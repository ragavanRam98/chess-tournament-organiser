'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, getAccessToken, setAccessToken, fetchAndCacheUserInfo } from '@/lib/api';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: Record<string, any> | null;
  newValue: Record<string, any> | null;
  performedAt: string;
  performedBy: { email: string; role: string } | null;
}

interface Meta {
  limit: number;
  next_cursor: string | null;
  has_next: boolean;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const ACTION_STYLES: Record<string, { bg: string; color: string }> = {
  APPROVED: { bg: 'rgba(16,185,129,0.10)', color: '#059669' },
  VERIFIED: { bg: 'rgba(16,185,129,0.10)', color: '#059669' },
  PAYMENT_CONFIRMED: { bg: 'rgba(16,185,129,0.10)', color: '#059669' },
  REJECTED: { bg: 'rgba(196,30,30,0.10)', color: '#C41E1E' },
  CANCELLED: { bg: 'rgba(196,30,30,0.10)', color: '#C41E1E' },
  SUSPENDED: { bg: 'rgba(245,158,11,0.10)', color: '#d97706' },
  REFUNDED: { bg: 'rgba(59,130,246,0.10)', color: '#2563eb' },
};

const ENTITY_TYPES = ['', 'tournament', 'organizer', 'registration'];

/* ─── Inline Admin Login ───────────────────────────────────────────── */
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post<{ access_token: string }>('/auth/login', { email, password });
      setAccessToken(res.data.access_token);
      fetchAndCacheUserInfo().catch(() => undefined);
      onLogin();
    } catch (err: any) {
      setError(err?.error?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100dvh - var(--header-height))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="animate-fadeInUp" style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 'var(--radius-lg)', margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem',
            boxShadow: '0 8px 24px rgba(185,28,28,0.3)', color: '#fff',
          }}>🛡</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Admin Portal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Sign in with super-admin credentials</p>
        </div>
        <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-100" style={{ padding: 32 }}>
          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', marginBottom: 20, fontSize: '0.9rem', fontWeight: 500 }}>
              {error}
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 28 }}>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-input" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
            {loading ? 'Signing in...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Value Diff Display ───────────────────────────────────────────── */
function ValueDiff({ label, value }: { label: string; value: Record<string, any> | null }) {
  if (!value || Object.keys(value).length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {Object.entries(value).map(([k, v]) => (
        <span key={k} style={{
          padding: '2px 8px', background: 'var(--ks-off-white)', borderRadius: 'var(--radius-full)',
          fontSize: '0.75rem', color: 'var(--text-secondary)', border: '1px solid var(--ks-border)',
        }}>
          {k}: <strong>{String(v ?? '—')}</strong>
        </span>
      ))}
    </div>
  );
}

/* ─── Audit Logs Page ──────────────────────────────────────────────── */
export default function AuditLogsPage() {
  const [authed, setAuthed] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [entityType, setEntityType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const buildQuery = useCallback((cursor?: string) => {
    const params = new URLSearchParams();
    params.set('limit', '50');
    if (entityType) params.set('entityType', entityType);
    if (dateFrom) params.set('from', dateFrom);
    if (dateTo) params.set('to', dateTo);
    if (cursor) params.set('cursor', cursor);
    return params.toString();
  }, [entityType, dateFrom, dateTo]);

  const loadLogs = useCallback((cursor?: string) => {
    const isLoadMore = !!cursor;
    if (isLoadMore) setLoadingMore(true); else setLoading(true);

    api.get<any>(`/admin/audit-logs?${buildQuery(cursor)}`)
      .then(res => {
        const data = res.data;
        const items: AuditLog[] = Array.isArray(data) ? data : data?.data ?? [];
        const m: Meta = data?.meta ?? res.data?.meta ?? { limit: 50, next_cursor: null, has_next: false };
        if (isLoadMore) {
          setLogs(prev => [...prev, ...items]);
        } else {
          setLogs(items);
        }
        setMeta(m);
        setAuthed(true);
      })
      .catch(() => setAuthed(false))
      .finally(() => {
        setLoading(false);
        setLoadingMore(false);
      });
  }, [buildQuery]);

  useEffect(() => {
    if (getAccessToken()) {
      loadLogs();
    } else {
      setLoading(false);
    }
  }, []);

  // Re-fetch on filter change
  const applyFilters = () => {
    setLogs([]);
    loadLogs();
  };

  if (!authed && !loading) {
    return <AdminLogin onLogin={() => loadLogs()} />;
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      {/* Header */}
      <div className="animate-fadeInUp" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <a href="/admin" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
            ← Dashboard
          </a>
        </div>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 4 }}>Audit Logs</h1>
        <p style={{ color: 'var(--text-muted)' }}>Track all administrative actions across the platform</p>
      </div>

      {/* Filters */}
      <div className="card card-body animate-fadeInUp delay-100" style={{ padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>Entity Type</label>
            <select
              value={entityType}
              onChange={e => setEntityType(e.target.value)}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            >
              <option value="">All</option>
              {ENTITY_TYPES.filter(Boolean).map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            />
          </div>
          <div style={{ flex: '1 1 160px', minWidth: 140 }}>
            <label className="form-label" style={{ fontSize: '0.78rem', marginBottom: 4 }}>To</label>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="form-input"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            />
          </div>
          <button
            onClick={applyFilters}
            className="btn btn-primary btn-sm"
            style={{ height: 38, paddingInline: 20 }}
          >
            Apply
          </button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card card-body">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton" style={{ height: 20, marginBottom: 12, width: `${90 - i * 8}%` }} />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="card card-body empty-state animate-fadeIn" style={{ padding: 48 }}>
          <div className="empty-state-icon" style={{ fontSize: '2.5rem' }}>📋</div>
          <h3>No audit logs found</h3>
          <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>
            {entityType || dateFrom || dateTo ? 'Try adjusting your filters.' : 'Actions will appear here as they happen.'}
          </p>
        </div>
      ) : (
        <div className="animate-fadeInUp delay-100">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Timestamp</th>
                  <th style={{ width: 120 }}>Action</th>
                  <th style={{ width: 110 }}>Entity</th>
                  <th>Changes</th>
                  <th style={{ width: 180 }}>Performed By</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const actionStyle = ACTION_STYLES[log.action] ?? { bg: 'var(--ks-off-white)', color: 'var(--text-secondary)' };
                  return (
                    <tr key={log.id}>
                      <td>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{formatDate(log.performedAt)}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatTime(log.performedAt)}</div>
                      </td>
                      <td>
                        <span style={{
                          display: 'inline-block', padding: '3px 10px', borderRadius: 'var(--radius-full)',
                          fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em',
                          background: actionStyle.bg, color: actionStyle.color,
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.85rem', fontWeight: 500, textTransform: 'capitalize' }}>{log.entityType}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {log.entityId.slice(0, 8)}...
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <ValueDiff label="Before" value={log.oldValue} />
                          {log.oldValue && log.newValue && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>→</span>
                          )}
                          <ValueDiff label="After" value={log.newValue} />
                        </div>
                      </td>
                      <td>
                        {log.performedBy ? (
                          <div>
                            <div style={{ fontSize: '0.85rem' }}>{log.performedBy.email}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{log.performedBy.role}</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>System</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {meta?.has_next && (
            <div style={{ textAlign: 'center', marginTop: 24 }}>
              <button
                onClick={() => loadLogs(meta.next_cursor!)}
                disabled={loadingMore}
                className="btn btn-secondary"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}

          {/* Count */}
          <div style={{ textAlign: 'center', marginTop: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Showing {logs.length} log{logs.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
