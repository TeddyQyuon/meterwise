"""End-to-end tests for multi-tenant client onboarding, RBAC, API key ingestion, dynamic assets, and cumulative meters."""
from datetime import timedelta

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import add_days, day_start, iso, singapore_date

ORIGIN = "https://meterwise.test"


def test_organization_onboarding_login_and_dynamic_policy(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        reg = client.post("/api/auth/register", json={
            "orgName": "Jurong East Town Council",
            "name": "Tan Wei Ming",
            "email": "wm.tan@jetc.sg",
            "password": "StrongPassword123!",
            "tariff": 0.312,
        })
        assert reg.status_code == 201
        data = reg.json()
        assert data["user"]["email"] == "wm.tan@jetc.sg"
        assert data["role"] == "manager"

        me = client.get("/api/auth/me").json()
        assert me["isDemo"] is False
        assert me["orgName"] == "Jurong East Town Council"
        assert me["actorName"] == "Tan Wei Ming"

        # Verify dynamic tariff policy was initialized to S$0.312/kWh
        overview = client.get("/api/estate/overview").json()
        assert overview["policy"]["tariff"] == 0.312

        # Update policy
        updated = client.patch("/api/estate/policy", json={
            "tariff": 0.295,
            "gridFactor": 0.398,
            "highPriorityHours": 12,
            "otherPriorityHours": 48,
        })
        assert updated.status_code == 200
        assert updated.json()["tariff"] == 0.295
        assert updated.json()["gridFactor"] == 0.398

        # Logout and login again
        assert client.post("/api/auth/logout", json={}).status_code == 200
        login = client.post("/api/auth/login", json={
            "email": "wm.tan@jetc.sg",
            "password": "StrongPassword123!",
        })
        assert login.status_code == 200
        assert login.json()["orgName"] == "Jurong East Town Council"


def test_dynamic_estate_blocks_meters_teams_and_api_key_ingestion(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        client.post("/api/auth/register", json={
            "orgName": "Marine Parade Estate Ops",
            "name": "Sarah Lim",
            "email": "sarah@mpeo.sg",
            "password": "StrongPassword123!",
        })

        # Add custom block
        blk = client.post("/api/estate/blocks", json={
            "id": "B07",
            "town": "Marine Parade",
            "block": "88",
            "street": "MARINE PARADE CENTRAL",
            "units": 110,
            "floors": 16,
            "completed": 1995,
        })
        assert blk.status_code == 201

        # Add custom cumulative-register meter on B07
        mtr = client.post("/api/estate/meters", json={
            "id": "B07-PUMPS",
            "blockId": "B07",
            "service": "pumps",
            "name": "Booster Pump Bank A",
            "thresholdKwh": 12.0,
            "readingMode": "cumulative_register",
            "multiplier": 1.0,
        })
        assert mtr.status_code == 201

        # Add contractor team
        team = client.post("/api/estate/teams", json={
            "name": "Apex Mechanical Contractors Pte Ltd",
            "specialty": "pumps",
            "contactEmail": "dispatch@apexmech.sg",
        })
        assert team.status_code == 201
        assert any(t["name"] == "Apex Mechanical Contractors Pte Ltd" for t in client.get("/api/estate/teams").json())

        # Create API key and push cumulative register readings via webhook
        key_res = client.post("/api/auth/api-keys", json={"name": "B07 Modbus Gateway"})
        assert key_res.status_code == 201
        api_key = key_res.json()["apiKey"]
        assert api_key.startswith("mw_live_")

        end_day = add_days(singapore_date(), -1)
        t1 = iso(day_start(end_day) + timedelta(hours=1))
        t2 = iso(day_start(end_day) + timedelta(hours=2))
        csv_payload = f"meter_id,timestamp,consumption_kwh\nB07-PUMPS,{t1},100.0\nB07-PUMPS,{t2},104.5\n"

        webhook = client.post(
            "/api/v1/telemetry/ingest",
            json={"fileName": "gateway-push.csv", "csv": csv_payload},
            headers={"Authorization": f"Bearer {api_key}"},
        )
        assert webhook.status_code == 201
        assert webhook.json()["accepted"] == 2


def test_commercial_building_tenant_meter_and_tariff_crud(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
        client.post("/api/session", json={"role": "manager"})

        # Update building workspace name & tariff
        ws = client.patch("/api/workspace", json={"name": "One Raffles Place Tower 2", "tariff": 0.305})
        assert ws.status_code == 200
        assert ws.json()["tariff"] == 0.305

        # Add a new commercial tenant
        t_res = client.post("/api/tenants", json={
            "id": "T05",
            "name": "Merlion Fintech Labs",
            "floor": "Level 12",
            "color": "#1d6f58",
        })
        assert t_res.status_code == 201

        # Map a new sub-meter to T05
        m_res = client.post("/api/meters", json={
            "id": "MW-007",
            "name": "Level 12 Server & HVAC",
            "location": "Level 12 DB-A",
            "tenantId": "T05",
            "threshold": 25.0,
            "intervalMinutes": 60,
        })
        assert m_res.status_code == 201
        info = client.get("/api/session").json()
        assert any(t["id"] == "T05" for t in info["tenants"])
        assert any(m["id"] == "MW-007" for m in info["meters"])
