"""Singapore estate analytics, bounded imports and optimistic maintenance workflow."""
import json
import math
import re
from datetime import timedelta
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
    parse_time,
    plain_filename,
    require_manager,
    required_text,
    rounded,
    sha256,
    singapore_date,
)
from .csv_import import preview_import
from .database import ROOT
from .seed import reading_statements

SOURCE = json.loads((ROOT / "data-source/hdb-property-snapshot.json").read_text())
BLOCKS = SOURCE["blocks"]
SERVICE_LABELS = {"lighting": "Common-area lighting", "lifts": "Lifts", "pumps": "Water pumps", "solar": "Rooftop solar"}
METERS = [dict(id=f'{block["id"]}-{service.upper()}', name=label, block_id=block["id"], service=service,
               tenant_id=block["town"], location=f'Blk {block["block"]} {block["street"]}', interval_minutes=60,
               threshold_kwh={"lighting": 7 + i, "lifts": 10 + i, "pumps": 5 + i, "solar": 60}[service])
          for i, block in enumerate(BLOCKS) for service, label in SERVICE_LABELS.items()]
POLICY = {"tariff": 0.285, "gridFactor": 0.402, "gridFactorYear": 2024, "timeZone": "Asia/Singapore",
          "highPriorityHours": 24, "otherPriorityHours": 72}
ORDER_COLUMNS = "id,block_id,meter_id,title,priority,status,assignee,due_at,created_at,updated_at,version"
TRANSITIONS = {"open": ["in_progress"], "in_progress": ["completed"],
               "completed": ["verified", "in_progress"], "verified": ["open"]}
IMPORT_COLUMNS = "id,file_name,accepted,skipped,rejected,created_at"


def ensure_estate(db, workspace):
    found = db.all("SELECT end_day FROM estate_state WHERE workspace_id=?", [workspace])
    if found:
        return found[0]["end_day"]
    end = add_days(singapore_date(), -1)
    start, rows = add_days(end, -13), []
    for day in range(14):
        for hour in range(24):
            for i, meter in enumerate(METERS):
                if (day == 12 and hour == 10 and meter["id"] == "B01-LIGHTING"
                        or day == 13 and hour == 14 and meter["id"] == "B05-SOLAR"):
                    continue
                index, service = i // 4, meter["service"]
                scale = BLOCKS[index]["units"] / 100
                daylight = max(0, math.sin((hour - 7) / 12 * math.pi))
                if service == "solar":
                    value = daylight * (21 + index) * (0.84 + day % 4 * 0.045)
                elif service == "lighting":
                    value = (4.4 if hour >= 19 or hour < 7 else 1.9) * scale
                elif service == "lifts":
                    value = (5.6 if 7 <= hour < 22 else 1.2) * scale
                else:
                    value = 2.3 * scale
                value *= 1 + day % 3 * 0.012
                if meter["id"] == "B03-PUMPS" and day >= 11 and hour == 3:
                    value = 10.8
                if meter["id"] == "B02-LIGHTING" and day >= 12 and hour == 2:
                    value = 11.2
                rows.append((meter["id"], iso(day_start(add_days(start, day)) + timedelta(hours=hour)), rounded(value)))
    statements = reading_statements(rows, workspace, "estate_readings")
    statements.append(("INSERT OR IGNORE INTO estate_state (workspace_id,end_day) VALUES (?,?)", [workspace, end]))
    db.batch(statements)
    return db.all("SELECT end_day FROM estate_state WHERE workspace_id=?", [workspace])[0]["end_day"]


def permitted_blocks(role):
    return BLOCKS if role == "manager" else [block for block in BLOCKS if block["town"] == "Ang Mo Kio"]


def energy_balance(readings, meters, start_day, end_day):
    groups = {}
    for meter in meters:
        groups.setdefault(meter["block_id"], []).append(meter)
    start, end = day_start(start_day), day_start(add_days(end_day, 1))
    start_iso, end_iso = iso(start), iso(end)
    values = {(row["meter_id"], row["recorded_at"]): row["consumption_kwh"] for row in readings
              if start_iso <= row["recorded_at"] < end_iso}
    load = solar = grid = consumed = exported = received = 0
    expected = int((end - start).total_seconds() / 3600) * len(meters)
    for assets in groups.values():
        time = start
        while time < end:
            timestamp, interval_load, interval_solar, count = iso(time), 0, 0, 0
            for meter in assets:
                value = values.get((meter["id"], timestamp))
                if value is None:
                    continue
                count += 1
                received += 1
                if meter["service"] == "solar":
                    interval_solar += value
                else:
                    interval_load += value
            load += interval_load
            solar += interval_solar
            if count == len(assets):
                grid += max(0, interval_load - interval_solar)
                consumed += min(interval_load, interval_solar)
                exported += max(0, interval_solar - interval_load)
            time += timedelta(hours=1)
    complete = expected > 0 and received == expected
    return {"load": rounded(load), "solar": rounded(solar), "grid": rounded(grid) if complete else None,
            "selfConsumed": rounded(consumed) if complete else None, "exported": rounded(exported) if complete else None,
            "complete": complete, "received": received, "expected": expected,
            "coverage": rounded(received / expected * 100) if expected else 0}


