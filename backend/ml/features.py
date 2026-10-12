"""Feature engineering for estate energy demand, solar generation, and anomaly detection.

Features include:
- Time-series lag features (lag_1, lag_2, lag_3, lag_24, lag_48)
- Rolling statistical features (rolling_mean_6, rolling_mean_24, rolling_std_24)
- Cyclical temporal features: hour-of-day (sine/cosine), day-of-week (sine/cosine), weekend flag
- Singapore weather and solar proxies: solar elevation proxy, daylight indicator, temperature proxy
- HDB block structural metadata: units, floors, building age, units per floor, scaling ratio
"""
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

from ..core import SGT, parse_time


def extract_datetime_components(dt_series: pd.Series) -> pd.DataFrame:
    """Extract hour, day of week, day of year in SGT."""
    # Convert to Singapore timezone (UTC+8)
    if dt_series.dt.tz is None:
        dt_sgt = dt_series.dt.tz_localize("UTC").dt.tz_convert(SGT)
    else:
        dt_sgt = dt_series.dt.tz_convert(SGT)

    hour = dt_sgt.dt.hour
    dow = dt_sgt.dt.dayofweek
    doy = dt_sgt.dt.dayofyear

    hour_sin = np.sin(2.0 * np.pi * hour / 24.0)
    hour_cos = np.cos(2.0 * np.pi * hour / 24.0)
    dow_sin = np.sin(2.0 * np.pi * dow / 7.0)
    dow_cos = np.cos(2.0 * np.pi * dow / 7.0)
    is_weekend = (dow >= 5).astype(int)
    is_night = ((hour < 7) | (hour >= 19)).astype(int)

    return pd.DataFrame({
        "hour": hour,
        "dow": dow,
        "doy": doy,
        "hour_sin": hour_sin,
        "hour_cos": hour_cos,
        "dow_sin": dow_sin,
        "dow_cos": dow_cos,
        "is_weekend": is_weekend,
        "is_night": is_night,
    }, index=dt_series.index)


def compute_singapore_weather_proxies(hour_series: pd.Series) -> pd.DataFrame:
    """Compute Singapore equatorial weather and solar elevation proxies.
    
    Singapore is 1.35 degrees North latitude, with consistent ~12-hour daylight
    from 07:00 to 19:00 SGT and diurnal temperature variation between 25C and 32C.
    """
    # Solar angle proxy: 0 at night, peak at 13:00 SGT
    solar_raw = np.maximum(0.0, np.sin((hour_series - 7.0) / 12.0 * np.pi))
    solar_elevation = np.where((hour_series >= 7) & (hour_series < 19), solar_raw, 0.0)
    is_daylight = ((hour_series >= 7) & (hour_series < 19)).astype(int)
    peak_sun_hour = ((hour_series >= 11) & (hour_series <= 15)).astype(int)

    # Diurnal temperature curve in Singapore (minimum ~25C at 06:00, maximum ~32C at 14:00)
    temp_curve = 25.0 + 7.0 * np.maximum(0.0, np.sin((hour_series - 6.0) / 16.0 * np.pi))
    cooling_demand = np.maximum(0.0, temp_curve - 24.0)

    return pd.DataFrame({
        "solar_elevation_proxy": solar_elevation,
        "is_daylight": is_daylight,
        "peak_sun_hour": peak_sun_hour,
        "temperature_proxy_c": temp_curve,
        "cooling_demand_proxy": cooling_demand,
    }, index=hour_series.index)


def get_block_features(block_meta: Dict[str, Any]) -> Dict[str, float]:
    """Extract numeric metadata features for an HDB block."""
    units = float(block_meta.get("units", 100))
    floors = float(block_meta.get("floors", 12))
    completed = float(block_meta.get("completed", 1980))
    age = max(1.0, 2026.0 - completed)
    units_per_floor = units / max(1.0, floors)
    scale = units / 100.0

    return {
        "block_units": units,
        "block_floors": floors,
        "block_age": age,
        "block_units_per_floor": units_per_floor,
        "block_scale": scale,
    }


def compute_lag_rolling_features(
    series: pd.Series,
    lags: Tuple[int, ...] = (1, 2, 3, 24, 48),
    rolling_windows: Tuple[int, ...] = (6, 24),
) -> pd.DataFrame:
    """Generate time-series lag and rolling statistics from an ordered series.
    
    Missing initial values are filled forward/backward to avoid loss of samples.
    """
    features = {}

    for lag in lags:
        features[f"lag_{lag}"] = series.shift(lag)

    for w in rolling_windows:
        features[f"rolling_mean_{w}"] = series.shift(1).rolling(window=w, min_periods=1).mean()

    features["rolling_std_24"] = series.shift(1).rolling(window=24, min_periods=2).std().fillna(0.0)
    features["rolling_max_24"] = series.shift(1).rolling(window=24, min_periods=1).max()
    features["rolling_min_24"] = series.shift(1).rolling(window=24, min_periods=1).min()

    df_lags = pd.DataFrame(features, index=series.index)
    # Fill remaining NaNs using the first non-null values or series median
    series_median = series.median() if not series.empty else 0.0
    return df_lags.bfill().fillna(series_median)


