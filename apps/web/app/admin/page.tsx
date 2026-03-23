'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import AdminLayout from '@/components/admin/AdminLayout';
import css from './admin.module.css';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface Analytics {
  tournaments: { total: number; active: number; pending_approval: number };
  organizers: { total: number; pending_verification: number };
  registrations: { total: number; confirmed: number };
  revenue_paise: number;
  top_categories: { name: string; tournament: string; registered_count: number }[];
}

interface Tournament {
  id: string; title: string; city: string; venue: string;
  startDate: string; endDate: string; status: string; createdAt: string;
  organizer: { academyName: string; city: string };
  categories: { id: string; name: string; maxSeats: number }[];
}

interface Organizer {
  id: string; academyName: string; contactPhone: string; city: string;
  verifiedAt: string | null; createdAt: string;
  user: { email: string; status: string; createdAt: string };
}

interface IntegrityCheck {
  status: 'ok' | 'warning' | 'error';
  checks: { name: string; status: string; details: string; affectedRows: number }[];
  checkedAt: string;
}

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function formatRevenue(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 100000) return `\u20B9${(rupees / 100000).toFixed(2)}L`;
  if (rupees >= 1000) return `\u20B9${(rupees / 1000).toFixed(1)}K`;
  return `\u20B9${rupees.toLocaleString('en-IN')}`;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatIST(dateStr: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(dateStr));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending', APPROVED: 'Approved',
  ACTIVE: 'Active', CLOSED: 'Closed', CANCELLED: 'Cancelled', REJECTED: 'Rejected',
};

