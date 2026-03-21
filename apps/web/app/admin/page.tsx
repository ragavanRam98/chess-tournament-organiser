'use client';

import { useEffect, useState } from 'react';
import { api, getAccessToken, setAccessToken } from '@/lib/api';

interface Tournament {
  id: string; title: string; city: string; venue: string;
  startDate: string; status: string;
  organizer: { academyName: string; city: string };
  categories: { name: string; maxSeats: number }[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─── Inline Admin Login ────────────────────────────────────────────── */
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
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" placeholder="admin@easychess.local" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 28 }}>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-input" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
            {loading ? 'Signing in...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Admin Dashboard ───────────────────────────────────────────────── */
export default function AdminDashboard() {
  const [authed, setAuthed] = useState(false);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadTournaments = () => {
    setLoading(true);
    api.get<any>('/admin/tournaments?status=PENDING_APPROVAL')
      .then(res => {
        const data = res.data;
        setTournaments(Array.isArray(data) ? data : data?.data ?? []);
        setAuthed(true);
      })
      .catch(() => {
        // If 403, token is wrong role → show login
        setAuthed(false);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (getAccessToken()) {
      loadTournaments();
    } else {
      setLoading(false);
    }
  }, []);

  if (!authed && !loading) {
    return <AdminLogin onLogin={loadTournaments} />;
  }

  const handleAction = async (id: string, status: 'ACTIVE' | 'REJECTED', reason?: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/admin/tournaments/${id}/status`, { status, reason });
      setTournaments(prev => prev.filter(t => t.id !== id));
    } catch (err: any) {
      alert(err?.error?.message ?? 'Action failed');
    }
    setActionLoading(null);
  };

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div className="animate-fadeInUp" style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: 4 }}>Admin Dashboard</h1>
        <p style={{ color: 'var(--text-muted)' }}>Review and approve tournament submissions</p>
      </div>

      <div className="animate-fadeInUp delay-100" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: 0 }}>
          Pending Approvals
          <span className="badge badge-warning" style={{ marginLeft: 10 }}>{tournaments.length}</span>
        </h2>
        <a href="/admin/audit-logs" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
          Audit Logs
        </a>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="card card-body">
              <div className="skeleton" style={{ height: 24, width: '50%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 60, width: '100%' }} />
            </div>
          ))}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="card card-body empty-state animate-fadeIn" style={{ padding: 48 }}>
          <div className="empty-state-icon">✅</div>
          <h3>All caught up!</h3>
          <p style={{ marginTop: 8 }}>No tournaments waiting for approval.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {tournaments.map((t, i) => (
            <div key={t.id} className="card card-body animate-fadeInUp" style={{ animationDelay: `${i * 80}ms` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 250 }}>
                  <h3 style={{ fontSize: '1.15rem', marginBottom: 6 }}>{t.title}</h3>
                  <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12, flexWrap: 'wrap' }}>
                    <span>🏢 {t.organizer?.academyName}</span>
                    <span>📍 {t.city}</span>
                    <span>🗓 {formatDate(t.startDate)}</span>
                    <span>🏛 {t.venue}</span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {t.categories.map((c, j) => (
                      <span key={j} style={{
                        padding: '3px 10px', background: 'var(--brand-blue-glow)',
                        color: 'var(--brand-blue)', borderRadius: 'var(--radius-full)',
                        fontSize: '0.75rem', fontWeight: 600,
                      }}>
                        {c.name} ({c.maxSeats} seats)
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    onClick={() => handleAction(t.id, 'ACTIVE')}
                    disabled={actionLoading === t.id}
                    className="btn btn-success btn-sm"
                  >
                    {actionLoading === t.id ? '...' : '✓ Approve'}
                  </button>
                  <button
                    onClick={() => {
                      const reason = prompt('Rejection reason:');
                      if (reason) handleAction(t.id, 'REJECTED', reason);
                    }}
                    disabled={actionLoading === t.id}
                    className="btn btn-danger btn-sm"
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
