from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

from fastapi.testclient import TestClient

from backend.app import create_app
from backend.core import now, sha256
from backend.csv_import import parse_csv
from backend.database import SQLiteDatabase

ORIGIN = "https://meterwise.test"


def test_estate_imports_reports_duplicates_and_building_are_preserved(client, db):
    assert client.get("/api/dashboard").json()["metrics"]["missing"] == 8
    initial = client.get("/api/estate/overview").json()
    assert (len(initial["blocks"]), len(initial["meters"]), initial["metrics"]["units"]) == (6, 24, 620)
    assert initial["metrics"]["expected"] - initial["metrics"]["received"] == 2
    assert initial["metrics"]["grid"] is None
    sample = client.get("/api/estate/sample.csv").text
    assert client.post("/api/estate/imports/preview", json={"csv": sample}).json()["valid"] == 2
    response = client.post("/api/estate/imports/commit", json={"csv": sample, "fileName": "estate.csv"})
    assert response.status_code == 201 and response.json()["accepted"] == 2
    ready = client.get("/api/estate/overview").json()
    metrics = ready["metrics"]
    assert metrics["coverage"] == 100 and metrics["change"] is not None
    assert abs(metrics["load"] - metrics["grid"] - metrics["selfConsumed"]) < 0.02
    assert abs(metrics["solar"] - metrics["exported"] - metrics["selfConsumed"]) < 0.02
    assert abs(metrics["co2Kg"] - metrics["grid"] * 0.402) < 0.02
    assert abs(metrics["cost"] - metrics["grid"] * 0.285) < 0.02
    assert client.post("/api/estate/imports/commit", json={"csv": sample, "fileName": "again.csv"}).json()["alreadyImported"]
    assert len(client.get("/api/estate/imports").json()) == 1
    assert client.post("/api/estate/imports/preview", json={"csv": sample}).json()["duplicate"] == 2
    assert client.get("/api/dashboard").json()["metrics"]["missing"] == 8
    report = parse_csv(client.get("/api/estate/report.csv").text)
    assert len(report) == 7 and report[1]["cells"][14:16] == ["2024", "0.402"]
    assert "SIMULATED" in report[1]["cells"][17] and "data.gov.sg" in report[1]["cells"][18]
    assert len(db.all("SELECT * FROM estate_state")) == 1
    assert client.get("/api/estate/overview?from=2026-02-30&to=2026-03-01").status_code == 400
    assert client.get("/api/estate/overview?town=Bishan&block=B01").status_code == 400


def test_order_transitions_conflicting_updates_and_atomic_audit(client, order):
    path = "/api/estate/orders/" + quote(order["id"], safe="")
    patch = {"version": 1, "status": "verified", "assignee": "Pump team (demo)", "note": "Simulated inspection evidence and a completed check."}
    assert client.patch(path, json=patch).status_code == 400
    patch["status"] = "in_progress"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.patch(path, json=patch).status_code, range(2)))
    assert sorted(results) == [200, 409]
    detail = client.get(path).json()
    assert detail["version"] == 2 and len(detail["events"]) == 2
    assert client.patch(path, json={**patch, "status": "completed"}).status_code == 409
    assert client.patch(path, json={**patch, "version": 2, "status": "completed", "note": "tiny"}).status_code == 400
    for version, status in [(2, "completed"), (3, "verified")]:
        assert client.patch(path, json={**patch, "version": version, "status": status}).status_code == 200
    detail = client.get(path).json()
    assert detail["status"] == "verified" and detail["version"] == 4 and len(detail["events"]) == 4


def test_estate_area_roles_and_visitors_are_isolated(client, db, order):
    path = "/api/estate/orders/" + quote(order["id"], safe="")
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as other:
        assert other.post("/api/session", json={"role": "manager"}).status_code == 200
        assert other.get(path).status_code == 404
        assert other.get("/api/estate/overview").json()["orders"] == []
        assert other.get("/api/estate/imports").json() == []
    assert client.post("/api/session", json={"role": "tenant"}).status_code == 200
    area = client.get("/api/estate/overview").json()
    assert len(area["blocks"]) == 2 and len(area["meters"]) == 8
    assert all(block["town"] == "Ang Mo Kio" for block in area["blocks"])
    for path, code in [("/api/estate/overview?town=Bishan", 403), ("/api/estate/overview?block=B03", 404),
                       (path, 404), ("/api/estate/sample.csv", 403), ("/api/estate/imports", 403)]:
        assert client.get(path).status_code == code
    for path in ["/api/estate/orders", "/api/estate/imports/commit", "/api/estate/imports/preview"]:
        assert client.post(path, json={}).status_code == 403
    report = client.get("/api/estate/report.csv").text
    assert len(parse_csv(report)) == 3 and "BISHAN ST" not in report and "TAMPINES ST" not in report


