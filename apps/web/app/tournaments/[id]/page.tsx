'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface Category {
  id: string; name: string; minAge: number; maxAge: number;
  maxSeats: number; registeredCount: number; entryFeePaise: number;
}

interface Tournament {
  id: string; title: string; description: string | null; city: string; venue: string;
  startDate: string; endDate: string; registrationDeadline: string; status: string;
  organizer: { academyName: string; city: string };
  categories: Category[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatCurrency(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function TournamentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Tournament>(`/tournaments/${id}`)
      .then(res => setTournament(res.data))
      .catch(() => setTournament(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="container" style={{ padding: '60px 24px' }}>
        <div className="skeleton" style={{ height: 40, width: '60%', marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 20, width: '40%', marginBottom: 32 }} />
        <div className="skeleton" style={{ height: 200, width: '100%' }} />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="container empty-state" style={{ padding: '80px 24px' }}>
        <div className="empty-state-icon">🔍</div>
        <h3>Tournament not found</h3>
        <p style={{ marginTop: 8 }}>The tournament you&apos;re looking for doesn&apos;t exist or has been removed.</p>
        <a href="/" className="btn btn-primary" style={{ marginTop: 24 }}>← Back to tournaments</a>
      </div>
    );
  }

  const deadlinePassed = new Date(tournament.registrationDeadline) < new Date();

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      {/* ── Back link ─────────── */}
      <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        ← All tournaments
      </a>

      {/* ── Title block ────────── */}
      <div className="animate-fadeInUp">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span className={`badge ${tournament.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}>
            {tournament.status}
          </span>
          {deadlinePassed && <span className="badge badge-danger">Registration closed</span>}
        </div>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', marginBottom: 8 }}>{tournament.title}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Organized by <strong>{tournament.organizer?.academyName}</strong></p>
      </div>

      {/* ── Info cards row ─────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, margin: '32px 0' }} className="animate-fadeInUp delay-100">
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>🗓</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{formatDate(tournament.startDate)}</div>
          {tournament.startDate !== tournament.endDate && (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>to {formatDate(tournament.endDate)}</div>
          )}
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Tournament Dates</div>
        </div>
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>📍</div>
          <div style={{ fontWeight: 700, fontSize: '1rem' }}>{tournament.venue}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{tournament.city}</div>
        </div>
        <div className="card card-body" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: 4 }}>⏰</div>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: deadlinePassed ? 'var(--brand-rose)' : 'var(--brand-gold)' }}>
            {formatDate(tournament.registrationDeadline)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Registration Deadline</div>
        </div>
      </div>

      {/* ── Description ────────── */}
      {tournament.description && (
        <div className="card card-body animate-fadeInUp delay-200" style={{ marginBottom: 32 }}>
          <h3 style={{ marginBottom: 12 }}>About this tournament</h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{tournament.description}</p>
        </div>
      )}

      {/* ── Categories table ───── */}
      <div className="animate-fadeInUp delay-300">
        <h2 style={{ marginBottom: 16, fontSize: '1.3rem' }}>Categories & Seats</h2>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Age Range</th>
                <th>Entry Fee</th>
                <th>Availability</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tournament.categories.map(c => {
                const fillPct = c.maxSeats ? Math.round((c.registeredCount / c.maxSeats) * 100) : 0;
                const seatsFull = c.registeredCount >= c.maxSeats;

                return (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</td>
                    <td>
                      {c.minAge === 0 && c.maxAge >= 999
                        ? 'Open'
                        : c.minAge === 0
                          ? `Under ${c.maxAge}`
                          : `${c.minAge}–${c.maxAge} years`
                      }
                    </td>
                    <td style={{ fontWeight: 600, color: 'var(--brand-emerald)' }}>
                      {c.entryFeePaise === 0 ? 'Free' : formatCurrency(c.entryFeePaise)}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div className="progress-bar" style={{ flex: 1 }}>
                          <div
                            className={`progress-fill ${fillPct > 85 ? 'danger' : fillPct > 60 ? 'warning' : ''}`}
                            style={{ width: `${fillPct}%` }}
                          />
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {c.registeredCount}/{c.maxSeats}
                        </span>
                      </div>
                    </td>
                    <td>
                      {seatsFull ? (
                        <span className="badge badge-danger">Full</span>
                      ) : deadlinePassed ? (
                        <span className="badge badge-neutral">Closed</span>
                      ) : (
                        <a href={`/tournaments/${id}/register?category=${c.id}`} className="btn btn-primary btn-sm">
                          Register
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
