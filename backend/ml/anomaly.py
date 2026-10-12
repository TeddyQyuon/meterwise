"""Anomaly detection module for estate energy meters and rooftop solar assets.

Combines Isolation Forest unsupervised machine learning with robust statistical
contextual baselines (hour-of-day median/IQR) and Singapore estate domain heuristics.
Detects:
- Water pump night leaks / continuous nighttime cycling (e.g. 03:00 spikes)
- Abnormal daytime lighting burn / photosensor failure
- High nighttime common lighting surges
- Elevator motor drag / off-peak duty spikes
- Rooftop solar generation underperformance / inverter trips during peak sunlight
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from ..core import SGT, parse_time, rounded
from .features import compute_singapore_weather_proxies, extract_datetime_components
from .schemas import AnomalyItem, AnomalyResponse, AnomalySummary


class EstateAnomalyDetector:
    """Robust Isolation Forest and contextual residual anomaly detector."""

    def __init__(self, sensitivity: float = 0.05, random_state: int = 42):
        self.sensitivity = max(0.01, min(0.25, sensitivity))
        self.random_state = random_state

    def detect_anomalies(
        self,
        readings: List[Dict[str, Any]],
        meters: List[Dict[str, Any]],
        blocks: List[Dict[str, Any]],
        service_filter: str = "all",
        block_filter: str = "all",
    ) -> List[AnomalyItem]:
        """Analyze readings and return structured anomaly items."""
        if not readings:
            return []

        df = pd.DataFrame(readings)
        df["recorded_dt"] = pd.to_datetime(df["recorded_at"])
        df = df.sort_values("recorded_dt").reset_index(drop=True)

        meter_map = {m["id"]: m for m in meters}
        block_map = {b["id"]: b for b in blocks}

        # Filter by service and block if requested
        if service_filter != "all":
            valid_meters = {mid for mid, m in meter_map.items() if m.get("service") == service_filter}
            df = df[df["meter_id"].isin(valid_meters)]
        if block_filter != "all":
            valid_meters = {mid for mid, m in meter_map.items() if m.get("block_id") == block_filter}
            df = df[df["meter_id"].isin(valid_meters)]

        if df.empty:
            return []

        # Temporal and weather features
        temporal = extract_datetime_components(df["recorded_dt"])
        weather = compute_singapore_weather_proxies(temporal["hour"])
        df["hour"] = temporal["hour"]
        df["dow"] = temporal["dow"]
        df["solar_elevation"] = weather["solar_elevation_proxy"]

        # Calculate hour-of-day baseline per meter (median and robust std)
        baselines = {}
        for meter_id, group in df.groupby("meter_id"):
            hourly_stats = {}
            for h in range(24):
                h_vals = group[group["hour"] == h]["consumption_kwh"]
                if not h_vals.empty:
                    med = float(h_vals.median())
                    std = float(h_vals.std()) if len(h_vals) > 1 else 0.2
                    q75 = float(h_vals.quantile(0.75))
                    q25 = float(h_vals.quantile(0.25))
                    hourly_stats[h] = {"median": med, "std": max(0.15, std if not np.isnan(std) else 0.2), "iqr": max(0.2, q75 - q25)}
                else:
                    hourly_stats[h] = {"median": 0.0, "std": 0.2, "iqr": 0.2}
            baselines[meter_id] = hourly_stats

        # Compute expected consumption, residual, and z-score
        expected_list = []
        z_scores = []
        for idx, row in df.iterrows():
            m_id = row["meter_id"]
            h = int(row["hour"])
            b = baselines.get(m_id, {}).get(h, {"median": 0.0, "std": 0.2})
            exp_val = b["median"]
            std_val = b["std"]
            expected_list.append(exp_val)
            z = (row["consumption_kwh"] - exp_val) / std_val
            z_scores.append(z)

        df["expected_kwh"] = expected_list
        df["residual_kwh"] = df["consumption_kwh"] - df["expected_kwh"]
        df["z_score"] = z_scores

        # Train Isolation Forest on contextual multidimensional features
        feat_matrix = pd.DataFrame({
            "consumption_kwh": df["consumption_kwh"],
            "hour": df["hour"],
            "hour_sin": temporal["hour_sin"],
            "hour_cos": temporal["hour_cos"],
            "dow_sin": temporal["dow_sin"],
            "dow_cos": temporal["dow_cos"],
            "solar_elevation": df["solar_elevation"],
            "expected_kwh": df["expected_kwh"],
            "residual_kwh": df["residual_kwh"],
            "z_score": df["z_score"],
        })

        iso_forest = IsolationForest(
            n_estimators=100,
            contamination=self.sensitivity,
            random_state=self.random_state,
        )
        iso_forest.fit(feat_matrix)
        df["iso_pred"] = iso_forest.predict(feat_matrix)  # -1 = anomaly, 1 = normal
        # Decision function: lower/negative means more abnormal
        scores = iso_forest.decision_function(feat_matrix)
        df["iso_score"] = scores

        anomalies: List[AnomalyItem] = []

        # Iterate and diagnose candidates
        for idx, row in df.iterrows():
            meter_id = row["meter_id"]
            meter = meter_map.get(meter_id, {})
            block_id = meter.get("block_id", "")
            block = block_map.get(block_id, {})
            service = meter.get("service", "")
            threshold = float(meter.get("threshold_kwh", 10.0))
            actual = float(row["consumption_kwh"])
            expected = float(row["expected_kwh"])
            residual = float(row["residual_kwh"])
            z = float(row["z_score"])
            hour = int(row["hour"])
            iso_flag = (row["iso_pred"] == -1)
            raw_score = float(row["iso_score"])

            # Normalized confidence score (0.0 to 1.0)
            base_confidence = min(0.99, max(0.50, 0.50 + abs(raw_score) * 2.0))

            is_anomaly = False
            severity = "low"
            anomaly_type = "unusual_load"
            root_cause = ""
            action = ""

            # Rule 1: Water Pump night leak / high night cycling
            if service == "pumps" and (hour in range(0, 7)):
                if actual >= expected * 2.0 or actual > threshold or z >= 2.5:
                    is_anomaly = True
                    severity = "high" if (actual > threshold or actual >= 8.0) else "medium"
                    base_confidence = min(0.99, max(0.88, 0.80 + 0.03 * z))
                    anomaly_type = "pump_night_leak"
                    root_cause = (
                        f"Abnormal water pump nighttime surge ({actual:.1f} kWh vs baseline {expected:.1f} kWh) at {hour:02d}:00 SGT. "
                        "High continuous runtime during minimal occupancy suggests an active distribution line pipe leak, "
                        "stuck float switch, or faulty pressure relief valve."
                    )
                    action = (
                        "Dispatch plumbing contractor immediately to conduct acoustic leak detection on booster risers "
                        "and test cistern ball float valves."
                    )

            # Rule 2: Common lighting daytime burn (photosensor failure)
            elif service == "lighting" and (hour in range(8, 18)):
                if actual >= expected * 1.8 and actual > 2.5:
                    is_anomaly = True
                    severity = "medium"
                    base_confidence = 0.86
                    anomaly_type = "lighting_daytime_burn"
                    root_cause = (
                        f"Daytime common lighting burn at {hour:02d}:00 SGT ({actual:.1f} kWh vs baseline {expected:.1f} kWh). "
                        "Corridor/staircase lighting remained energized under bright daylight, indicating photoelectric sensor failure "
                        "or manual bypass switch override."
                    )
                    action = (
                        "Inspect external photocell ambient sensor and reset master corridor timer switch in the main distribution frame."
                    )

            # Rule 3: Common lighting nighttime surge / tap
            elif service == "lighting" and (actual > threshold or z >= 3.0):
                is_anomaly = True
                severity = "high" if actual > threshold else "medium"
                base_confidence = min(0.99, max(0.90, 0.78 + 0.03 * z))
                anomaly_type = "lighting_night_spike"
                root_cause = (
                    f"Common lighting load exceeded threshold ({actual:.1f} kWh vs limit {threshold:.1f} kWh). "
                    "Indicates an unauthorized circuit load tap, insulation degradation, or electrical ballast failure."
                )
                action = (
                    "Conduct thermal imaging inspection of lighting distribution sub-boards and verify common-area power socket usage."
                )

            # Rule 4: Lift motor drag / off-peak duty
            elif service == "lifts" and ((hour in range(0, 6) and actual >= expected * 2.5 and actual > 3.0) or actual > threshold):
                is_anomaly = True
                severity = "high" if actual > threshold else "medium"
                base_confidence = min(0.98, max(0.85, 0.75 + 0.03 * z))
                anomaly_type = "lift_mechanical_drag"
                root_cause = (
                    f"Elevator motor consumption surge at off-peak hour {hour:02d}:00 SGT ({actual:.1f} kWh vs baseline {expected:.1f} kWh). "
                    "Likely hoistway guide shoe binding, brake drag, or lift car stuck in continuous unprogrammed cycling."
                )
                action = (
                    "Schedule lift maintenance vendor to inspect traction motor current draw, guide rails, and brake clearance."
                )

            # Rule 5: Rooftop Solar underperformance during peak sun
            elif service == "solar" and (hour in range(10, 16)):
                if expected >= 8.0 and actual <= expected * 0.25:
                    is_anomaly = True
                    severity = "high" if actual < 1.0 else "medium"
                    base_confidence = min(0.98, max(0.88, 0.80 + (expected - actual) / expected * 0.15))
                    anomaly_type = "solar_underperformance"
                    root_cause = (
                        f"Rooftop solar severe shortfall during peak sun at {hour:02d}:00 SGT ({actual:.1f} kWh vs expected {expected:.1f} kWh). "
                        "Indicates DC string inverter trip, tripped DC isolator, or heavy PV panel shading/soiling."
                    )
                    action = (
                        "Check solar inverter fault error codes, verify DC circuit breakers at the string combiner box, and inspect panel surface."
                    )

            # Rule 6: General Isolation Forest outlier + significant residual
            elif iso_flag and abs(z) >= 2.5 and actual > threshold:
                is_anomaly = True
                severity = "high" if actual > threshold else "medium"
                base_confidence = min(0.95, max(0.75, 0.65 + 0.03 * abs(z)))
                anomaly_type = "consumption_spike"
                root_cause = (
                    f"Uncharacteristic {service} consumption surge ({actual:.1f} kWh vs expected {expected:.1f} kWh, z-score: {z:.1f}). "
                    "Deviates significantly from historical diurnal baseline."
                )
                action = "Review facilities operations logbook and inspect asset electrical supply."

            if is_anomaly:
                recorded_dt = row["recorded_dt"].to_pydatetime()
                if recorded_dt.tzinfo is None:
                    recorded_dt = recorded_dt.replace(tzinfo=SGT)
                else:
                    recorded_dt = recorded_dt.astimezone(SGT)
                sgt_time_str = recorded_dt.strftime("%Y-%m-%d %H:00 SGT")
                anom_id = f"ANOM-{meter_id}-{recorded_dt.strftime('%Y%m%d%H%M')}"

                anomalies.append(
                    AnomalyItem(
                        id=anom_id,
                        meter_id=meter_id,
                        block_id=block_id,
                        town=block.get("town", ""),
                        service=service,
                        timestamp=row["recorded_at"],
                        sgt_time=sgt_time_str,
                        hour=hour,
                        actual_kwh=rounded(actual, 2),
                        expected_kwh=rounded(expected, 2),
                        residual_kwh=rounded(residual, 2),
                        threshold_kwh=rounded(threshold, 2),
                        anomaly_confidence=rounded(base_confidence, 2),
                        severity=severity,
                        anomaly_type=anomaly_type,
                        root_cause=root_cause,
                        recommended_action=action,
                    )
                )

        # Sort chronologically descending (most recent first)
        anomalies.sort(key=lambda a: a.timestamp, reverse=True)
        return anomalies
