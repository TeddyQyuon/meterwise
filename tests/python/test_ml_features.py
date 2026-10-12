"""Comprehensive unit tests for MeterWise time-series and estate feature engineering."""
import math
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import pytest

from backend.core import SGT
from backend.ml.features import (
    TimeSeriesFeatureExtractor,
    compute_lag_rolling_features,
    compute_singapore_weather_proxies,
    extract_datetime_components,
    get_block_features,
)


def test_extract_datetime_components_sgt_conversion():
    # 2026-10-10 16:00:00 UTC = 2026-10-11 00:00:00 SGT (Sunday)
    utc_timestamps = pd.to_datetime([
        "2026-10-10T16:00:00Z",  # 00:00 SGT Sun
        "2026-10-11T04:00:00Z",  # 12:00 SGT Sun
        "2026-10-11T12:00:00Z",  # 20:00 SGT Sun
        "2026-10-12T02:00:00Z",  # 10:00 SGT Mon
    ])
    df = extract_datetime_components(pd.Series(utc_timestamps))

    assert df.loc[0, "hour"] == 0
    assert df.loc[0, "dow"] == 6  # Sunday (0=Mon, 6=Sun)
    assert df.loc[0, "is_weekend"] == 1
    assert df.loc[0, "is_night"] == 1

    assert df.loc[1, "hour"] == 12
    assert df.loc[1, "is_night"] == 0

    assert df.loc[2, "hour"] == 20
    assert df.loc[2, "is_night"] == 1

    assert df.loc[3, "hour"] == 10
    assert df.loc[3, "dow"] == 0  # Monday
    assert df.loc[3, "is_weekend"] == 0
    assert df.loc[3, "is_night"] == 0


def test_extract_datetime_cyclics_bounds():
    hours = pd.date_range("2026-10-01", periods=168, freq="h", tz="UTC")
    df = extract_datetime_components(pd.Series(hours))

    assert (-1.0 <= df["hour_sin"]).all() and (df["hour_sin"] <= 1.0).all()
    assert (-1.0 <= df["hour_cos"]).all() and (df["hour_cos"] <= 1.0).all()
    assert (-1.0 <= df["dow_sin"]).all() and (df["dow_sin"] <= 1.0).all()
    assert (-1.0 <= df["dow_cos"]).all() and (df["dow_cos"] <= 1.0).all()
    # Harmonic circle: sin^2 + cos^2 == 1
    np.testing.assert_allclose(df["hour_sin"] ** 2 + df["hour_cos"] ** 2, 1.0, atol=1e-5)
    np.testing.assert_allclose(df["dow_sin"] ** 2 + df["dow_cos"] ** 2, 1.0, atol=1e-5)


def test_singapore_weather_proxies():
    hour_series = pd.Series(range(24))
    proxies = compute_singapore_weather_proxies(hour_series)

    # Nighttime (00:00 - 06:00, 19:00 - 23:00) solar elevation must be zero
    night_mask = (hour_series < 7) | (hour_series >= 19)
    assert np.isclose(proxies.loc[night_mask, "solar_elevation_proxy"], 0.0, atol=1e-5).all()
    assert (proxies.loc[night_mask, "is_daylight"] == 0).all()

    # Peak solar is at 13:00 SGT
    peak_elevation = proxies.loc[13, "solar_elevation_proxy"]
    assert peak_elevation > 0.95
    assert proxies.loc[13, "peak_sun_hour"] == 1

    # Temperatures in Singapore diurnal curve stay within [25.0, 32.0]
    temps = proxies["temperature_proxy_c"]
    assert (temps >= 25.0).all() and (temps <= 32.0).all()
    assert (proxies["cooling_demand_proxy"] >= 0.0).all()


def test_get_block_features():
    meta = {
        "id": "B01",
        "units": 110,
        "floors": 11,
        "completed": 1985,
    }
    feats = get_block_features(meta)
    assert feats["block_units"] == 110.0
    assert feats["block_floors"] == 11.0
    assert feats["block_age"] == 41.0  # 2026 - 1985
    assert feats["block_units_per_floor"] == 10.0
    assert feats["block_scale"] == 1.1

    # Fallback defaults
    empty_feats = get_block_features({})
    assert empty_feats["block_units"] == 100.0
    assert empty_feats["block_floors"] == 12.0
    assert empty_feats["block_age"] >= 1.0


def test_compute_lag_rolling_features():
    # 72 hours of constant + trend data
    values = pd.Series([10.0 + i * 0.1 for i in range(72)])
    lags = compute_lag_rolling_features(values)

    assert "lag_1" in lags.columns
    assert "lag_24" in lags.columns
    assert "lag_48" in lags.columns
    assert "rolling_mean_6" in lags.columns
    assert "rolling_mean_24" in lags.columns
    assert "rolling_std_24" in lags.columns
    assert "rolling_max_24" in lags.columns
    assert "rolling_min_24" in lags.columns

    # Check lag accuracy at index 30
    assert math.isclose(lags.loc[30, "lag_1"], values.loc[29], rel_tol=1e-5)
    assert math.isclose(lags.loc[30, "lag_24"], values.loc[6], rel_tol=1e-5)

    # Output has no NaNs
    assert not lags.isna().any().any()


def test_time_series_feature_extractor_full_transform():
    timestamps = pd.Series(pd.date_range("2026-10-01", periods=96, freq="h", tz="UTC"))
    values = pd.Series([15.0 + math.sin(i / 12 * math.pi) * 3 for i in range(96)])
    block_meta = {"id": "B03", "units": 120, "floors": 12, "completed": 1980}

    features = TimeSeriesFeatureExtractor.transform(timestamps, values, block_meta)

    assert list(features.columns) == TimeSeriesFeatureExtractor.FEATURE_COLUMNS
    assert len(features) == 96
    assert not features.isna().any().any()


def test_create_future_feature_row():
    target_utc = datetime(2026, 10, 15, 6, 0, tzinfo=timezone.utc)  # 14:00 SGT (daylight)
    recent_history = [12.0] * 50
    block_meta = {"id": "B01", "units": 100, "floors": 10, "completed": 1990}

    future_df = TimeSeriesFeatureExtractor.create_future_feature_row(
        target_utc, recent_history, block_meta
    )

    assert len(future_df) == 1
    assert list(future_df.columns) == TimeSeriesFeatureExtractor.FEATURE_COLUMNS
    assert future_df.loc[0, "hour"] == 14
    assert future_df.loc[0, "is_daylight"] == 1
    assert future_df.loc[0, "is_night"] == 0
    assert not future_df.isna().any().any()
