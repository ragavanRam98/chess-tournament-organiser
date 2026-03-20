'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, getAccessToken } from '@/lib/api';

interface Registration {
  id: string; entryNumber: string; playerName: string; phone: string; email: string | null;
  city: string | null; status: string; registeredAt: string; confirmedAt: string | null;
  category: { name: string };
}

const statusMap: Record<string, { cls: string }> = {
  CONFIRMED: { cls: 'badge-success' },
  PENDING_PAYMENT: { cls: 'badge-warning' },
  CANCELLED: { cls: 'badge-danger' },
  EXPIRED: { cls: 'badge-neutral' },
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function OrganizerRegistrationsPage() {
  const params = useParams();
  const tournamentId = params.id as string;
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!getAccessToken()) { window.location.href = '/organizer/login'; return; }
    api.get<any>(`/organizer/tournaments/${tournamentId}/registrations`)
      .then(res => {
        const data = res.data;
        setRegistrations(Array.isArray(data) ? data : data?.registrations ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tournamentId]);

  const filteredRegs = filter
    ? registrations.filter(r => r.status === filter)
    : registrations;

  const handleExport = async () => {
    setExporting(true);
    setExportMsg('');
    try {
      const res = await api.post<{ id: string }>(`/organizer/tournaments/${tournamentId}/exports`, { format: 'XLSX' });
      const jobId = res.data.id;
      setExportMsg('Export queued — polling for download link...');

      // Poll for completion (max 30 attempts, 3s interval)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await api.get<any>(`/organizer/exports/${jobId}`);
        if (status.data.status === 'DONE' && status.data.download_url) {
          setExportMsg('');
          window.open(status.data.download_url, '_blank');
          setExporting(false);
          return;
        }
        if (status.data.status === 'FAILED') {
          setExportMsg('Export failed. Please try again.');
          setExporting(false);
          return;
        }
      }
      setExportMsg('Export is taking longer than expected. Check back later.');
    } catch {
      setExportMsg('Export request failed.');
    }
    setExporting(false);
  };

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <a href="/organizer/dashboard" style={{ display: 'inline-flex', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        ← Back to Dashboard
      </a>

      <div className="flex-between animate-fadeInUp" style={{ marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Registrations</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{registrations.length} total registrations</p>
        </div>
        <button onClick={handleExport} disabled={exporting} className="btn btn-secondary">
          {exporting ? '📦 Exporting...' : '📥 Export to Excel'}
        </button>
      </div>

      {exportMsg && (
        <div style={{ padding: '10px 16px', background: 'var(--brand-blue-glow)', borderRadius: 'var(--radius-md)', marginBottom: 16, fontSize: '0.9rem', color: 'var(--brand-blue)' }}>
          {exportMsg}
        </div>
      )}

      {/* Status filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }} className="animate-fadeInUp delay-100">
        {['', 'CONFIRMED', 'PENDING_PAYMENT', 'CANCELLED', 'EXPIRED'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8rem' }}>
            {s || 'All'} {s ? `(${registrations.filter(r => r.status === s).length})` : `(${registrations.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="skeleton" style={{ height: 300 }} />
      ) : filteredRegs.length === 0 ? (
        <div className="empty-state animate-fadeIn">
          <div className="empty-state-icon">📋</div>
          <h3>No registrations found</h3>
        </div>
      ) : (
        <div className="table-wrapper animate-fadeInUp delay-200">
          <table className="table">
            <thead>
              <tr>
                <th>Entry #</th>
                <th>Player</th>
                <th>Category</th>
                <th>Phone</th>
                <th>City</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredRegs.map(r => {
                const badge = statusMap[r.status] ?? statusMap.PENDING_PAYMENT;
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700, fontFamily: "'Inter', sans-serif", color: 'var(--brand-blue)' }}>{r.entryNumber}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.playerName}</td>
                    <td>{r.category?.name}</td>
                    <td>{r.phone}</td>
                    <td>{r.city ?? '—'}</td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{r.status.replace('_', ' ')}</span>
                    </td>
                    <td>{formatDate(r.registeredAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
