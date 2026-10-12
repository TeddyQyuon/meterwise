"""Comprehensive unit tests for estate energy anomaly detection and diagnostic heuristics."""
from datetime import datetime, timedelta, timezone
import pytest

from backend.core import SGT, iso
from backend.estate import BLOCKS, METERS
from backend.ml.anomaly import EstateAnomalyDetector


def create_base_readings_with_anomaly(days=14):
    """Create a baseline reading set covering all meters, injecting specific anomalies."""
    start_dt = datetime(2026, 9, 27, 16, 0, tzinfo=timezone.utc)  # 00:00 SGT
    readings = []
    for day in range(days):
        for hour in range(24):
            cur_dt = start_dt + timedelta(days=day, hours=hour)
            sgt_hour = cur_dt.astimezone(SGT).hour
            ts_str = iso(cur_dt)

            for meter in METERS:
                m_id = meter["id"]
                svc = meter["service"]
                val = 2.0
                if svc == "lighting":
                    val = 4.4 if sgt_hour >= 19 or sgt_hour < 7 else 1.9
                elif svc == "lifts":
                    val = 5.6 if 7 <= sgt_hour < 22 else 1.2
                elif svc == "pumps":
                    val = 2.3
                elif svc == "solar":
                    daylight = max(0.0, ((sgt_hour - 7) / 12) if 7 <= sgt_hour < 19 else 0.0)
                    val = daylight * 20.0

                # Inject Pump night leak on B03-PUMPS at day 12, hour 3 SGT (10.8 kWh vs 2.3 kWh)
                if m_id == "B03-PUMPS" and day == 12 and sgt_hour == 3:
                    val = 10.8

                # Inject Night lighting surge on B02-LIGHTING at day 13, hour 2 SGT (11.2 kWh vs 4.4 kWh)
                if m_id == "B02-LIGHTING" and day == 13 and sgt_hour == 2:
                    val = 11.2

                # Inject Daytime lighting burn on B01-LIGHTING at day 11, hour 12 SGT (6.0 kWh vs 1.9 kWh)
                if m_id == "B01-LIGHTING" and day == 11 and sgt_hour == 12:
                    val = 6.0

                # Inject Solar drop on B05-SOLAR at day 10, hour 13 SGT (0.0 kWh vs 20.0 kWh expected)
                if m_id == "B05-SOLAR" and day == 10 and sgt_hour == 13:
                    val = 0.0

                readings.append({
                    "meter_id": m_id,
                    "recorded_at": ts_str,
                    "consumption_kwh": val,
                })
    return readings


def test_detector_initialization_clamping():
    d_low = EstateAnomalyDetector(sensitivity=0.001)
    assert d_low.sensitivity == 0.01

    d_high = EstateAnomalyDetector(sensitivity=0.99)
    assert d_high.sensitivity == 0.25

    d_mid = EstateAnomalyDetector(sensitivity=0.07)
    assert d_mid.sensitivity == 0.07


def test_detector_empty_readings():
    detector = EstateAnomalyDetector()
    assert detector.detect_anomalies([], METERS, BLOCKS) == []


def test_detect_water_pump_night_leak():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)
    anomalies = detector.detect_anomalies(readings, METERS, BLOCKS, service_filter="pumps")

    pump_anoms = [a for a in anomalies if a.meter_id == "B03-PUMPS" and a.hour == 3]
    assert len(pump_anoms) >= 1
    target = pump_anoms[0]

    assert target.service == "pumps"
    assert target.actual_kwh == 10.8
    assert target.severity == "high"
    assert target.anomaly_type == "pump_night_leak"
    assert "pipe leak" in target.root_cause.lower() or "float switch" in target.root_cause.lower()
    assert "plumbing" in target.recommended_action.lower() or "leak detection" in target.recommended_action.lower()
    assert 0.85 <= target.anomaly_confidence <= 1.0


def test_detect_lighting_night_spike():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)
    anomalies = detector.detect_anomalies(readings, METERS, BLOCKS, service_filter="lighting")

    night_spikes = [a for a in anomalies if a.meter_id == "B02-LIGHTING" and a.hour == 2]
    assert len(night_spikes) >= 1
    target = night_spikes[0]

    assert target.service == "lighting"
    assert target.actual_kwh == 11.2
    assert target.severity == "high"
    assert target.anomaly_type == "lighting_night_spike"
    assert "load tap" in target.root_cause.lower() or "threshold" in target.root_cause.lower()


def test_detect_lighting_daytime_burn():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)
    anomalies = detector.detect_anomalies(readings, METERS, BLOCKS, service_filter="lighting")

    day_burns = [a for a in anomalies if a.meter_id == "B01-LIGHTING" and a.hour == 12]
    assert len(day_burns) >= 1
    target = day_burns[0]

    assert target.service == "lighting"
    assert target.anomaly_type == "lighting_daytime_burn"
    assert "photoelectric" in target.root_cause.lower() or "timer" in target.root_cause.lower()
    assert "photocell" in target.recommended_action.lower() or "timer" in target.recommended_action.lower()


def test_detect_solar_underperformance():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)
    anomalies = detector.detect_anomalies(readings, METERS, BLOCKS, service_filter="solar")

    solar_drops = [a for a in anomalies if a.meter_id == "B05-SOLAR" and a.hour == 13]
    assert len(solar_drops) >= 1
    target = solar_drops[0]

    assert target.service == "solar"
    assert target.actual_kwh == 0.0
    assert target.anomaly_type == "solar_underperformance"
    assert "inverter" in target.root_cause.lower() or "isolator" in target.root_cause.lower()
    assert "inverter" in target.recommended_action.lower()


def test_anomalies_service_and_block_filtering():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)

    # Filter by pumps service
    pumps_only = detector.detect_anomalies(readings, METERS, BLOCKS, service_filter="pumps")
    assert all(a.service == "pumps" for a in pumps_only)

    # Filter by block B03
    b03_only = detector.detect_anomalies(readings, METERS, BLOCKS, block_filter="B03")
    assert all(a.block_id == "B03" for a in b03_only)


def test_anomaly_attributes_validity():
    readings = create_base_readings_with_anomaly()
    detector = EstateAnomalyDetector(sensitivity=0.05)
    anomalies = detector.detect_anomalies(readings, METERS, BLOCKS)

    assert len(anomalies) > 0
    for a in anomalies:
        assert a.id.startswith("ANOM-")
        assert a.severity in ("high", "medium", "low")
        assert 0.0 <= a.anomaly_confidence <= 1.0
        assert a.residual_kwh == round(a.actual_kwh - a.expected_kwh, 2)
        assert len(a.root_cause) > 10
        assert len(a.recommended_action) > 10
