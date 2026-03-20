'use client';

import { useEffect, useState } from 'react';
import { api, getAccessToken } from '@/lib/api';
import styles from './dashboard.module.css';

interface Tournament {
  id: string; title: string; status: string; city: string;
  startDate: string; endDate: string; registrationDeadline: string;
  categories: { id: string; name: string; registeredCount: number; maxSeats: number }[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const statusMap: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Draft', cls: 'badge-neutral' },
  PENDING_APPROVAL: { label: 'Pending Approval', cls: 'badge-warning' },
  ACTIVE: { label: 'Active', cls: 'badge-success' },
  COMPLETED: { label: 'Completed', cls: 'badge-info' },
  CANCELLED: { label: 'Cancelled', cls: 'badge-danger' },
  REJECTED: { label: 'Rejected', cls: 'badge-danger' },
};

export default function OrganizerDashboard() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getAccessToken()) {
      window.location.href = '/organizer/login';
      return;
    }
    api.get<any>('/organizer/tournaments')
      .then(res => {
        const data = res.data;
        setTournaments(Array.isArray(data) ? data : data?.tournaments ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const stats = {
    total: tournaments.length,
    active: tournaments.filter(t => t.status === 'ACTIVE').length,
    totalRegs: tournaments.reduce((s, t) => s + t.categories.reduce((a, c) => a + c.registeredCount, 0), 0),
  };

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div className="flex-between animate-fadeInUp" style={{ marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: 4 }}>Tournament Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>Manage your tournaments and registrations</p>
        </div>
        <a href="/organizer/tournaments/new" className="btn btn-primary">+ Create Tournament</a>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }} className="animate-fadeInUp delay-100">
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--brand-blue)' }}>{stats.total}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Tournaments</div>
        </div>
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--brand-emerald)' }}>{stats.active}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Active</div>
        </div>
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: "'Inter', sans-serif", color: 'var(--brand-gold)' }}>{stats.totalRegs}</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Registrations</div>
        </div>
      </div>

      {/* Tournament list */}
      {loading ? (
        <div style={{ display: 'grid', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} className="card card-body">
              <div className="skeleton" style={{ height: 24, width: '50%', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 16, width: '70%' }} />
            </div>
          ))}
        </div>
      ) : tournaments.length === 0 ? (
        <div className="empty-state animate-fadeIn">
          <div className="empty-state-icon">🏆</div>
          <h3>No tournaments yet</h3>
          <p style={{ marginBottom: 20 }}>Create your first tournament to get started.</p>
          <a href="/organizer/tournaments/new" className="btn btn-primary">+ Create Tournament</a>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {tournaments.map((t, i) => {
            const totalRegs = t.categories.reduce((s, c) => s + c.registeredCount, 0);
            const totalSeats = t.categories.reduce((s, c) => s + c.maxSeats, 0);
            const badge = statusMap[t.status] ?? statusMap.DRAFT;

            return (
              <div key={t.id} className={`card ${styles.tournamentRow} animate-fadeInUp`} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <h3 style={{ fontSize: '1.1rem' }}>{t.title}</h3>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <span>📍 {t.city}</span>
                      <span>🗓 {formatDate(t.startDate)}</span>
                      <span>👥 {totalRegs}/{totalSeats} registrations</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a href={`/organizer/tournaments/${t.id}/registrations`} className="btn btn-secondary btn-sm">View Registrations</a>
                    <a href={`/tournaments/${t.id}`} className="btn btn-ghost btn-sm">Preview</a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
