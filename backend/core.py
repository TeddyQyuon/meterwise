"""Shared date, validation and response helpers. All reporting dates use SGT."""
import hashlib
import math
import re
from datetime import date, datetime, timedelta, timezone

from fastapi.responses import JSONResponse, Response

VERSION = "2.1.0"
SGT = timezone(timedelta(hours=8))
MAX_REQUEST_BYTES = 1_100_000


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def singapore_date(value=None):
    return (parse_time(value) if isinstance(value, str) else value or now()).astimezone(SGT).date().isoformat()


def day_start(day):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise ValueError("Invalid calendar date")
    return datetime.combine(date.fromisoformat(day), datetime.min.time(), SGT)


def add_days(day, offset):
    return (day_start(day).date() + timedelta(days=offset)).isoformat()


def day_label(day):
    value = day_start(day)
    month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"][value.month - 1]
    return f"{value.day} {month}"


def date_range(start, end):
    count = (day_start(end) - day_start(start)).days + 1
    if not 1 <= count <= 366:
        raise ValueError("Choose a date range between 1 and 366 days.")
    return [add_days(start, i) for i in range(count)]


def rounded(value, digits=2):
    # Match the existing JavaScript Math.round contract (rather than bankers' rounding).
    factor = 10 ** digits
    return math.floor((value + 2.220446049250313e-16) * factor + 0.5) / factor


def sha256(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_response(value, status=200):
    return JSONResponse(value, status_code=status, headers={"Cache-Control": "no-store"})


def csv_cell(value):
    text = "" if value is None else str(value)
    if not isinstance(value, (int, float)) and re.match(r"^\s*[=+@-]", text):
        text = "'" + text
    return '"' + text.replace('"', '""') + '"'


def csv_response(rows, filename):
    return Response("\r\n".join(",".join(csv_cell(cell) for cell in row) for row in rows),
                    media_type="text/csv; charset=utf-8",
                    headers={"Cache-Control": "no-store", "Content-Disposition": f'attachment; filename="{filename}"'})


def plain_filename(value, csv):
    if (not isinstance(csv, str) or not isinstance(value, str) or not value.strip()
            or len(value) > 180 or re.search(r"[\x00-\x1f\x7f/\\]", value)):
        raise ApiError(400, "Choose a CSV file with a plain filename of 1–180 characters.")
    return value


def required_text(value, label, minimum, maximum):
    if (not isinstance(value, str) or len(value.strip()) < minimum or len(value) > maximum
            or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value)):
        raise ApiError(400, f"{label} must contain {minimum}–{maximum} characters.")
    return value.strip()


def require_manager(access, estate=False):
    if access["role"] != "manager":
        raise ApiError(403, "Area viewers cannot import readings or change work orders." if estate
                       else "Only a facilities manager can make this change.")


def security_headers(secure=False, document=False):
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "Content-Security-Policy": (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; "
            "frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"
            if document else "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"),
    }
    if secure:
        headers["Strict-Transport-Security"] = "max-age=31536000"
    return headers
