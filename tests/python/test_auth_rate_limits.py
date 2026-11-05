"""Authentication budgets must survive app instances and race atomically."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from backend import app as module
from backend import rate_limit
from backend.app import create_app
from backend.core import ApiError
from backend.database import SQLiteDatabase

ORIGIN = "https://meterwise.test"


@pytest.fixture
def clock(monkeypatch):
    current = [1_800_000_000]
    monkeypatch.setattr(rate_limit.time, "time", lambda: current[0])
    monkeypatch.delenv("VERCEL", raising=False)
    return current


@pytest.fixture
def rejected_auth(monkeypatch):
    attempts = []
    def reject(db, body):
        attempts.append(body)
        raise ApiError(401, "Invalid email or password.")
    monkeypatch.setattr(module, "authenticate_user", reject)
    return attempts


def browser(db, address="198.51.100.1"):
    return TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN},
                      client=(address, 12345))


def login(client, email="person@example.test", **headers):
    return client.post("/api/auth/login", json={"email": email, "password": "WrongPassword123!"},
                       headers=headers)


def test_account_budget_shared_across_apps_sources_and_normalized_email(db, clock, rejected_auth):
    with browser(db) as first:
        assert all(login(first).status_code == 401 for _ in range(5))
    with browser(db, "198.51.100.2") as second:
        assert all(login(second, " PERSON@EXAMPLE.TEST ").status_code == 401 for _ in range(5))
        blocked = login(second)
        assert blocked.status_code == 429
        assert 1 <= int(blocked.headers["retry-after"]) <= 900
        assert blocked.headers["cache-control"] == "no-store"
        assert len(rejected_auth) == 10
        clock[0] += 901
        assert login(second).status_code == 401
    assert db.all("SELECT COUNT(*) AS total FROM auth_rate_buckets WHERE expires_at<=?", [clock[0]])[0]["total"] == 0


def test_source_budget_cannot_be_bypassed_by_account_or_forwarded_header_rotation(db, clock, rejected_auth):
    with browser(db) as client:
        for i in range(30):
            assert login(client, f"person-{i}@example.test", **{
                "X-Forwarded-For": f"203.0.113.{i + 1}",
                "X-Vercel-Forwarded-For": f"203.0.113.{i + 1}",
            }).status_code == 401
        assert login(client, "new@example.test").status_code == 429
    assert len(rejected_auth) == 30


def test_registration_budget_runs_before_password_hashing(db, clock, monkeypatch):
    attempts = []
    def reject(db, body):
        attempts.append(body)
        raise ApiError(400, "Invalid account details.")
    monkeypatch.setattr(module, "register_organization", reject)
    with browser(db) as client:
        for _ in range(5):
            assert client.post("/api/auth/register", json={}).status_code == 400
        response = client.post("/api/auth/register", json={})
        assert response.status_code == 429
        assert 1 <= int(response.headers["retry-after"]) <= 3600
    assert len(attempts) == 5


def test_two_database_connections_cannot_race_past_limit(tmp_path, clock):
    path = tmp_path / "shared.sqlite"
    databases = [SQLiteDatabase(path), SQLiteDatabase(path)]
    def attempt(i):
        try:
            rate_limit.consume(databases[i % 2], "test", "shared-account", 10, 900, clock[0])
            return True
        except ApiError as exc:
            assert exc.status == 429
            return False
    try:
        with ThreadPoolExecutor(max_workers=8) as workers:
            assert sum(workers.map(attempt, range(32))) == 10
    finally:
        for db in databases:
            db.close()
