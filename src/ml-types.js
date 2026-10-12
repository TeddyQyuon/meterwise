/**
 * ML Types and constants for MeterWise predictive intelligence.
 */

export const ML_SEVERITIES = ['critical', 'high', 'medium', 'low'];

export const ML_ANOMALY_TYPES = [
  'pump_spike',
  'night_lighting_leak',
  'lift_stalled_idle',
  'solar_underperformance',
  'unusual_spike',
];

// Named exports matching type identifiers for compatibility
export const MLSeverity = ML_SEVERITIES;
export const MLForecastPoint = {};
export const MLForecastMetrics = {};
export const MLForecastSummary = {};
export const MLModelInfo = {};
export const MLForecastResponse = {};
export const MLAnomaly = {};
export const MLAnomaliesResponse = {};

/**
 * @typedef {'critical' | 'high' | 'medium' | 'low'} MLSeverity
 */

/**
 * @typedef {Object} MLForecastPoint
 * @property {string} timestamp
 * @property {string} label
 * @property {number} hour
 * @property {number | null} actual_demand Common load demand (kWh)
 * @property {number} predicted_demand
 * @property {number} demand_lower
 * @property {number} demand_upper
 * @property {number | null} actual_solar Solar PV generation (kWh)
 * @property {number} predicted_solar
 * @property {number} solar_lower
 * @property {number} solar_upper
 * @property {number} [net_predicted_grid] Derived net grid impact: max(0, predicted_demand - predicted_solar)
 */

/**
 * @typedef {Object} MLForecastMetrics
 * @property {number} demand_mae
 * @property {number} demand_rmse
 * @property {number} demand_mape
 * @property {number} solar_mae
 * @property {number} solar_rmse
 * @property {number} r2_score
 */

/**
 * @typedef {Object} MLForecastSummary
 * @property {number} total_predicted_demand
 * @property {number} total_predicted_solar
 * @property {number} net_grid_kwh
 * @property {number} peak_demand_kwh
 * @property {string} peak_demand_hour
 * @property {number} peak_solar_kwh
 * @property {string} peak_solar_hour
 * @property {number} self_consumption_rate
 */

/**
 * @typedef {Object} MLModelInfo
 * @property {string} algorithm
 * @property {string} training_window
 * @property {string[]} features_used
 * @property {string} confidence_interval
 */

/**
 * @typedef {Object} MLForecastResponse
 * @property {string} block_id
 * @property {string} town
 * @property {number} horizon_hours
 * @property {string} generated_at
 * @property {MLForecastMetrics} metrics
 * @property {MLForecastSummary} summary
 * @property {MLModelInfo} model_info
 * @property {MLForecastPoint[]} series
 */

/**
 * @typedef {Object} MLAnomaly
 * @property {string} id
 * @property {string} meter_id
 * @property {string} block_id
 * @property {string} block_label
 * @property {string} town
 * @property {string} service
 * @property {'pump_spike' | 'night_lighting_leak' | 'lift_stalled_idle' | 'solar_underperformance' | 'unusual_spike'} anomaly_type
 * @property {string} title
 * @property {string} description
 * @property {string} detected_at
 * @property {number} value_kwh
 * @property {number} baseline_kwh
 * @property {number} excess_kwh
 * @property {number} z_score
 * @property {MLSeverity} severity
 * @property {number} confidence
 * @property {string} root_cause
 * @property {string} suggested_action
 * @property {string} work_order_title
 * @property {string} work_order_note
 * @property {'high' | 'medium' | 'low'} suggested_priority
 */

/**
 * @typedef {Object} MLAnomaliesResponse
 * @property {MLAnomaly[]} anomalies
 * @property {{
 *   total_detected: number,
 *   critical_count: number,
 *   high_count: number,
 *   medium_count: number,
 *   estimated_excess_kwh: number
 * }} summary
 * @property {{
 *   model: string,
 *   contamination_rate: number,
 *   last_evaluated_at: string
 * }} detector_info
 */
