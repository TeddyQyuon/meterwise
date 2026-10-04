import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.database import SQLiteDatabase

ORIGIN = "https://meterwise.test"


@pytest.fixture
def db():
    database = SQLiteDatabase()
    yield database
    database.close()


@pytest.fixture
def client(db):
    with TestClient(create_app(db), base_url=ORIGIN, headers={"Origin": ORIGIN}) as browser:
        response = browser.post("/api/session", json={"role": "manager"})
        assert response.status_code == 200
        yield browser


@pytest.fixture
def order(client):
    response = client.post("/api/estate/orders", json={"meterId": "B03-PUMPS", "title": "Inspect pump load at night",
                                                     "priority": "high", "note": "Simulated pump load exceeded its configured threshold."})
    assert response.status_code == 201
    return response.json()
