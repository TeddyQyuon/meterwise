import json
from datetime import timedelta

import pytest

from backend import core, estate, seed
from backend.core import add_days, csv_cell, day_start, iso
from backend.csv_import import parse_csv, validate_csv
from backend.database import ROOT
from backend.estate import BLOCKS, METERS, calculate_estate, energy_balance


def full_day(count=1):
    return [{"meter_id": meter["id"], "recorded_at": iso(day_start("2026-09-30") + timedelta(hours=hour)),
             "consumption_kwh": 0} for meter in METERS[:count * 4] for hour in range(24)]


def test_balance_never_nets_between_blocks_or_hours():
    rows = full_day(2)
    for meter, hour, value in [("B01-SOLAR", 12, 50), ("B01-LIGHTING", 12, 5),
                               ("B01-LIGHTING", 20, 20), ("B02-LIFTS", 12, 30)]:
        next(row for row in rows if row["meter_id"] == meter
             and row["recorded_at"] == iso(day_start("2026-09-30") + timedelta(hours=hour)))["consumption_kwh"] = value
    result = energy_balance(rows, METERS[:8], "2026-09-30", "2026-09-30")
    assert (result["load"], result["solar"], result["grid"], result["exported"], result["selfConsumed"]) == (55, 50, 50, 45, 5)
    assert result["coverage"] == 100
    assert result["load"] == result["grid"] + result["selfConsumed"]
    assert result["solar"] == result["exported"] + result["selfConsumed"]


def test_missing_is_distinct_from_zero_and_withholds_estimates():
    result = calculate_estate(full_day()[:-1], [], BLOCKS[:1], METERS[:4], "2026-09-30", "2026-09-30")
    assert result["balance"]["received"] == 95
    assert result["balance"]["expected"] == 96
    for key in ["grid", "exported", "selfConsumed"]:
        assert result["balance"][key] is None
    for key in ["cost", "co2Kg", "kwhPerUnit"]:
        assert result["summaries"][0][key] is None
    assert result["change"] is None


def test_api_matches_the_original_typescript_contract(client, monkeypatch):
    # The fixture was produced by the actual 2.0 TS handler before removing it.
    fixture = json.loads((ROOT / "tests/fixtures/v2-api-contract.json").read_text())
    fixed_time = core.parse_time(fixture["clock"])
    def fixed_date(value=None):
        return core.singapore_date(value or fixed_time)
    monkeypatch.setattr(seed, "singapore_date", fixed_date)
    monkeypatch.setattr(estate, "singapore_date", fixed_date)
    # This visitor is provisioned after installing the synthetic clock.
    client.cookies.clear()
    client.cookies.set("mw_visitor", "a" * 64, domain="meterwise.test", path="/")
    session = client.post("/api/session", json={"role": "manager"}).json()
    assert session == fixture["session"]
    assert client.get("/api/dashboard").json() == fixture["building"]
    assert client.get("/api/estate/overview").json() == fixture["estate"]


def test_csv_quotes_bom_multiline_duplicates_and_formula_protection():
    text = '\ufeffmeter_id,timestamp,consumption_kwh,note\r\n"MW-001","2026-09-30T10:00:00+08:00",0,"line one\nline ""two"""'
    rows = parse_csv(text)
    assert rows[1]["cells"][-1] == 'line one\nline "two"'
    result = validate_csv(text + "\r\n" + text.split("\r\n", 1)[1], seed.METERS)
    assert (result["valid"], result["duplicate"], result["invalid"]) == (1, 1, 0)
    assert result["readings"][0]["consumption_kwh"] == 0
    assert csv_cell(" =cmd()") == '"\' =cmd()"'
    assert csv_cell(-2) == '"-2"'
    with pytest.raises(ValueError, match="closing quote"):
        parse_csv('"x"no')
    with pytest.raises(ValueError, match="not closed"):
        parse_csv('"x')


@pytest.mark.parametrize("time,kwh", [("2026-02-30T10:00:00+08:00", "2"),
    ("2026-09-30T10:30:00+08:00", "2"), ("2026-09-30T10:00:00", "2"),
    ("2099-01-01T10:00:00+08:00", "2"), ("2026-09-30T10:00:00+08:00", "-1"),
    ("2026-09-30T10:00:00+08:00", "NaN"), ("2026-09-30T10:00:00+08:00", "1e309"),
    ("2026-09-30T10:00:00+08:99", "2")])
def test_csv_rejects_invalid_time_or_consumption(time, kwh):
    result = validate_csv(f"meter_id,timestamp,consumption_kwh\nMW-001,{time},{kwh}", seed.METERS)
    assert result["invalid"] == 1


def test_csv_requires_completed_intervals_and_caps_bytes_and_rows():
    timestamp = core.now().replace(minute=0, second=0, microsecond=0)
    result = validate_csv(f"meter_id,timestamp,consumption_kwh\nMW-001,{iso(timestamp)},3", seed.METERS)
    assert result["invalid"] == 1
    assert "not finished" in result["issues"][0]["message"]
    with pytest.raises(ValueError, match="1 MB"):
        validate_csv("é" * 500001, seed.METERS)
    with pytest.raises(ValueError, match="1,500"):
        validate_csv("meter_id,timestamp,consumption_kwh\n" + "MW-001,2026-09-30T10:00:00Z,2\n" * 1501, seed.METERS)
    assert add_days("2028-02-28", 1) == "2028-02-29"
