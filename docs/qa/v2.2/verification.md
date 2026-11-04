# MeterWise workspace upgrade — 4 November 2026

## Implemented

- Retained MeterWise's forest green identity with a quieter, compact workspace, consistent panel spacing, readable metrics and a clear filter bar.
- Added a three-step quick guide, mobile bottom navigation and an accessible drawer. Kept detailed anomalies behind an explicit disclosure so the overview stays focused.
- Moved the demo attribution into document flow to avoid covering charts or controls.
- Kept synthetic operational data, unavailable ML results and incomplete coverage explicitly labelled. Matched anomaly locations to the current permitted asset register.
- Preserved the existing overview, forecasts, assets, data repair, work orders, reports, source documentation and building demo routes.

## Performance

Production Vite builds, same environment and dependency lockfile:

| Asset | Before | After |
| --- | ---: | ---: |
| Main startup JavaScript | 293.02 kB | 244.31 kB |
| Main startup JavaScript, gzip | 88.70 kB | 77.15 kB |

Main entry JavaScript is 16.6% smaller before compression and 13.0% smaller gzipped. This measures the main entry file, not total page transfer or Core Web Vitals. The shared chart library remains separately loaded.

Secondary estate pages, inspection dialogs, sign-in, anomaly triage and ML styles now load on demand. Chart code is still started in parallel with the initial request. Estate bootstrap combines the session, overview and account context, removing the separate overview and account lookup from startup. A first visit still performs the initial session check and creates its isolated workspace when necessary. Existing session responses remain compatible when bootstrap is omitted.

Forecast regressors use one worker rather than every detected CPU for this small dataset; LightGBM uses column-wise training without its automatic layout benchmark. Request waits are bounded at 45 seconds. Loading feedback is indeterminate instead of claiming fabricated percentages.

## Validation

- `npm run build`: passed.
- `OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 python -m pytest -q`: 86 passed, one upstream Starlette/httpx deprecation warning.
- The two stale legacy contract assertions also failed in the untouched baseline checkout. Updated them to recognise the existing session metadata and 2.1 asset fields, while retaining exact checks of the original 2.0 values.
- Cloud browser: inspected desktop overview and guide; changed the town to Bishan and verified 100% coverage, two blocks and calculated grid use; created a local demonstration pump inspection and verified its maintenance-queue entry.
- Responsive iframe checks at 320, 390 and 768 px: document content width equalled viewport width (305, 375 and 753 CSS px with classic scrollbars). These are responsive layout checks, not mobile hardware emulation.
- Checked mobile drawer, asset navigation and bottom navigation. Labels, native dialog focus, reduced-motion handling and contained table scrolling retained.
- Console messages observed from the browser extension are outside the application. No application exception was seen during the verified flows.

## Reference research

- Schneider Electric Energy Hub: site/building comparison, energy by service and actionable equipment status — https://www.se.com/sg/en/work/campaign/local/energy-hub/
- Grafana: focused overview, consistent dashboard hierarchy — https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/
- Tableau: fewer competing views and device-specific layouts — https://help.tableau.com/current/pro/desktop/en-us/dashboards_best_practices.htm
- Enode: clear asset navigation and contextual insights — https://enode.com/platform/overview
- LightGBM: avoid excessive threads for small data — https://lightgbm.readthedocs.io/en/latest/Parameters.html

No field Core Web Vitals or Lighthouse score is claimed. Production first-visit speed still depends on database latency and workspace provisioning. Live ML availability must be checked independently after release; the UI retains an explicit demonstration fallback.
