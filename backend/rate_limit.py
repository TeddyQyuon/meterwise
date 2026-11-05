"""Atomic authentication budgets shared by SQLite and all Turso workers."""
import os
import time
from ipaddress import ip_address

from .core import ApiError, sha256


def source_address(request):
    # Vercel overwrites this header at its edge. Locally, forwarded headers are
    # caller-controlled and only the socket peer may identify the source.
    raw = (request.headers.get("x-vercel-forwarded-for", "").split(",")[0].strip()
           if os.getenv("VERCEL") == "1"
           else request.client.host if request.client else "")
    try:
        return str(ip_address(raw))
    except ValueError:
        # A missing trusted edge address shares a restrictive bucket. Never fall
        # back to arbitrary X-Forwarded-For or a client cookie.
        return "unknown"


def consume(db, label, subject, limit, seconds, timestamp):
    window = timestamp // seconds
    expiry = (window + 1) * seconds
    key = sha256(f"meterwise-auth:{label}:{subject}:{window}")
    # One conditional write is the decision, including across serverless workers.
    # A read followed by a write would allow concurrent requests to bypass it.
    result = db.run(
        "INSERT INTO auth_rate_buckets (key,attempts,expires_at) VALUES (?,1,?) "
        "ON CONFLICT(key) DO UPDATE SET attempts=auth_rate_buckets.attempts+1 "
        "WHERE auth_rate_buckets.attempts<?",
        [key, expiry, limit],
    )
    if not result["changes"]:
        raise ApiError(429, "Too many authentication attempts. Please try again later.",
                       retry_after=max(1, expiry - timestamp))


def protect_auth(db, request, body):
    timestamp = int(time.time())
    db.run("DELETE FROM auth_rate_buckets WHERE expires_at<=?", [timestamp])
    source = source_address(request)
    if request.url.path.endswith("/register"):
        consume(db, "register-source", source, 5, 3600, timestamp)
        return
    # Check the source budget first, bounding the number of account buckets any
    # one source can create. Count successful and failed attempts alike.
    consume(db, "login-source", source, 30, 900, timestamp)
    email = body.get("email")
    account = email.strip().lower()[:254] if isinstance(email, str) else ""
    consume(db, "login-account", account, 10, 900, timestamp)
