"""Unit and integration tests for ML energy demand and rooftop solar forecasting."""
import math
from datetime import datetime, timedelta, timezone
import numpy as np
import pandas as pd
import pytest

from backend.core import SGT
from backend.ml.forecasting import (
    EnergyDemandSolarForecaster,
    build_regressor,
    safe_mape,
)


def generate_synthetic_block_history(days=14, scale=1.1):
    """Generate deterministic 14-day hourly block history (load + solar)."""
    start_dt = datetime(2026, 9, 27, 16, 0, tzinfo=timezone.utc)  # 00:00 SGT
    rows = []
    for step in range(days * 24):
        dt = start_dt + timedelta(hours=step)
        sgt_hour = dt.astimezone(SGT).hour

        # Load curve: higher evening lighting and daytime lifts
        lighting = (4.4 if sgt_hour >= 19 or sgt_hour < 7 else 1.9) * scale
        lifts = (5.6 if 7 <= sgt_hour < 22 else 1.2) * scale
        pumps = 2.3 * scale
        load = lighting + lifts + pumps + 0.1 * math.sin(step / 3)

        # Solar curve: daylight between 07:00 and 19:00 SGT
        daylight = max(0.0, math.sin((sgt_hour - 7) / 12 * math.pi))
        solar = daylight * 22.0 * scale

        rows.append({
            "timestamp": dt,
            "load_kwh": max(0.1, load),
            "solar_kwh": max(0.0, solar),
        })
    return pd.DataFrame(rows)


def test_safe_mape_filtering():
    y_true = np.array([0.0, 0.1, 10.0, 20.0])
    y_pred = np.array([0.2, 0.2, 11.0, 18.0])
    # Min threshold 0.5 filters out 0.0 and 0.1
    mape = safe_mape(y_true, y_pred, min_threshold=0.5)
    expected = (abs(10 - 11) / 10 + abs(20 - 18) / 20) / 2 * 100
    assert math.isclose(mape, expected, rel_tol=1e-3)

    # All below threshold returns 0.0
    assert safe_mape(np.array([0.0, 0.2]), np.array([1.0, 1.0]), min_threshold=0.5) == 0.0


@pytest.mark.parametrize("m_type", ["lightgbm", "gradient_boosting", "random_forest"])
def test_build_regressor(m_type):
    reg = build_regressor(m_type, random_state=42)
    assert hasattr(reg, "fit") and hasattr(reg, "predict")


def test_forecaster_fit_and_evaluate():
    df = generate_synthetic_block_history(days=14, scale=1.0)
    meta = {"id": "B01", "block": "101", "street": "Ang Mo Kio Ave 3", "town": "Ang Mo Kio", "units": 100, "floors": 12, "completed": 1982}

    forecaster = EnergyDemandSolarForecaster(model_type="gradient_boosting")
    (
        load_model,
        solar_model,
        load_metrics,
        solar_metrics,
        load_std,
        solar_std,
    ) = forecaster.fit_and_evaluate(df, meta, test_hours=48)

    assert hasattr(load_model, "predict")
    assert hasattr(solar_model, "predict")

    # Metrics validation
    assert load_metrics.samples == 48
    assert load_metrics.mae >= 0.0
    assert load_metrics.rmse >= 0.0
    assert load_metrics.mape >= 0.0
    assert load_metrics.r2 <= 1.0

    assert solar_metrics.samples == 48
    assert solar_metrics.mae >= 0.0
    assert solar_metrics.rmse >= 0.0
    assert solar_std >= 0.0


@pytest.mark.parametrize("horizon", [24, 48])
def test_forecast_block_horizons_and_physical_constraints(horizon):
    df = generate_synthetic_block_history(days=14, scale=1.1)
    meta = {"id": "B02", "block": "202", "street": "Bishan St 22", "town": "Bishan", "units": 120, "floors": 15, "completed": 1988}

    forecaster = EnergyDemandSolarForecaster(model_type="lightgbm")
    forecast = forecaster.forecast_block(df, meta, horizon_hours=horizon)

    assert forecast.block_id == "B02"
    assert forecast.horizon_hours == horizon
    assert len(forecast.hourly) == horizon

    tot_load = sum(p.predicted_load_kwh for p in forecast.hourly)
    tot_solar = sum(p.predicted_solar_kwh for p in forecast.hourly)
    tot_grid = sum(p.predicted_grid_kwh for p in forecast.hourly)
    tot_export = sum(p.predicted_export_kwh for p in forecast.hourly)

    assert math.isclose(forecast.total_predicted_load_kwh, tot_load, abs_tol=0.05)
    assert math.isclose(forecast.total_predicted_solar_kwh, tot_solar, abs_tol=0.05)
    assert math.isclose(forecast.total_predicted_grid_kwh, tot_grid, abs_tol=0.05)
    assert math.isclose(forecast.total_predicted_export_kwh, tot_export, abs_tol=0.05)

    for point in forecast.hourly:
        # Non-negative predictions
        assert point.predicted_load_kwh >= 0.0
        assert point.predicted_solar_kwh >= 0.0

        # Solar night constraint: zero outside 07:00-19:00 SGT
        if point.hour < 7 or point.hour >= 19:
            assert point.predicted_solar_kwh == 0.0
            assert point.solar_lower_kwh == 0.0
            assert point.solar_upper_kwh == 0.0

        # Derived energy balance consistency
        expected_grid = max(0.0, point.predicted_load_kwh - point.predicted_solar_kwh)
        expected_export = max(0.0, point.predicted_solar_kwh - point.predicted_load_kwh)
        assert math.isclose(point.predicted_grid_kwh, expected_grid, abs_tol=0.02)
        assert math.isclose(point.predicted_export_kwh, expected_export, abs_tol=0.02)

        # 90% prediction intervals consistency
        assert point.load_lower_kwh <= point.predicted_load_kwh <= point.load_upper_kwh
        assert point.solar_lower_kwh <= point.predicted_solar_kwh <= point.solar_upper_kwh


def test_forecast_comparison_across_algorithms():
    df = generate_synthetic_block_history(days=10, scale=1.0)
    meta = {"id": "B01", "block": "101", "street": "AMK St", "town": "Ang Mo Kio", "units": 100, "floors": 10, "completed": 1985}

    results = {}
    for algo in ["lightgbm", "gradient_boosting", "random_forest"]:
        f = EnergyDemandSolarForecaster(model_type=algo, random_state=42)
        b_fc = f.forecast_block(df, meta, horizon_hours=24)
        results[algo] = b_fc

    for algo, b_fc in results.items():
        assert b_fc.total_predicted_load_kwh > 0.0
        assert b_fc.total_predicted_solar_kwh > 0.0
        assert len(b_fc.hourly) == 24
