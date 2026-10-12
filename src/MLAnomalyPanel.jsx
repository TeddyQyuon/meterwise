import {useState} from 'react';
import {
  TriangleAlert,
  Activity,
  ClipboardCheck,
  ShieldAlert,
  CheckCircle2,
  ChevronRight,
  Info,
  Clock,
  Sparkles,
} from 'lucide-react';

const severityOrder = {critical: 0, high: 1, medium: 2, low: 3};

export default function MLAnomalyPanel({
  anomalies,
  canWrite,
  onDispatchOrder,
  onOpenOrders,
}) {
  const [filter, setFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');

  const filtered = anomalies
    .filter(a => filter === 'all' || a.severity === filter)
    .filter(a => serviceFilter === 'all' || a.service === serviceFilter)
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  const criticalCount = anomalies.filter(a => a.severity === 'critical').length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;

  return (
    <section className="panel ml-anomaly-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Intelligent Anomaly Detection
            <span className="ml-tag"><Sparkles size={13} /> ML Isolation Forest</span>
          </h2>
          <p>Statistical residual and unsupervised anomaly model with diagnostic root cause hypotheses</p>
          
          {/* Service filter chips */}
          <div className="ml-service-filters">
            {[
              {id: 'all', label: 'All Services'},
              {id: 'pumps', label: 'Water Booster Pumps'},
              {id: 'lighting', label: 'Common Lighting'},
              {id: 'lifts', label: 'Lifts & Elevators'},
              {id: 'solar', label: 'Rooftop Solar PV'},
            ].map(svc => (
              <button
                key={svc.id}
                type="button"
                className={`service-filter-btn ${serviceFilter === svc.id ? 'active' : ''}`}
                onClick={() => setServiceFilter(svc.id)}
              >
                {svc.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-panel-top-actions">
          <div className="estate-status-filters">
            {['all', 'critical', 'high', 'medium'].map((level) => {
              const count = level === 'all'
                ? anomalies.length
                : anomalies.filter(a => a.severity === level).length;
              if (level !== 'all' && count === 0) return null;
              return (
                <button
                  key={level}
                  type="button"
                  className={filter === level ? 'selected' : ''}
                  aria-pressed={filter === level}
                  onClick={() => setFilter(level)}
                >
                  {level === 'all' ? 'All Severities' : level.charAt(0).toUpperCase() + level.slice(1)}
                  <span>{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="ml-anomaly-list">
        {filtered.length ? (
          filtered.map((anomaly) => {
            const isCritical = anomaly.severity === 'critical';
            const excessCost = anomaly.excess_kwh > 0 ? (anomaly.excess_kwh * 0.285).toFixed(2) : null;
            const excessCo2 = anomaly.excess_kwh > 0 ? (anomaly.excess_kwh * 0.402).toFixed(1) : null;

            return (
              <div
                key={anomaly.id}
                className={`ml-anomaly-item ${isCritical ? 'critical-border' : ''}`}
              >
                <div className="anomaly-icon-col">
                  <span className={`alert-icon ${isCritical ? 'high' : 'medium'}`}>
                    {anomaly.service === 'pumps' ? <Activity size={18} /> : <TriangleAlert size={18} />}
                  </span>
                </div>

                <div className="anomaly-body-col">
                  <div className="anomaly-title-row">
                    <div className="title-and-badges">
                      <strong>{anomaly.title}</strong>
                      <span className={`badge ${isCritical ? 'red' : anomaly.severity === 'high' ? 'amber' : 'neutral'}`}>
                        {anomaly.severity.toUpperCase()}
                      </span>
                      <span className="badge demo">
                        {(anomaly.confidence * 100).toFixed(0)}% Confidence
                      </span>
                      {excessCost && (
                        <span className="impact-badge">
                          Est. +S${excessCost} waste · +{excessCo2} kg CO₂
                        </span>
                      )}
                    </div>
                    <span className="anomaly-time">
                      <Clock size={13} /> {new Intl.DateTimeFormat('en-SG', {
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZone: 'Asia/Singapore',
                      }).format(new Date(anomaly.detected_at))} SGT
                    </span>
                  </div>

                  <div className="anomaly-meta-row">
                    <span className="meta-asset">
                      <strong>{anomaly.meter_id}</strong> · {anomaly.block_label} ({anomaly.town})
                    </span>
                    <span className="meta-values">
                      Recorded: <strong>{anomaly.value_kwh} kWh</strong> vs baseline {anomaly.baseline_kwh} kWh
                      {anomaly.excess_kwh > 0 && <span className="excess-badge">+{anomaly.excess_kwh} kWh excess</span>}
                      {anomaly.z_score && <span className="z-badge">Z: {anomaly.z_score.toFixed(1)}σ</span>}
                    </span>
                  </div>

                  <div className="anomaly-root-cause-card">
                    <div className="root-cause-text">
                      <ShieldAlert size={15} className="cause-icon" />
                      <div>
                        <strong>Root Cause Diagnostic:</strong>
                        <p>{anomaly.root_cause}</p>
                      </div>
                    </div>
                    <div className="suggested-action-text">
                      <span>Remediation recommendation:</span> {anomaly.suggested_action}
                    </div>
                  </div>

                  <div className="anomaly-action-row">
                    {canWrite ? (
                      <button
                        type="button"
                        className="button primary small-button"
                        onClick={() => onDispatchOrder(anomaly)}
                        aria-label={`Dispatch work order for ${anomaly.meter_id}`}
                      >
                        <ClipboardCheck size={15} />
                        <span>Dispatch Inspection Work Order</span>
                      </button>
                    ) : (
                      <span className="muted-hint">Area viewer mode is read-only. Switch to manager to dispatch work order.</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="estate-empty">
            <CheckCircle2 size={26} className="text-green" />
            <h3>No anomalies found</h3>
            <p>Isolation Forest model detected no anomalous consumption for this filter.</p>
          </div>
        )}
      </div>

      <div className="panel-note">
        <Info size={15} />
        <span>
          ML anomaly engine uses Scikit-Learn Isolation Forest ($n=150$) and robust residual Z-scores. Detected anomalies can be converted into tracked maintenance work orders with full audit history.
        </span>
        <button type="button" className="text-button" onClick={onOpenOrders}>
          Open maintenance queue <ChevronRight size={14} />
        </button>
      </div>
    </section>
  );
}
