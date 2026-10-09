from fastapi.testclient import TestClient

from backend.app import create_app

ORIGIN = "https://meterwise.test"


def test_estate_startup_defers_building_seed_and_preserves_role_scope(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        assert browser.get("/api/session?view=estate").status_code == 401
        response = browser.post("/api/session?view=estate", json={"role": "tenant"})
        assert response.status_code == 200
        assert response.json() == {"role": "tenant", "tenantId": "T01"}
        assert db.all("SELECT COUNT(*) AS n FROM readings")[0]["n"] == 0
        assert browser.get("/api/session?view=estate").json() == response.json()
        estate = browser.get("/api/estate/overview").json()
        assert len(estate["blocks"]) == 2
        assert browser.get("/api/estate/overview?town=Bishan").status_code == 403
        assert db.all("SELECT COUNT(*) AS n FROM readings")[0]["n"] == 0
        building = browser.get("/api/session").json()
        assert building["role"] == "tenant"
        assert building["meters"] and building["bounds"]["from"]
        assert db.all("SELECT COUNT(*) AS n FROM readings")[0]["n"] > 0
        assert browser.get("/api/dashboard").status_code == 200
        assert browser.get("/api/estate/overview").json()["bounds"] == estate["bounds"]
