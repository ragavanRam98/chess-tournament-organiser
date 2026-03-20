'use client';

import { useEffect, useState } from 'react';
import { api, getAccessToken } from '@/lib/api';

interface Tournament {
  id: string; title: string; city: string; venue: string;
  startDate: string; status: string;
  organizer: { academyName: string; city: string };
  categories: { name: string; maxSeats: number }[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AdminDashboard() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!getAccessToken()) { window.location.href = '/organizer/login'; return; }

    api.get<any>('/admin/tournaments?status=PENDING_APPROVAL')
      .then(res => {
        const data = res.data;
        setTournaments(Array.isArray(data) ? data : data?.data ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

      <div className="animate-fadeInUp delay-100" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>
          Pending Approvals
          <span className="badge badge-warning" style={{ marginLeft: 10 }}>{tournaments.length}</span>
        </h2>
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

                  {/* Categories */}
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
