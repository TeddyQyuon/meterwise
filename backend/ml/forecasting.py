"""Energy demand and rooftop solar generation forecasting module.

Uses LightGBM (with HistGradientBoosting fallback) to forecast hourly
common-area energy load and solar generation for 24-48 hours per HDB block.
Calculates MAE, RMSE, MAPE, and R-squared evaluation metrics.
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    import lightgbm as lgb
    HAS_LIGHTGBM = True
except ImportError:
    HAS_LIGHTGBM = False

from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor

from ..core import SGT, iso, rounded
from .features import TimeSeriesFeatureExtractor
from .schemas import BlockForecast, ForecastMetrics, ForecastSummary, HourlyForecastPoint


def safe_mape(y_true: np.ndarray, y_pred: np.ndarray, min_threshold: float = 0.5) -> float:
    """Compute Mean Absolute Percentage Error, filtering near-zero values to prevent inflation."""
    mask = y_true >= min_threshold
    if not np.any(mask):
        return 0.0
    return float(np.mean(np.abs(y_true[mask] - y_pred[mask]) / y_true[mask]) * 100.0)


def build_regressor(model_type: str = "lightgbm", random_state: int = 42):
    """Instantiate a fast tabular regression model."""
    if model_type == "lightgbm" and HAS_LIGHTGBM:
        return lgb.LGBMRegressor(
            n_estimators=80,
            learning_rate=0.08,
            max_depth=4,
            num_leaves=15,
            min_child_samples=5,
            random_state=random_state,
            verbose=-1,
            n_jobs=-1,
        )
    elif model_type == "random_forest":
        return RandomForestRegressor(
            n_estimators=100,
            max_depth=8,
            random_state=random_state,
            n_jobs=-1,
        )
    else:
        return HistGradientBoostingRegressor(
            max_iter=120,
            learning_rate=0.06,
            max_depth=5,
            random_state=random_state,
        )


class EnergyDemandSolarForecaster:
    """Trains and forecasts hourly block-level common load and solar generation."""

    def __init__(self, model_type: str = "lightgbm", random_state: int = 42):
        self.model_type = model_type if (model_type != "lightgbm" or HAS_LIGHTGBM) else "gradient_boosting"
        self.random_state = random_state

    def fit_and_evaluate(
        self,
        df_history: pd.DataFrame,
        block_meta: Dict[str, Any],
        test_hours: int = 48,
    ) -> Tuple[Any, Any, ForecastMetrics, ForecastMetrics, float, float]:
        """Fit load and solar models for a block, validating on holdout intervals.
        
        Args:
            df_history: DataFrame containing 'timestamp', 'load_kwh', 'solar_kwh' sorted by time.
            block_meta: Dictionary of block metadata.
            test_hours: Number of trailing hours to reserve for backtesting evaluation.
            
        Returns:
            Tuple of (load_model, solar_model, load_metrics, solar_metrics, load_resid_std, solar_resid_std)
        """
        timestamps = df_history["timestamp"]
        load_series = df_history["load_kwh"]
        solar_series = df_history["solar_kwh"]

        # Feature matrix for load
        x_load = TimeSeriesFeatureExtractor.transform(timestamps, load_series, block_meta)
        # Feature matrix for solar
        x_solar = TimeSeriesFeatureExtractor.transform(timestamps, solar_series, block_meta)

        n_samples = len(df_history)
        split_idx = max(int(n_samples * 0.75), n_samples - test_hours)

        # Train / Test split
        x_load_train, x_load_test = x_load.iloc[:split_idx], x_load.iloc[split_idx:]
        y_load_train, y_load_test = load_series.iloc[:split_idx], load_series.iloc[split_idx:]

        x_solar_train, x_solar_test = x_solar.iloc[:split_idx], x_solar.iloc[split_idx:]
        y_solar_train, y_solar_test = solar_series.iloc[:split_idx], solar_series.iloc[split_idx:]

        # Train models
        load_model = build_regressor(self.model_type, self.random_state)
        load_model.fit(x_load_train, y_load_train)

        solar_model = build_regressor(self.model_type, self.random_state + 1)
        solar_model.fit(x_solar_train, y_solar_train)

        # Evaluate load
        load_preds = np.maximum(0.0, load_model.predict(x_load_test))
        load_mae = float(mean_absolute_error(y_load_test, load_preds))
        load_rmse = float(np.sqrt(mean_squared_error(y_load_test, load_preds)))
        load_mape = safe_mape(y_load_test.values, load_preds, min_threshold=0.5)
        load_r2 = float(r2_score(y_load_test, load_preds))
        load_resid_std = float(np.std(y_load_test.values - load_preds))

        load_metrics = ForecastMetrics(
            mae=rounded(load_mae, 2),
            rmse=rounded(load_rmse, 2),
            mape=rounded(load_mape, 2),
            r2=rounded(max(0.0, load_r2), 3),
            samples=len(y_load_test),
        )

        # Evaluate solar
        solar_preds = np.maximum(0.0, solar_model.predict(x_solar_test))
        # Ensure nighttime solar is clamped to 0
        hours_test = x_solar_test["hour"].values
        solar_preds[(hours_test < 7) | (hours_test >= 19)] = 0.0

        solar_mae = float(mean_absolute_error(y_solar_test, solar_preds))
        solar_rmse = float(np.sqrt(mean_squared_error(y_solar_test, solar_preds)))
        solar_mape = safe_mape(y_solar_test.values, solar_preds, min_threshold=1.0)
        solar_r2 = float(r2_score(y_solar_test, solar_preds))
        solar_resid_std = float(np.std(y_solar_test.values - solar_preds))

        solar_metrics = ForecastMetrics(
            mae=rounded(solar_mae, 2),
            rmse=rounded(solar_rmse, 2),
            mape=rounded(solar_mape, 2),
            r2=rounded(max(0.0, solar_r2), 3),
            samples=len(y_solar_test),
        )

        # Fit on full dataset for forward forecast
        full_load_model = build_regressor(self.model_type, self.random_state)
        full_load_model.fit(x_load, load_series)

        full_solar_model = build_regressor(self.model_type, self.random_state + 1)
        full_solar_model.fit(x_solar, solar_series)

        return (
            full_load_model,
            full_solar_model,
            load_metrics,
            solar_metrics,
            load_resid_std,
            solar_resid_std,
        )

    def forecast_block(
        self,
        df_history: pd.DataFrame,
        block_meta: Dict[str, Any],
        horizon_hours: int = 24,
    ) -> BlockForecast:
        """Forecast the next 24-48 hours for a single block."""
        df_history = df_history.sort_values("timestamp").reset_index(drop=True)

        (
            load_model,
            solar_model,
            load_metrics,
            solar_metrics,
            load_std,
            solar_std,
        ) = self.fit_and_evaluate(df_history, block_meta)

        last_dt = df_history["timestamp"].iloc[-1]
        load_history = df_history["load_kwh"].tolist()
        solar_history = df_history["solar_kwh"].tolist()

        hourly_points: List[HourlyForecastPoint] = []
        tot_load = tot_solar = tot_grid = tot_export = 0.0

        # Roll forward hour by hour
        for step in range(1, horizon_hours + 1):
            next_dt = last_dt + timedelta(hours=step)
            next_sgt = next_dt.astimezone(SGT)
            hour_sgt = next_sgt.hour

            # Predict load
            x_load_next = TimeSeriesFeatureExtractor.create_future_feature_row(
                next_dt, load_history, block_meta
            )
            pred_load_raw = float(load_model.predict(x_load_next)[0])
            pred_load = max(0.0, pred_load_raw)
            load_history.append(pred_load)

            # Predict solar
            x_solar_next = TimeSeriesFeatureExtractor.create_future_feature_row(
                next_dt, solar_history, block_meta
            )
            if 7 <= hour_sgt < 19:
                pred_solar_raw = float(solar_model.predict(x_solar_next)[0])
                pred_solar = max(0.0, pred_solar_raw)
            else:
                pred_solar = 0.0
            solar_history.append(pred_solar)

            # Prediction intervals (90% confidence ~ 1.645 * std)
            z_factor = 1.645
            load_lower = max(0.0, pred_load - z_factor * max(load_std, 0.2))
            load_upper = pred_load + z_factor * max(load_std, 0.2)

            if 7 <= hour_sgt < 19:
                solar_lower = max(0.0, pred_solar - z_factor * max(solar_std, 0.5))
                solar_upper = pred_solar + z_factor * max(solar_std, 0.5)
            else:
                solar_lower = 0.0
                solar_upper = 0.0

            # Rounded predictions and consistent energy balance
            pt_load = rounded(pred_load, 2)
            pt_solar = rounded(pred_solar, 2)
            pt_grid = rounded(max(0.0, pt_load - pt_solar), 2)
            pt_export = rounded(max(0.0, pt_solar - pt_load), 2)

            tot_load += pt_load
            tot_solar += pt_solar
            tot_grid += pt_grid
            tot_export += pt_export

            sgt_str = next_sgt.strftime("%Y-%m-%d %H:00 SGT")
            hourly_points.append(
                HourlyForecastPoint(
                    timestamp=iso(next_dt),
                    sgt_time=sgt_str,
                    hour=hour_sgt,
                    predicted_load_kwh=pt_load,
                    load_lower_kwh=rounded(load_lower, 2),
                    load_upper_kwh=rounded(load_upper, 2),
                    predicted_solar_kwh=pt_solar,
                    solar_lower_kwh=rounded(solar_lower, 2),
                    solar_upper_kwh=rounded(solar_upper, 2),
                    predicted_grid_kwh=pt_grid,
                    predicted_export_kwh=pt_export,
                )
            )

        block_name = f'Blk {block_meta.get("block", "")} {block_meta.get("street", "")}'.strip()
        return BlockForecast(
            block_id=block_meta["id"],
            block_name=block_name,
            town=block_meta["town"],
            units=block_meta["units"],
            floors=block_meta["floors"],
            horizon_hours=horizon_hours,
            total_predicted_load_kwh=rounded(tot_load, 2),
            total_predicted_solar_kwh=rounded(tot_solar, 2),
            total_predicted_grid_kwh=rounded(tot_grid, 2),
            total_predicted_export_kwh=rounded(tot_export, 2),
            load_metrics=load_metrics,
            solar_metrics=solar_metrics,
            hourly=hourly_points,
        )
