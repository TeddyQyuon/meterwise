import {useState} from 'react';
import {
  TriangleAlert,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ClipboardCheck,
  CheckCircle2,
} from 'lucide-react';

export default function MLAnomalyBanner({
  anomalies,
  canWrite,
  onDispatchOrder,
  onExploreForecast,
  onViewAll,
}) {
  const [expanded, setExpanded] = useState(false);

  if (!anomalies.length) {
    return (
      <div className="ml-banner clean" role="status">
        <CheckCircle2 size={19} className="text-green" />
        <div>
          <strong>Intelligent Anomaly Detection: All Systems Nominal</strong>
          <span>Isolation Forest model detected 0 telemetry outliers across common services.</span>
        </div>
      </div>
    );
  }

  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;
  const topAnomaly = anomalies[0];

  return (
    <div className={`ml-banner ${criticalCount > 0 ? 'critical' : 'warning'}`} role="alert">
      <div className="ml-banner-main">
        <div className="ml-banner-icon-wrap">
          <span className="pulse-indicator" />
          <TriangleAlert size={22} />
        </div>

        <div className="ml-banner-text">
          <div className="ml-banner-header">
            <strong>
              {anomalies.length} Intelligent {anomalies.length === 1 ? 'Anomaly' : 'Anomalies'} Detected
            </strong>
            <div className="ml-badge-row">
              {criticalCount > 0 && (
                <span className="badge red">{criticalCount} Critical</span>
              )}
              {highCount > 0 && (
                <span className="badge amber">{highCount} High Priority</span>
              )}
              <span className="badge demo">Isolation Forest ML</span>
            </div>
          </div>
          <p>
            Top priority: <strong>{topAnomaly.title}</strong> on {topAnomaly.meter_id} ({topAnomaly.block_label}) · {topAnomaly.root_cause}
          </p>
        </div>

        <div className="ml-banner-actions">
          {canWrite && (
            <button
              type="button"
              className="button primary"
              onClick={() => onDispatchOrder(topAnomaly)}
              aria-label={`Dispatch work order for ${topAnomaly.meter_id}`}
            >
              <ClipboardCheck size={16} />
              <span>Dispatch Work Order</span>
            </button>
          )}

          {onExploreForecast && (
            <button
              type="button"
              className="button secondary"
              onClick={onExploreForecast}
              aria-label="View ML forecast dashboard"
            >
              <span>ML Forecast</span>
              <ArrowRight size={15} />
            </button>
          )}

          {anomalies.length > 1 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setExpanded(prev => !prev)}
              aria-expanded={expanded}
              aria-label="Toggle anomaly details list"
            >
              <span>{expanded ? 'Hide Details' : `View All (${anomalies.length})`}</span>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded list of anomalies */}
      {expanded && (
        <div className="ml-banner-drawer">
          <div className="ml-anomaly-cards-grid">
            {anomalies.map((item) => (
              <div key={item.id} className="ml-anomaly-compact-card">
                <div className="compact-card-header">
                  <span className={`badge ${item.severity === 'critical' ? 'red' : item.severity === 'high' ? 'amber' : 'neutral'}`}>
                    {item.severity.toUpperCase()}
                  </span>
                  <span className="compact-meter">{item.meter_id}</span>
                  <span className="compact-block">{item.block_label}</span>
                </div>
                <h4>{item.title}</h4>
                <p className="compact-desc">{item.root_cause}</p>
                <div className="compact-footer">
                  <span className="compact-stats">
                    <strong>{item.value_kwh} kWh</strong> vs {item.baseline_kwh} kWh baseline ({(item.confidence * 100).toFixed(0)}% conf)
                  </span>
                  {canWrite && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onDispatchOrder(item)}
                    >
                      Dispatch <ArrowRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {onViewAll && (
            <div className="drawer-foot">
              <button type="button" className="text-button" onClick={onViewAll}>
                Open full anomaly triage panel <ArrowRight size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