class TimeSeriesFeatureExtractor:
    """High-level feature extraction pipeline for MeterWise ML models."""

    FEATURE_COLUMNS = [
        "hour",
        "dow",
        "hour_sin",
        "hour_cos",
        "dow_sin",
        "dow_cos",
        "is_weekend",
        "is_night",
        "solar_elevation_proxy",
        "is_daylight",
        "peak_sun_hour",
        "temperature_proxy_c",
        "cooling_demand_proxy",
        "block_units",
        "block_floors",
        "block_age",
        "block_units_per_floor",
        "block_scale",
        "lag_1",
        "lag_2",
        "lag_3",
        "lag_24",
        "lag_48",
        "rolling_mean_6",
        "rolling_mean_24",
        "rolling_std_24",
        "rolling_max_24",
        "rolling_min_24",
    ]

    @classmethod
    def transform(
        cls,
        timestamps: pd.Series,
        values: pd.Series,
        block_meta: Dict[str, Any],
    ) -> pd.DataFrame:
        """Transform timestamp and value series into full feature matrix."""
        # 1. Temporal cyclical features
        temporal = extract_datetime_components(timestamps)

        # 2. Weather & solar proxies
        weather = compute_singapore_weather_proxies(temporal["hour"])

        # 3. Block metadata features
        b_feats = get_block_features(block_meta)
        b_df = pd.DataFrame([b_feats] * len(timestamps), index=timestamps.index)

        # 4. Lag and rolling statistics
        lags = compute_lag_rolling_features(values)

        # Combine all features
        features = pd.concat([temporal, weather, b_df, lags], axis=1)
        return features[cls.FEATURE_COLUMNS]

    @classmethod
    def create_future_feature_row(
        cls,
        dt_utc: datetime,
        recent_history: List[float],
        block_meta: Dict[str, Any],
    ) -> pd.DataFrame:
        """Create a single feature row for step-by-step future forecasting.
        
        Args:
            dt_utc: Target future timestamp in UTC.
            recent_history: Chronological list of past hourly values up to t-1.
            block_meta: Block metadata dictionary.
        """
        dt_sgt = dt_utc.astimezone(SGT)
        hour = dt_sgt.hour
        dow = dt_sgt.weekday()

        hour_sin = math.sin(2.0 * math.pi * hour / 24.0)
        hour_cos = math.cos(2.0 * math.pi * hour / 24.0)
        dow_sin = math.sin(2.0 * math.pi * dow / 7.0)
        dow_cos = math.cos(2.0 * math.pi * dow / 7.0)
        is_weekend = 1 if dow >= 5 else 0
        is_night = 1 if (hour < 7 or hour >= 19) else 0

        solar_elevation = max(0.0, math.sin((hour - 7.0) / 12.0 * math.pi)) if (7 <= hour < 19) else 0.0
        is_daylight = 1 if (7 <= hour < 19) else 0
        peak_sun_hour = 1 if (11 <= hour <= 15) else 0
        temp_curve = 25.0 + 7.0 * max(0.0, math.sin((hour - 6.0) / 16.0 * math.pi))
        cooling_demand = max(0.0, temp_curve - 24.0)

        b_feats = get_block_features(block_meta)

        # History features from recent_history[-1], recent_history[-2], etc.
        n = len(recent_history)
        def get_hist(lag: int) -> float:
            if n >= lag:
                return recent_history[-lag]
            return recent_history[0] if n > 0 else 0.0

        lag_1 = get_hist(1)
        lag_2 = get_hist(2)
        lag_3 = get_hist(3)
        lag_24 = get_hist(24)
        lag_48 = get_hist(48)

        w6 = recent_history[-6:] if n >= 6 else recent_history
        w24 = recent_history[-24:] if n >= 24 else recent_history

        rolling_mean_6 = float(np.mean(w6)) if w6 else 0.0
        rolling_mean_24 = float(np.mean(w24)) if w24 else 0.0
        rolling_std_24 = float(np.std(w24)) if len(w24) > 1 else 0.0
        rolling_max_24 = float(np.max(w24)) if w24 else 0.0
        rolling_min_24 = float(np.min(w24)) if w24 else 0.0

        row_dict = {
            "hour": hour,
            "dow": dow,
            "hour_sin": hour_sin,
            "hour_cos": hour_cos,
            "dow_sin": dow_sin,
            "dow_cos": dow_cos,
            "is_weekend": is_weekend,
            "is_night": is_night,
            "solar_elevation_proxy": solar_elevation,
            "is_daylight": is_daylight,
            "peak_sun_hour": peak_sun_hour,
            "temperature_proxy_c": temp_curve,
            "cooling_demand_proxy": cooling_demand,
            **b_feats,
            "lag_1": lag_1,
            "lag_2": lag_2,
            "lag_3": lag_3,
            "lag_24": lag_24,
            "lag_48": lag_48,
            "rolling_mean_6": rolling_mean_6,
            "rolling_mean_24": rolling_mean_24,
            "rolling_std_24": rolling_std_24,
            "rolling_max_24": rolling_max_24,
            "rolling_min_24": rolling_min_24,
        }

        return pd.DataFrame([row_dict])[cls.FEATURE_COLUMNS]
