"""MeterWise Estate Machine Learning Package.

Provides:
- Time-series feature engineering with Singapore solar/weather proxies
- Energy demand and rooftop solar LightGBM forecasting (24-48 hours)
- Isolation Forest & contextual residual anomaly detection
- Clean FastAPI endpoints and Pydantic schemas
"""
from .anomaly import EstateAnomalyDetector
from .features import TimeSeriesFeatureExtractor
from .forecasting import EnergyDemandSolarForecaster
from .router import router as ml_router
from .schemas import (
    AnomalyItem,
    AnomalyRequest,
    AnomalyResponse,
    AnomalySummary,
    BlockForecast,
    ForecastMetrics,
    ForecastRequest,
    ForecastResponse,
    ForecastSummary,
    HourlyForecastPoint,
)
from .service import get_ml_anomalies, get_ml_forecast

__all__ = [
    "TimeSeriesFeatureExtractor",
    "EnergyDemandSolarForecaster",
    "EstateAnomalyDetector",
    "get_ml_forecast",
    "get_ml_anomalies",
    "ml_router",
    "ForecastMetrics",
    "HourlyForecastPoint",
    "BlockForecast",
    "ForecastSummary",
    "ForecastResponse",
    "ForecastRequest",
    "AnomalyItem",
    "AnomalySummary",
    "AnomalyResponse",
    "AnomalyRequest",
]
