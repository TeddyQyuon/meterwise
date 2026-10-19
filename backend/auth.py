"""Multi-tenant authentication, RBAC, API key verification, and dynamic workspace policy/catalogue helpers."""
import hashlib
import hmac
import re
import secrets
from uuid import uuid4

from .core import ApiError, iso, now, required_text, rounded, sha256

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SLUG_RE = re.compile(r"[^a-z0-9]+")
VALID_ROLES = ("org_admin", "manager", "contractor", "tenant")


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
        raise ApiError(400, "Password must be between 8 and 128 characters.")
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 210_000).hex()
    return f"pbkdf2_sha256$210000${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not isinstance(password, str) or not isinstance(stored_hash, str):
        return False
    parts = stored_hash.split("$")
    if len(parts) != 4 or parts[0] != "pbkdf2_sha256":
        return False
    try:
        iterations = int(parts[1])
    except ValueError:
        return False
    salt, expected = parts[2], parts[3]
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations).hex()
    return hmac.compare_digest(candidate, expected)


def slugify(text: str) -> str:
    base = SLUG_RE.sub("-", text.strip().lower()).strip("-")[:40]
    return base or "client-org"


def register_organization(db, body: dict) -> dict:
    """Create a new client Organization, Workspace, Policy, and Admin User atomically."""
    org_name = required_text(body.get("orgName"), "Organization name", 2, 100)
    admin_name = required_text(body.get("name"), "Admin name", 2, 80)
    email = (body.get("email") or "").strip().lower()
    if not EMAIL_RE.fullmatch(email) or len(email) > 120:
        raise ApiError(400, "Provide a valid work email address.")
    pwd_hash = hash_password(body.get("password", ""))

    if db.all("SELECT id FROM users WHERE email=?", [email]):
        raise ApiError(409, "An account with this email already exists.")

    org_id = f"org_{uuid4().hex[:16]}"
    workspace_id = f"ws_{uuid4().hex[:16]}"
    user_id = f"usr_{uuid4().hex[:16]}"
    member_id = f"mem_{uuid4().hex[:16]}"
    slug = f"{slugify(org_name)}-{secrets.token_hex(3)}"
    timestamp = iso(now())
    tariff = float(body.get("tariff", 0.285))
    if not 0.01 <= tariff <= 5.0:
        raise ApiError(400, "Tariff must be between S$0.01 and S$5.00 per kWh.")

    db.batch([
        ("INSERT INTO organizations (id,slug,name,plan,is_demo,created_at) VALUES (?,?,?,?,?,?)",
         [org_id, slug, org_name, "pro", 0, timestamp]),
        ("INSERT INTO workspaces (id,name,tariff,seeded,created_at) VALUES (?,?,?,?,?)",
         [workspace_id, org_name, rounded(tariff, 4), 1, timestamp]),
        ("INSERT INTO workspace_policies (workspace_id,tariff_sgd_per_kwh,solar_export_rate_sgd,grid_factor_kg_co2,grid_factor_year,high_priority_sla_hours,normal_priority_sla_hours,timezone,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
         [workspace_id, rounded(tariff, 4), 0.0, 0.402, 2024, 24, 72, "Asia/Singapore", timestamp]),
        ("INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)",
         [user_id, email, admin_name, pwd_hash, timestamp]),
        ("INSERT INTO org_members (id,org_id,user_id,workspace_id,role,permitted_town,permitted_tenant_id,created_at) VALUES (?,?,?,?,?,?,?,?)",
         [member_id, org_id, user_id, workspace_id, "manager", None, None, timestamp]),
    ])
    return {
        "orgId": org_id,
        "workspaceId": workspace_id,
        "user": {"id": user_id, "email": email, "name": admin_name},
        "role": "manager",
    }


def authenticate_user(db, body: dict) -> dict:
    """Verify email/password credentials and return active workspace membership."""
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    users = db.all("SELECT id,email,name,password_hash FROM users WHERE email=?", [email])
    if not users or not verify_password(password, users[0]["password_hash"]):
        raise ApiError(401, "Invalid email or password.")
    user = users[0]
    memberships = db.all(
        "SELECT m.org_id,m.workspace_id,m.role,m.permitted_town,m.permitted_tenant_id,o.name AS org_name "
        "FROM org_members m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=? ORDER BY m.created_at",
        [user["id"]],
    )
    if not memberships:
        raise ApiError(403, "No active workspace membership found for this account.")
    active = memberships[0]
    return {
        "orgId": active["org_id"],
        "orgName": active["org_name"],
        "workspaceId": active["workspace_id"],
        "role": active["role"],
        "tenantId": active["permitted_tenant_id"],
        "permittedTown": active["permitted_town"],
        "user": {"id": user["id"], "email": user["email"], "name": user["name"]},
    }


def create_api_key(db, access: dict, name: str) -> dict:
    """Issue a scoped ingestion API key for smart meter gateways or webhooks."""
    if access["role"] not in ("org_admin", "manager"):
        raise ApiError(403, "Only workspace managers can create ingestion API keys.")
    clean_name = required_text(name, "API key name", 2, 80)
    raw_key = f"mw_live_{secrets.token_urlsafe(24)}"
    key_id = f"key_{uuid4().hex[:16]}"
    timestamp = iso(now())
    db.run(
        "INSERT INTO api_keys (id,workspace_id,name,key_hash,key_prefix,last_used_at,created_at) VALUES (?,?,?,?,?,?,?)",
        [key_id, access["workspace_id"], clean_name, sha256(raw_key), raw_key[:12], None, timestamp],
    )
    return {"id": key_id, "name": clean_name, "apiKey": raw_key, "prefix": raw_key[:12], "createdAt": timestamp}


def authenticate_api_key(db, auth_header: str) -> dict:
    """Authenticate Bearer API key for automated meter ingestion endpoints."""
    if not auth_header or not auth_header.startswith("Bearer mw_live_"):
        raise ApiError(401, "Provide a valid MeterWise Bearer API key.")
    raw_key = auth_header.removeprefix("Bearer ").strip()
    found = db.all("SELECT id,workspace_id FROM api_keys WHERE key_hash=?", [sha256(raw_key)])
    if not found:
        raise ApiError(401, "Invalid or revoked API key.")
    key_row = found[0]
    db.run("UPDATE api_keys SET last_used_at=? WHERE id=?", [iso(now()), key_row["id"]])
    return {"workspace_id": key_row["workspace_id"], "role": "manager", "tenant_id": None}


def get_workspace_policy(db, workspace_id: str, default_policy: dict) -> dict:
    """Load configurable tariff, carbon factor, and SLA hours for a workspace."""
    rows = db.all(
        "SELECT tariff_sgd_per_kwh,peak_tariff_sgd,offpeak_tariff_sgd,solar_export_rate_sgd,"
        "grid_factor_kg_co2,grid_factor_year,high_priority_sla_hours,normal_priority_sla_hours,timezone "
        "FROM workspace_policies WHERE workspace_id=?",
        [workspace_id],
    )
    if not rows:
        return dict(default_policy)
    r = rows[0]
    return {
        "tariff": r["tariff_sgd_per_kwh"],
        "peakTariff": r["peak_tariff_sgd"],
        "offpeakTariff": r["offpeak_tariff_sgd"],
        "solarExportRate": r["solar_export_rate_sgd"],
        "gridFactor": r["grid_factor_kg_co2"],
        "gridFactorYear": r["grid_factor_year"],
        "highPriorityHours": r["high_priority_sla_hours"],
        "otherPriorityHours": r["normal_priority_sla_hours"],
        "timeZone": r["timezone"],
    }
