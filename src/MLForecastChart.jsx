import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

const numberFormat = (val, digits = 2) =>
  new Intl.NumberFormat('en-SG', {maximumFractionDigits: digits, minimumFractionDigits: digits}).format(val);

export default function MLForecastChart({data, viewMode, showConfidence}) {
  // Transform data to ensure range arrays for confidence interval rendering
  const chartData = data.map(point => ({
    ...point,
    demand_range: [point.demand_lower, point.demand_upper],
    solar_range: [point.solar_lower, point.solar_upper],
  }));

  const showDemand = viewMode === 'all' || viewMode === 'demand';
  const showSolar = viewMode === 'all' || viewMode === 'solar';
  const showGrid = viewMode === 'all' || viewMode === 'grid';

  return (
    <div className="ml-chart-container">
      <div className="ml-chart-legend">
        {showDemand && (
          <>
            <span className="legend-item"><i className="legend-swatch actual-demand-swatch" />Actual Demand</span>
            <span className="legend-item"><i className="legend-swatch pred-demand-swatch" />ML Predicted Demand</span>
            {showConfidence && <span className="legend-item"><i className="legend-swatch band-demand-swatch" />95% Demand Bounds</span>}
          </>
        )}
        {showSolar && (
          <>
            <span className="legend-item"><i className="legend-swatch actual-solar-swatch" />Actual Solar</span>
            <span className="legend-item"><i className="legend-swatch pred-solar-swatch" />ML Predicted Solar</span>
            {showConfidence && <span className="legend-item"><i className="legend-swatch band-solar-swatch" />95% Solar Bounds</span>}
          </>
        )}
        {showGrid && (
          <span className="legend-item"><i className="legend-swatch net-grid-swatch" />Projected Net Grid Import</span>
        )}
      </div>

      <div className="estate-chart" role="img" aria-label="Hourly ML Forecast and Confidence Interval Chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{top: 12, right: 16, left: 4, bottom: 8}}>
            <CartesianGrid vertical={false} stroke="#e4eae5" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{fontSize: 11, fill: '#5c6e63'}}
              minTickGap={20}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{fontSize: 11, fill: '#5c6e63'}}
              width={48}
              tickFormatter={(v) => `${v} kWh`}
            />

            <Tooltip
              content={({active, payload}) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload;
                if (!point) return null;

                const demandDelta = point.actual_demand !== null
                  ? Math.abs(point.actual_demand - point.predicted_demand)
                  : null;

                return (
                  <div className="ml-chart-tooltip">
                    <div className="tooltip-head">
                      <strong>{point.label} SGT</strong>
                      <span className="tooltip-hour">Hour {point.hour.toString().padStart(2, '0')}:00</span>
                    </div>

                    {showDemand && (
                      <div className="tooltip-section">
                        <span className="section-title demand-color">Common-Area Demand</span>
                        {point.actual_demand !== null && (
                          <div className="tooltip-row">
                            <span>Actual recorded:</span>
                            <strong>{numberFormat(point.actual_demand)} kWh</strong>
                          </div>
                        )}
                        <div className="tooltip-row">
                          <span>ML Predicted:</span>
                          <strong className="pred-value">{numberFormat(point.predicted_demand)} kWh</strong>
                        </div>
                        {demandDelta !== null && (
                          <div className="tooltip-row subtle">
                            <span>Residual error:</span>
                            <span>{numberFormat(demandDelta)} kWh</span>
                          </div>
                        )}
                        {showConfidence && (
                          <div className="tooltip-row confidence-row">
                            <span>95% Bounds:</span>
                            <span>[{numberFormat(point.demand_lower)} – {numberFormat(point.demand_upper)}] kWh</span>
                          </div>
                        )}
                      </div>
                    )}

                    {showSolar && (
                      <div className="tooltip-section">
                        <span className="section-title solar-color">Rooftop Solar Generation</span>
                        {point.actual_solar !== null && (
                          <div className="tooltip-row">
                            <span>Actual solar:</span>
                            <strong>{numberFormat(point.actual_solar)} kWh</strong>
                          </div>
                        )}
                        <div className="tooltip-row">
                          <span>ML Predicted:</span>
                          <strong className="pred-value solar-value">{numberFormat(point.predicted_solar)} kWh</strong>
                        </div>
                        {showConfidence && (
                          <div className="tooltip-row confidence-row">
                            <span>95% Bounds:</span>
                            <span>[{numberFormat(point.solar_lower)} – {numberFormat(point.solar_upper)}] kWh</span>
                          </div>
                        )}
                      </div>
                    )}

                    {showGrid && (
                      <div className="tooltip-section grid-section">
                        <div className="tooltip-row">
                          <span>Projected Net Grid:</span>
                          <strong>{numberFormat(point.net_predicted_grid ?? 0)} kWh</strong>
                        </div>
                      </div>
                    )}
                  </div>
                );
              }}
            />

            {/* Confidence Bands (Shaded intervals) */}
            {showDemand && showConfidence && (
              <Area
                name="Demand 95% Confidence"
                dataKey="demand_range"
                stroke="none"
                fill="#1b5a40"
                fillOpacity={0.14}
                isAnimationActive={false}
              />
            )}
            {showSolar && showConfidence && (
              <Area
                name="Solar 95% Confidence"
                dataKey="solar_range"
                stroke="none"
                fill="#ca922e"
                fillOpacity={0.16}
                isAnimationActive={false}
              />
            )}

            {/* Actual Lines */}
            {showDemand && (
              <Line
                name="Actual Demand"
                type="monotone"
                dataKey="actual_demand"
                stroke="#1b5a40"
                strokeWidth={2.4}
                dot={{r: 3, fill: '#1b5a40', strokeWidth: 1}}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}
            {showSolar && (
              <Line
                name="Actual Solar"
                type="monotone"
                dataKey="actual_solar"
                stroke="#ca922e"
                strokeWidth={2.4}
                dot={{r: 3, fill: '#ca922e', strokeWidth: 1}}
                connectNulls={false}
                isAnimationActive={false}
              />
            )}

            {/* Predicted Curves */}
            {showDemand && (
              <Line
                name="Predicted Demand"
                type="monotone"
                dataKey="predicted_demand"
                stroke="#2f8e65"
                strokeWidth={2.2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            )}
            {showSolar && (
              <Line
                name="Predicted Solar"
                type="monotone"
                dataKey="predicted_solar"
                stroke="#e09d29"
                strokeWidth={2.2}
                strokeDasharray="5 4"
                dot={false}
                isAnimationActive={false}
              />
            )}

            {/* Net Grid Line */}
            {showGrid && (
              <Line
                name="Net Grid Import"
                type="monotone"
                dataKey="net_predicted_grid"
                stroke="#6883a4"
                strokeWidth={1.8}
                strokeDasharray="3 3"
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="chart-data">
        <summary>View forecast hourly data table</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Hourly ML forecast table">
          <table>
            <thead>
              <tr>
                <th>Interval (SGT)</th>
                <th>Actual Demand</th>
                <th>Predicted Demand</th>
                <th>Demand 95% Bounds</th>
                <th>Actual Solar</th>
                <th>Predicted Solar</th>
                <th>Solar 95% Bounds</th>
                <th>Net Grid</th>
              </tr>
            </thead>
            <tbody>
              {data.map((point) => (
                <tr key={point.timestamp}>
                  <td>{point.label}</td>
                  <td>{point.actual_demand !== null ? `${numberFormat(point.actual_demand)} kWh` : '—'}</td>
                  <td><strong>{numberFormat(point.predicted_demand)} kWh</strong></td>
                  <td><small className="table-sub">[{numberFormat(point.demand_lower)} – {numberFormat(point.demand_upper)}]</small></td>
                  <td>{point.actual_solar !== null ? `${numberFormat(point.actual_solar)} kWh` : '—'}</td>
                  <td><strong>{numberFormat(point.predicted_solar)} kWh</strong></td>
                  <td><small className="table-sub">[{numberFormat(point.solar_lower)} – {numberFormat(point.solar_upper)}]</small></td>
                  <td>{numberFormat(point.net_predicted_grid ?? 0)} kWh</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
