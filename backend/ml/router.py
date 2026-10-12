"""FastAPI APIRouter for Estate Machine Learning endpoints.

Exposes:
- GET /api/estate/ml/forecast and POST /api/estate/ml/forecast
- GET /api/estate/ml/anomalies and POST /api/estate/ml/anomalies
With clean typed Pydantic request and response schemas.
"""
from typing import Optional
from fastapi import APIRouter, Query

from .schemas import (
    AnomalyRequest,
    AnomalyResponse,
    ForecastRequest,
    ForecastResponse,
)

router = APIRouter(prefix="/api/estate/ml", tags=["estate-ml"])


@router.get(
    "/forecast",
    response_model=ForecastResponse,
    summary="Forecast estate common load and rooftop solar generation",
    description="Forecasts hourly energy demand and solar generation for 24-48 hours per block using LightGBM.",
)
async def forecast_get(
    block: Optional[str] = Query("all", description="Block ID ('all' or specific block e.g., 'B01')"),
    horizon_hours: int = Query(24, ge=1, le=72, description="Forecast horizon in hours (1-72)"),
    model_type: Optional[str] = Query("lightgbm", description="Algorithm ('lightgbm', 'gradient_boosting', 'random_forest')"),
) -> ForecastResponse:
    """Swagger/OpenAPI documentation schema entrypoint."""
    ...


@router.post(
    "/forecast",
    response_model=ForecastResponse,
    summary="Forecast estate common load and rooftop solar generation (POST)",
)
async def forecast_post(payload: ForecastRequest) -> ForecastResponse:
    """Swagger/OpenAPI documentation schema entrypoint."""
    ...


@router.get(
    "/anomalies",
    response_model=AnomalyResponse,
    summary="Detect anomalies in estate energy consumption and solar generation",
    description="Detects anomalous meter intervals (pump leaks, daytime lighting burn, spikes) using Isolation Forest.",
)
async def anomalies_get(
    block: Optional[str] = Query("all", description="Block ID filter"),
    service: Optional[str] = Query("all", description="Service filter ('all', 'lighting', 'lifts', 'pumps', 'solar')"),
    sensitivity: float = Query(0.05, ge=0.01, le=0.25, description="Contamination sensitivity"),
    from_date: Optional[str] = Query(None, alias="from", description="Start date (YYYY-MM-DD)"),
    to_date: Optional[str] = Query(None, alias="to", description="End date (YYYY-MM-DD)"),
) -> AnomalyResponse:
    """Swagger/OpenAPI documentation schema entrypoint."""
    ...


@router.post(
    "/anomalies",
    response_model=AnomalyResponse,
    summary="Detect anomalies in estate energy consumption and solar generation (POST)",
)
async def anomalies_post(payload: AnomalyRequest) -> AnomalyResponse:
    """Swagger/OpenAPI documentation schema entrypoint."""
    ...
