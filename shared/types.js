/**
 * Shared Type Definitions for MeterWise
 *
 * Converted to JavaScript with JSDoc annotations and compatibility exports.
 */

export const Role = {};
export const AlertStatus = {};
export const Tenant = {};
export const Meter = {};
export const Reading = {};
export const AlertNote = {};
export const EnergyAlert = {};
export const Session = {};
export const ImportIssue = {};
export const ImportPreview = {};
export const ImportRecord = {};
export const Dashboard = {};

/**
 * @typedef {'manager' | 'tenant'} Role
 */

/**
 * @typedef {'open' | 'investigating' | 'resolved'} AlertStatus
 */

/**
 * @typedef {Object} Tenant
 * @property {string} id
 * @property {string} name
 * @property {string} floor
 * @property {string} color
 */

/**
 * @typedef {Object} Meter
 * @property {string} id
 * @property {string} name
 * @property {string} tenant_id
 * @property {string} location
 * @property {number} threshold_kwh
 * @property {number} interval_minutes
 */

/**
 * @typedef {Object} Reading
 * @property {string} meter_id
 * @property {string} recorded_at
 * @property {number} consumption_kwh
 */

/**
 * @typedef {Object} AlertNote
 * @property {string} id
 * @property {string} alert_id
 * @property {string} body
 * @property {string} author
 * @property {string} created_at
 */

/**
 * @typedef {Object} EnergyAlert
 * @property {string} id
 * @property {string} meter_id
 * @property {string} type
 * @property {string} title
 * @property {string} detail
 * @property {string} severity
 * @property {AlertStatus} status
 * @property {string} recorded_at
 * @property {AlertNote[]} [notes]
 */

/**
 * @typedef {Object} Session
 * @property {Role} role
 * @property {string | null} tenantId
 * @property {{ name: string, tariff: number, timezone: string }} workspace
 * @property {Tenant[]} tenants
 * @property {Meter[]} meters
 * @property {{ from: string, to: string }} bounds
 */

/**
 * @typedef {Object} ImportIssue
 * @property {number} line
 * @property {string} meter
 * @property {string} message
 * @property {'invalid' | 'duplicate'} kind
 */

/**
 * @typedef {Object} ImportPreview
 * @property {number} total
 * @property {number} valid
 * @property {number} duplicate
 * @property {number} invalid
 * @property {ImportIssue[]} issues
 * @property {Reading[]} readings
 * @property {{ from: string, to: string } | null} range
 */

/**
 * @typedef {Object} ImportRecord
 * @property {string} id
 * @property {string} file_name
 * @property {number} accepted
 * @property {number} skipped
 * @property {number} rejected
 * @property {string} created_at
 */

/**
 * @typedef {Object} Dashboard
 * @property {string} from
 * @property {string} to
 * @property {number} tariff
 * @property {string} timezone
 * @property {{
 *   kwh: number,
 *   cost: number,
 *   change: number | null,
 *   coverage: number,
 *   expected: number,
 *   actual: number,
 *   missing: number,
 *   openAlerts: number
 * }} metrics
 * @property {{ date: string, label: string, kwh: number, previous: number, cost: number }[]} chart
 * @property {(Tenant & { kwh: number, cost: number, meters: number, coverage: number })[]} tenants
 * @property {(Meter & { tenant_name: string, kwh: number, coverage: number, expected: number, actual: number, last_reading: string | null, active_alerts: number })[]} meters
 * @property {EnergyAlert[]} alerts
 */
