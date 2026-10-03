"""Original building dashboard, meter mapping, alerts and CSV reporting."""
import math
import re
from uuid import uuid4

from .core import (
    ApiError,
    add_days,
    csv_response,
    date_range,
    day_label,
    day_start,
    iso,
    json_response,
    now,
    plain_filename,
    require_manager,
    rounded,
    sha256,
    singapore_date,
)
from .csv_import import preview_import

METER_COLUMNS = "id,name,tenant_id,location,threshold_kwh,interval_minutes"
ALERT_COLUMNS = "id,meter_id,type,title,detail,severity,status,recorded_at"
IMPORT_COLUMNS = "id,file_name,accepted,skipped,rejected,created_at"


def workspace_meters(db, workspace):
    return db.all(f"SELECT {METER_COLUMNS} FROM meters WHERE workspace_id=? ORDER BY id", [workspace])


def scope_meters(meters, access, tenant_filter=None, meter_filter=None):
    if (access["role"] == "tenant" and tenant_filter and tenant_filter != "all"
            and tenant_filter != access["tenant_id"]):
        raise ApiError(403, "This tenant is outside your view.")
    scoped = [meter for meter in meters if access["role"] == "manager" or meter["tenant_id"] == access["tenant_id"]]
    if tenant_filter and tenant_filter != "all":
        scoped = [meter for meter in scoped if meter["tenant_id"] == tenant_filter]
    if meter_filter:
        if not any(meter["id"] == meter_filter for meter in scoped):
            raise ApiError(404, "Meter not found in this view.")
        scoped = [meter for meter in scoped if meter["id"] == meter_filter]
    return scoped


def session_info(db, access):
    workspace = access["workspace_id"]
    workspaces = db.all("SELECT name,tariff FROM workspaces WHERE id=?", [workspace])
    tenants = db.all("SELECT id,name,floor,color FROM tenants WHERE workspace_id=? ORDER BY id", [workspace])
    meters = scope_meters(workspace_meters(db, workspace), access)
    bounds = db.all("SELECT MIN(recorded_at) AS first,MAX(recorded_at) AS last FROM readings WHERE workspace_id=?", [workspace])[0]
    ids = {meter["tenant_id"] for meter in meters}
    return {"role": access["role"], "tenantId": access["tenant_id"],
            "workspace": {**workspaces[0], "timezone": "Asia/Singapore"},
            "tenants": [tenant for tenant in tenants if tenant["id"] in ids], "meters": meters,
            "bounds": {"from": singapore_date(bounds["first"]), "to": singapore_date(bounds["last"])}}


def scoped_readings(db, workspace, meters, start, end):
    if not meters:
        return []
    return db.all("SELECT meter_id,recorded_at,consumption_kwh FROM readings WHERE workspace_id=? "
                  "AND recorded_at>=? AND recorded_at<? AND meter_id IN (" + ",".join("?" for _ in meters)
                  + ") ORDER BY recorded_at", [workspace, iso(day_start(start)), iso(day_start(add_days(end, 1))),
                                               *[meter["id"] for meter in meters]])


def expected_intervals(meters, start, end, current_time=None):
    last = min(day_start(add_days(end, 1)), current_time or now())
    seconds = (last - day_start(start)).total_seconds()
    return sum(max(0, math.floor(seconds / (meter["interval_minutes"] * 60))) for meter in meters)


def sum_readings(rows):
    return rounded(sum(row["consumption_kwh"] for row in rows))


def coverage(actual, expected):
    return rounded(min(100, actual / expected * 100), 1) if expected else 100


