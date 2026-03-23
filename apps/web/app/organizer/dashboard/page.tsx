'use client';

import { useEffect, useState } from 'react';
import { api, getAccessToken, getUserInfo, decodeJwtRole } from '@/lib/api';
import css from './dashboard.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

interface Tournament {
  id: string;
  title: string;
  status: string;
  city: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  categories: { id: string; name: string; registeredCount: number; maxSeats: number }[];
}

interface Summary {
  totalTournaments: number;
  activeTournaments: number;
  pendingApprovalCount: number;
  createdThisMonth: number;
  totalRegistrations: number;
  pendingPaymentCount: number;
  totalRevenue: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueChangePercent: number;
}

interface RecentReg {
  id: string;
  playerName: string;
  playerInitials: string;
  tournamentName: string;
  tournamentId: string;
  paymentStatus: string;
  registeredAt: string;
  timeAgo: string;
}

interface UpcomingTournament {
  id: string;
  name: string;
  startDate: string;
  venue: string;
  totalSeats: number;
  confirmedRegistrations: number;
  daysUntil: number;
  status: string;
  needsAttention: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════ */

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  if (h >= 17 && h < 21) return 'Good evening';
  return 'Welcome back';
}

function formatRevenue(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(2)}L`;
  return `₹${rupees.toLocaleString('en-IN')}`;
}

function formatDateShort(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: css.badgeDraft,
  PENDING_APPROVAL: css.badgePending,
  APPROVED: css.badgeApproved,
  ACTIVE: css.badgeActive,
  CLOSED: css.badgeClosed,
  CANCELLED: css.badgeCancelled,
  REJECTED: css.badgeCancelled,
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending',
  APPROVED: 'Approved',
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

const AVATAR_COLORS = ['#1A1A1A', '#C41E1E', '#185FA5', '#3B6D11', '#854F0B'];

/* ═══════════════════════════════════════════════════════════════════════
   Page
   ═══════════════════════════════════════════════════════════════════════ */

export default function OrganizerDashboard() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [recent, setRecent] = useState<RecentReg[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTournament[]>([]);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { window.location.href = '/login'; return; }
    // Verify role — an admin token should not access organizer pages
    const role = getUserInfo()?.role ?? decodeJwtRole(token);
    if (role !== 'ORGANIZER') { window.location.href = '/'; return; }
    const user = getUserInfo();
    setDisplayName(user?.displayName ?? '');

    Promise.all([
      api.get<Summary>('/organizer/dashboard/summary'),
      api.get<any>('/organizer/tournaments?limit=5'),
      api.get<{ registrations: RecentReg[] }>('/organizer/dashboard/recent-registrations?limit=5'),
      api.get<{ tournaments: UpcomingTournament[] }>('/organizer/dashboard/upcoming?limit=3'),
    ])
      .then(([sumRes, tourRes, recentRes, upRes]) => {
        setSummary(sumRes.data);
        const td = tourRes.data;
        setTournaments(Array.isArray(td) ? td : td?.tournaments ?? []);
        setRecent(recentRes.data.registrations ?? []);
        setUpcoming(upRes.data.tournaments ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const greeting = getGreeting();
  const isNewOrganizer = !loading && summary?.totalTournaments === 0;

  /* ── Skeleton ────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className={`container ${css.page}`} data-testid="organizer-dashboard">
        {/* Header skeleton */}
        <div className={css.header}>
          <div>
            <div className={css.skeleton} style={{ width: 220, height: 20, marginBottom: 8 }} />
            <div className={css.skeleton} style={{ width: 300, height: 12 }} />
          </div>
        </div>
        {/* Stats skeleton */}
        <div className={css.statsGrid}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={css.statCard}>
              <div className={css.skeleton} style={{ width: 60, height: 22, marginBottom: 6 }} />
              <div className={css.skeleton} style={{ width: 100, height: 10, marginBottom: 4 }} />
              <div className={css.skeleton} style={{ width: 80, height: 8 }} />
            </div>
          ))}
        </div>
        {/* Columns skeleton */}
        <div className={css.columns}>
          <div className={css.card}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
                <div className={css.skeleton} style={{ flex: 1, height: 14 }} />
                <div className={css.skeleton} style={{ width: 50, height: 14 }} />
              </div>
            ))}
          </div>
          <div className={css.rightCol}>
            <div className={css.card}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'center' }}>
                  <div className={css.skeleton} style={{ width: 44, height: 44, borderRadius: 8 }} />
                  <div style={{ flex: 1 }}>
                    <div className={css.skeleton} style={{ width: '70%', height: 12, marginBottom: 4 }} />
                    <div className={css.skeleton} style={{ width: '50%', height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
            <div className={css.card}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '7px 0', alignItems: 'center' }}>
                  <div className={css.skeletonCircle} />
                  <div style={{ flex: 1 }}>
                    <div className={css.skeleton} style={{ width: '60%', height: 12, marginBottom: 4 }} />
                    <div className={css.skeleton} style={{ width: '40%', height: 10 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Page ─────────────────────────────────────────────────────────── */
  return (
    <div className={`container ${css.page}`} data-testid="organizer-dashboard">
      {/* Header */}
      <div className={css.header}>
        <div>
          <h1 className={css.greeting}>{greeting}, {displayName || 'Organizer'}</h1>
          <p className={css.subtitle}>Here&apos;s what&apos;s happening with your tournaments today</p>
        </div>
        <a href="/organizer/tournaments/new" className={css.createBtn} data-testid="create-tournament-btn">
          + Create Tournament
        </a>
      </div>

      {/* Attention banner */}
      {summary && summary.pendingApprovalCount > 0 && (
        <div className={css.attention} data-testid="attention-banner">
          <span className={css.attentionDot} />
          <span className={css.attentionText}>
            {summary.pendingApprovalCount} tournament{summary.pendingApprovalCount > 1 ? 's' : ''} pending admin approval.
            Players cannot register until approved.
          </span>
          <a href="/organizer/dashboard" className={css.attentionBtn}>View pending</a>
        </div>
      )}

      {/* Stats */}
      {summary && (
        <div className={css.statsGrid}>
          <div className={css.statCard} data-testid="stat-total-tournaments">
            <div className={css.statValue}>{summary.totalTournaments}</div>
            <div className={css.statLabel}>Total tournaments</div>
            <div className={css.statSub} style={{ color: 'var(--color-text-tertiary, #888)' }}>
              {summary.createdThisMonth} this month
            </div>
          </div>
          <div className={css.statCard} data-testid="stat-active">
            <div className={css.statValue} style={{ color: summary.activeTournaments > 0 ? 'var(--color-text-success, #3B6D11)' : undefined }}>
              {summary.activeTournaments}
            </div>
            <div className={css.statLabel}>Active now</div>
            <div className={css.statSub} style={{ color: summary.activeTournaments > 0 ? 'var(--color-text-success, #3B6D11)' : 'var(--color-text-tertiary, #888)' }}>
              {summary.activeTournaments > 0 ? 'Registration open' : 'No active tournaments'}
            </div>
          </div>
          <div className={css.statCard} data-testid="stat-registrations">
            <div className={css.statValue}>{summary.totalRegistrations}</div>
            <div className={css.statLabel}>Total registrations</div>
            <div className={css.statSub} style={{ color: summary.pendingPaymentCount > 0 ? '#854F0B' : 'var(--color-text-success, #3B6D11)' }}>
              {summary.pendingPaymentCount > 0 ? `${summary.pendingPaymentCount} pending payment` : 'All confirmed'}
            </div>
          </div>
          <div className={css.statCard} data-testid="stat-revenue">
            <div className={css.statValue} style={{ color: '#C41E1E' }}>
              {formatRevenue(summary.totalRevenue)}
            </div>
            <div className={css.statLabel}>Total revenue</div>
            <div className={css.statSub} style={{
              color: summary.revenueChangePercent > 0
                ? 'var(--color-text-success, #3B6D11)'
                : summary.revenueChangePercent < 0
                  ? '#C41E1E'
                  : 'var(--color-text-tertiary, #888)',
            }}>
              {summary.revenueChangePercent > 0 && `↑ ${summary.revenueChangePercent}% vs last month`}
              {summary.revenueChangePercent < 0 && `↓ ${Math.abs(summary.revenueChangePercent)}% vs last month`}
              {summary.revenueChangePercent === 0 && 'No change'}
            </div>
          </div>
        </div>
      )}

      {/* Empty state for new organizers */}
      {isNewOrganizer ? (
        <div className={css.emptyState} data-testid="empty-state">
          <div className={css.emptyIcon}>♚</div>
          <div className={css.emptyTitle}>Welcome to KingSquare</div>
          <div className={css.emptySub}>Create your first tournament to get started</div>
          <a href="/organizer/tournaments/new" className={`${css.createBtn} ${css.emptyBtn}`}>
            + Create Tournament
          </a>
        </div>
      ) : (
        /* Two column grid */
        <div className={css.columns}>
          {/* Left — Tournaments table */}
          <div className={css.card} data-testid="tournaments-table">
            <div className={css.cardHeader}>
              <span className={css.cardTitle}>Your tournaments</span>
              <a href="/organizer/dashboard" className={css.cardLink}>View all →</a>
            </div>
            {tournaments.length === 0 ? (
              <div className={css.emptyInline}>No tournaments yet. Create your first one.</div>
            ) : (
              <table className={css.dashTable}>
                <thead>
                  <tr>
                    <th className={css.dashTh}>Tournament</th>
                    <th className={`${css.dashTh} ${css.colHideTablet}`}>Date</th>
                    <th className={css.dashTh}>Status</th>
                    <th className={`${css.dashTh} ${css.colHideMobile}`}>Regs</th>
                    <th className={css.dashTh} style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {tournaments.slice(0, 5).map((t, i) => {
                    const confirmed = t.categories.reduce((s, c) => s + c.registeredCount, 0);
                    const totalSeats = t.categories.reduce((s, c) => s + c.maxSeats, 0);
                    const badgeCls = STATUS_BADGE[t.status] ?? css.badgeDraft;
                    return (
                      <tr key={t.id} className={css.dashTr} data-testid={`tournament-row-${i}`}>
                        <td className={css.dashTd}>
                          <span className={css.tournamentName}>{t.title}</span>
                        </td>
                        <td className={`${css.dashTd} ${css.colHideTablet}`} style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>
                          {formatDateShort(t.startDate)}
                        </td>
                        <td className={css.dashTd}>
                          <span className={`${css.badge} ${badgeCls}`}>
                            {STATUS_LABELS[t.status] ?? t.status}
                          </span>
                        </td>
                        <td className={`${css.dashTd} ${css.colHideMobile}`} style={{ fontWeight: confirmed > 0 ? 500 : undefined, color: confirmed === 0 ? 'var(--color-text-tertiary, #888)' : undefined }}>
                          {confirmed}/{totalSeats}
                        </td>
                        <td className={css.dashTd}>
                          <button className={css.viewBtn} onClick={() => { window.location.href = `/organizer/tournaments/${t.id}/registrations`; }}>
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Right column */}
          <div className={css.rightCol}>
            {/* Upcoming */}
            <div className={css.card} data-testid="upcoming-card">
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>Upcoming tournaments</span>
              </div>
              {upcoming.length === 0 ? (
                <div className={css.emptyInline}>No upcoming tournaments</div>
              ) : (
                upcoming.slice(0, 3).map(t => (
                  <div key={t.id} className={css.upcomingRow}>
                    <div className={`${css.daysBadge} ${t.needsAttention ? css.daysBadgeAttention : css.daysBadgeDefault}`}>
                      <span className={css.daysNumber}>{t.daysUntil}</span>
                      <span className={css.daysLabel}>days</span>
                    </div>
                    <div className={css.upcomingInfo}>
                      <div className={css.upcomingName}>{t.name}</div>
                      <div className={css.upcomingMeta}>{t.venue} · {t.totalSeats} seats</div>
                    </div>
                    <div className={css.upcomingRegs} style={{ color: t.confirmedRegistrations > 0 ? '#C41E1E' : 'var(--color-text-tertiary, #888)' }}>
                      {t.confirmedRegistrations} reg
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Recent registrations */}
            <div className={css.card} data-testid="recent-registrations-card">
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>Recent registrations</span>
                {tournaments.length > 0 && (
                  <a
                    href={`/organizer/tournaments/${tournaments[0]?.id}/registrations`}
                    className={css.cardLink}
                  >
                    View all →
                  </a>
                )}
              </div>
              {recent.length === 0 ? (
                <div className={css.emptyInline}>No registrations yet</div>
              ) : (
                recent.slice(0, 4).map((r, i) => (
                  <div key={r.id} className={css.recentRow}>
                    <div className={css.avatar} style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                      {r.playerInitials}
                    </div>
                    <div className={css.recentInfo}>
                      <div className={css.recentName}>{r.playerName}</div>
                      <div className={css.recentTournament}>{r.tournamentName}</div>
                    </div>
                    <div className={css.recentRight}>
                      <span className={`${css.badge} ${r.paymentStatus === 'CONFIRMED' ? css.badgeConfirmed : css.badgePendingPay}`}>
                        {r.paymentStatus === 'CONFIRMED' ? 'Confirmed' : 'Pending'}
                      </span>
                      <div className={css.recentTime}>{r.timeAgo}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
