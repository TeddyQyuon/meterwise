"""Comprehensive tests for MeterWise ML module:
- Time-series lag, cyclic, weather proxies, and block metadata feature engineering
- LightGBM energy demand and rooftop solar forecasting
- Isolation Forest & contextual residual anomaly detection
- Clean FastAPI endpoints with Pydantic request/response validation
"""
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import pytest

from backend.estate import BLOCKS, METERS
from backend.ml.anomaly import EstateAnomalyDetector
from backend.ml.features import (
    TimeSeriesFeatureExtractor,
    compute_lag_rolling_features,
    compute_singapore_weather_proxies,
    extract_datetime_components,
    get_block_features,
)
from backend.ml.forecasting import EnergyDemandSolarForecaster
from backend.ml.schemas import AnomalyResponse, ForecastResponse


def test_feature_engineering_cyclics_weather_and_block_metadata():
    """Verify temporal cyclic features, Singapore weather proxies, and block metadata."""
    # Create synthetic hourly timestamps across a full day in SGT
    # 2026-10-10 00:00 SGT is 2026-10-09 16:00 UTC
    dt_index = pd.date_range("2026-10-09 16:00:00+00:00", periods=24, freq="h")
    s_dt = pd.Series(dt_index)

    # 1. Cyclical time components
    temporal = extract_datetime_components(s_dt)
    assert len(temporal) == 24
    assert temporal["hour"].iloc[0] == 0  # Midnight SGT
    assert temporal["hour"].iloc[12] == 12  # Noon SGT
    assert np.all(temporal["hour_sin"] >= -1.0) and np.all(temporal["hour_sin"] <= 1.0)
    assert np.all(temporal["hour_cos"] >= -1.0) and np.all(temporal["hour_cos"] <= 1.0)
    assert temporal["is_night"].iloc[0] == 1  # 00:00 is night
    assert temporal["is_night"].iloc[12] == 0  # 12:00 is day

    # 2. Singapore weather and solar proxies
    weather = compute_singapore_weather_proxies(temporal["hour"])
    # Solar elevation proxy must be 0 at night (00:00 to 06:00 and 19:00 to 23:00)
    assert weather["solar_elevation_proxy"].iloc[0] == 0.0
    assert weather["solar_elevation_proxy"].iloc[5] == 0.0
    assert weather["solar_elevation_proxy"].iloc[20] == 0.0
    # Peak solar elevation around 13:00 SGT
    assert weather["solar_elevation_proxy"].iloc[13] == pytest.approx(1.0, abs=0.01)
    # Daylight indicator
    assert weather["is_daylight"].iloc[12] == 1
    assert weather["is_daylight"].iloc[2] == 0

    # 3. Block metadata features
    block_b01 = next(b for b in BLOCKS if b["id"] == "B01")
    b_feats = get_block_features(block_b01)
    assert b_feats["block_units"] == 88.0
    assert b_feats["block_floors"] == 12.0
    assert b_feats["block_scale"] == 0.88
    assert b_feats["block_age"] == 2026.0 - 1977.0

    # 4. Lag and rolling features
    values = pd.Series([10.0 + i for i in range(50)])
    lags = compute_lag_rolling_features(values)
    assert "lag_1" in lags.columns
    assert "lag_24" in lags.columns
    assert "rolling_mean_24" in lags.columns
    assert "rolling_std_24" in lags.columns
    assert not lags.isnull().values.any()


def test_forecasting_pipeline_metrics_and_horizons():
    """Verify LightGBM demand and solar forecasting with backtest metrics and prediction intervals."""
    block_b01 = next(b for b in BLOCKS if b["id"] == "B01")
    hours = 14 * 24
    dt_base = pd.date_range("2026-09-28 16:00:00+00:00", periods=hours, freq="h")

    # Generate synthetic history matching Singapore diurnal pattern
    load_vals = []
    solar_vals = []
    for dt in dt_base:
        h = dt.tz_convert("Asia/Singapore").hour
        load = (4.4 if h >= 19 or h < 7 else 1.9) * 0.88 + (5.6 if 7 <= h < 22 else 1.2) * 0.88 + 2.0
        daylight = max(0.0, np.sin((h - 7) / 12 * np.pi))
        solar = daylight * 21.0
        load_vals.append(load)
        solar_vals.append(solar)

    df_hist = pd.DataFrame({
        "timestamp": dt_base.to_pydatetime(),
        "load_kwh": load_vals,
        "solar_kwh": solar_vals,
    })

    forecaster = EnergyDemandSolarForecaster(model_type="lightgbm")

    # 24-hour horizon forecast
    fc24 = forecaster.forecast_block(df_hist, block_b01, horizon_hours=24)
    assert fc24.block_id == "B01"
    assert len(fc24.hourly) == 24
    assert fc24.load_metrics.mae >= 0.0
    assert fc24.load_metrics.rmse >= 0.0
    assert fc24.load_metrics.r2 >= 0.0
    assert fc24.solar_metrics.mae >= 0.0
    assert fc24.solar_metrics.r2 >= 0.0

    # 48-hour horizon forecast
    fc48 = forecaster.forecast_block(df_hist, block_b01, horizon_hours=48)
    assert len(fc48.hourly) == 48

    # Verify prediction intervals and night solar constraints
    for pt in fc24.hourly:
        assert pt.load_lower_kwh <= pt.predicted_load_kwh <= pt.load_upper_kwh
        assert pt.solar_lower_kwh <= pt.predicted_solar_kwh <= pt.solar_upper_kwh
        # Solar must be 0 at night in SGT
        if pt.hour < 7 or pt.hour >= 19:
            assert pt.predicted_solar_kwh == 0.0
            assert pt.solar_lower_kwh == 0.0
        # Energy balance consistency
        assert pt.predicted_grid_kwh == pytest.approx(max(0.0, pt.predicted_load_kwh - pt.predicted_solar_kwh), abs=0.01)
        assert pt.predicted_export_kwh == pytest.approx(max(0.0, pt.predicted_solar_kwh - pt.predicted_load_kwh), abs=0.01)