def calculate_estate(readings, prior, blocks, meters, start, end):
    balance = energy_balance(readings, meters, start, end)
    days = date_range(start, end)
    previous = energy_balance(prior, meters, add_days(start, -len(days)), add_days(start, -1))
    summaries = []
    for block in blocks:
        result = energy_balance(readings, [meter for meter in meters if meter["block_id"] == block["id"]], start, end)
        summaries.append({**block, **result,
                          "kwhPerUnit": rounded(result["load"] / block["units"]) if result["complete"] else None,
                          "cost": rounded(result["grid"] * POLICY["tariff"]) if result["complete"] else None,
                          "co2Kg": rounded(result["grid"] * POLICY["gridFactor"]) if result["complete"] else None,
                          "issues": 0})
    chart = []
    for day in days:
        point = energy_balance(readings, meters, day, day)
        chart.append({"date": day, "label": day_label(day),
                      "load": point["load"], "solar": point["solar"], "grid": point["grid"]})
    meter_map = {meter["id"]: meter for meter in meters}
    services = [{"service": service, "kwh": rounded(sum(row["consumption_kwh"] for row in readings
                 if row["meter_id"] in meter_map and meter_map[row["meter_id"]]["service"] == service))}
                for service in SERVICE_LABELS]
    change = (rounded((balance["load"] - previous["load"]) / previous["load"] * 100, 1)
              if balance["complete"] and previous["complete"] and previous["load"] > 0 else None)
    return {"balance": balance, "summaries": summaries, "chart": chart, "services": services, "change": change}


def estate_issues(readings, meters, start, end):
    issues = []
    for meter in meters:
        rows = [row for row in readings if row["meter_id"] == meter["id"]]
        expected = len(date_range(start, end)) * 24
        base = {"block_id": meter["block_id"], "meter_id": meter["id"]}
        if len(rows) < expected:
            issues.append({**base, "key": meter["id"] + "|missing", "kind": "missing", "title": "Missing meter intervals",
                           "detail": f"{expected - len(rows)} hourly intervals are missing. Restore data before estimating grid use or carbon.", "priority": "medium"})
        spikes = [row for row in rows if row["consumption_kwh"] > meter["threshold_kwh"]]
        if meter["service"] != "solar" and spikes:
            issues.append({**base, "key": meter["id"] + "|threshold", "kind": "threshold",
                           "title": SERVICE_LABELS[meter["service"]] + " above threshold",
                           "detail": f'{len(spikes)} intervals exceeded {meter["threshold_kwh"]} kWh. Latest: {singapore_date(spikes[-1]["recorded_at"])}. Inspect the asset; this rule does not diagnose a fault.', "priority": "high"})
    return issues


def overview(db, access, query):
    workspace = access["workspace_id"]
    end = ensure_estate(db, workspace)
    bounds = {"from": add_days(end, -13), "to": end}
    start, end = query.get("from", add_days(end, -6)), query.get("to", end)
    try:
        days = date_range(start, end)
        if start < bounds["from"] or end > bounds["to"]:
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError(400, "Choose valid dates within the 14-day demo dataset.") from None
    permitted = permitted_blocks(access["role"])
    town, block_id = query.get("town", "all"), query.get("block", "all")
    if town != "all" and not any(block["town"] == town for block in permitted):
        raise ApiError(403, "This town is outside your area view.")
    if block_id != "all" and not any(block["id"] == block_id for block in permitted):
        raise ApiError(404, "Block not found in this area view.")
    blocks = [block for block in permitted if (town == "all" or block["town"] == town)
              and (block_id == "all" or block["id"] == block_id)]
    if not blocks:
        raise ApiError(400, "The selected block does not belong to that town.")
    meters = [meter for meter in METERS if any(block["id"] == meter["block_id"] for block in blocks)]
    all_rows = db.all("SELECT meter_id,recorded_at,consumption_kwh FROM estate_readings "
                      "WHERE workspace_id=? AND recorded_at>=? AND recorded_at<? AND meter_id IN ("
                      + ",".join("?" for _ in meters) + ") ORDER BY recorded_at",
                      [workspace, iso(day_start(add_days(start, -len(days)))), iso(day_start(add_days(end, 1))),
                       *[meter["id"] for meter in meters]])
    boundary = iso(day_start(start))
    readings = [row for row in all_rows if row["recorded_at"] >= boundary]
    prior = [row for row in all_rows if row["recorded_at"] < boundary]
    calculated = calculate_estate(readings, prior, blocks, meters, start, end)
    issues = estate_issues(readings, meters, start, end)
    orders = db.all(f"SELECT {ORDER_COLUMNS} FROM estate_orders WHERE workspace_id=? AND block_id IN ("
                    + ",".join("?" for _ in blocks) + ") ORDER BY created_at DESC LIMIT 100",
                    [workspace, *[block["id"] for block in blocks]])
    open_orders = [order for order in orders if order["status"] != "verified"]
    balance = calculated["balance"]
    for block in calculated["summaries"]:
        block["issues"] = sum(issue["block_id"] == block["id"] for issue in issues)
    return {"role": access["role"], "from": start, "to": end, "bounds": bounds, "catalogue": permitted,
            "meters": meters, "blocks": calculated["summaries"], "metrics": {**balance,
            "cost": rounded(balance["grid"] * POLICY["tariff"]) if balance["complete"] else None,
            "co2Kg": rounded(balance["grid"] * POLICY["gridFactor"]) if balance["complete"] else None,
            "change": calculated["change"], "units": sum(block["units"] for block in blocks),
            "openOrders": len(open_orders), "overdueOrders": sum(parse_time(order["due_at"]) < now() for order in open_orders)},
            "chart": calculated["chart"], "services": calculated["services"], "issues": issues,
            "orders": orders, "policy": POLICY, "source": SOURCE}


