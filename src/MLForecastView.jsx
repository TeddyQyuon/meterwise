import {useState, useEffect, useCallback, useMemo} from 'react';
import {
  Sparkles,
  Zap,
  Sun,
  Activity,
  Layers,
  Clock,
  ShieldCheck,
  RefreshCw,
  LoaderCircle,
  Lightbulb,
  Sliders,
  Leaf,
  DollarSign,
} from 'lucide-react';
import {fetchMLForecast} from './ml-api';
import MLForecastChart from './MLForecastChart';

const numberFormat = (val, digits = 0) =>
  new Intl.NumberFormat('en-SG', {maximumFractionDigits: digits, minimumFractionDigits: digits}).format(val);

const money = (val) => `S$${new Intl.NumberFormat('en-SG', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(val)}`;

export default function MLForecastView({town, block, catalogue}) {
  const [horizon, setHorizon] = useState(24);
  const [viewMode, setViewMode] = useState('all');
  const [showConfidence, setShowConfidence] = useState(true);
  const [scenario, setScenario] = useState('baseline');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forecast, setForecast] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMLForecast(town, block, horizon);
      setForecast(data);
    } catch (err) {
      setError(err?.message || 'Failed to load ML forecast.');
    } finally {
      setLoading(false);
    }
  }, [town, block, horizon]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const matchedBlock = catalogue?.find(b => b.id === block);
  const selectedBlockLabel = block === 'all'
    ? 'All permitted blocks'
    : matchedBlock
      ? `Blk ${matchedBlock.block} · ${matchedBlock.street}`
      : block;

  // Real-time What-If Scenario recalculation
  const {simulatedSeries, scenarioImpact} = useMemo(() => {
    if (!forecast?.series) return {simulatedSeries: [], scenarioImpact: null};

    let totalSavedKwh = 0;
    let peakShavedKwh = 0;

    const modified = forecast.series.map(point => {
      let d = point.predicted_demand;
      let s = point.predicted_solar;

      if (scenario === 'lighting') {
        if (point.hour >= 0 && point.hour <= 5) {
          const delta = d * 0.22;
          d = Math.max(0.2, d - delta);
          totalSavedKwh += delta;
        }
      } else if (scenario === 'solar_expand') {
        const addedSolar = s * 0.50;
        s = s + addedSolar;
        totalSavedKwh += addedSolar;
      } else if (scenario === 'pump_shift') {
        if (point.hour >= 18 && point.hour <= 22) {
          const shaved = d * 0.16;
          d = Math.max(0.4, d - shaved);
          peakShavedKwh = Math.max(peakShavedKwh, shaved);
          totalSavedKwh += shaved * 0.4;
        } else if (point.hour >= 11 && point.hour <= 14) {
          d = d * 1.14; // pumped using zero-marginal-cost solar
        }
      }

      const netGrid = Math.max(0, d - s);
      const ratio = point.predicted_demand > 0 ? d / point.predicted_demand : 1;

      return {
        ...point,
        predicted_demand: Number(d.toFixed(2)),
        predicted_solar: Number(s.toFixed(2)),
        net_predicted_grid: Number(netGrid.toFixed(2)),
        demand_lower: Number((point.demand_lower * ratio).toFixed(2)),
        demand_upper: Number((point.demand_upper * ratio).toFixed(2)),
      };
    });

    const monthlyCostSaved = totalSavedKwh * 0.285 * 30;
    const monthlyCo2Saved = totalSavedKwh * 0.402 * 30;

    return {
      simulatedSeries: modified,
      scenarioImpact: {
        savedKwh: totalSavedKwh,
        monthlyCostSaved,
        monthlyCo2Saved,
        peakShavedKwh,
      },
    };
  }, [forecast, scenario]);

  return (
    <div className="ml-forecast-page">
      {/* KPI Cards */}
      {forecast && (
        <div className="metrics estate-metrics ml-forecast-metrics">
          <div className="metric">
            <div className="metric-top">
              Predicted Common Demand
              <span className="metric-icon"><Zap size={17} /></span>
            </div>
            <div className="metric-value">
              {numberFormat(forecast.summary.total_predicted_demand)}
              <span>kWh</span>
            </div>
            <div className="metric-foot">
              Peak {forecast.summary.peak_demand_kwh} kWh at {forecast.summary.peak_demand_hour} · MAE: {forecast.metrics.demand_mae} kWh
            </div>
          </div>

          <div className="metric">
            <div className="metric-top">
              Predicted Solar Generation
              <span className="metric-icon"><Sun size={17} /></span>
            </div>
            <div className="metric-value">
              {numberFormat(forecast.summary.total_predicted_solar)}
              <span>kWh</span>
            </div>
            <div className="metric-foot">
              Peak {forecast.summary.peak_solar_kwh} kWh at {forecast.summary.peak_solar_hour} · {forecast.summary.self_consumption_rate}% on-site use
            </div>
          </div>

          <div className="metric">
            <div className="metric-top">
              Projected Net Grid Import
              <span className="metric-icon"><Activity size={17} /></span>
            </div>
            <div className="metric-value">
              {numberFormat(forecast.summary.net_grid_kwh)}
              <span>kWh</span>
            </div>
            <div className="metric-foot">
              Est. Tariff: {money(forecast.summary.net_grid_kwh * 0.285)} (at S$0.285/kWh)
            </div>
          </div>

          <div className="metric">
            <div className="metric-top">
              Avoided CO₂ & Accuracy
              <span className="metric-icon"><ShieldCheck size={17} /></span>
            </div>
            <div className="metric-value">
              {numberFormat(forecast.summary.total_predicted_solar * 0.402, 1)}<span>kg</span>
            </div>
            <div className="metric-foot">
              Avoided CO₂ · Backtested R²: {forecast.metrics.r2_score} (MAPE: {forecast.metrics.demand_mape}%)
            </div>
          </div>
        </div>
      )}

      {/* Main Forecast Panel */}
      <section className="panel ml-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Hourly Demand & Solar Forecast
              <span className="ml-tag"><Sparkles size={13} /> ML Predictive</span>
            </h2>
            <p>
              Scope: <strong>{selectedBlockLabel}</strong> ({town === 'all' ? 'All Towns' : town}) · LightGBM Time-Series Regression
            </p>
          </div>

          {/* Interactive Controls */}
          <div className="ml-controls-row">
            {/* Horizon switcher */}
            <div className="segmented" role="group" aria-label="Forecast horizon">
              <button
                type="button"
                className={horizon === 24 ? 'selected' : ''}
                aria-pressed={horizon === 24}
                onClick={() => setHorizon(24)}
              >
                24h Horizon
              </button>
              <button
                type="button"
                className={horizon === 48 ? 'selected' : ''}
                aria-pressed={horizon === 48}
                onClick={() => setHorizon(48)}
              >
                48h Horizon
              </button>
            </div>

            {/* View Mode */}
            <div className="segmented" role="group" aria-label="Energy mode">
              <button
                type="button"
                className={viewMode === 'all' ? 'selected' : ''}
                aria-pressed={viewMode === 'all'}
                onClick={() => setViewMode('all')}
              >
                All Energy
              </button>
              <button
                type="button"
                className={viewMode === 'demand' ? 'selected' : ''}
                aria-pressed={viewMode === 'demand'}
                onClick={() => setViewMode('demand')}
              >
                Demand
              </button>
              <button
                type="button"
                className={viewMode === 'solar' ? 'selected' : ''}
                aria-pressed={viewMode === 'solar'}
                onClick={() => setViewMode('solar')}
              >
                Solar
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'selected' : ''}
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
              >
                Net Grid
              </button>
            </div>

            {/* Confidence toggle */}
            <label className="ml-checkbox-label">
              <input
                type="checkbox"
                checked={showConfidence}
                onChange={(e) => setShowConfidence(e.target.checked)}
              />
              <span>95% Bounds</span>
            </label>

            {/* Refresh */}
            <button
              type="button"
              className="icon-button bordered"
              aria-label="Refresh forecast"
              disabled={loading}
              onClick={() => void loadData()}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Operational What-If Scenario Simulator Bar */}
        {forecast && (
          <div className="ml-scenario-box">
            <div className="ml-scenario-header">
              <div className="ml-scenario-title">
                <Sliders size={16} />
                <span>Operational What-If Simulator:</span>
              </div>
              {scenario !== 'baseline' && scenarioImpact && (
                <div className="ml-scenario-impact-pill">
                  <Leaf size={14} />
                  <span>
                    Est. {money(scenarioImpact.monthlyCostSaved)}/mo savings · {numberFormat(scenarioImpact.monthlyCo2Saved, 0)} kg CO₂ abated
                    {scenarioImpact.peakShavedKwh > 0 && ` · ${scenarioImpact.peakShavedKwh.toFixed(1)} kW peak shaved`}
                  </span>
                </div>
              )}
            </div>
            <div className="ml-scenario-buttons" role="group" aria-label="What-if operational scenarios">
              <button
                type="button"
                className={`ml-scenario-btn ${scenario === 'baseline' ? 'active' : ''}`}
                onClick={() => setScenario('baseline')}
              >
                Baseline ML Model
              </button>
              <button
                type="button"
                className={`ml-scenario-btn ${scenario === 'lighting' ? 'active' : ''}`}
                onClick={() => setScenario('lighting')}
              >
                Smart Corridor Dimming (-22% 00:00–05:00)
              </button>
              <button
                type="button"
                className={`ml-scenario-btn ${scenario === 'solar_expand' ? 'active' : ''}`}
                onClick={() => setScenario('solar_expand')}
              >
                Rooftop Solar Expansion (+50% PV)
              </button>
              <button
                type="button"
                className={`ml-scenario-btn ${scenario === 'pump_shift' ? 'active' : ''}`}
                onClick={() => setScenario('pump_shift')}
              >
                Booster Pump Peak-Shifting (Solar Hours)
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="estate-notice error" role="alert">
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="data-status" role="status">
            <LoaderCircle size={18} className="spin" /> Generating machine learning predictions…
          </div>
        ) : forecast ? (
          <MLForecastChart
            data={simulatedSeries}
            viewMode={viewMode}
            showConfidence={showConfidence}
          />
        ) : null}
      </section>

      {/* Model Context & Operation Insights Grid */}
      {forecast && (
        <div className="estate-grid ml-bottom-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Predictive Operational Insights</h2>
                <p>Derived recommendations for Town Council operations</p>
              </div>
              <Lightbulb size={19} className="muted" />
            </div>

            <div className="ml-insights-list">
              <div className="ml-insight-item">
                <span className="insight-badge peak"><Clock size={15} /></span>
                <div>
                  <strong>Peak Demand Window ({forecast.summary.peak_demand_hour} SGT)</strong>
                  <p>
                    Anticipated evening surge reaching {forecast.summary.peak_demand_kwh} kWh across corridor lighting and lift banks. Ensure non-essential water transfer pumping is scheduled before 18:00 to shave peak tariff charges.
                  </p>
                </div>
              </div>

              <div className="ml-insight-item">
                <span className="insight-badge solar"><Sun size={15} /></span>
                <div>
                  <strong>Solar Peak & Self-Consumption ({forecast.summary.peak_solar_hour} SGT)</strong>
                  <p>
                    Solar generation is forecast to reach {forecast.summary.peak_solar_kwh} kWh, offsetting up to {forecast.summary.self_consumption_rate}% of midday building elevator and booster pump load.
                  </p>
                </div>
              </div>

              <div className="ml-insight-item">
                <span className="insight-badge efficiency"><Zap size={15} /></span>
                <div>
                  <strong>Tariff Cost Optimization</strong>
                  <p>
                    Forecasted total net grid import is {numberFormat(forecast.summary.net_grid_kwh)} kWh (approx S${numberFormat(forecast.summary.net_grid_kwh * 0.285, 2)} at benchmark tariff). Smart load-shifting can yield estimated 8-12% monthly reductions.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>ML Model Architecture & Verification</h2>
                <p>Feature pipeline and statistical boundaries</p>
              </div>
              <Layers size={19} className="muted" />
            </div>

            <dl className="estate-assumptions ml-model-specs">
              <div>
                <dt>Predictive Algorithm</dt>
                <dd><strong>{forecast.model_info.algorithm}</strong></dd>
              </div>
              <div>
                <dt>Evaluation Metrics (Test Split)</dt>
                <dd>Demand MAE: {forecast.metrics.demand_mae} kWh · RMSE: {forecast.metrics.demand_rmse} kWh · MAPE: {forecast.metrics.demand_mape}%</dd>
              </div>
              <div>
                <dt>Confidence Bounds</dt>
                <dd>{forecast.model_info.confidence_interval} (Heteroscedastic quantile regression)</dd>
              </div>
              <div>
                <dt>Feature Engineering</dt>
                <dd className="ml-features-tags">
                  {forecast.model_info.features_used.map(f => (
                    <span key={f} className="ml-feat-tag">{f}</span>
                  ))}
                </dd>
              </div>
              <div>
                <dt>Training Dataset</dt>
                <dd>{forecast.model_info.training_window}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