def test_anomaly_detection_isolation_forest_and_root_cause(client, db):
    """Verify Isolation Forest accurately catches B03 pump leak and B02 lighting surge with diagnostic root cause."""
    res = client.get("/api/estate/ml/anomalies")
    assert res.status_code == 200
    data = res.json()

    # Validated against Pydantic schema
    validated = AnomalyResponse.model_validate(data)
    assert validated.total_anomalies >= 2

    # Check B03-PUMPS night leak detection
    pump_anomalies = [a for a in validated.anomalies if a.meter_id == "B03-PUMPS"]
    assert len(pump_anomalies) >= 1
    leak = pump_anomalies[0]
    assert leak.severity == "high"
    assert leak.anomaly_type == "pump_night_leak"
    assert leak.anomaly_confidence >= 0.80
    assert "pipe leak" in leak.root_cause.lower() or "float switch" in leak.root_cause.lower()
    assert "plumbing" in leak.recommended_action.lower()

    # Check B02-LIGHTING spike detection
    lighting_anomalies = [a for a in validated.anomalies if a.meter_id == "B02-LIGHTING"]
    assert len(lighting_anomalies) >= 1
    light = lighting_anomalies[0]
    assert light.severity == "high"
    assert light.anomaly_type == "lighting_night_spike"
    assert light.anomaly_confidence >= 0.80
    assert "lighting" in light.root_cause.lower()

    # Test service filtering
    res_pumps = client.get("/api/estate/ml/anomalies?service=pumps")
    assert res_pumps.status_code == 200
    p_data = res_pumps.json()
    assert all(a["service"] == "pumps" for a in p_data["anomalies"])

    # Test block filtering
    res_b03 = client.get("/api/estate/ml/anomalies?block=B03")
    assert res_b03.status_code == 200
    b_data = res_b03.json()
    assert all(a["block_id"] == "B03" for a in b_data["anomalies"])


def test_ml_forecast_endpoints_get_and_post(client):
    """Verify GET and POST endpoints for ML forecasts with portfolio aggregation."""
    # 1. GET forecast for single block 24h
    res_get = client.get("/api/estate/ml/forecast?block=B01&horizon_hours=24")
    assert res_get.status_code == 200
    f_get = ForecastResponse.model_validate(res_get.json())
    assert f_get.horizon_hours == 24
    assert len(f_get.blocks) == 1
    assert len(f_get.blocks[0].hourly) == 24
    assert f_get.summary.blocks_count == 1

    # 2. POST forecast for all blocks 48h
    payload = {"block": "all", "horizon_hours": 48, "model_type": "lightgbm"}
    res_post = client.post("/api/estate/ml/forecast", json=payload)
    assert res_post.status_code == 200
    f_post = ForecastResponse.model_validate(res_post.json())
    assert f_post.horizon_hours == 48
    assert len(f_post.blocks) == 6
    assert f_post.summary.total_load_kwh > 0.0
    assert f_post.summary.total_solar_kwh > 0.0
    assert f_post.summary.solar_offset_percentage >= 0.0


def test_ml_endpoints_permissions_and_validations(client):
    """Verify area view restrictions and parameter validation bounds."""
    # 1. Invalid horizon
    res_bad_h = client.get("/api/estate/ml/forecast?horizon_hours=100")
    assert res_bad_h.status_code == 400

    # 2. Invalid service
    res_bad_svc = client.get("/api/estate/ml/anomalies?service=aircon")
    assert res_bad_svc.status_code == 400

    # 3. Invalid sensitivity
    res_bad_sens = client.get("/api/estate/ml/anomalies?sensitivity=0.9")
    assert res_bad_sens.status_code == 400

    # 4. Tenant role scoping
    client.post("/api/session", json={"role": "tenant"})
    # Tenant can view Ang Mo Kio block B01
    res_t_ok = client.get("/api/estate/ml/forecast?block=B01")
    assert res_t_ok.status_code == 200
    # Tenant cannot view Bishan block B03
    res_t_denied = client.get("/api/estate/ml/forecast?block=B03")
    assert res_t_denied.status_code == 404