def handle_estate(db, access, path, method, query, body):
    workspace = access["workspace_id"]
    if path == "/api/estate/overview" and method == "GET":
        return json_response(overview(db, access, query))
    end = ensure_estate(db, workspace)
    if path == "/api/estate/sample.csv" and method == "GET":
        require_manager(access, True)
        return csv_response([["meter_id", "timestamp", "consumption_kwh"],
                             ["B01-LIGHTING", iso(day_start(add_days(end, -1)) + timedelta(hours=10)), 1.67],
                             ["B05-SOLAR", iso(day_start(end) + timedelta(hours=14)), 20.86]], "meterwise-estate-gap-repair.csv")
    if path == "/api/estate/imports" and method == "GET":
        require_manager(access, True)
        return json_response(db.all(f"SELECT {IMPORT_COLUMNS} FROM estate_imports WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30", [workspace]))
    if path == "/api/estate/imports/preview" and method == "POST":
        require_manager(access, True)
        if not isinstance(body.get("csv"), str):
            raise ApiError(400, "Choose a CSV file.")
        return json_response(preview_import(db, workspace, body["csv"], METERS, "estate_readings", (add_days(end, -13), end)))
    if path == "/api/estate/imports/commit" and method == "POST":
        require_manager(access, True)
        plain_filename(body.get("fileName"), body.get("csv"))
        import_id = f'{workspace}|{sha256(body["csv"])[:32]}'
        prior = db.all(f"SELECT {IMPORT_COLUMNS} FROM estate_imports WHERE id=? AND workspace_id=?", [import_id, workspace])
        if prior:
            return json_response({**prior[0], "alreadyImported": True})
        result = preview_import(db, workspace, body["csv"], METERS, "estate_readings", (add_days(end, -13), end))
        if not result["valid"]:
            raise ApiError(400, "There are no new valid intervals to import.")
        statements = [("INSERT OR IGNORE INTO estate_readings (id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES (?,?,?,?,?)",
                       [f'{workspace}|{row["meter_id"]}|{row["recorded_at"]}', workspace, row["meter_id"], row["recorded_at"], row["consumption_kwh"]]) for row in result["readings"]]
        statements.append(("INSERT OR IGNORE INTO estate_imports (id,workspace_id,file_name,accepted,skipped,rejected,created_at) VALUES (?,?,?,?,?,?,?)",
                           [import_id, workspace, body["fileName"], result["valid"], result["duplicate"], result["invalid"], iso(now())]))
        saved = db.batch(statements)
        count = sum(row["changes"] for row in saved[:-1])
        if saved[-1]["changes"]:
            db.run("UPDATE estate_imports SET accepted=?,skipped=? WHERE id=? AND workspace_id=?",
                   [count, result["duplicate"] + result["valid"] - count, import_id, workspace])
        return json_response(db.all(f"SELECT {IMPORT_COLUMNS} FROM estate_imports WHERE id=? AND workspace_id=?", [import_id, workspace])[0], 201)
    if path == "/api/estate/orders" and method == "POST":
        require_manager(access, True)
        title = required_text(body.get("title"), "Work order title", 5, 160)
        note = required_text(body.get("note"), "Inspection note", 12, 1200)
        meter = next((meter for meter in METERS if meter["id"] == body.get("meterId")), None)
        if not meter:
            raise ApiError(400, "Choose a registered estate asset.")
        if body.get("priority") not in ("high", "medium", "low"):
            raise ApiError(400, "Choose a valid priority.")
        time, order_id, event = now(), f"{workspace}|{uuid4()}", str(uuid4())
        hours = POLICY["highPriorityHours"] if body["priority"] == "high" else POLICY["otherPriorityHours"]
        saved = db.batch([
            ("INSERT INTO estate_orders (id,workspace_id,block_id,meter_id,title,priority,status,assignee,due_at,created_at,updated_at,version,mutation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM estate_orders WHERE workspace_id=?)<100",
             [order_id, workspace, meter["block_id"], meter["id"], title, body["priority"], "open", "", iso(time + timedelta(hours=hours)), iso(time), iso(time), 1, event, workspace]),
            ("INSERT INTO estate_events (id,workspace_id,order_id,action,body,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM estate_orders WHERE workspace_id=? AND id=?)",
             [event, workspace, order_id, "created", note, "Estate manager (demo)", iso(time), workspace, order_id]),
        ])
        if not saved[0]["changes"]:
            raise ApiError(409, "This demo workspace has reached its 100-work-order limit.")
        return json_response(db.all(f"SELECT {ORDER_COLUMNS} FROM estate_orders WHERE workspace_id=? AND id=?", [workspace, order_id])[0], 201)
    match = re.fullmatch(r"/api/estate/orders/([^/]+)", path)
    if match:
        order_id = match[1]  # ASGI has already percent-decoded the URL path exactly once.
        found = db.all(f"SELECT {ORDER_COLUMNS} FROM estate_orders WHERE workspace_id=? AND id=?", [workspace, order_id])
        if not found or not any(block["id"] == found[0]["block_id"] for block in permitted_blocks(access["role"])):
            raise ApiError(404, "Work order not found in this area view.")
        order = found[0]
        if method == "GET":
            order["events"] = db.all("SELECT id,order_id,action,body,actor,created_at FROM estate_events WHERE workspace_id=? AND order_id=? ORDER BY created_at,id", [workspace, order_id])
            return json_response(order)
        if method == "PATCH":
            require_manager(access, True)
            note = required_text(body.get("note"), "Evidence note", 12, 1200)
            if type(body.get("version")) is not int or body["version"] != order["version"]:
                raise ApiError(409, "This order changed. Reload its latest version before saving.")
            status = body.get("status")
            if status not in TRANSITIONS[order["status"]]:
                raise ApiError(400, "Follow the workflow: open → in progress → completed → verified. Completed orders can return for rework; verified orders can reopen.")
            assignee = required_text(body.get("assignee"), "Assigned demo team", 3, 100)
            mutation, time = str(uuid4()), iso(now())
            saved = db.batch([
                ("UPDATE estate_orders SET status=?,assignee=?,updated_at=?,version=version+1,mutation_id=? WHERE workspace_id=? AND id=? AND version=?",
                 [status, assignee, time, mutation, workspace, order_id, body["version"]]),
                ("INSERT INTO estate_events (id,workspace_id,order_id,action,body,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM estate_orders WHERE workspace_id=? AND id=? AND mutation_id=?)",
                 [mutation, workspace, order_id, status, note, "Estate manager (demo)", time, workspace, order_id, mutation]),
            ])
            if not saved[0]["changes"]:
                raise ApiError(409, "This order changed. Reload its latest version before saving.")
            return json_response({"ok": True, "version": order["version"] + 1})
    if path == "/api/estate/report.csv" and method == "GET":
        data = overview(db, access, query)
        rows = [["block", "street", "town", "public_hdb_units", "from_sgt", "to_sgt", "recorded_common_load_kwh", "recorded_solar_kwh", "derived_grid_import_kwh", "derived_solar_export_kwh", "common_load_kwh_per_unit", "coverage_percent", "estimated_grid_cost_sgd", "estimated_grid_co2_kg", "ema_gef_year", "ema_gef_kg_co2_per_kwh", "tariff_sgd_per_kwh", "energy_data_type", "inventory_source", "inventory_retrieved_at"]]
        for block in data["blocks"]:
            rows.append([block["block"], block["street"], block["town"], block["units"], data["from"], data["to"],
                         block["load"], block["solar"], block["grid"], block["exported"], block["kwhPerUnit"],
                         block["coverage"], block["cost"], block["co2Kg"], POLICY["gridFactorYear"], POLICY["gridFactor"],
                         POLICY["tariff"], "SIMULATED — independent portfolio pilot", SOURCE["source_url"], SOURCE["retrieved_at"]])
        return csv_response(rows, f'meterwise-estate-{data["from"]}-{data["to"]}.csv')
    raise ApiError(404, "Estate action not found.")
