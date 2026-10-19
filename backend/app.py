"""FastAPI ASGI entrypoint shared by Vercel, Uvicorn and pytest."""
import json
import logging
import math
import os
import re
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool
from starlette.staticfiles import StaticFiles

from .auth import authenticate_api_key, authenticate_user, create_api_key, register_organization
from .building import handle_building, session_info
from .core import MAX_REQUEST_BYTES, VERSION, ApiError, iso, json_response, now, security_headers, sha256
from .database import ROOT, get_database
from .estate import ensure_estate, handle_estate
from .seed import ensure_workspace, provision_workspace


async def payload(request):
    if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
        raise ApiError(415, "Send request data as application/json.")
    message = "The request is too large. Import CSV files smaller than 1 MB."
    try:
        length = int(request.headers.get("content-length", "0"))
    except ValueError:
        raise ApiError(400, "Invalid request content length.") from None
    if length > MAX_REQUEST_BYTES:
        raise ApiError(413, message)
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_REQUEST_BYTES:
            raise ApiError(413, message)
        data.extend(chunk)
    try:
        body = json.loads(data.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
        if not isinstance(body, dict):
            raise ValueError()
        def validate(value):
            if isinstance(value, str):
                value.encode("utf-8")
            elif isinstance(value, float) and not math.isfinite(value):
                raise ValueError()
            elif isinstance(value, dict):
                for key, item in value.items():
                    validate(key)
                    validate(item)
            elif isinstance(value, list):
                for item in value:
                    validate(item)
        validate(body)
        return body
    except (ValueError, UnicodeError, RecursionError):
        raise ApiError(400, "Request data must be a valid JSON object encoded as UTF-8.") from None


def create_app(database=None, workspace_limit=100, trusted_origins=()):
    api = FastAPI(title="MeterWise", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None,
                  redirect_slashes=False)

    @api.middleware("http")
    async def protect(request, call_next):
        try:
            response = await call_next(request)
        except Exception as error:
            # Log only the exception class: SQL and credential-bearing URLs never enter logs.
            logging.warning("MeterWise request failed (%s)", type(error).__name__)
            response = json_response({"error": "MeterWise could not complete this request. Your file or note has been kept so you can try again."}, 503)
        secure = request.url.scheme == "https" or bool(os.getenv("VERCEL"))
        document = "text/html" in response.headers.get("content-type", "")
        response.headers.update(security_headers(secure, document))
        if request.url.path.startswith("/api"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @api.exception_handler(ApiError)
    async def api_error(request, error):
        return json_response({"error": str(error)}, error.status)

    def dispatch(request, body, visitor, existing_visitor):
        db = database if database is not None else get_database()
        path, method = request.url.path, request.method
        if path == "/api/health" and method in ("GET", "HEAD"):
            db.all("SELECT 1 AS ready")
            return json_response({"ok": True, "app": "MeterWise", "version": VERSION, "hosting": "Vercel" if os.getenv("VERCEL") else "Python",
                                  "backend": "Python", "framework": "FastAPI", "database": db.kind})
        if path == "/api/v1/telemetry/ingest" and method == "POST":
            access = authenticate_api_key(db, request.headers.get("authorization", ""))
            ws = access["workspace_id"]
            ensure_estate(db, ws)
            return handle_estate(db, access, "/api/estate/imports/commit", "POST", request.query_params, body)
        secure = request.url.scheme == "https" or bool(os.getenv("VERCEL"))
        token = request.cookies.get("mw_session")
        if path in ("/api/auth/register", "/api/auth/login") and method == "POST":
            auth_info = register_organization(db, body) if path.endswith("/register") else authenticate_user(db, body)
            ws = auth_info["workspaceId"]
            ensure_workspace(db, ws)
            ensure_estate(db, ws)
            time = int(now().timestamp() * 1000)
            new_token = secrets.token_hex(32)
            db.run("INSERT INTO sessions (token_hash,workspace_id,role,tenant_id,expires_at) VALUES (?,?,?,?,?)",
                   [sha256(new_token), ws, auth_info["role"], auth_info.get("tenantId"), time + 604800000])
            response = json_response(auth_info, 201 if path.endswith("/register") else 200)
            response.set_cookie("mw_session", new_token, max_age=604800, httponly=True, samesite="lax", secure=secure)
            response.set_cookie("mw_workspace", ws, max_age=604800, httponly=True, samesite="lax", secure=secure)
            if not existing_visitor:
                response.set_cookie("mw_visitor", visitor, max_age=604800, httponly=True, samesite="lax", secure=secure)
            return response
        if path == "/api/auth/logout" and method == "POST":
            if token:
                db.run("DELETE FROM sessions WHERE token_hash=?", [sha256(token)])
            response = json_response({"ok": True})
            response.delete_cookie("mw_session")
            response.delete_cookie("mw_workspace")
            return response
        workspace = request.cookies.get("mw_workspace") or sha256("vercel-demo:" + visitor)[:24]
        if path == "/api/session" and method == "POST":
            workspace = sha256("vercel-demo:" + visitor)[:24]
            role = body.get("role")
            if role not in ("manager", "tenant"):
                raise ApiError(400, "Choose a manager or tenant demo view.")
            if not provision_workspace(db, workspace, workspace_limit):
                raise ApiError(503, "The demo is at capacity. Please contact the portfolio owner.")
            estate_view = request.query_params.get("view") == "estate"
            if not estate_view:
                ensure_workspace(db, workspace)
            access = {"role": role, "tenant_id": "T01" if role == "tenant" else None, "workspace_id": workspace}
            time = int(now().timestamp() * 1000)
            db.run("DELETE FROM sessions WHERE expires_at<?", [time])
            if token:
                db.run("DELETE FROM sessions WHERE token_hash=? AND workspace_id=?", [sha256(token), workspace])
            token = secrets.token_hex(32)
            db.run("INSERT INTO sessions (token_hash,workspace_id,role,tenant_id,expires_at) VALUES (?,?,?,?,?)",
                   [sha256(token), workspace, role, access["tenant_id"], time + 604800000])
            response = json_response({"role": role, "tenantId": access["tenant_id"]} if estate_view else session_info(db, access))
            response.set_cookie("mw_session", token, max_age=604800, httponly=True, samesite="lax", secure=secure)
            if request.cookies.get("mw_workspace"):
                response.delete_cookie("mw_workspace")
            if not existing_visitor:
                response.set_cookie("mw_visitor", visitor, max_age=604800, httponly=True, samesite="lax", secure=secure)
            return response
        if not token:
            raise ApiError(401, "Your demo session has expired. Reload to continue.")
        sessions = db.all("SELECT workspace_id,role,tenant_id FROM sessions WHERE token_hash=? AND workspace_id=? AND expires_at>?",
                          [sha256(token), workspace, int(now().timestamp() * 1000)])
        if not sessions:
            raise ApiError(401, "Your demo session has expired. Reload to continue.")
        access = dict(sessions[0])
        org_rows = db.all(
            "SELECT o.id AS org_id,o.name AS org_name,o.is_demo,u.name AS user_name,u.email AS user_email "
            "FROM org_members m JOIN organizations o ON o.id=m.org_id JOIN users u ON u.id=m.user_id "
            "WHERE m.workspace_id=? LIMIT 1",
            [workspace],
        )
        if org_rows:
            access["actor_name"] = org_rows[0]["user_name"]
            access["org_name"] = org_rows[0]["org_name"]
            access["is_demo"] = bool(org_rows[0]["is_demo"])
        else:
            access["is_demo"] = True
        if path == "/api/auth/me" and method == "GET":
            return json_response({
                "workspaceId": workspace,
                "role": access["role"],
                "isDemo": access["is_demo"],
                "orgName": access.get("org_name"),
                "actorName": access.get("actor_name"),
            })
        if path == "/api/auth/api-keys":
            if method == "GET":
                if access["role"] not in ("org_admin", "manager"):
                    raise ApiError(403, "Only workspace managers can view ingestion API keys.")
                return json_response(db.all("SELECT id,name,key_prefix,last_used_at,created_at FROM api_keys WHERE workspace_id=? ORDER BY created_at DESC", [workspace]))
            if method == "POST":
                return json_response(create_api_key(db, access, body.get("name")), 201)
        if path.startswith("/api/estate/"):
            return handle_estate(db, access, path, method, request.query_params, body)
        if path == "/api/session" and method == "GET" and request.query_params.get("view") == "estate":
            return json_response({"role": access["role"], "tenantId": access["tenant_id"], "isDemo": access["is_demo"], "orgName": access.get("org_name")})
        # Estate visitors only seed the separate building demo when they open it.
        ensure_workspace(db, workspace)
        return handle_building(db, access, path, method, request.query_params, body)

    @api.api_route("/api/{path:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"])
    async def route(request: Request, path: str):
        method = request.method
        is_ingest = request.url.path == "/api/v1/telemetry/ingest" and method == "POST"
        if method not in ("GET", "HEAD", "OPTIONS") and not is_ingest:
            origin = request.headers.get("origin")
            expected = f"{request.url.scheme}://{request.url.netloc}"
            local_allowed = origin in trusted_origins and not os.getenv("VERCEL")
            if ((origin != expected and not local_allowed) or request.headers.get("sec-fetch-site") == "cross-site"):
                raise ApiError(403, "This request must come from MeterWise.")
        visitor = request.cookies.get("mw_visitor", "")
        existing = bool(re.fullmatch(r"[a-f0-9]{64}", visitor))
        starting = request.url.path in ("/api/session", "/api/auth/register", "/api/auth/login") and method == "POST"
        if not existing and not starting and not is_ingest and request.url.path != "/api/health":
            raise ApiError(401, "Start your demo workspace to continue.")
        body = await payload(request) if method not in ("GET", "HEAD", "OPTIONS") else {}
        if request.url.path == "/api/session" and method == "POST" and body.get("role") not in ("manager", "tenant"):
            raise ApiError(400, "Choose a manager or tenant demo view.")
        return await run_in_threadpool(dispatch, request, body, visitor if existing else secrets.token_hex(32), existing)

    # Local `npm start` serves the built frontend. Vercel serves these assets at its CDN.
    client = ROOT / "dist/client"
    if client.is_dir() and not os.getenv("VERCEL"):
        if (client / "assets").is_dir():
            api.mount("/assets", StaticFiles(directory=client / "assets"), name="assets")

        @api.get("/{path:path}")
        def frontend(path: str):
            target = (client / path).resolve()
            if target.is_relative_to(client.resolve()) and target.is_file():
                return FileResponse(target)
            return FileResponse(client / "index.html")

    return api


# Only explicit development origins are trusted; production remains exact same-origin.
app = create_app(trusted_origins=tuple(os.getenv("CLIENT_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://terminal.local:4173").split(",")))
