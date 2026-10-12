"""Integration and security tests for FastAPI Estate ML endpoints and work-order triage."""
from fastapi.testclient import TestClient
import pytest

from backend.app import create_app
from backend.core import sha256

ORIGIN = "https://meterwise.test"


def test_ml_forecast_endpoint_get(client):
    res = client.get("/api/estate/ml/forecast")
    assert res.status_code == 200
    data = res.json()

    assert data["horizon_hours"] == 24
    assert "summary" in data
    assert "blocks" in data

    summary = data["summary"]
    assert summary["blocks_count"] == 6
    assert summary["total_load_kwh"] > 0
    assert summary["total_solar_kwh"] > 0
    assert summary["total_grid_kwh"] > 0
    assert 0.0 <= summary["solar_offset_percentage"] <= 100.0
    assert summary["average_load_mae"] >= 0.0
    assert summary["average_solar_mae"] >= 0.0

    assert len(data["blocks"]) == 6
    for b in data["blocks"]:
        assert len(b["hourly"]) == 24
        assert b["load_metrics"]["mae"] >= 0.0
        assert b["solar_metrics"]["mae"] >= 0.0


def test_ml_forecast_query_params_and_post(client):
    # Query specific block and 48-hour horizon
    res = client.get("/api/estate/ml/forecast?block=B01&horizon_hours=48&model_type=gradient_boosting")
    assert res.status_code == 200
    data = res.json()
    assert data["horizon_hours"] == 48
    assert len(data["blocks"]) == 1
    assert data["blocks"][0]["block_id"] == "B01"
    assert len(data["blocks"][0]["hourly"]) == 48

    # POST payload
    payload = {"block": "B02", "horizon_hours": 24, "model_type": "lightgbm"}
    post_res = client.post("/api/estate/ml/forecast", json=payload)
    assert post_res.status_code == 200
    post_data = post_res.json()
    assert len(post_data["blocks"]) == 1
    assert post_data["blocks"][0]["block_id"] == "B02"


def test_ml_forecast_validation_errors(client):
    # Invalid horizon
    assert client.get("/api/estate/ml/forecast?horizon_hours=0").status_code == 400
    assert client.get("/api/estate/ml/forecast?horizon_hours=100").status_code == 400

    # Invalid model type
    assert client.get("/api/estate/ml/forecast?model_type=deep_learning").status_code == 400

    # Unknown block
    assert client.get("/api/estate/ml/forecast?block=B99").status_code == 404


def test_ml_anomalies_endpoint_get_and_post(client):
    res = client.get("/api/estate/ml/anomalies")
    assert res.status_code == 200
    data = res.json()

    assert "total_anomalies" in data
    assert "summary" in data
    assert "anomalies" in data
    assert data["total_anomalies"] >= 1

    summary = data["summary"]
    assert "high_severity" in summary
    assert "medium_severity" in summary
    assert "by_service" in summary

    # Pump filter
    pump_res = client.get("/api/estate/ml/anomalies?service=pumps")
    assert pump_res.status_code == 200
    pump_data = pump_res.json()
    assert all(a["service"] == "pumps" for a in pump_data["anomalies"])

    # Block filter
    b03_res = client.get("/api/estate/ml/anomalies?block=B03")
    assert b03_res.status_code == 200
    b03_data = b03_res.json()
    assert all(a["block_id"] == "B03" for a in b03_data["anomalies"])

    # POST payload with sensitivity
    post_res = client.post("/api/estate/ml/anomalies", json={"service": "lighting", "sensitivity": 0.08})
    assert post_res.status_code == 200
    assert all(a["service"] == "lighting" for a in post_res.json()["anomalies"])


def test_ml_anomalies_validation_errors(client):
    # Invalid service
    assert client.get("/api/estate/ml/anomalies?service=hvac").status_code == 400

    # Invalid sensitivity
    assert client.get("/api/estate/ml/anomalies?sensitivity=0.5").status_code == 400

    # Unknown block
    assert client.get("/api/estate/ml/anomalies?block=B99").status_code == 404


def test_ml_tenant_area_enforcement(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as t_client:
        # Sign in as tenant (restricted to Ang Mo Kio: B01, B02)
        t_res = t_client.post("/api/session", json={"role": "tenant"})
        assert t_res.status_code == 200

        # Permitted block B01 (Ang Mo Kio) succeeds
        b01_res = t_client.get("/api/estate/ml/forecast?block=B01")
        assert b01_res.status_code == 200
        assert len(b01_res.json()["blocks"]) == 1

        # Unpermitted block B03 (Bishan) returns 404
        b03_res = t_client.get("/api/estate/ml/forecast?block=B03")
        assert b03_res.status_code == 404

        # Same restriction on anomalies endpoint
        assert t_client.get("/api/estate/ml/anomalies?block=B03").status_code == 404
        assert t_client.get("/api/estate/ml/anomalies?block=B01").status_code == 200


def test_ml_security_csrf_and_unauthenticated(db):
    with TestClient(create_app(db), base_url=ORIGIN) as unauth_client:
        # Unauthenticated request without session cookie
        unauth_res = unauth_client.get("/api/estate/ml/forecast")
        assert unauth_res.status_code == 401

    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as auth_client:
        auth_client.post("/api/session", json={"role": "manager"})

        # Cross-origin request without trusted origin is rejected
        cross_res = auth_client.get("/api/estate/ml/forecast", headers={"Origin": "https://malicious-site.com"})
        # GET is safe method; test mutating POST
        cross_post = auth_client.post(
            "/api/estate/ml/forecast",
            json={"block": "B01"},
            headers={"Origin": "https://malicious-site.com"},
        )
        assert cross_post.status_code == 403


def test_automated_work_order_triage_flow(client, db):
    """End-to-end test verifying ML anomaly detection triages into an audit-logged work order."""
    # 1. Detect anomalies for pumps
    anom_res = client.get("/api/estate/ml/anomalies?service=pumps")
    assert anom_res.status_code == 200
    anomalies = anom_res.json()["anomalies"]
    assert len(anomalies) >= 1

    # Pick the B03 pump spike anomaly
    pump_anom = next(a for a in anomalies if a["meter_id"] == "B03-PUMPS")
    assert pump_anom["severity"] == "high"
    assert pump_anom["actual_kwh"] > 10.0

    # 2. Automated triage creates a work order using ML telemetry
    triage_order_payload = {
        "meterId": pump_anom["meter_id"],
        "title": f"Triage: {pump_anom['anomaly_type']} on {pump_anom['meter_id']}",
        "priority": pump_anom["severity"],
        "note": f"ML detected {pump_anom['actual_kwh']} kWh (baseline {pump_anom['expected_kwh']} kWh, confidence {pump_anom['anomaly_confidence']}). Diagnosis: {pump_anom['root_cause']}. Action: {pump_anom['recommended_action']}",
    }

    create_res = client.post("/api/estate/orders", json=triage_order_payload)
    assert create_res.status_code == 201
    created_order = create_res.json()

    assert created_order["meter_id"] == "B03-PUMPS"
    assert created_order["status"] == "open"
    assert created_order["version"] == 1
    assert "Triage: pump_night_leak" in created_order["title"]

    # 3. Verify order exists and has initial audit event recorded
    order_id = created_order["id"]
    from urllib.parse import quote
    detail_res = client.get(f"/api/estate/orders/{quote(order_id, safe='')}")
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["version"] == 1
    assert len(detail["events"]) == 1
    assert detail["events"][0]["action"] == "created"
    assert "ML detected" in detail["events"][0]["body"]
