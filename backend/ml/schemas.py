"""Pydantic schemas for Estate ML forecasting and anomaly detection."""
from typing import Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class ForecastMetrics(BaseModel):
    mae: float = Field(..., description="Mean Absolute Error in kWh")
    rmse: float = Field(..., description="Root Mean Squared Error in kWh")
    mape: float = Field(..., description="Mean Absolute Percentage Error (%)")
    r2: float = Field(..., description="Coefficient of determination (R-squared)")
    samples: int = Field(..., description="Number of evaluation samples")


class HourlyForecastPoint(BaseModel):
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
    sgt_time: str = Field(..., description="Singapore Local Time (SGT)")
    hour: int = Field(..., ge=0, le=23, description="Hour of day (0-23 in SGT)")
    predicted_load_kwh: float = Field(..., ge=0, description="Predicted common load in kWh")
    load_lower_kwh: float = Field(..., ge=0, description="Lower prediction interval (90% CI)")
    load_upper_kwh: float = Field(..., ge=0, description="Upper prediction interval (90% CI)")
    predicted_solar_kwh: float = Field(..., ge=0, description="Predicted rooftop solar generation in kWh")
    solar_lower_kwh: float = Field(..., ge=0, description="Lower solar prediction bound")
    solar_upper_kwh: float = Field(..., ge=0, description="Upper solar prediction bound")
    predicted_grid_kwh: float = Field(..., ge=0, description="Derived net grid import in kWh")
    predicted_export_kwh: float = Field(..., ge=0, description="Derived surplus solar export in kWh")


class BlockForecast(BaseModel):
    block_id: str = Field(..., description="HDB Block identifier (e.g., B01)")
    block_name: str = Field(..., description="Display name and street address")
    town: str = Field(..., description="HDB Town (e.g., Ang Mo Kio, Bishan, Tampines)")
    units: int = Field(..., description="Total residential units in block")
    floors: int = Field(..., description="Number of storeys")
    horizon_hours: int = Field(..., description="Forecast horizon in hours (24 or 48)")
    total_predicted_load_kwh: float = Field(..., ge=0, description="Total predicted load over horizon")
    total_predicted_solar_kwh: float = Field(..., ge=0, description="Total predicted solar over horizon")
    total_predicted_grid_kwh: float = Field(..., ge=0, description="Total net grid import over horizon")
    total_predicted_export_kwh: float = Field(..., ge=0, description="Total solar exported over horizon")
    load_metrics: ForecastMetrics = Field(..., description="Demand model evaluation metrics")
    solar_metrics: ForecastMetrics = Field(..., description="Solar model evaluation metrics")
    hourly: List[HourlyForecastPoint] = Field(..., description="Hourly forecast time-series")


class ForecastSummary(BaseModel):
    total_load_kwh: float = Field(..., ge=0)
    total_solar_kwh: float = Field(..., ge=0)
    total_grid_kwh: float = Field(..., ge=0)
    total_export_kwh: float = Field(..., ge=0)
    solar_offset_percentage: float = Field(..., ge=0, description="Percentage of load offset by solar")
    blocks_count: int = Field(..., ge=1)
    average_load_mae: float = Field(..., ge=0)
    average_solar_mae: float = Field(..., ge=0)


class ForecastResponse(BaseModel):
    generated_at: str = Field(..., description="ISO timestamp when forecast was generated")
    horizon_hours: int = Field(..., description="Forecast horizon hours")
    model_type: str = Field(..., description="ML algorithm utilized (e.g., lightgbm)")
    summary: ForecastSummary = Field(..., description="Aggregated portfolio summary")
    blocks: List[BlockForecast] = Field(..., description="Per-block forecasts")


class ForecastRequest(BaseModel):
    block: Optional[str] = Field("all", description="Block ID ('all' or specific block like 'B01')")
    horizon_hours: int = Field(24, ge=1, le=72, description="Forecast horizon hours (1 to 72)")
    model_type: Optional[Literal["lightgbm", "gradient_boosting", "random_forest"]] = Field(
        "lightgbm", description="Machine learning algorithm to train/infer"
    )


class AnomalyItem(BaseModel):
    id: str = Field(..., description="Unique anomaly identifier")
    meter_id: str = Field(..., description="Meter ID (e.g., B03-PUMPS)")
    block_id: str = Field(..., description="Block ID (e.g., B03)")
    town: str = Field(..., description="HDB Town")
    service: str = Field(..., description="Service: lighting, lifts, pumps, or solar")
    timestamp: str = Field(..., description="ISO 8601 UTC timestamp")
    sgt_time: str = Field(..., description="Local Singapore time representation")
    hour: int = Field(..., ge=0, le=23, description="Hour of day (0-23 in SGT)")
    actual_kwh: float = Field(..., ge=0, description="Observed meter consumption in kWh")
    expected_kwh: float = Field(..., ge=0, description="Model baseline expected consumption in kWh")
    residual_kwh: float = Field(..., description="Deviation (actual - expected) in kWh")
    threshold_kwh: float = Field(..., ge=0, description="Configured asset threshold in kWh")
    anomaly_confidence: float = Field(..., ge=0.0, le=1.0, description="Statistical anomaly confidence (0-1)")
    severity: Literal["high", "medium", "low"] = Field(..., description="Incident severity level")
    anomaly_type: str = Field(..., description="Categorized anomaly classification")
    root_cause: str = Field(..., description="Engineering root-cause diagnosis")
    recommended_action: str = Field(..., description="Actionable facilities maintenance recommendation")


class AnomalySummary(BaseModel):
    total_detected: int = Field(..., ge=0)
    high_severity: int = Field(..., ge=0)
    medium_severity: int = Field(..., ge=0)
    low_severity: int = Field(..., ge=0)
    by_service: Dict[str, int] = Field(default_factory=dict)
    by_block: Dict[str, int] = Field(default_factory=dict)


class AnomalyResponse(BaseModel):
    detected_at: str = Field(..., description="ISO timestamp of detection run")
    total_anomalies: int = Field(..., ge=0)
    summary: AnomalySummary = Field(..., description="Anomaly counts by severity and asset type")
    anomalies: List[AnomalyItem] = Field(..., description="List of detected anomalies")


class AnomalyRequest(BaseModel):
    block: Optional[str] = Field("all", description="Block ID ('all' or specific block like 'B01')")
    service: Optional[str] = Field("all", description="Service category ('all', 'lighting', 'lifts', 'pumps', 'solar')")
    sensitivity: float = Field(0.05, ge=0.01, le=0.25, description="Contamination factor for anomaly detection")
    from_date: Optional[str] = Field(None, description="Start date filter (YYYY-MM-DD)")
    to_date: Optional[str] = Field(None, description="End date filter (YYYY-MM-DD)")