def dashboard(db, access, query):
    info = session_info(db, access)
    end = query.get("to", info["bounds"]["to"])
    try:
        day_start(end)
        start = query.get("from", add_days(end, -6))
        days = date_range(start, end)
    except (ValueError, TypeError):
        raise ApiError(400, "Choose valid calendar dates and a range between 1 and 366 days.") from None
    prior_start, prior_end = add_days(start, -len(days)), add_days(start, -1)
    meters = scope_meters(info["meters"], access, query.get("tenant"), query.get("meter"))
    workspace = access["workspace_id"]
    readings = scoped_readings(db, workspace, meters, start, end)
    prior = scoped_readings(db, workspace, meters, prior_start, prior_end)
    all_alerts = db.all(f"SELECT {ALERT_COLUMNS} FROM alerts WHERE workspace_id=? ORDER BY recorded_at DESC", [workspace])
    latest = db.all("SELECT meter_id,MAX(recorded_at) AS last FROM readings WHERE workspace_id=? GROUP BY meter_id", [workspace])
    permitted = {meter["id"] for meter in meters}
    alerts = [alert for alert in all_alerts if alert["meter_id"] in permitted]
    expected, kwh, previous = expected_intervals(meters, start, end), sum_readings(readings), sum_readings(prior)
    tariff = info["workspace"]["tariff"]
    chart = []
    for i, day in enumerate(days):
        total = sum_readings([row for row in readings if singapore_date(row["recorded_at"]) == day])
        chart.append({"date": day, "label": day_label(day), "kwh": total,
                      "previous": sum_readings([row for row in prior if singapore_date(row["recorded_at"]) == add_days(prior_start, i)]),
                      "cost": rounded(total * tariff)})
    detail = []
    for meter in meters:
        rows = [row for row in readings if row["meter_id"] == meter["id"]]
        count = expected_intervals([meter], start, end)
        detail.append({**meter, "tenant_name": next((tenant["name"] for tenant in info["tenants"] if tenant["id"] == meter["tenant_id"]), ""),
                       "kwh": sum_readings(rows), "coverage": coverage(len(rows), count), "expected": count, "actual": len(rows),
                       "last_reading": next((item["last"] for item in latest if item["meter_id"] == meter["id"]), None),
                       "active_alerts": sum(alert["meter_id"] == meter["id"] and alert["status"] != "resolved" for alert in alerts)})
    tenants = []
    for tenant in info["tenants"]:
        group = [meter for meter in detail if meter["tenant_id"] == tenant["id"]]
        if not group:
            continue
        usage = rounded(sum(meter["kwh"] for meter in group))
        count, actual = sum(meter["expected"] for meter in group), sum(meter["actual"] for meter in group)
        tenants.append({**tenant, "kwh": usage, "cost": rounded(usage * tariff), "meters": len(group), "coverage": coverage(actual, count)})
    tenants.sort(key=lambda tenant: -tenant["kwh"])
    return {"from": start, "to": end, "tariff": tariff, "timezone": "Asia/Singapore", "metrics": {
        "kwh": kwh, "cost": rounded(kwh * tariff), "change": rounded((kwh - previous) / previous * 100, 1) if previous else None,
        "coverage": coverage(len(readings), expected), "expected": expected, "actual": len(readings),
        "missing": max(0, expected - len(readings)), "openAlerts": sum(alert["status"] != "resolved" for alert in alerts)},
        "chart": chart, "tenants": tenants, "meters": detail, "alerts": alerts}


def commit_import(db, access, body):
    require_manager(access)
    plain_filename(body.get("fileName"), body.get("csv"))
    workspace = access["workspace_id"]
    import_id = f'{workspace}|{sha256(body["csv"])[:32]}'
    prior = db.all(f"SELECT {IMPORT_COLUMNS} FROM imports WHERE id=? AND workspace_id=?", [import_id, workspace])
    if prior:
        return json_response({**prior[0], "alreadyImported": True})
    meters = workspace_meters(db, workspace)
    preview = preview_import(db, workspace, body["csv"], meters)
    if not preview["valid"]:
        raise ApiError(400, "No new valid readings to import. Fix the errors or choose another file.")
    time = iso(now())
    statements = [("INSERT OR IGNORE INTO readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES (?,?,?,?,?)",
                   [f'{workspace}|{row["meter_id"]}|{row["recorded_at"]}', workspace, row["meter_id"], row["recorded_at"], row["consumption_kwh"]]) for row in preview["readings"]]
    statements.append(("INSERT OR IGNORE INTO imports (id,workspace_id,file_name,accepted,skipped,rejected,created_at) VALUES (?,?,?,?,?,?,?)",
                       [import_id, workspace, body["fileName"], preview["valid"], preview["duplicate"], preview["invalid"], time]))
    results = db.batch(statements)
    inserted = sum(row["changes"] for row in results[:-1])
    if results[-1]["changes"]:
        db.run("UPDATE imports SET accepted=?,skipped=? WHERE id=? AND workspace_id=?",
               [inserted, preview["duplicate"] + preview["valid"] - inserted, import_id, workspace])
    spikes = []
    for row in preview["readings"]:
        meter = next(meter for meter in meters if meter["id"] == row["meter_id"])
        if row["consumption_kwh"] > meter["threshold_kwh"]:
            spikes.append(("INSERT OR IGNORE INTO alerts (id,workspace_id,meter_id,type,title,detail,severity,status,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)",
                           [f'{workspace}|{row["meter_id"]}|{row["recorded_at"]}|spike', workspace, row["meter_id"],
                            "consumption_spike", "Consumption above the meter threshold",
                            f'{meter["name"]} used {row["consumption_kwh"]} kWh in one interval, above its configured {meter["threshold_kwh"]} kWh threshold. This alert is based on a rule, not an AI prediction.',
                            "high", "open", row["recorded_at"]]))
    db.batch(spikes)
    gaps = db.all("SELECT id,meter_id,recorded_at FROM alerts WHERE workspace_id=? AND type=? AND status<>?", [workspace, "missing_data", "resolved"])
    for gap in gaps:
        day = singapore_date(gap["recorded_at"])
        meter = next(meter for meter in meters if meter["id"] == gap["meter_id"])
        rows = scoped_readings(db, workspace, [meter], day, day)
        if len(rows) >= expected_intervals([meter], day, day):
            db.batch([("UPDATE alerts SET status=? WHERE id=? AND workspace_id=?", ["resolved", gap["id"], workspace]),
                      ("INSERT INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)",
                       [str(uuid4()), workspace, gap["id"], "All expected intervals were restored by a CSV import.", "MeterWise", time])])
    return json_response(db.all(f"SELECT {IMPORT_COLUMNS} FROM imports WHERE id=? AND workspace_id=?", [import_id, workspace])[0], 201)


