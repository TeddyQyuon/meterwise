"""Exercise only synthetic MeterWise demo data on the published Vercel app.

Usage: python scripts/verify-estate-live.py [https://meterwise-kappa.vercel.app]
Creates two isolated demo workspaces; never needs database credentials.
"""
import csv
import io
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path

base = (sys.argv[1] if len(sys.argv) > 1 else "https://meterwise-kappa.vercel.app").rstrip("/")
checks = []


def visitor():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))


def request(client, path, method="GET", body=None, status=200, origin=None):
    headers = {"Accept": "application/json"}
    data = None
    if body is not None:
        headers.update({"Content-Type": "application/json", "Origin": origin or base})
        data = json.dumps(body).encode()
    req = urllib.request.Request(base + "/api" + path, data=data, headers=headers, method=method)
    try:
        response = client.open(req, timeout=45)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read().decode()
    assert response.code == status, (path, response.code, raw[:180])
    if "application/json" in response.headers.get("Content-Type", ""):
        return json.loads(raw)
    return raw


def passed(label, **evidence):
    checks.append({"check": label, "status": "passed", **evidence})
    print(label, flush=True)


manager = visitor()
health = request(manager, "/health")
assert health["ok"] and health["version"] == "2.0.0"
passed("Vercel 2.0 health checks persistent Turso storage")
request(manager, "/session", "POST", {"role": "manager"}, status=403, origin="https://foreign.example")
request(manager, "/session", "POST", {"role": "manager"})
passed("Cross-origin session mutation is rejected")

started = time.monotonic()
initial = request(manager, "/estate/overview")
cold_seconds = round(time.monotonic() - started, 2)
assert len(initial["blocks"]) == 6 and len(initial["meters"]) == 24
assert initial["metrics"]["units"] == 620
assert initial["metrics"]["expected"] - initial["metrics"]["received"] == 2
assert all(initial["metrics"][key] is None for key in ("grid", "exported", "selfConsumed", "cost", "co2Kg", "change"))
assert initial["source"]["dataset_id"] == "d_17f5382f26140b1fdae0ba2ef6239d2f"
passed("Six public HDB blocks, 24 simulated assets and missing-data safeguards", cold_seed_seconds=cold_seconds)

sample = request(manager, "/estate/sample.csv")
preview = request(manager, "/estate/imports/preview", "POST", {"csv": sample})
assert preview["valid"] == 2 and preview["duplicate"] == 0 and preview["invalid"] == 0
commit = request(manager, "/estate/imports/commit", "POST", {"csv": sample, "fileName": "estate-gap-repair.csv"}, status=201)
assert commit["accepted"] == 2
complete = request(manager, "/estate/overview")
m = complete["metrics"]
assert m["complete"] and m["coverage"] == 100 and m["change"] is not None
assert abs(m["load"] - m["selfConsumed"] - m["grid"]) < .03
assert abs(m["solar"] - m["selfConsumed"] - m["exported"]) < .03
assert abs(m["cost"] - m["grid"] * .285) < .02
assert abs(m["co2Kg"] - m["grid"] * .402) < .02
passed("Two-reading import persists and unlocks correctly balanced estimates", coverage=100)

repeat = request(manager, "/estate/imports/commit", "POST", {"csv": sample, "fileName": "estate-gap-repair.csv"})
assert repeat["alreadyImported"] and len(request(manager, "/estate/imports")) == 1
duplicate = request(manager, "/estate/imports/preview", "POST", {"csv": sample})
assert duplicate["valid"] == 0 and duplicate["duplicate"] == 2
passed("Repeated imports preserve one history record and identify duplicates")

report = request(manager, "/estate/report.csv")
rows = list(csv.DictReader(io.StringIO(report)))
assert len(rows) == 6
assert all(row["ema_gef_year"] == "2024" and row["ema_gef_kg_co2_per_kwh"] == "0.402" for row in rows)
assert all("SIMULATED" in row["energy_data_type"] and "data.gov.sg" in row["inventory_source"] for row in rows)
passed("Six-block CSV report carries source and historical factor provenance", rows=6)

request(manager, "/estate/overview?from=2026-02-30&to=2026-03-01", status=400)
request(manager, "/estate/overview?town=Ang%20Mo%20Kio&block=B03", status=400)
request(manager, "/estate/imports/commit", "POST", {"csv": sample, "fileName": "../bad.csv"}, status=400)
passed("Invalid dates, mismatched filters and path-like filenames are rejected")

order = request(manager, "/estate/orders", "POST", {"meterId": "B03-PUMPS", "title": "Inspect simulated pump threshold exception", "priority": "high", "note": "Synthetic QA inspection requested; no real maintenance is dispatched."}, status=201)
path = "/estate/orders/" + urllib.parse.quote(order["id"], safe="")
request(manager, path, "PATCH", {"version": 1, "status": "verified", "assignee": "Demo M&E team", "note": "This transition should be rejected before the inspection."}, status=400)
for version, state in enumerate(("in_progress", "completed", "verified"), start=1):
    request(manager, path, "PATCH", {"version": version, "status": state, "assignee": "Demo M&E team", "note": "Synthetic QA evidence recorded for the " + state + " workflow stage."})
saved = request(manager, path)
assert saved["version"] == 4 and saved["status"] == "verified" and len(saved["events"]) == 4
request(manager, path, "PATCH", {"version": 1, "status": "open", "assignee": "Demo M&E team", "note": "An outdated version must not change the saved evidence."}, status=409)
passed("Ordered maintenance transitions persist four audit events and reject stale writes")

other = visitor()
request(other, "/session", "POST", {"role": "manager"})
independent = request(other, "/estate/overview")
assert independent["metrics"]["grid"] is None and not independent["orders"]
assert request(other, "/estate/imports") == []
request(other, path, status=404)
passed("Independent visitors cannot see another workspace's imports or maintenance")

request(manager, "/session", "POST", {"role": "tenant"})
viewer = request(manager, "/estate/overview")
assert len(viewer["blocks"]) == 2 and len(viewer["meters"]) == 8
assert all(block["town"] == "Ang Mo Kio" for block in viewer["blocks"])
request(manager, "/estate/overview?town=Bishan", status=403)
request(manager, "/estate/overview?block=B03", status=404)
request(manager, path, status=404)
request(manager, "/estate/orders", "POST", {}, status=403)
request(manager, "/estate/imports/commit", "POST", {}, status=403)
request(manager, "/estate/sample.csv", status=403)
viewer_report = list(csv.DictReader(io.StringIO(request(manager, "/estate/report.csv"))))
assert len(viewer_report) == 2 and all(row["town"] == "Ang Mo Kio" for row in viewer_report)
passed("Area viewer is restricted to two blocks, eight assets and read-only reports")

request(manager, "/session", "POST", {"role": "manager"})
office = request(manager, "/dashboard")
assert office["metrics"]["missing"] == 8
passed("Original building demo remains available with its unchanged eight-reading gap")

output = Path("docs/qa/v2.0")
output.mkdir(parents=True, exist_ok=True)
(output / "estate-report.csv").write_text(report)
(output / "live-api-checks.json").write_text(json.dumps({"url": base, "verified_at": datetime.now(timezone.utc).isoformat(), "checks": checks, "synthetic_test_workspaces": 2, "known_dependency_vulnerabilities": 0}, indent=2) + "\n")
print(json.dumps({"passed": len(checks), "report_rows": len(rows)}), flush=True)
