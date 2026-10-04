import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from backend import app as module
from backend.app import create_app
from backend.core import MAX_REQUEST_BYTES
from backend.csv_import import preview_import
from backend.seed import METERS, provision_workspace

ORIGIN = "https://meterwise.test"


@pytest.mark.parametrize("origin,fetch_site", [(None, None), ("https://evil.test", None),
    ("https://meterwise.test:8443", None), ("http://meterwise.test", None),
    ("https://meterwise.test.evil.test", None), (ORIGIN, "cross-site")])
def test_write_origin_rejected_before_database_load(monkeypatch, origin, fetch_site):
    def unavailable():
        pytest.fail("Database must not be reached")
    monkeypatch.setattr(module, "get_database", unavailable)
    headers = {}
    if origin:
        headers["Origin"] = origin
    if fetch_site:
        headers["Sec-Fetch-Site"] = fetch_site
    with TestClient(create_app(), base_url=ORIGIN) as browser:
        assert browser.post("/api/session", json={"role": "manager"}, headers=headers).status_code == 403


@pytest.mark.parametrize("body", [b"null", b"[]", b'"manager"', b"42", b"{broken", b'{"role":NaN}',
                                br'{"role":"\ud800"}', b'{"value":1e309}', b'\x7b\xc3\x28\x7d'])
def test_bad_json_utf8_types_and_nonfinite_numbers_precede_database(monkeypatch, body):
    monkeypatch.setattr(module, "get_database", lambda: pytest.fail("Database must not be reached"))
    with TestClient(create_app(), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        assert browser.post("/api/session", content=body, headers={"Content-Type": "application/json"}).status_code == 400


def test_content_type_declared_and_multibyte_body_limits(monkeypatch):
    monkeypatch.setattr(module, "get_database", lambda: pytest.fail("Database must not be reached"))
    with TestClient(create_app(), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        assert browser.post("/api/session", content='{}', headers={"Content-Type": "text/plain"}).status_code == 415
        assert browser.post("/api/session", content='{}', headers={"Content-Type": "application/json", "Content-Length": str(MAX_REQUEST_BYTES + 1)}).status_code == 413
        assert browser.post("/api/session", content=json.dumps({"csv": "é" * 560000}, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"}).status_code == 413


def test_unbounded_asgi_stream_stops_receiving_after_limit(monkeypatch):
    monkeypatch.setattr(module, "get_database", lambda: pytest.fail("Database must not be reached"))
    pulls, messages = [], []
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
             "scheme": "https", "path": "/api/session", "raw_path": b"/api/session", "query_string": b"",
             "headers": [(b"host", b"meterwise.test"), (b"origin", ORIGIN.encode()), (b"content-type", b"application/json")],
             "server": ("meterwise.test", 443), "client": ("127.0.0.1", 1234), "root_path": ""}
    async def receive():
        pulls.append(1)
        return {"type": "http.request", "body": b"x" * 300000, "more_body": True}
    async def send(message):
        messages.append(message)
    asyncio.run(create_app()(scope, receive, send))
    assert next(message for message in messages if message["type"] == "http.response.start")["status"] == 413
    assert len(pulls) <= 5


def test_secure_cookies_headers_failures_health_and_no_platform_identity(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        assert browser.get("/api/session", headers={"x-openai-user-id": "spoofed-owner"}).status_code == 401
        response = browser.post("/api/session", json={"role": "manager"})
        cookies = response.headers.get_list("set-cookie")
        assert len(cookies) == 2
        for cookie in cookies:
            for value in ["HttpOnly", "SameSite=lax", "Max-Age=604800", "Secure"]:
                assert value in cookie
        assert len(browser.cookies.get("mw_visitor")) == 64
        sample = browser.get("/api/sample.csv")
        health = browser.get("/api/health")
        assert health.json()["backend"] == "Python" and health.json()["framework"] == "FastAPI"
        for response in [response, sample, health, browser.get("/api/missing")]:
            assert response.headers["cache-control"] == "no-store"
            assert response.headers["x-content-type-options"] == "nosniff"
            assert "default-src 'none'" in response.headers["content-security-policy"]
            assert response.headers["strict-transport-security"] == "max-age=31536000"
        browser.cookies.set("mw_visitor", "f" * 64, domain="meterwise.test", path="/")
        assert browser.get("/api/session").status_code == 401


def test_database_errors_expose_no_sql_or_credentials(monkeypatch):
    def fail():
        raise RuntimeError("libsql://secret/token SQL SELECT hidden_table")
    monkeypatch.setattr(module, "get_database", fail)
    with TestClient(create_app(), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        response = browser.post("/api/session", json={"role": "manager"})
        assert response.status_code == 503
        assert "secret" not in response.text and "hidden_table" not in response.text
        assert response.headers.get("set-cookie") is None
        assert response.headers["cache-control"] == "no-store"


def test_candidate_queries_are_bounded_and_bad_files_never_query_history(client, db):
    queries = []
    class Traced:
        def all(self, sql, params=()):
            queries.append((sql, params))
            return db.all(sql, params)
    text = "meter_id,timestamp,consumption_kwh\n" + "\n".join(f"MW-001,2026-09-{day:02}T{hour:02}:00:00Z,2" for day in range(1, 4) for hour in range(24))
    workspace = db.all("SELECT id FROM workspaces")[0]["id"]
    preview_import(Traced(), workspace, text, METERS)
    assert len(queries) == 2
    assert all(len(params) <= 81 and "meter_id=? AND recorded_at=?" in sql for sql, params in queries)
    queries.clear()
    preview_import(Traced(), workspace, "meter_id,timestamp,consumption_kwh\nUNKNOWN,invalid,-1", METERS)
    assert queries == []
    for filename in ["../readings.csv", "folder\\readings.csv", "bad\n.csv", ""]:
        assert client.post("/api/imports/commit", json={"csv": text, "fileName": filename}).status_code == 400
        assert client.post("/api/estate/imports/commit", json={"csv": text, "fileName": filename}).status_code == 400


def test_failed_atomic_batch_and_workspace_capacity(db):
    with pytest.raises(Exception):
        db.batch([("INSERT INTO workspaces (id,name,tariff,seeded,created_at) VALUES (?,?,?,?,?)", ["rollback", "Test", .285, 0, "2026-10-01"]),
                  ("INSERT INTO table_not_present (id) VALUES (?)", ["fail"])])
    assert db.all("SELECT id FROM workspaces") == []
    assert provision_workspace(db, "one", 2)
    assert provision_workspace(db, "two", 2)
    assert not provision_workspace(db, "three", 2)
    assert provision_workspace(db, "one", 2)
    with TestClient(create_app(db, workspace_limit=2), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        assert browser.post("/api/session", json={"role": "manager"}).status_code == 503


def test_local_proxy_allowlist_is_explicit_and_disabled_in_vercel(db, monkeypatch):
    local = "http://localhost:5173"
    with TestClient(create_app(db, trusted_origins=(local,)), base_url="http://127.0.0.1:3001") as browser:
        assert browser.post("/api/session", json={"role": "manager"}, headers={"Origin": local}).status_code == 200
        assert browser.post("/api/session", json={"role": "manager"}, headers={"Origin": local + ".evil.test"}).status_code == 403
        monkeypatch.setenv("VERCEL", "1")
        assert browser.post("/api/session", json={"role": "manager"}, headers={"Origin": local}).status_code == 403