def handle_building(db, access, path, method, query, body):
    workspace = access["workspace_id"]
    if path == "/api/session" and method == "GET":
        return json_response(session_info(db, access))
    if path == "/api/dashboard" and method == "GET":
        return json_response(dashboard(db, access, query))
    if path == "/api/imports" and method == "GET":
        require_manager(access)
        return json_response(db.all(f"SELECT {IMPORT_COLUMNS} FROM imports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30", [workspace]))
    if path == "/api/imports/preview" and method == "POST":
        require_manager(access)
        if not isinstance(body.get("csv"), str):
            raise ApiError(400, "Choose a CSV file.")
        return json_response(preview_import(db, workspace, body["csv"], workspace_meters(db, workspace)))
    if path == "/api/imports/commit" and method == "POST":
        return commit_import(db, access, body)
    if path == "/api/sample.csv" and method == "GET":
        require_manager(access)
        day = singapore_date(db.all("SELECT MAX(recorded_at) AS last FROM readings WHERE workspace_id=?", [workspace])[0]["last"])
        return csv_response([["meter_id", "timestamp", "consumption_kwh"],
                             *[["MW-006", f"{day}T{hour:02}:00:00+08:00", 4.20] for hour in range(3, 11)]], "meterwise-sample-readings.csv")
    match = re.fullmatch(r"/api/meters/([^/]+)", path)
    if match and method == "PATCH":
        require_manager(access)
        tenants = db.all("SELECT id FROM tenants WHERE workspace_id=?", [workspace])
        threshold = body.get("threshold")
        if (not any(tenant["id"] == body.get("tenantId") for tenant in tenants)
                or type(threshold) not in (int, float) or not 0.1 <= threshold <= 100_000):
            raise ApiError(400, "Choose a registered tenant and a threshold between 0.1 and 100,000 kWh.")
        if not db.all("SELECT id FROM meters WHERE workspace_id=? AND id=?", [workspace, match[1]]):
            raise ApiError(404, "Meter not found.")
        db.run("UPDATE meters SET tenant_id=?,threshold_kwh=? WHERE workspace_id=? AND id=?",
               [body["tenantId"], threshold, workspace, match[1]])
        return json_response({"ok": True})
    match = re.fullmatch(r"/api/alerts/([^/]+)", path)
    if match:
        alert_id = match[1]
        found = db.all(f"SELECT {ALERT_COLUMNS} FROM alerts WHERE workspace_id=? AND id=?", [workspace, alert_id])
        meters = scope_meters(workspace_meters(db, workspace), access)
        if not found or not any(meter["id"] == found[0]["meter_id"] for meter in meters):
            raise ApiError(404, "Alert not found in this view.")
        alert = found[0]
        if method == "GET":
            alert["notes"] = db.all("SELECT id,alert_id,body,author,created_at FROM notes WHERE workspace_id=? AND alert_id=? ORDER BY created_at", [workspace, alert_id])
            return json_response(alert)
        if method == "PATCH":
            require_manager(access)
            if body.get("status") not in ("open", "investigating", "resolved") or not isinstance(body.get("note"), str) or len(body["note"]) > 1000:
                raise ApiError(400, "Choose a valid status and keep the note under 1,000 characters.")
            note = body["note"].strip()
            if body["status"] == "resolved" and len(note) < 3:
                raise ApiError(400, "Add an investigation note before resolving this alert.")
            if not note and body["status"] == alert["status"]:
                raise ApiError(400, "Add a note or change the status.")
            db.batch([("UPDATE alerts SET status=? WHERE workspace_id=? AND id=?", [body["status"], workspace, alert_id]),
                      ("INSERT INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)",
                       [str(uuid4()), workspace, alert_id, note or f'Status changed to {body["status"]}.', "Facilities manager", iso(now())])])
            return json_response({"ok": True})
    if path == "/api/reports.csv" and method == "GET":
        data = dashboard(db, access, query)
        readings = scoped_readings(db, workspace, data["meters"], data["from"], data["to"])
        rows = [["date_sgt", "meter_id", "meter_name", "tenant", "consumption_kwh", "estimated_cost_sgd", "received_intervals", "expected_intervals", "coverage_percent", "tariff_sgd_per_kwh"]]
        for day in date_range(data["from"], data["to"]):
            for meter in data["meters"]:
                selected = [row for row in readings if row["meter_id"] == meter["id"] and singapore_date(row["recorded_at"]) == day]
                kwh, expected = sum_readings(selected), expected_intervals([meter], day, day)
                rows.append([day, meter["id"], meter["name"], meter["tenant_name"], kwh, rounded(kwh * data["tariff"]), len(selected), expected, coverage(len(selected), expected), data["tariff"]])
        return csv_response(rows, f'meterwise-report-{data["from"]}-{data["to"]}.csv')
    raise ApiError(404, "This page or action was not found.")
