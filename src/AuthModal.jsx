import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Key, Building2, Copy, Check, Plus, LoaderCircle, ShieldCheck, LogOut } from 'lucide-react';
import { estateApi, postEstate } from './estate-api';

export default function AuthModal({ open, onClose, authInfo, onAuthenticated, onLogout }) {
  const dialogRef = useRef(null);
  const isManager = authInfo?.role === 'manager' || authInfo?.role === 'org_admin' || !authInfo?.isDemo;
  const [tab, setTab] = useState(!authInfo?.isDemo ? 'apikeys' : 'signin');

  // Sign in state
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register state
  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [tariff, setTariff] = useState('0.285');

  // API keys state
  const [apiKeys, setApiKeys] = useState([]);
  const [keyName, setKeyName] = useState('');
  const [newKey, setNewKey] = useState(null);
  const [copied, setCopied] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);

  // Common UI state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    setError('');
    if (!authInfo?.isDemo) {
      setTab('apikeys');
    } else {
      setTab('signin');
    }
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [open, authInfo?.isDemo]);

  const loadApiKeys = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const keys = await estateApi('/auth/api-keys');
      setApiKeys(Array.isArray(keys) ? keys : []);
      setKeysLoaded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open && tab === 'apikeys' && !keysLoaded) {
      void loadApiKeys();
    }
  }, [open, tab, keysLoaded, loadApiKeys]);

  if (!open) return null;

  async function handleLogin(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await estateApi('/auth/login', postEstate({
        email: loginEmail,
        password: loginPassword,
      }));
      setLoginEmail('');
      setLoginPassword('');
      if (onAuthenticated) await onAuthenticated(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await estateApi('/auth/register', postEstate({
        orgName,
        name: adminName,
        email: regEmail,
        password: regPassword,
        tariff: parseFloat(tariff) || 0.285,
      }));
      setOrgName('');
      setAdminName('');
      setRegEmail('');
      setRegPassword('');
      if (onAuthenticated) await onAuthenticated(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateKey(e) {
    e.preventDefault();
    if (busy || !keyName.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await estateApi('/auth/api-keys', postEstate({
        name: keyName.trim(),
      }));
      setNewKey(result);
      setKeyName('');
      await loadApiKeys();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogoutClick() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await estateApi('/auth/logout', postEstate({}));
      if (onLogout) await onLogout();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/telemetry/ingest`;

  return (
    <dialog
      ref={dialogRef}
      className="modal estate-dialog"
      aria-label="Client Workspace & Smart Meter Ingestion"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
    >
      <div className="modal-head">
        <h2>Client Workspace & Ingestion</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>

      <div style={{ padding: '20px 24px 0' }}>
        {/* Active Client Workspace banner */}
        {!authInfo?.isDemo && authInfo?.orgName ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: '#edf5e8',
            border: '1px solid #d4e4cc',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16
          }}>
            <div>
              <div style={{ fontSize: '0.72rem', color: '#527546', fontWeight: 600, letterSpacing: '0.04em' }}>
                ACTIVE CLIENT WORKSPACE
              </div>
              <strong style={{ fontSize: '0.95rem', color: '#274b2f' }}>
                {authInfo.orgName}
              </strong>
              {authInfo.actorName && (
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#668065' }}>
                  Signed in as {authInfo.actorName} ({authInfo.role || 'manager'})
                </span>
              )}
            </div>
            <button
              type="button"
              className="button secondary"
              style={{ minHeight: 34, padding: '6px 12px', fontSize: '0.75rem' }}
              disabled={busy}
              onClick={handleLogoutClick}
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        ) : null}

        {/* Tab switcher */}
        <div className="estate-status-filters" style={{ padding: 0, margin: '0 0 16px' }}>
          <button
            type="button"
            className={tab === 'signin' ? 'selected' : ''}
            aria-pressed={tab === 'signin'}
            onClick={() => { setTab('signin'); setError(''); }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={tab === 'register' ? 'selected' : ''}
            aria-pressed={tab === 'register'}
            onClick={() => { setTab('register'); setError(''); }}
          >
            New Client Workspace
          </button>
          {isManager && (
            <button
              type="button"
              className={tab === 'apikeys' ? 'selected' : ''}
              aria-pressed={tab === 'apikeys'}
              onClick={() => { setTab('apikeys'); setError(''); }}
            >
              Smart Meter API Keys
            </button>
          )}
        </div>
      </div>

      {/* Tab: Sign In */}
      {tab === 'signin' && (
        <form onSubmit={handleLogin} className="estate-form" style={{ paddingTop: 0 }}>
          <label>
            Work Email
            <input
              type="email"
              required
              aria-label="Work Email"
              placeholder="manager@towncouncil.sg"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              aria-label="Password"
              placeholder="••••••••"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
            />
          </label>

          {error && <p role="alert" className="estate-form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  <span>Signing In…</span>
                </>
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Tab: New Client Workspace */}
      {tab === 'register' && (
        <form onSubmit={handleRegister} className="estate-form" style={{ paddingTop: 0 }}>
          <label>
            Organization Name
            <input
              type="text"
              required
              minLength={2}
              maxLength={100}
              aria-label="Organization Name"
              placeholder="e.g. Jurong Town Pilot"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </label>
          <label>
            Administrator Name
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              aria-label="Administrator Name"
              placeholder="e.g. Alex Tan"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
            />
          </label>
          <label>
            Admin Work Email
            <input
              type="email"
              required
              aria-label="Admin Work Email"
              placeholder="alex.tan@towncouncil.sg"
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              aria-label="Password"
              placeholder="At least 8 characters"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
            />
          </label>
          <label>
            Configured Tariff (S$ / kWh)
            <input
              type="number"
              step="0.001"
              min="0.01"
              max="5.0"
              required
              aria-label="Configured Tariff"
              value={tariff}
              onChange={(e) => setTariff(e.target.value)}
            />
          </label>
          <p className="field-hint">
            Creates an isolated client organization with dedicated energy policy, building catalog, and audit trail.
          </p>

          {error && <p role="alert" className="estate-form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  <span>Creating…</span>
                </>
              ) : (
                'Create Client Workspace'
              )}
            </button>
          </div>
        </form>
      )}

      {/* Tab: Smart Meter Ingestion API Keys */}
      {tab === 'apikeys' && (
        <div className="estate-form" style={{ paddingTop: 0 }}>
          {newKey && (
            <div
              className="estate-notice"
              style={{
                background: '#e9f6ea',
                borderColor: '#c3e3c6',
                color: '#285831',
                display: 'block',
                margin: 0
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong>Key Generated: {newKey.name}</strong>
                <span style={{ fontSize: '0.72rem', color: '#4a7953' }}>
                  Copy this key now. It will not be shown again.
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code
                  style={{
                    flex: 1,
                    background: '#fff',
                    border: '1px solid #cce2d0',
                    padding: '8px 10px',
                    borderRadius: 6,
                    fontSize: '0.8rem',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all'
                  }}
                >
                  {newKey.apiKey}
                </code>
                <button
                  type="button"
                  className="button secondary"
                  style={{ minHeight: 34, padding: '4px 10px', fontSize: '0.75rem' }}
                  onClick={() => {
                    void navigator.clipboard?.writeText(newKey.apiKey);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Webhook details */}
          <div style={{
            background: '#f8faf7',
            border: '1px solid #e1e9de',
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: '0.8rem'
          }}>
            <strong style={{ display: 'block', color: '#33553a', marginBottom: 4 }}>
              Telemetry Webhook Ingestion Endpoint
            </strong>
            <code style={{
              display: 'block',
              background: '#fff',
              border: '1px solid #dce5da',
              borderRadius: 6,
              padding: '6px 9px',
              fontSize: '0.78rem',
              color: '#2d674b',
              marginBottom: 8
            }}>
              POST {webhookUrl}
            </code>
            <div style={{ fontSize: '0.75rem', color: '#687e6c', lineHeight: 1.6 }}>
              <span>Header: <code>Authorization: Bearer mw_live_...</code></span>
              <br />
              <span>Format: JSON payload with <code>csv</code> string containing interval rows.</span>
            </div>
          </div>

          {/* Create key form */}
          <form onSubmit={handleCreateKey} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <label style={{ flex: 1 }}>
              New Ingestion Key Name
              <input
                type="text"
                required
                minLength={2}
                maxLength={80}
                aria-label="New Ingestion Key Name"
                placeholder="e.g. Substation IoT Gateway"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={busy || !keyName.trim()} style={{ height: 42 }}>
              <Plus size={16} />
              <span>Generate Key</span>
            </button>
          </form>

          {/* Keys list */}
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Ingestion API Keys" style={{ maxHeight: 220 }}>
            <table>
              <thead>
                <tr>
                  <th>Key Name</th>
                  <th>Prefix</th>
                  <th>Created</th>
                  <th>Last Used</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: '#889a8b', padding: '24px 0' }}>
                      {busy ? 'Loading API keys…' : 'No ingestion API keys generated yet.'}
                    </td>
                  </tr>
                ) : (
                  apiKeys.map((k) => (
                    <tr key={k.id}>
                      <td><strong>{k.name}</strong></td>
                      <td><code>{k.key_prefix || k.prefix}…</code></td>
                      <td>{k.created_at ? new Date(k.created_at).toLocaleDateString('en-SG') : '—'}</td>
                      <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString('en-SG') : 'Never'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {error && <p role="alert" className="estate-form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
