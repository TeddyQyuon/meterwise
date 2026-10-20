const Bolt = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13.2 1.8 4.6 13.3a.7.7 0 0 0 .56 1.12h5.2l-1.1 7.7a.7.7 0 0 0 1.23.53l8.6-11.5a.7.7 0 0 0-.56-1.12h-5.2l1.1-7.7a.7.7 0 0 0-1.23-.53Z" />
  </svg>
);

export default function BootScreen({
  progress = 0,
  stage = 'Connecting to your workspace…',
  detail = 'Starting an isolated demo workspace for this browser.',
  elapsed = 0,
  steps = [],
  error = '',
  onRetry,
}) {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="mw-boot" aria-busy={!error}>
      <div className="mw-boot-inner">
        <header className="mw-boot-brand">
          <span className="mw-boot-mark"><Bolt /></span>
          <strong>MeterWise</strong>
          <span className="mw-boot-pill">Independent pilot</span>
        </header>

        <section className="mw-boot-card">
          <p className="mw-boot-eyebrow">SINGAPORE ESTATES</p>
          <h1>{error ? 'Workspace unavailable' : 'Preparing your workspace'}</h1>
          <p className="mw-boot-lead" role={error ? 'alert' : undefined}>
            {error || detail}
          </p>

          {error ? (
            <div className="mw-boot-error">
              <button type="button" className="button primary" onClick={onRetry}>Try again</button>
              <span>If this keeps happening, reload in a moment.</span>
            </div>
          ) : (
            <>
              <div
                className="mw-boot-track"
                role="progressbar"
                aria-label="Workspace loading progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${percent}% — ${stage}`}
              >
                <span style={{ width: `${Math.max(8, percent)}%` }} />
              </div>
              <div className="mw-boot-meta">
                <strong>{percent}%</strong>
                <span role="status" aria-live="polite">{stage}</span>
                <span className="mw-boot-time" aria-hidden="true">{elapsed.toFixed(1)}s</span>
              </div>

              <ol className="mw-boot-steps">
                {steps.map((step, index) => (
                  <li key={step.label} className={step.state}>
                    <i aria-hidden="true">{step.state === 'done' ? '✓' : index + 1}</i>
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>

              <p className="mw-boot-note">
                First visit only: MeterWise generates about 8,000 synthetic meter readings for your own workspace.
                Later visits load much faster.
              </p>
            </>
          )}
        </section>

        {!error && (
          <div className="mw-boot-skeleton" aria-hidden="true">
            <div className="mw-boot-metrics">
              <i /><i /><i /><i />
            </div>
            <div className="mw-boot-chart" />
          </div>
        )}

        <p className="mw-boot-foot">
          Real HDB building inventory · Simulated meter and maintenance data · SGT
        </p>
      </div>
    </div>
  );
}
