import {useState} from 'react';
import {
  TriangleAlert,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  ClipboardCheck,
  CheckCircle2,
  LoaderCircle,
  WifiOff,
} from 'lucide-react';

export default function MLAnomalyBanner({
  anomalies,
  loading = false,
  degraded = false,
  degradedReason = '',
  canWrite,
  onDispatchOrder,
  onExploreForecast,
  onViewAll,
}) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return (
      <div className="ml-banner ml-banner-loading" role="status" aria-live="polite">
        <div className="ml-banner-main">
          <div className="ml-banner-icon-wrap neutral">
            <LoaderCircle size={21} className="spin" aria-hidden="true" />
          </div>
          <div className="ml-banner-text">
            <div className="ml-banner-header">
              <strong>Scanning telemetry for anomalies…</strong>
              <span className="ml-badge-row"><span className="badge demo">Isolation Forest ML</span></span>
            </div>
            <p>Comparing recent meter intervals with each block&apos;s normal pattern. The dashboard stays usable while this runs.</p>
            <div className="ml-load-track" aria-hidden="true"><span /></div>
          </div>
        </div>
      </div>
    );
  }

  if (!anomalies.length) {
    return (
      <div className={`ml-banner clean ${degraded ? 'is-degraded' : ''}`} role="status">
        {degraded ? <WifiOff size={19} className="text-amber" /> : <CheckCircle2 size={19} className="text-green" />}
        <div>
          <strong>{degraded ? 'No fallback anomalies match this selection' : 'Intelligent Anomaly Detection: All Systems Nominal'}</strong>
          <span>
            {degraded
              ? 'The live ML service is unavailable, so this is the built-in demonstration checklist — not a fresh model result.'
              : 'Isolation Forest model detected 0 telemetry outliers across common services.'}
          </span>
          {degraded && degradedReason && <span className="ml-degraded-reason">{degradedReason}</span>}
        </div>
      </div>
    );
  }

  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;
  const topAnomaly = anomalies[0];

  return (
    <div className={`ml-banner ${criticalCount > 0 ? 'critical' : 'warning'} ${degraded ? 'is-degraded' : ''}`} role="alert">
      <div className="ml-banner-main">
        <div className="ml-banner-icon-wrap">
          <span className="pulse-indicator" />
          {degraded ? <WifiOff size={22} /> : <TriangleAlert size={22} />}
        </div>

        <div className="ml-banner-text">
          <div className="ml-banner-header">
            <strong>
              {degraded ? `${anomalies.length} fallback demo ${anomalies.length === 1 ? 'anomaly' : 'anomalies'} shown` : `${anomalies.length} Intelligent ${anomalies.length === 1 ? 'Anomaly' : 'Anomalies'} Detected`}
            </strong>
            <div className="ml-badge-row">
              {criticalCount > 0 && (
                <span className="badge red">{criticalCount} Critical</span>
              )}
              {highCount > 0 && (
                <span className="badge amber">{highCount} High Priority</span>
              )}
              {degraded
                ? <span className="badge amber" title={degradedReason}>Estimated fallback</span>
                : <span className="badge demo">Isolation Forest ML</span>}
            </div>
          </div>
          <p>
            Top priority: <strong>{topAnomaly.title}</strong> on {topAnomaly.meter_id} ({topAnomaly.block_label}) · {topAnomaly.root_cause}
          </p>
          {degraded && (
            <p className="ml-degraded-note">
              <WifiOff size={13} /> Live ML unavailable{degradedReason ? ` — ${degradedReason}` : ''} These are seeded demonstration cases, not detections from your latest readings.
            </p>
          )}
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
