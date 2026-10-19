"""Estate ML Service Layer.

Bridges the MeterWise database, estate metadata, LightGBM forecasting,
and Isolation Forest anomaly detection to provide high-performance ML analytics.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import pandas as pd

from ..core import ApiError, iso, now, parse_time, rounded
from ..estate import ensure_estate, permitted_blocks, workspace_blocks, workspace_estate_meters
from .anomaly import EstateAnomalyDetector
from .forecasting import EnergyDemandSolarForecaster
from .schemas import (
    AnomalyRequest,
    AnomalyResponse,
    AnomalySummary,
    BlockForecast,
    ForecastRequest,
    ForecastResponse,
    ForecastSummary,
)


def get_ml_forecast(
    db: Any,
    access: Dict[str, Any],
    query: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Train/infer energy demand and rooftop solar forecasts for permitted estate blocks."""
    query = query or {}
    body = body or {}

    block_param = body.get("block") or query.get("block", "all")
    horizon_param = body.get("horizon_hours") or query.get("horizon_hours", 24)
    model_type_param = body.get("model_type") or query.get("model_type", "lightgbm")

    try:
        horizon_hours = int(horizon_param)
        if not (1 <= horizon_hours <= 72):
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError(400, "Forecast horizon must be an integer between 1 and 72 hours.") from None

    if model_type_param not in ("lightgbm", "gradient_boosting", "random_forest"):
        raise ApiError(400, "Supported model types are 'lightgbm', 'gradient_boosting', or 'random_forest'.")

    workspace = access["workspace_id"]
    ensure_estate(db, workspace)
    all_blocks = workspace_blocks(db, workspace)
    all_meters = workspace_estate_meters(db, workspace)
    permitted = permitted_blocks(access["role"], all_blocks, access.get("permitted_town"))

    if block_param != "all" and not any(b["id"] == block_param for b in permitted):
        raise ApiError(404, "Requested block is not found or not in your permitted area view.")

    target_blocks = [b for b in permitted if (block_param == "all" or b["id"] == block_param)]
    target_meters = [m for m in all_meters if any(b["id"] == m["block_id"] for b in target_blocks)]

    # Fetch readings for targeted blocks
    sql = (
        "SELECT meter_id, recorded_at, consumption_kwh FROM estate_readings "
        "WHERE workspace_id=? AND meter_id IN ("
        + ",".join("?" for _ in target_meters)
        + ") ORDER BY recorded_at"
    )
    rows = db.all(sql, [workspace, *[m["id"] for m in target_meters]])
    if not rows:
        raise ApiError(404, "No meter readings available to build ML forecasts.")

    meter_map = {m["id"]: m for m in target_meters}
    df_raw = pd.DataFrame(rows)
    df_raw["recorded_dt"] = pd.to_datetime(df_raw["recorded_at"])
    df_raw["block_id"] = df_raw["meter_id"].map(lambda mid: meter_map[mid]["block_id"])
    df_raw["service"] = df_raw["meter_id"].map(lambda mid: meter_map[mid]["service"])

    forecaster = EnergyDemandSolarForecaster(model_type=model_type_param)
    block_forecasts: List[BlockForecast] = []

    total_load = total_solar = total_grid = total_export = 0.0
    load_maes: List[float] = []
    solar_maes: List[float] = []

    for block in target_blocks:
        b_id = block["id"]
        b_rows = df_raw[df_raw["block_id"] == b_id]
        if b_rows.empty:
            continue

        # Pivot to aggregate hourly common load (lighting + lifts + pumps) vs solar
        pivoted = b_rows.pivot_table(
            index="recorded_dt",
            columns="service",
            values="consumption_kwh",
            aggfunc="sum",
            fill_value=0.0,
        ).reset_index()

        # Compute common load
        load_cols = [c for c in ["lighting", "lifts", "pumps"] if c in pivoted.columns]
        pivoted["load_kwh"] = pivoted[load_cols].sum(axis=1) if load_cols else 0.0
        pivoted["solar_kwh"] = pivoted["solar"] if "solar" in pivoted.columns else 0.0

        df_block_history = pd.DataFrame({
            "timestamp": pivoted["recorded_dt"].tolist(),
            "load_kwh": pivoted["load_kwh"].values,
            "solar_kwh": pivoted["solar_kwh"].values,
        })

        b_forecast = forecaster.forecast_block(df_block_history, block, horizon_hours=horizon_hours)
        block_forecasts.append(b_forecast)

        total_load += b_forecast.total_predicted_load_kwh
        total_solar += b_forecast.total_predicted_solar_kwh
        total_grid += b_forecast.total_predicted_grid_kwh
        total_export += b_forecast.total_predicted_export_kwh
        load_maes.append(b_forecast.load_metrics.mae)
        solar_maes.append(b_forecast.solar_metrics.mae)

    solar_offset = (total_solar / max(total_load, 0.001)) * 100.0

    summary = ForecastSummary(
        total_load_kwh=rounded(total_load, 2),
        total_solar_kwh=rounded(total_solar, 2),
        total_grid_kwh=rounded(total_grid, 2),
        total_export_kwh=rounded(total_export, 2),
        solar_offset_percentage=rounded(solar_offset, 1),
        blocks_count=len(block_forecasts),
        average_load_mae=rounded(float(sum(load_maes) / max(len(load_maes), 1)), 2),
        average_solar_mae=rounded(float(sum(solar_maes) / max(len(solar_maes), 1)), 2),
    )

    response = ForecastResponse(
        generated_at=iso(now()),
        horizon_hours=horizon_hours,
        model_type=forecaster.model_type,
        summary=summary,
        blocks=block_forecasts,
    )
    return response.model_dump()


