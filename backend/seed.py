"""Deterministic synthetic seeds; existing workspace markers always win."""
from datetime import timedelta

from .core import add_days, day_start, iso, now, rounded, singapore_date

TENANTS = [
    {"id": "T01", "name": "Northstar Studio", "floor": "Level 2", "color": "#267765"},
    {"id": "T02", "name": "Juniper Labs", "floor": "Level 3", "color": "#68a38a"},
    {"id": "T03", "name": "Atlas Digital", "floor": "Level 4", "color": "#a3bcb0"},
    {"id": "T04", "name": "Shared areas", "floor": "Building-wide", "color": "#c5dac9"},
]
METERS = [dict(id=f"MW-{i+1:03}", name=name, tenant_id=tenant, location=location,
               threshold_kwh=threshold, interval_minutes=60)
          for i, (name, tenant, location, threshold) in enumerate([
              ("Studio main", "T01", "Level 2 · East wing", 18),
              ("Studio air conditioning", "T01", "Level 2 · Plant room", 20),
              ("Labs main", "T02", "Level 3 · West wing", 22),
              ("Digital main", "T03", "Level 4 · East wing", 18),
              ("Common lighting", "T04", "Lobby & corridors", 12),
              ("Building services", "T04", "Basement · Services", 16),
          ])]


def reading_statements(rows, workspace, table):
    # Keep each statement below 100 SQLite bind parameters.
    statements = []
    for i in range(0, len(rows), 16):
        chunk = rows[i:i + 16]
        statements.append((f"INSERT OR IGNORE INTO {table} "
                           "(id,workspace_id,meter_id,recorded_at,consumption_kwh) VALUES "
                           + ",".join("(?,?,?,?,?)" for _ in chunk),
                           [value for meter, time, kwh in chunk for value in
                            (f"{workspace}|{meter}|{time}", workspace, meter, time, kwh)]))
    return statements


def provision_workspace(db, workspace, limit=100):
    if db.all("SELECT id FROM workspaces WHERE id=?", [workspace]):
        return True
    db.run("INSERT OR IGNORE INTO workspaces (id,name,tariff,seeded,created_at) "
           "SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM workspaces)<?",
           [workspace, "Harbour One", 0.285, 0, iso(now()), limit])
    return bool(db.all("SELECT id FROM workspaces WHERE id=?", [workspace]))


def ensure_workspace(db, workspace):
    current = db.all("SELECT seeded FROM workspaces WHERE id=?", [workspace])
    if current and current[0]["seeded"]:
        return
    end = add_days(singapore_date(), -1)
    statements, rows = [], []
    for tenant in TENANTS:
        statements.append(("INSERT OR IGNORE INTO tenants (key,workspace_id,id,name,floor,color) VALUES (?,?,?,?,?,?)",
                           [f'{workspace}|{tenant["id"]}', workspace, *tenant.values()]))
    for meter in METERS:
        statements.append(("INSERT OR IGNORE INTO meters "
                           "(key,workspace_id,id,name,tenant_id,location,threshold_kwh,interval_minutes) VALUES (?,?,?,?,?,?,?,?)",
                           [f'{workspace}|{meter["id"]}', workspace, meter["id"], meter["name"],
                            meter["tenant_id"], meter["location"], meter["threshold_kwh"], meter["interval_minutes"]]))
    for day in range(30):
        date = add_days(end, day - 29)
        weekend = day_start(date).weekday() >= 5
        for i, meter in enumerate(METERS):
            for hour in range(24):
                if meter["id"] == "MW-006" and date == end and 3 <= hour < 11:
                    continue
                base = [8.8, 10.2, 12.5, 7.6, 3.8, 6.2][i]
                noise = 0.9 + ((day * 17 + hour * 11 + i * 7) % 23) / 100
                value = base * (1 if 8 <= hour < 19 else 0.22) * (0.64 if weekend else 1) * noise * (1 - day * 0.0025)
                if meter["id"] == "MW-002" and date == add_days(end, -2) and hour == 22:
                    value = 28.4
                if meter["id"] == "MW-003" and date == add_days(end, -1) and hour == 11:
                    value = 27.6
                rows.append((meter["id"], iso(day_start(date) + timedelta(hours=hour)), rounded(value)))
    statements.extend(reading_statements(rows, workspace, "readings"))
    alerts = [
        ("MW-002", "consumption_spike", "Unusual after-hours consumption",
         "Studio air conditioning used 28.4 kWh between 22:00 and 23:00 SGT. This exceeds its configured 20 kWh interval threshold. Check the operating schedule and equipment.",
         "high", "open", iso(day_start(add_days(end, -2)) + timedelta(hours=22))),
        ("MW-006", "missing_data", "Eight readings are missing",
         "Building services has no readings from 03:00 to 11:00 SGT on the latest complete day. Check connectivity or import the missing hourly intervals.",
         "medium", "open", iso(day_start(end) + timedelta(hours=3))),
        ("MW-003", "consumption_spike", "Consumption above the meter threshold",
         "Labs main used 27.6 kWh between 11:00 and 12:00 SGT. This exceeds its configured 22 kWh interval threshold.",
         "medium", "investigating", iso(day_start(add_days(end, -1)) + timedelta(hours=11))),
    ]
    for i, alert in enumerate(alerts):
        statements.append(("INSERT OR IGNORE INTO alerts "
                           "(id,workspace_id,meter_id,type,title,detail,severity,status,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)",
                           [f"{workspace}|demo-alert-{i+1}", workspace, *alert]))
    statements.extend([
        ("INSERT OR IGNORE INTO notes (id,workspace_id,alert_id,body,author,created_at) VALUES (?,?,?,?,?,?)",
         [f"{workspace}|demo-note-1", workspace, f"{workspace}|demo-alert-3",
          "Checking whether lab equipment was left running during the lunch break.", "Facilities manager", iso(now())]),
        ("UPDATE workspaces SET seeded=1 WHERE id=?", [workspace]),
    ])
    db.batch(statements)
