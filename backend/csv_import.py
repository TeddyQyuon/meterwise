"""Bounded CSV validation, including strict quoting and completed ISO intervals."""
import re
from datetime import timedelta

from .core import ApiError, iso, now, parse_time


def parse_csv(text):
    rows, cells, field = [], [], ""
    quoted = closed = False
    line = row_line = 1
    text = text.removeprefix("\ufeff")
    i = 0
    while i < len(text):
        char = text[i]
        if quoted:
            if char == '"':
                if i + 1 < len(text) and text[i + 1] == '"':
                    field += '"'
                    i += 1
                else:
                    quoted, closed = False, True
            else:
                field += char
                if char == "\n":
                    line += 1
        elif char == '"':
            if field.strip() or closed:
                raise ValueError(f"Unexpected quote on line {line}.")
            quoted = True
        elif char == ",":
            cells.append(field)
            field, closed = "", False
        elif char in "\r\n":
            if char == "\r" and i + 1 < len(text) and text[i + 1] == "\n":
                i += 1
            cells.append(field)
            if any(cell.strip() for cell in cells):
                rows.append({"line": row_line, "cells": cells})
            cells, field, closed = [], "", False
            line += 1
            row_line = line
        else:
            if closed and char.strip():
                raise ValueError(f"Unexpected text after a closing quote on line {line}.")
            field += char
        i += 1
    if quoted:
        raise ValueError("A quoted field is not closed.")
    cells.append(field)
    if any(cell.strip() for cell in cells):
        rows.append({"line": row_line, "cells": cells})
    return rows


ISO_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})")
NUMBER = re.compile(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")


def validate_csv(text, meters, existing=(), current_time=None):
    current_time = current_time or now()
    if not text.strip():
        raise ValueError("Choose a CSV file containing meter readings.")
    if len(text.encode("utf-8")) > 1_000_000:
        raise ValueError("CSV files must be smaller than 1 MB.")
    rows = parse_csv(text)
    header = [cell.strip().lower() for cell in rows.pop(0)["cells"]] if rows else []
    required = ["meter_id", "timestamp", "consumption_kwh"]
    if len(set(header)) != len(header) or any(column not in header for column in required):
        raise ValueError("CSV headers must include meter_id, timestamp, and consumption_kwh, without duplicate columns.")
    if len(rows) > 1500:
        raise ValueError("Import up to 1,500 readings per file. Split larger files into smaller batches.")
    meter_map, seen = {meter["id"]: meter for meter in meters}, set(existing)
    result = {"total": len(rows), "valid": 0, "duplicate": 0, "invalid": 0,
              "issues": [], "readings": [], "range": None}
    indices = [header.index(column) for column in required]
    for row in rows:
        cells = row["cells"]
        meter_id, raw_time, raw_kwh = [cells[i].strip() if i < len(cells) else "" for i in indices]
        meter, recorded, kwh = meter_map.get(meter_id), None, None
        try:
            if ISO_TIME.fullmatch(raw_time):
                # datetime validates leap days, seconds and timezone ranges; no calendar rollover.
                if re.search(r"[+-]\d{2}:[6-9]\d$", raw_time):
                    raise ValueError()
                recorded = parse_time(raw_time)
        except ValueError:
            pass
        if NUMBER.fullmatch(raw_kwh):
            kwh = float(raw_kwh)
        message = ""
        if len(cells) != len(header):
            message = "Column count does not match the header."
        elif not meter:
            message = "Meter ID is not registered in this building."
        elif recorded is None:
            message = "Use a valid ISO timestamp with a timezone, such as 2026-10-01T09:00:00+08:00."
        elif recorded > current_time:
            message = "Reading is in the future."
        elif recorded + timedelta(minutes=meter["interval_minutes"]) > current_time:
            message = "This consumption interval has not finished yet."
        elif (int(recorded.timestamp() * 1000) + 8 * 3_600_000) % (meter["interval_minutes"] * 60_000):
            message = f'Reading must start on a {meter["interval_minutes"]}-minute interval.'
        elif kwh is None or not 0 <= kwh <= 100_000:
            message = "Consumption must be a number between 0 and 100,000 kWh."
        if message:
            result["invalid"] += 1
            result["issues"].append({"line": row["line"], "meter": meter_id, "message": message, "kind": "invalid"})
            continue
        time = iso(recorded)
        key = f"{meter_id}|{time}"
        if key in seen:
            result["duplicate"] += 1
            result["issues"].append({"line": row["line"], "meter": meter_id,
                                     "message": "This meter and timestamp already have a reading.", "kind": "duplicate"})
        else:
            seen.add(key)
            result["readings"].append({"meter_id": meter_id, "recorded_at": time, "consumption_kwh": kwh})
            result["valid"] += 1
    if result["readings"]:
        times = sorted(row["recorded_at"] for row in result["readings"])
        result["range"] = {"from": times[0], "to": times[-1]}
    return result


def preview_import(db, workspace, text, meters, table="readings", bounds=None):
    if table not in ("readings", "estate_readings"):
        raise ValueError("Unsupported readings table")
    try:
        first = validate_csv(text, meters)
        if bounds:
            from .core import singapore_date
            if any(not bounds[0] <= singapore_date(row["recorded_at"]) <= bounds[1] for row in first["readings"]):
                raise ValueError("Import readings only within the 14-day estate demo dataset.")
        existing = set()
        for start in range(0, len(first["readings"]), 40):
            chunk = first["readings"][start:start + 40]
            sql = f"SELECT meter_id,recorded_at FROM {table} WHERE workspace_id=? AND (" + " OR ".join(
                "(meter_id=? AND recorded_at=?)" for _ in chunk) + ")"
            params = [workspace] + [value for row in chunk for value in (row["meter_id"], row["recorded_at"])]
            for row in db.all(sql, params):
                existing.add(f'{row["meter_id"]}|{row["recorded_at"]}')
        return validate_csv(text, meters, existing) if existing else first
    except ValueError as error:
        raise ApiError(400, str(error)) from None