def get_ml_anomalies(
    db: Any,
    access: Dict[str, Any],
    query: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run Isolation Forest and contextual residual anomaly detection across estate assets."""
    query = query or {}
    body = body or {}

    block_param = body.get("block") or query.get("block", "all")
    service_param = body.get("service") or query.get("service", "all")
    sens_param = body.get("sensitivity") or query.get("sensitivity", 0.05)
    from_date = body.get("from_date") or query.get("from")
    to_date = body.get("to_date") or query.get("to")

    try:
        sensitivity = float(sens_param)
        if not (0.01 <= sensitivity <= 0.25):
            raise ValueError()
    except (ValueError, TypeError):
        raise ApiError(400, "Sensitivity parameter must be between 0.01 and 0.25.") from None

    if service_param not in ("all", "lighting", "lifts", "pumps", "solar"):
        raise ApiError(400, "Service must be 'all', 'lighting', 'lifts', 'pumps', or 'solar'.")

    workspace = access["workspace_id"]
    ensure_estate(db, workspace)
    all_blocks = workspace_blocks(db, workspace)
    all_meters = workspace_estate_meters(db, workspace)
    permitted = permitted_blocks(access["role"], all_blocks, access.get("permitted_town"))

    if block_param != "all" and not any(b["id"] == block_param for b in permitted):
        raise ApiError(404, "Requested block is not found or not in your permitted area view.")

    target_blocks = [b for b in permitted if (block_param == "all" or b["id"] == block_param)]
    target_meters = [m for m in all_meters if any(b["id"] == m["block_id"] for b in target_blocks)]

    if service_param != "all":
        target_meters = [m for m in target_meters if m["service"] == service_param]

    sql = (
        "SELECT meter_id, recorded_at, consumption_kwh FROM estate_readings "
        "WHERE workspace_id=? AND meter_id IN ("
        + ",".join("?" for _ in target_meters)
        + ") "
    )
    params = [workspace, *[m["id"] for m in target_meters]]

    if from_date:
        sql += " AND recorded_at >= ?"
        params.append(from_date + "T00:00:00.000Z")
    if to_date:
        sql += " AND recorded_at <= ?"
        params.append(to_date + "T23:59:59.999Z")

    sql += " ORDER BY recorded_at"
    readings = db.all(sql, params)

    detector = EstateAnomalyDetector(sensitivity=sensitivity)
    anomalies = detector.detect_anomalies(
        readings=readings,
        meters=target_meters,
        blocks=target_blocks,
        service_filter=service_param,
        block_filter=block_param,
    )

    high_count = sum(1 for a in anomalies if a.severity == "high")
    med_count = sum(1 for a in anomalies if a.severity == "medium")
    low_count = sum(1 for a in anomalies if a.severity == "low")

    by_service: Dict[str, int] = {}
    by_block: Dict[str, int] = {}
    for a in anomalies:
        by_service[a.service] = by_service.get(a.service, 0) + 1
        by_block[a.block_id] = by_block.get(a.block_id, 0) + 1

    summary = AnomalySummary(
        total_detected=len(anomalies),
        high_severity=high_count,
        medium_severity=med_count,
        low_severity=low_count,
        by_service=by_service,
        by_block=by_block,
    )

    response = AnomalyResponse(
        detected_at=iso(now()),
        total_anomalies=len(anomalies),
        summary=summary,
        anomalies=anomalies,
    )
    return response.model_dump()