def test_building_import_alert_notes_mapping_and_role_switch(client):
    initial = client.get("/api/dashboard").json()
    sample = client.get("/api/sample.csv").text
    preview = client.post("/api/imports/preview", json={"csv": sample}).json()
    assert preview["valid"] == 8
    assert client.post("/api/imports/commit", json={"csv": sample, "fileName": "repair.csv"}).json()["accepted"] == 8
    filled = client.get("/api/dashboard").json()
    assert filled["metrics"]["missing"] == 0 and filled["metrics"]["coverage"] == 100
    gap = next(alert for alert in filled["alerts"] if alert["type"] == "missing_data")
    assert gap["status"] == "resolved"
    gap_path = "/api/alerts/" + quote(gap["id"], safe="")
    assert "restored" in client.get(gap_path).json()["notes"][0]["body"]
    spike = next(alert for alert in initial["alerts"] if alert["meter_id"] == "MW-002")
    path = "/api/alerts/" + quote(spike["id"], safe="")
    assert client.patch(path, json={"status": "resolved", "note": ""}).status_code == 400
    assert client.patch(path, json={"status": "resolved", "note": "Inspected the simulated air conditioning schedule."}).status_code == 200
    old_token = client.cookies.get("mw_session")
    assert client.post("/api/session", json={"role": "tenant"}).status_code == 200
    assert len(client.get("/api/dashboard").json()["meters"]) == 2
    assert client.post("/api/imports/commit", json={"csv": sample, "fileName": "blocked.csv"}).status_code == 403
    assert client.patch("/api/meters/MW-001", json={"tenantId": "T02", "threshold": 19}).status_code == 403
    assert client.get("/api/dashboard?tenant=T02").status_code == 403
    assert client.get("/api/dashboard?meter=MW-003").status_code == 404
    assert client.get("/api/reports.csv").status_code == 200
    tenant_token = client.cookies.get("mw_session")
    client.cookies.set("mw_session", old_token, domain="meterwise.test", path="/")
    assert client.get("/api/dashboard").status_code == 401
    client.cookies.set("mw_session", tenant_token, domain="meterwise.test", path="/")
    client.post("/api/session", json={"role": "manager"})
    assert client.patch("/api/meters/MW-001", json={"tenantId": "T02", "threshold": 19}).status_code == 200
    assert client.get("/api/session").json()["meters"][0]["tenant_id"] == "T02"
    client.post("/api/session", json={"role": "manager"})
    assert len(client.get("/api/imports").json()) == 1


def test_existing_node_cookie_identity_and_persistent_database_restart(tmp_path):
    path = str(tmp_path / "migration.sqlite")
    database = SQLiteDatabase(path)
    with TestClient(create_app(database), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        browser.post("/api/session", json={"role": "manager"})
        visitor = browser.cookies.get("mw_visitor")
        workspace = sha256("vercel-demo:" + visitor)[:24]
        # Old Node sessions used UUID pairs and epoch-millisecond expirations.
        old_token = "11111111-1111-4111-8111-11111111111122222222-2222-4222-8222-222222222222"
        database.run("INSERT INTO sessions (token_hash,workspace_id,role,tenant_id,expires_at) VALUES (?,?,?,?,?)",
                     [sha256(old_token), workspace, "manager", None, int(now().timestamp() * 1000) + 600000])
        browser.cookies.set("mw_session", old_token, domain="meterwise.test", path="/")
        assert browser.get("/api/session").status_code == 200
        sample = browser.get("/api/estate/sample.csv").text
        browser.post("/api/estate/imports/commit", json={"csv": sample, "fileName": "persist.csv"})
        cookies = dict(browser.cookies)
        # A historical seed window must survive a new runtime and later date.
        end_day = database.all("SELECT end_day FROM estate_state WHERE workspace_id=?", [workspace])[0]["end_day"]
    database.close()
    database = SQLiteDatabase(path)
    with TestClient(create_app(database), base_url=ORIGIN, headers={"Origin": ORIGIN}, cookies=cookies) as restored:
        response = restored.get("/api/estate/overview")
        assert response.status_code == 200
        assert response.json()["bounds"]["to"] == end_day
        assert response.json()["metrics"]["coverage"] == 100
        assert len(restored.get("/api/estate/imports").json()) == 1
    database.close()
