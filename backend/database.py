"""SQLite locally; Turso's documented Hrana HTTP protocol in Vercel.

Writes are parameterized. A remote atomic batch sends BEGIN, conditional statements,
COMMIT and conditional ROLLBACK in one round trip; it never retries a mutation.
https://github.com/tursodatabase/libsql/blob/main/docs/HTTP_V2_SPEC.md
"""
import base64
import math
import os
import re
import sqlite3
import threading
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import httpx

ROOT = Path(__file__).resolve().parent.parent


class DatabaseError(Exception):
    """Intentionally excludes SQL, response bodies and database credentials."""


def migrations():
    statements = []
    for path in sorted((ROOT / "drizzle").glob("*.sql")):
        for sql in path.read_text().split("--> statement-breakpoint"):
            if sql.strip():
                statements.append((re.sub(r"CREATE (TABLE|(?:UNIQUE )?INDEX) ",
                                          r"CREATE \1 IF NOT EXISTS ", sql.strip()), []))
    if not statements:
        raise DatabaseError("Database migrations are unavailable")
    return statements


class SQLiteDatabase:
    kind = "SQLite"

    def __init__(self, path=":memory:"):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(path, check_same_thread=False, isolation_level=None, timeout=15)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.lock = threading.RLock()
        self.batch(migrations())

    def all(self, sql, params=()):
        with self.lock:
            return [dict(row) for row in self.connection.execute(sql, params).fetchall()]

    def run(self, sql, params=()):
        with self.lock:
            cursor = self.connection.execute(sql, params)
            return {"changes": max(0, cursor.rowcount)}

    def batch(self, statements):
        if not statements:
            return []
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                results = [self.run(sql, params) for sql, params in statements]
                self.connection.execute("COMMIT")
                return results
            except Exception:
                self.connection.execute("ROLLBACK")
                raise

    def close(self):
        self.connection.close()


def encoded(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, (int, bool)):
        return {"type": "integer", "value": str(int(value))}
    if isinstance(value, float) and math.isfinite(value):
        return {"type": "float", "value": value}
    if isinstance(value, str):
        return {"type": "text", "value": value}
    raise DatabaseError("Unsupported database parameter")


def decoded(value):
    kind = value["type"]
    if kind == "null":
        return None
    if kind == "integer":
        return int(value["value"])
    if kind == "float":
        return float(value["value"])
    if kind == "blob":
        return base64.b64decode(value["base64"])
    return value["value"]


def statement(sql, params=(), rows=False):
    return {"sql": sql, "args": [encoded(value) for value in params], "want_rows": rows}


class TursoDatabase:
    kind = "Turso"

    def __init__(self, url, token, transport=None):
        parts = urlsplit(url)
        if parts.scheme not in ("libsql", "https") or not parts.hostname or parts.username or parts.password:
            raise DatabaseError("Turso configuration is unavailable")
        self.endpoint = urlunsplit(("https", parts.netloc, "/v2/pipeline", "", ""))
        self.client = httpx.Client(timeout=httpx.Timeout(25, connect=5),
                                   headers={"Authorization": "Bearer " + token}, transport=transport)

    def initialize(self):
        self.batch(migrations())
        return self

    def _request(self, request):
        try:
            response = self.client.post(self.endpoint, json={"requests": [request, {"type": "close"}]})
            response.raise_for_status()
            result = response.json()["results"][0]
            if result["type"] != "ok":
                raise DatabaseError("Database operation failed")
            return result["response"]["result"]
        except DatabaseError:
            raise
        except Exception:
            raise DatabaseError("Database operation failed") from None

    def all(self, sql, params=()):
        result = self._request({"type": "execute", "stmt": statement(sql, params, True)})
        names = [column["name"] for column in result["cols"]]
        return [dict(zip(names, map(decoded, row), strict=True)) for row in result["rows"]]

    def run(self, sql, params=()):
        result = self._request({"type": "execute", "stmt": statement(sql, params)})
        return {"changes": int(result["affected_row_count"])}

    def batch(self, statements):
        if not statements:
            return []
        steps = [{"stmt": statement("BEGIN IMMEDIATE")}]
        for i, (sql, params) in enumerate(statements):
            steps.append({"condition": {"type": "ok", "step": i}, "stmt": statement(sql, params)})
        commit = len(steps)
        steps.append({"condition": {"type": "ok", "step": commit - 1}, "stmt": statement("COMMIT")})
        steps.append({"condition": {"type": "not", "cond": {"type": "ok", "step": commit}},
                      "stmt": statement("ROLLBACK")})
        result = self._request({"type": "batch", "batch": {"steps": steps}})
        values, errors = result["step_results"], result["step_errors"]
        if len(values) != len(steps) or len(errors) != len(steps) or not values[commit] or any(errors[:commit + 1]):
            raise DatabaseError("Database transaction failed")
        return [{"changes": int(value["affected_row_count"])} for value in values[1:commit]]

    def close(self):
        self.client.close()


_database = None
_database_lock = threading.Lock()


def get_database():
    global _database
    with _database_lock:
        if _database is None:
            url, token = os.getenv("TURSO_DATABASE_URL"), os.getenv("TURSO_AUTH_TOKEN")
            if url or token or os.getenv("VERCEL"):
                if not url or not token:
                    raise DatabaseError("Turso configuration is unavailable")
                database = TursoDatabase(url, token)
                try:
                    _database = database.initialize()
                except Exception:
                    database.close()
                    raise
            else:
                _database = SQLiteDatabase(os.getenv("SQLITE_PATH", str(ROOT / "data/meterwise.sqlite")))
        return _database
