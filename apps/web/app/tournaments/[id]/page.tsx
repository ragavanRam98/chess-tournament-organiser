'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

/* ── Types ─────────────────────────────────────────────────────────── */

interface Category {
  id: string; name: string; minAge: number; maxAge: number;
  maxSeats: number; registeredCount: number; entryFeePaise: number;
}

interface Tournament {
  id: string; title: string; description: string | null; city: string; venue: string;
  startDate: string; endDate: string; registrationDeadline: string; status: string;
  organizer: { academyName: string; city: string };
  categories: Category[];
  posterUrl?: string | null;
}

interface Participant {
  entry_number: string;
  player_name: string;
  city: string;
  category: string;
}

interface ParticipantsData {
  participants: Participant[];
  meta: {
    total_confirmed: number;
    total_seats: number;
    by_category: { name: string; registered: number; max_seats: number; seats_remaining: number }[];
    status?: string;
    message?: string;
  };
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatCurrency(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/* ── Live Data Types ────────────────────────────────────────────────── */

interface LivePairing {
  board: number;
  whiteName: string;
  whiteRtg: number | null;
  result: string;
  blackName: string;
  blackRtg: number | null;
}

interface LiveStanding {
  rank: number;
  startNo: number;
  name: string;
  rating: number | null;
  points: number;
}

interface LiveRound {
  roundNumber: number;
  pairings: LivePairing[] | null;
  standings: LiveStanding[] | null;
  isFinal: boolean;
}

interface LiveCategory {
  id: string;
  category: { id: string; name: string } | null;
  chessResultsUrl: string;
  totalRounds: number | null;
  lastSyncedAt: string | null;
  syncStatus: string;
  rounds: LiveRound[];
  crossTable: any | null;
}

/* ── Page ───────────────────────────────────────────────────────────── */

type Tab = 'categories' | 'participants' | 'live';

export default function TournamentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('categories');
  const [participants, setParticipants] = useState<ParticipantsData | null>(null);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [sortField, setSortField] = useState<'entry_number' | 'player_name' | 'city' | 'category'>('entry_number');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [participantSearch, setParticipantSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  // Live data
  const [liveData, setLiveData] = useState<LiveCategory[] | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveChecked, setLiveChecked] = useState(false);
  const [liveRound, setLiveRound] = useState(1);
  const [liveView, setLiveView] = useState<'pairings' | 'standings'>('standings');
  const [liveCatIdx, setLiveCatIdx] = useState(0);

  useEffect(() => {
    api.get<Tournament>(`/tournaments/${id}`)
      .then(res => setTournament(res.data))
      .catch(() => setTournament(null))
      .finally(() => setLoading(false));
  }, [id]);

  // Lazy-load participants when that tab is first opened.
  useEffect(() => {
    if (activeTab !== 'participants' || participants !== null) return;
    setParticipantsLoading(true);
    api.get<ParticipantsData>(`/tournaments/${id}/participants`)
      .then(res => setParticipants(res.data))
      .catch(() => setParticipants({ participants: [], meta: { total_confirmed: 0, total_seats: 0, by_category: [], message: 'Failed to load participants' } }))
      .finally(() => setParticipantsLoading(false));
  }, [activeTab, id, participants]);

  // Check for live data availability on mount
  useEffect(() => {
    if (liveChecked) return;
    api.get<LiveCategory[] | null>(`/tournaments/${id}/live`)
      .then(res => {
        setLiveData(res.data);
        if (res.data && res.data.length > 0) {
          const latest = res.data[0];
          const maxRd = latest.rounds.length > 0
            ? Math.max(...latest.rounds.map(r => r.roundNumber))
            : 1;
          setLiveRound(maxRd);
        }
      })
      .catch(() => setLiveData(null))
      .finally(() => setLiveChecked(true));
  }, [id, liveChecked]);

  // Lazy-load live data when tab is opened (refresh)
  useEffect(() => {
    if (activeTab !== 'live' || !liveData) return;
    setLiveLoading(true);
    api.get<LiveCategory[] | null>(`/tournaments/${id}/live`)
      .then(res => {
        if (res.data) setLiveData(res.data);
      })
      .catch(() => {})
      .finally(() => setLiveLoading(false));
  }, [activeTab, id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sort + filter helper ─────────────────────────────────────────── */
  const displayedParticipants = participants
    ? [...participants.participants]
        .filter(p =>
          !participantSearch ||
          p.player_name.toLowerCase().includes(participantSearch.toLowerCase()) ||
          p.entry_number.toLowerCase().includes(participantSearch.toLowerCase()) ||
          p.city.toLowerCase().includes(participantSearch.toLowerCase())
        )
        .sort((a, b) => {
          const av = a[sortField]; const bv = b[sortField];
          return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
        })
    : [];

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sortIcon = (field: typeof sortField) => {
    if (sortField !== field) return <span style={{ opacity: 0.3, fontSize: '0.7rem' }}>↕</span>;
    return <span style={{ fontSize: '0.7rem' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  /* ── Loading state ────────────────────────────────────────────────── */
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
        <Link href="/" className="btn btn-primary" style={{ marginTop: 24 }}>← Back to tournaments</Link>
      </div>
    );
  }

  const deadlinePassed = new Date(tournament.registrationDeadline) < new Date();

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        ← All tournaments
      </Link>

      {/* ── Poster banner ─────────────────────────────────────────── */}
      {tournament.posterUrl && (
        <div className="animate-fadeInUp" style={{
          marginBottom: 28, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          border: '1px solid var(--ks-border)', maxHeight: 360,
        }}>
          <img
            src={tournament.posterUrl}
            alt={`${tournament.title} poster`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* ── Title block ──────────────────────────────────────────── */}
      <div className="animate-fadeInUp">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span className={`badge ${tournament.status === 'ACTIVE' ? 'badge-success' : 'badge-neutral'}`}>
            {tournament.status}
          </span>
          {deadlinePassed && <span className="badge badge-danger">Registration closed</span>}
        </div>
        <h1 style={{ fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', marginBottom: 8 }}>{tournament.title}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>
          Organized by <strong>{tournament.organizer?.academyName}</strong>
        </p>
      </div>

      {/* ── Info cards ───────────────────────────────────────────── */}
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

      {/* ── Description ──────────────────────────────────────────── */}
      {tournament.description && (
        <div className="card card-body animate-fadeInUp delay-200" style={{ marginBottom: 32 }}>
          <h3 style={{ marginBottom: 12 }}>About this tournament</h3>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>{tournament.description}</p>
        </div>
      )}

      {/* ── Tab bar ──────────────────────────────────────────────── */}
      <div className="animate-fadeInUp delay-300">
        <div style={{
          display: 'flex',
          gap: 4,
          borderBottom: '2px solid var(--border-subtle)',
          marginBottom: 24,
        }}>
          {(
            (liveData && liveData.length > 0
              ? ['categories', 'participants', 'live'] as Tab[]
              : ['categories', 'participants'] as Tab[])
          ).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--brand-blue)' : '2px solid transparent',
                marginBottom: -2,
                cursor: 'pointer',
                fontFamily: "'Inter', sans-serif",
                fontWeight: 600,
                fontSize: '0.9rem',
                color: activeTab === tab ? 'var(--brand-blue)' : 'var(--text-muted)',
                transition: 'all var(--duration-fast) var(--ease-out)',
                whiteSpace: 'nowrap',
              }}
            >
              {tab === 'categories' ? '🏷 Categories & Seats' : tab === 'participants' ? '👥 Participants' : '📡 Live'}
              {tab === 'participants' && participants && (
                <span style={{
                  marginLeft: 6, fontSize: '0.75rem', fontWeight: 700,
                  padding: '1px 7px', borderRadius: 'var(--radius-full)',
                  background: activeTab === 'participants' ? 'var(--brand-blue-glow)' : 'var(--bg-secondary)',
                  color: activeTab === 'participants' ? 'var(--brand-blue)' : 'var(--text-muted)',
                }}>
                  {participants.meta.total_confirmed}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab: Categories ──────────────────────────────────── */}
        {activeTab === 'categories' && (
          <div>
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
                              : `${c.minAge}–${c.maxAge} years`}
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
                            <Link href={`/tournaments/${id}/register?category=${c.id}`} className="btn btn-primary btn-sm">
                              Register
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab: Participants ─────────────────────────────────── */}
        {activeTab === 'participants' && (
          <div>
            {participantsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 44, borderRadius: 'var(--radius-md)' }} />
                ))}
              </div>
            ) : participants?.meta.message ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔒</div>
                <h3>{participants.meta.message}</h3>
                <p style={{ marginTop: 8, fontSize: '0.9rem' }}>Participants will be listed once the tournament is open.</p>
              </div>
            ) : (
              <>
                {/* Summary stats row */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
                  <div className="card card-body" style={{ flex: '1 1 160px', textAlign: 'center', padding: '14px 20px' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--brand-blue)' }}>
                      {participants?.meta.total_confirmed ?? 0}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>Confirmed</div>
                  </div>
                  <div className="card card-body" style={{ flex: '1 1 160px', textAlign: 'center', padding: '14px 20px' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--brand-emerald)' }}>
                      {(participants?.meta.total_seats ?? 0) - (participants?.meta.total_confirmed ?? 0)}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>Seats remaining</div>
                  </div>
                  {participants?.meta.by_category.map(c => (
                    <div key={c.name} className="card card-body" style={{ flex: '1 1 140px', textAlign: 'center', padding: '14px 20px' }}>
                      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>{c.registered}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{c.name} ({c.max_seats} seats)</div>
                    </div>
                  ))}
                </div>

                {/* Search */}
                <div style={{ marginBottom: 16 }}>
                  <input
                    type="search"
                    placeholder="Search by name, entry number, or city…"
                    value={participantSearch}
                    onChange={e => { setParticipantSearch(e.target.value); setCurrentPage(1); }}
                    className="form-input"
                    style={{ maxWidth: 400 }}
                  />
                </div>

                {displayedParticipants.length === 0 ? (
                  <div className="empty-state" style={{ padding: '40px 0' }}>
                    <div className="empty-state-icon">👤</div>
                    <h3>No participants yet</h3>
                    <p style={{ marginTop: 8 }}>
                      {participantSearch ? 'No results for that search.' : 'Be the first to register!'}
                    </p>
                  </div>
                ) : (() => {
                  const totalPages = Math.ceil(displayedParticipants.length / PAGE_SIZE);
                  const paginated = displayedParticipants.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
                  return (
                    <div className="table-wrapper">
                      <table className="table">
                        <thead>
                          <tr>
                            {(
                              [
                                ['entry_number', 'Entry No.'],
                                ['player_name', 'Player Name'],
                                ['category', 'Category'],
                                ['city', 'City'],
                              ] as [typeof sortField, string][]
                            ).map(([field, label]) => (
                              <th
                                key={field}
                                onClick={() => toggleSort(field)}
                                style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                              >
                                {label} {sortIcon(field)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {paginated.map(p => (
                            <tr key={p.entry_number}>
                              <td>
                                <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: 'var(--brand-blue)' }}>
                                  {p.entry_number}
                                </span>
                              </td>
                              <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.player_name}</td>
                              <td>
                                <span className="badge badge-info" style={{ fontSize: '0.75rem' }}>{p.category}</span>
                              </td>
                              <td>{p.city}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Footer: count + pagination */}
                      <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, displayedParticipants.length)} of {displayedParticipants.length} participants
                          {participantSearch && ` (filtered from ${participants?.meta.total_confirmed})`}
                        </span>
                        {totalPages > 1 && (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <button
                              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '4px 10px' }}
                            >
                              ← Prev
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1)
                              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                                if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('...');
                                acc.push(p);
                                return acc;
                              }, [])
                              .map((p, i) =>
                                p === '...'
                                  ? <span key={`ellipsis-${i}`} style={{ padding: '0 4px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>…</span>
                                  : <button
                                      key={p}
                                      onClick={() => setCurrentPage(p as number)}
                                      className={`btn btn-sm ${currentPage === p ? 'btn-primary' : 'btn-ghost'}`}
                                      style={{ padding: '4px 10px', minWidth: 32 }}
                                    >
                                      {p}
                                    </button>
                              )}
                            <button
                              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                              disabled={currentPage === totalPages}
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '4px 10px' }}
                            >
                              Next →
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                <p style={{ marginTop: 16, fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Only confirmed (paid) registrations are shown. Phone, email, and FIDE ID are not displayed to protect player privacy.
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Tab: Live ────────────────────────────────────────────── */}
        {activeTab === 'live' && liveData && liveData.length > 0 && (() => {
          const cat = liveData[liveCatIdx] ?? liveData[0];
          if (!cat) return null;
          const roundData = cat.rounds.find(r => r.roundNumber === liveRound);
          const pairings = (roundData?.pairings ?? []) as LivePairing[];
          const standings = (roundData?.standings ?? []) as LiveStanding[];
          const maxRound = cat.totalRounds ?? (cat.rounds.length > 0 ? Math.max(...cat.rounds.map(r => r.roundNumber)) : 1);

          return (
            <div>
              {liveLoading && (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
                  Refreshing live data...
                </div>
              )}

              {/* Category selector (if multiple) */}
              {liveData.length > 1 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                  {liveData.map((lc, i) => (
                    <button
                      key={lc.id}
                      onClick={() => { setLiveCatIdx(i); setLiveRound(1); }}
                      className={`btn btn-sm ${liveCatIdx === i ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ fontSize: '0.8rem' }}
                    >
                      {lc.category?.name ?? 'All'}
                    </button>
                  ))}
                </div>
              )}

              {/* Round selector + view toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, marginRight: 4 }}>Round:</span>
                  {Array.from({ length: maxRound }, (_, i) => i + 1).map(rd => (
                    <button
                      key={rd}
                      onClick={() => setLiveRound(rd)}
                      className={`btn btn-sm ${liveRound === rd ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ minWidth: 32, padding: '4px 8px', fontSize: '0.8rem' }}
                    >
                      {rd}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
                  <button
                    onClick={() => setLiveView('standings')}
                    className={`btn btn-sm ${liveView === 'standings' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.8rem' }}
                  >
                    Standings
                  </button>
                  <button
                    onClick={() => setLiveView('pairings')}
                    className={`btn btn-sm ${liveView === 'pairings' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ fontSize: '0.8rem' }}
                  >
                    Pairings
                  </button>
                </div>
              </div>

              {/* Standings view */}
              {liveView === 'standings' && (
                standings.length > 0 ? (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}>Rank</th>
                          <th>Name</th>
                          <th style={{ width: 70 }}>Rtg</th>
                          <th style={{ width: 60 }}>Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((s, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 700, color: s.rank <= 3 ? 'var(--brand-gold)' : 'var(--text-primary)' }}>
                              {s.rank}
                            </td>
                            <td style={{ fontWeight: 600 }}>{s.name}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{s.rating ?? '—'}</td>
                            <td style={{ fontWeight: 700, color: 'var(--brand-blue)' }}>{s.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '40px 0' }}>
                    <div className="empty-state-icon">📊</div>
                    <h3>No standings yet</h3>
                    <p style={{ marginTop: 8, fontSize: '0.9rem' }}>Standings for round {liveRound} are not available yet.</p>
                  </div>
                )
              )}

              {/* Pairings view */}
              {liveView === 'pairings' && (
                pairings.length > 0 ? (
                  <div className="table-wrapper">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}>Bd</th>
                          <th>White</th>
                          <th style={{ width: 70 }}>Rtg</th>
                          <th style={{ width: 70, textAlign: 'center' }}>Result</th>
                          <th style={{ width: 70 }}>Rtg</th>
                          <th>Black</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pairings.map((p, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{p.board}</td>
                            <td style={{ fontWeight: 600 }}>{p.whiteName}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{p.whiteRtg ?? '—'}</td>
                            <td style={{
                              textAlign: 'center', fontWeight: 700,
                              color: p.result.includes('1') || p.result.includes('0')
                                ? 'var(--brand-emerald)' : 'var(--text-muted)',
                            }}>
                              {p.result || '—'}
                            </td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{p.blackRtg ?? '—'}</td>
                            <td style={{ fontWeight: 600 }}>{p.blackName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: '40px 0' }}>
                    <div className="empty-state-icon">♟</div>
                    <h3>No pairings yet</h3>
                    <p style={{ marginTop: 8, fontSize: '0.9rem' }}>Pairings for round {liveRound} are not available yet.</p>
                  </div>
                )
              )}

              {/* Sync info + link */}
              <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {cat.lastSyncedAt && (
                  <span>Last updated: {new Date(cat.lastSyncedAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
                )}
                <a href={cat.chessResultsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--brand-blue)' }}>
                  View on chess-results.com →
                </a>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
