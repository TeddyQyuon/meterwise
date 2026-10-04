"""Exercise the actual HTTP adapter against SQLite, with a Hrana protocol transport.

This checks transaction semantics and typed values without live credentials.
Production is subsequently tested against the connected Turso database.
"""
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import DatabaseError, TursoDatabase, decoded, encoded


class HranaSQLite:
    def __init__(self):
        self.connection = sqlite3.connect(":memory:", check_same_thread=False, isolation_level=None)
        self.calls = []

    def execute(self, stmt):
        cursor = self.connection.execute(stmt["sql"], [decoded(value) for value in stmt.get("args", [])])
        rows = cursor.fetchall() if stmt.get("want_rows") else []
        return {"cols": [{"name": col[0]} for col in cursor.description or []],
                "rows": [[encoded(value) for value in row] for row in rows],
                "affected_row_count": max(0, cursor.rowcount)}

    def condition(self, condition, results):
        if condition["type"] == "ok":
            return results[condition["step"]] is not None
        if condition["type"] == "not":
            return not self.condition(condition["cond"], results)
        raise AssertionError("Unexpected condition")

    def __call__(self, request):
        assert request.url == "https://test-db.example/v2/pipeline"
        payload = json.loads(request.content)
        self.calls.append(payload)
        operation = payload["requests"][0]
        assert payload["requests"][-1] == {"type": "close"}
        if operation["type"] == "execute":
            try:
                result = {"type": "ok", "response": {"type": "execute", "result": self.execute(operation["stmt"])}}
            except sqlite3.Error:
                result = {"type": "error", "error": {"message": "server-private-SQL-error"}}
        else:
            results, errors = [], []
            for step in operation["batch"]["steps"]:
                value = error = None
                if "condition" not in step or self.condition(step["condition"], results):
                    try:
                        value = self.execute(step["stmt"])
                    except sqlite3.Error:
                        error = {"message": "server-private-SQL-error"}
                results.append(value)
                errors.append(error)
            result = {"type": "ok", "response": {"type": "batch", "result": {"step_results": results, "step_errors": errors}}}
        return httpx.Response(200, json={"results": [result, {"type": "ok", "response": {"type": "close"}}]})


@pytest.fixture
def remote():
    transport = HranaSQLite()
    db = TursoDatabase("libsql://test-db.example", "synthetic-test-placeholder", httpx.MockTransport(transport)).initialize()
    yield db, transport
    db.close()
    transport.connection.close()


def test_http_typed_values_and_parameterized_sql(remote):
    db, _ = remote
    row = db.all("SELECT ? AS i,? AS f,? AS text,? AS empty_value", [3, .285, "x' OR 1=1 --", None])[0]
    assert row == {"i": 3, "f": .285, "text": "x' OR 1=1 --", "empty_value": None}


def test_http_batch_rolls_back_on_failure_and_does_not_leak(remote):
    db, transport = remote
    with pytest.raises(DatabaseError, match="Database transaction failed") as error:
        db.batch([("INSERT INTO workspaces VALUES (?,?,?,?,?)", ["rollback", "Test", .285, 0, "2026-10-01"]),
                  ("INSERT INTO missing_table VALUES (?)", ["oops"])])
    assert "private" not in str(error.value)
    assert db.all("SELECT id FROM workspaces") == []
    assert not transport.connection.in_transaction


def test_http_migrations_are_idempotent_and_workflows_use_real_adapter(remote):
    db, transport = remote
    db.initialize()
    with TestClient(create_app(db), base_url="https://meterwise.test", headers={"Origin": "https://meterwise.test"}) as browser:
        assert browser.post("/api/session", json={"role": "manager"}).status_code == 200
        initial = browser.get("/api/estate/overview").json()
        assert initial["metrics"]["expected"] - initial["metrics"]["received"] == 2
        sample = browser.get("/api/estate/sample.csv").text
        assert browser.post("/api/estate/imports/commit", json={"csv": sample, "fileName": "turso.csv"}).status_code == 201
        assert browser.get("/api/estate/overview").json()["metrics"]["coverage"] == 100
        assert browser.get("/api/dashboard").json()["metrics"]["missing"] == 8
    # Large seed batches remain one atomic request rather than one network call per interval.
    seed_batches = [call for call in transport.calls if call["requests"][0]["type"] == "batch"
                    and len(call["requests"][0]["batch"]["steps"]) > 400]
    assert len(seed_batches) == 1


def test_http_mutations_are_never_retried_on_timeout():
    calls = []
    def timeout(request):
        calls.append(1)
        raise httpx.ReadTimeout("private-url-or-token", request=request)
    db = TursoDatabase("https://test-db.example", "synthetic-test-placeholder", httpx.MockTransport(timeout))
    with pytest.raises(DatabaseError, match="Database operation failed"):
        db.run("UPDATE workspaces SET name=?", ["changed"])
    assert len(calls) == 1
    db.close()


def test_http_rejects_incomplete_transaction_result():
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"results": [
        {"type": "ok", "response": {"result": {"step_results": [], "step_errors": []}}}]}))
    db = TursoDatabase("https://test-db.example", "synthetic-test-placeholder", transport)
    with pytest.raises(DatabaseError):
        db.batch([("SELECT 1", [])])
    db.close()