/* ═══════════════════════════════════════════════════════════════════
   Page
   ═══════════════════════════════════════════════════════════════════ */

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [pending, setPending] = useState<Tournament[]>([]);
  const [allTournaments, setAllTournaments] = useState<Tournament[]>([]);
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [integrityData, setIntegrityData] = useState<IntegrityCheck | null>(null);
  const [integrityOpen, setIntegrityOpen] = useState(false);
  const [integrityLoading, setIntegrityLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [analyticsRes, pendingRes, allRes, orgRes] = await Promise.all([
        api.get<Analytics>('/admin/analytics'),
        api.get<Tournament[]>('/admin/tournaments?status=PENDING_APPROVAL&limit=10'),
        api.get<Tournament[]>('/admin/tournaments?limit=5'),
        api.get<Organizer[]>('/admin/organizers?limit=8'),
      ]);

      setAnalytics(analyticsRes.data);

      const pData = pendingRes as unknown as { data: Tournament[] };
      setPending(Array.isArray(pData.data) ? pData.data : []);

      const aData = allRes as unknown as { data: Tournament[] };
      setAllTournaments(Array.isArray(aData.data) ? aData.data : []);

      const oData = orgRes as unknown as { data: Organizer[] };
      setOrganizers(Array.isArray(oData.data) ? oData.data : []);
    } catch {
      // auth errors handled by api wrapper redirect
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Actions ────────────────────────────────────────────────────── */

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await api.patch(`/admin/tournaments/${id}/status`, { status: 'APPROVED' });
      setPending(prev => prev.filter(t => t.id !== id));
      // Refresh analytics to update counts
      api.get<Analytics>('/admin/analytics').then(r => setAnalytics(r.data)).catch(() => {});
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      alert(apiErr?.error?.message ?? 'Approve failed');
    }
    setActionLoading(null);
  };

  const handleReject = async (id: string) => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    setActionLoading(id);
    try {
      await api.patch(`/admin/tournaments/${id}/status`, { status: 'REJECTED', reason });
      setPending(prev => prev.filter(t => t.id !== id));
      api.get<Analytics>('/admin/analytics').then(r => setAnalytics(r.data)).catch(() => {});
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      alert(apiErr?.error?.message ?? 'Reject failed');
    }
    setActionLoading(null);
  };

  const handleVerify = async (orgId: string) => {
    setActionLoading(orgId);
    try {
      await api.patch(`/admin/organizers/${orgId}/verify`);
      setOrganizers(prev => prev.map(o =>
        o.id === orgId ? { ...o, verifiedAt: new Date().toISOString(), user: { ...o.user, status: 'ACTIVE' } } : o
      ));
      api.get<Analytics>('/admin/analytics').then(r => setAnalytics(r.data)).catch(() => {});
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      alert(apiErr?.error?.message ?? 'Verify failed');
    }
    setActionLoading(null);
  };

  const runIntegrityCheck = async () => {
    setIntegrityLoading(true);
    setIntegrityOpen(true);
    try {
      const res = await api.get<IntegrityCheck>('/admin/integrity-check');
      setIntegrityData(res.data);
    } catch {
      setIntegrityData(null);
    }
    setIntegrityLoading(false);
  };

  /* ── Derived data ───────────────────────────────────────────────── */
  const pendingOrgs = organizers.filter(o => o.user.status === 'PENDING_VERIFICATION');
  const verifiedOrgs = organizers.filter(o => o.user.status === 'ACTIVE');

  /* ── Skeleton ──────────────────────────────────────────────────── */
  if (loading) {
    return (
      <AdminLayout activeNav="dashboard">
        <div className={`container ${css.page}`} data-testid="admin-dashboard">
          <div className={css.header}>
            <div>
              <div className={css.skeleton} style={{ width: 200, height: 18, marginBottom: 8 }} />
              <div className={css.skeleton} style={{ width: 180, height: 12 }} />
            </div>
          </div>
          <div className={css.statsGrid}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className={css.statCard}>
                <div className={css.skeleton} style={{ width: 60, height: 22, marginBottom: 6 }} />
                <div className={css.skeleton} style={{ width: 100, height: 10, marginBottom: 4 }} />
                <div className={css.skeleton} style={{ width: 80, height: 8 }} />
              </div>
            ))}
          </div>
          <div className={css.columns}>
            <div className={css.leftCol}>
              <div className={css.card}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 0' }}>
                    <div className={css.skeleton} style={{ flex: 1, height: 14 }} />
                    <div className={css.skeleton} style={{ width: 50, height: 14 }} />
                  </div>
                ))}
              </div>
            </div>
            <div className={css.rightCol}>
              <div className={css.card}>
                {[1, 2, 3].map(i => (
                  <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', alignItems: 'center' }}>
                    <div className={css.skeleton} style={{ width: 30, height: 30, borderRadius: '50%' }} />
                    <div style={{ flex: 1 }}>
                      <div className={css.skeleton} style={{ width: '70%', height: 12, marginBottom: 4 }} />
                      <div className={css.skeleton} style={{ width: '50%', height: 10 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  /* ── Page ────────────────────────────────────────────────────────── */
  return (
    <AdminLayout activeNav="dashboard">
      <div className={`container ${css.page}`} data-testid="admin-dashboard">

        {/* ─── Section 1: Header ───────────────────────────────────── */}
        <div className={css.header}>
          <div>
            <h1 className={css.headerTitle}>Platform Overview</h1>
            <p className={css.headerSub}>KingSquare admin dashboard</p>
          </div>
          <div className={css.headerActions}>
            <a href="/admin/audit-logs" className={css.btnOutline}>Audit Logs</a>
            <button
              className={css.btnDark}
              onClick={runIntegrityCheck}
              disabled={integrityLoading}
              data-testid="integrity-check-btn"
            >
              {integrityLoading ? 'Checking...' : 'Integrity Check'}
            </button>
          </div>
        </div>

        {/* ─── Section 5: Integrity check panel (inline) ──────────── */}
        {integrityOpen && (
          <div className={css.integrityPanel} data-testid="integrity-check-panel">
            <div className={css.integrityHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={css.integrityTitle}>Data integrity check</span>
                {integrityData && (
                  <span className={`${css.integrityBadge} ${
                    integrityData.status === 'ok' ? css.integrityOk
                    : integrityData.status === 'warning' ? css.integrityWarn
                    : css.integrityErr
                  }`}>
                    {integrityData.status === 'ok' ? 'All checks passed'
                     : integrityData.status === 'warning' ? 'Warning'
                     : 'Issues found'}
                  </span>
                )}
              </div>
              <button className={css.integrityClose} onClick={() => setIntegrityOpen(false)}>&times;</button>
            </div>
            {integrityLoading ? (
              <div className={css.emptyInline}>Running checks...</div>
            ) : integrityData ? (
              <>
                {integrityData.checks.map(c => (
                  <div key={c.name} className={css.checkRow}>
                    <span className={`${css.checkDot} ${
                      c.status === 'ok' ? css.dotOk : c.status === 'warning' ? css.dotWarn : css.dotErr
                    }`} />
                    <div className={css.checkInfo}>
                      <div className={css.checkName}>{c.name.replace(/_/g, ' ')}</div>
                      <div className={css.checkDetails}>{c.details}</div>
                      {c.affectedRows > 0 && <div className={css.checkAffected}>{c.affectedRows} affected row(s)</div>}
                    </div>
                  </div>
                ))}
                <div className={css.integrityFooter}>
                  Checked at: {formatIST(integrityData.checkedAt)}
                </div>
              </>
            ) : (
              <div className={css.emptyInline}>Check failed — try again</div>
            )}
          </div>
        )}

        {/* ─── Section 2: Attention banners ────────────────────────── */}
        {analytics && analytics.tournaments.pending_approval > 0 && (
          <div className={css.attention}>
            <span className={css.attentionDot} />
            <span className={css.attentionText}>
              {analytics.tournaments.pending_approval} tournament{analytics.tournaments.pending_approval > 1 ? 's' : ''} awaiting your approval
            </span>
            <button className={css.attentionBtn} onClick={() => document.getElementById('pending-approvals')?.scrollIntoView({ behavior: 'smooth' })}>
              Review now
            </button>
          </div>
        )}

        {analytics && analytics.organizers.pending_verification > 0 && (
          <div className={css.attention}>
            <span className={css.attentionDot} />
            <span className={css.attentionText}>
              {analytics.organizers.pending_verification} organizer{analytics.organizers.pending_verification > 1 ? 's' : ''} awaiting verification
            </span>
            <button className={css.attentionBtn} onClick={() => document.getElementById('organizers')?.scrollIntoView({ behavior: 'smooth' })}>
              Review now
            </button>
          </div>
        )}

        {/* ─── Section 3: Stats row ────────────────────────────────── */}
        {analytics && (
          <div className={css.statsGrid}>
            <div className={css.statCard} data-testid="admin-stat-tournaments">
              <div className={css.statValue}>{analytics.tournaments.total}</div>
              <div className={css.statLabel}>Total tournaments</div>
              <div className={css.statSub} style={{ color: analytics.tournaments.active > 0 ? 'var(--color-text-success, #3B6D11)' : 'var(--color-text-tertiary, #888)' }}>
                {analytics.tournaments.active} active now
              </div>
            </div>
            <div className={css.statCard} data-testid="admin-stat-organizers">
              <div className={css.statValue}>{analytics.organizers.total}</div>
              <div className={css.statLabel}>Verified organizers</div>
              <div className={css.statSub} style={{ color: analytics.organizers.pending_verification > 0 ? '#854F0B' : 'var(--color-text-tertiary, #888)' }}>
                {analytics.organizers.pending_verification} pending
              </div>
            </div>
            <div className={css.statCard} data-testid="admin-stat-registrations">
              <div className={css.statValue}>{analytics.registrations.total}</div>
              <div className={css.statLabel}>Total registrations</div>
              <div className={css.statSub} style={{ color: 'var(--color-text-success, #3B6D11)' }}>
                {analytics.registrations.confirmed} confirmed
              </div>
            </div>
            <div className={css.statCard} data-testid="admin-stat-revenue">
              <div className={css.statValue} style={{ color: '#C41E1E' }}>
                {formatRevenue(analytics.revenue_paise)}
              </div>
              <div className={css.statLabel}>Platform revenue</div>
              <div className={css.statSub} style={{ color: 'var(--color-text-tertiary, #888)' }}>
                All confirmed payments
              </div>
            </div>
          </div>
        )}

        {/* ─── Section 4: Two column grid ──────────────────────────── */}
        <div className={css.columns}>

          {/* ── Left column ─────────────────────────────────────────── */}
          <div className={css.leftCol}>

            {/* Pending approvals */}
            <div className={css.card} id="pending-approvals" data-testid="pending-approvals-section">
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>Pending approvals</span>
                {pending.length > 0 && <span className={css.cardBadge}>{pending.length}</span>}
              </div>
              {pending.length === 0 ? (
                <div className={css.emptyInline}>
                  <div className={css.emptyCheck}>&#10003;</div>
                  <div>No tournaments pending approval</div>
                </div>
              ) : (
                pending.map(t => {
                  const feeRange = t.categories.length > 0
                    ? `\u20B9${Math.min(...t.categories.map(c => c.maxSeats))} seats`
                    : '';
                  return (
                    <div key={t.id} className={css.pendingRow}>
                      <div className={css.pendingInfo}>
                        <div className={css.pendingName}>{t.title}</div>
                        <div className={css.pendingMeta}>{t.organizer?.academyName} &middot; {t.city}</div>
                        <div className={css.pendingFee}>{formatDateShort(t.startDate)} &middot; {t.categories.length} categories</div>
                      </div>
                      <div className={css.pendingActions}>
                        <button
                          className={css.btnApprove}
                          onClick={() => handleApprove(t.id)}
                          disabled={actionLoading === t.id}
                          data-testid={`approve-btn-${t.id}`}
                        >
                          {actionLoading === t.id ? '...' : 'Approve'}
                        </button>
                        <button
                          className={css.btnReject}
                          onClick={() => handleReject(t.id)}
                          disabled={actionLoading === t.id}
                          data-testid={`reject-btn-${t.id}`}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* All tournaments */}
            <div className={css.card}>
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>All tournaments</span>
                <a href="/admin/tournaments" className={css.cardLink}>View all &rarr;</a>
              </div>
              {allTournaments.length === 0 ? (
                <div className={css.emptyInline}>No tournaments yet</div>
              ) : (
                <table className={css.dashTable}>
                  <thead>
                    <tr>
                      <th className={css.dashTh}>Tournament</th>
                      <th className={`${css.dashTh} ${css.colHideTablet}`}>Organizer</th>
                      <th className={css.dashTh}>Status</th>
                      <th className={`${css.dashTh} ${css.colHideMobile}`}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allTournaments.slice(0, 5).map((t, i) => {
                      const badgeCls = STATUS_BADGE[t.status] ?? css.badgeDraft;
                      return (
                        <tr key={t.id} className={css.dashTr}>
                          <td className={css.dashTd}>
                            <span className={css.nameCell}>{t.title}</span>
                          </td>
                          <td className={`${css.dashTd} ${css.colHideTablet}`} style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>
                            {t.organizer?.academyName}
                          </td>
                          <td className={css.dashTd}>
                            <span className={`${css.badge} ${badgeCls}`}>
                              {STATUS_LABELS[t.status] ?? t.status}
                            </span>
                          </td>
                          <td className={`${css.dashTd} ${css.colHideMobile}`} style={{ fontSize: 11, color: 'var(--color-text-secondary, #666)' }}>
                            {formatDateShort(t.startDate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── Right column ────────────────────────────────────────── */}
          <div className={css.rightCol}>

            {/* Organizers */}
            <div className={css.card} id="organizers" data-testid="organizers-section">
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>Organizers</span>
                <a href="/admin/organizers" className={css.cardLink}>View all &rarr;</a>
              </div>

              {organizers.length === 0 ? (
                <div className={css.emptyInline}>No organizers yet</div>
              ) : (
                <>
                  {/* Pending verification */}
                  {pendingOrgs.length > 0 && (
                    <>
                      <div className={css.sectionLabel}>Awaiting verification</div>
                      {pendingOrgs.map(o => (
                        <div key={o.id} className={css.orgRow}>
                          <span className={css.avatar} style={{ background: '#C41E1E' }}>
                            {initials(o.academyName)}
                          </span>
                          <div className={css.orgInfo}>
                            <div className={css.orgName}>{o.academyName}</div>
                            <div className={css.orgEmail}>{o.user.email}</div>
                          </div>
                          <button
                            className={css.btnVerify}
                            onClick={() => handleVerify(o.id)}
                            disabled={actionLoading === o.id}
                            data-testid={`verify-organizer-btn-${o.id}`}
                          >
                            {actionLoading === o.id ? '...' : 'Verify'}
                          </button>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Active organizers */}
                  {verifiedOrgs.length > 0 && (
                    <>
                      <div className={css.sectionLabel} style={pendingOrgs.length > 0 ? { marginTop: 12 } : undefined}>Active organizers</div>
                      {verifiedOrgs.slice(0, 5).map(o => (
                        <div key={o.id} className={css.orgRow}>
                          <span className={css.avatar} style={{ background: '#1A1A1A' }}>
                            {initials(o.academyName)}
                          </span>
                          <div className={css.orgInfo}>
                            <div className={css.orgName}>{o.academyName}</div>
                            <div className={css.orgEmail}>{o.user.email}</div>
                          </div>
                          <span className={`${css.badgeSmall}`} style={{ background: '#EAF3DE', color: '#3B6D11' }}>Active</span>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Top categories */}
            <div className={css.card}>
              <div className={css.cardHeader}>
                <span className={css.cardTitle}>Top categories</span>
              </div>
              {!analytics || analytics.top_categories.length === 0 ? (
                <div className={css.emptyInline}>No registration data yet</div>
              ) : (
                (() => {
                  const maxCount = Math.max(...analytics.top_categories.map(c => c.registered_count), 1);
                  return analytics.top_categories.map((c, i) => (
                    <div key={i} className={css.catRow}>
                      <div className={css.catHeader}>
                        <span className={css.catName}>{c.name}</span>
                        <span className={css.catCount}>{c.registered_count} registered</span>
                      </div>
                      <div className={css.catTournament}>{c.tournament}</div>
                      <div className={css.progressBar}>
                        <div className={css.progressFill} style={{ width: `${(c.registered_count / maxCount) * 100}%` }} />
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
