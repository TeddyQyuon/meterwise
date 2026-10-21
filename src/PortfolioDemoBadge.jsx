// Self-contained notice for live demo deployments: tells visitors this app is a
// demo and links to the owner's portfolio. Dependency-free, inline styles only,
// so it survives any app theme and any CSP that blocks <style> elements.
import { useState } from 'react';

const PORTFOLIO_URL = 'https://teddy-qyuon-portfolio.vercel.app/';
const STORAGE_KEY = 'tq-demo-badge-dismissed';

const styles = {
  wrap: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    zIndex: 2147483000,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    maxWidth: 'calc(100vw - 32px)',
    padding: '10px 14px',
    borderRadius: 999,
    background: 'rgba(9, 14, 24, 0.92)',
    color: '#e6ecf5',
    border: '1px solid rgba(120, 160, 200, 0.35)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
    font: '500 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  dot: { width: 8, height: 8, borderRadius: '50%', background: '#34d399', flex: '0 0 auto' },
  label: { whiteSpace: 'nowrap' },
  link: { color: '#67e8f9', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' },
  close: {
    border: 0,
    background: 'transparent',
    color: '#9fb0c4',
    fontSize: 16,
    lineHeight: 1,
    padding: '4px 6px',
    borderRadius: 8,
    cursor: 'pointer',
  },
};

export default function PortfolioDemoBadge() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Storage blocked (private mode): hide for this session render anyway.
    }
    setDismissed(true);
  };

  return (
    <div style={styles.wrap} role="region" aria-label="Demo notice" data-demo-badge="portfolio">
      <span style={styles.dot} aria-hidden="true" />
      <span style={styles.label}>Live demo</span>
      <a style={styles.link} href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
        Browse my portfolio ↗
      </a>
      <button type="button" style={styles.close} onClick={dismiss} aria-label="Dismiss demo notice">
        ×
      </button>
    </div>
  );
}
