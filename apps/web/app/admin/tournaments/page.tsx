'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import AdminLayout from '@/components/admin/AdminLayout';
import KSTable, {
  renderStatusBadge,
  type KSColumn,
  type KSFilter,
  type KSStat,
} from '@/components/ui/KSTable';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface Tournament {
  id: string; title: string; city: string; venue: string;
  startDate: string; endDate: string; status: string; createdAt: string;
  organizer: { academyName: string; city: string };
  categories: { id: string; name: string; maxSeats: number }[];
}

interface Meta { total: number; page: number; limit: number }

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function formatDateShort(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ═══════════════════════════════════════════════════════════════════
   Column + Filter Config
   ═══════════════════════════════════════════════════════════════════ */

const columns: KSColumn<Tournament>[] = [
  {
    key: 'title',
    label: 'Tournament',
    sortable: true,
    render: (_, row) => (
      <div>
        <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{row.title}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #999)' }}>{row.city}</div>
      </div>
    ),
  },
  {
    key: 'organizer',
    label: 'Organizer',
    hideOnMobile: true,
    render: (_, row) => (
      <span style={{ fontSize: '0.85rem' }}>{row.organizer?.academyName ?? '—'}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    width: '120px',
    render: (v) => renderStatusBadge(v as string),
  },
  {
    key: 'categories',
    label: 'Categories',
    width: '80px',
    hideOnMobile: true,
    render: (_, row) => (
      <span style={{ fontSize: '0.85rem' }}>{row.categories?.length ?? 0}</span>
    ),
  },
  {
    key: 'startDate',
    label: 'Start Date',
    width: '120px',
    sortable: true,
    hideOnMobile: true,
    render: (v) => (
      <span style={{ fontSize: '0.85rem' }}>{formatDateShort(v as string)}</span>
    ),
  },
  {
    key: 'id',
    label: '',
    width: '80px',
    render: (_, row) => {
      if (row.status === 'PENDING_APPROVAL') {
        return <ApproveRejectButtons tournamentId={row.id} />;
      }
      return null;
    },
  },
];

const statusFilters: KSFilter[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'DRAFT', label: 'Draft' },
      { value: 'PENDING_APPROVAL', label: 'Pending' },
      { value: 'APPROVED', label: 'Approved' },
      { value: 'ACTIVE', label: 'Active', dot: '#3B6D11' },
      { value: 'CLOSED', label: 'Closed' },
      { value: 'CANCELLED', label: 'Cancelled', dot: '#A32D2D' },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════════════
   Inline Approve/Reject
   ═══════════════════════════════════════════════════════════════════ */

function ApproveRejectButtons({ tournamentId }: { tournamentId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (done) return <span style={{ fontSize: '0.75rem', color: '#3B6D11', fontWeight: 500 }}>Done</span>;

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    try {
      await api.patch(`/admin/tournaments/${tournamentId}/status`, { status: 'APPROVED' });
      setDone(true);
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      alert(apiErr?.error?.message ?? 'Approve failed');
    }
    setLoading(false);
  };

  const handleReject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    setLoading(true);
    try {
      await api.patch(`/admin/tournaments/${tournamentId}/status`, { status: 'REJECTED', reason });
      setDone(true);
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      alert(apiErr?.error?.message ?? 'Reject failed');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
      <button
        onClick={handleApprove}
        disabled={loading}
        style={{
          fontSize: 10, fontWeight: 500, color: '#3B6D11',
          border: '0.5px solid #3B6D11', borderRadius: 4,
          padding: '2px 6px', background: 'transparent', cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.5 : 1,
        }}
      >
        {loading ? '...' : 'Approve'}
      </button>
      <button
        onClick={handleReject}
        disabled={loading}
        style={{
          fontSize: 10, fontWeight: 500, color: '#A32D2D',
          border: '0.5px solid #A32D2D', borderRadius: 4,
          padding: '2px 6px', background: 'transparent', cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.5 : 1,
        }}
      >
        Reject
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Page
   ═══════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<KSStat[]>([]);

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(p));
    params.set('limit', String(PAGE_SIZE));
    if (statusFilter.status) params.set('status', statusFilter.status);

    try {
      const res = await api.get<Tournament[]>(`/admin/tournaments?${params}`);
      const raw = res as unknown as { data: Tournament[]; meta: Meta };
      let items = Array.isArray(raw.data) ? raw.data : [];

      // Client-side search filter
      if (search) {
        const q = search.toLowerCase();
        items = items.filter(t =>
          t.title.toLowerCase().includes(q) ||
          t.organizer?.academyName?.toLowerCase().includes(q) ||
          t.city.toLowerCase().includes(q)
        );
      }

      setTournaments(items);
      setTotalCount(raw.meta?.total ?? items.length);
    } catch {
      // auth errors handled by api wrapper
    }
    setLoading(false);
  }, [statusFilter, search]);

  // Load stats
  useEffect(() => {
    api.get<any>('/admin/analytics').then(r => {
      const d = r.data;
      setStats([
        { label: 'Total', value: d.tournaments.total },
        { label: 'Active', value: d.tournaments.active, color: 'green' },
        { label: 'Pending', value: d.tournaments.pending_approval, color: d.tournaments.pending_approval > 0 ? 'red' : 'default' },
      ]);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadData(1); setPage(1); }, [statusFilter, search]);
  useEffect(() => { loadData(page); }, [page]);

  const handlePageChange = (p: number) => setPage(p);
  const handleFilterChange = useCallback((f: Record<string, string>) => setStatusFilter(f), []);
  const handleSearch = useCallback((q: string) => setSearch(q), []);
  const handleSortChange = useCallback(() => {}, []);

  return (
    <AdminLayout activeNav="tournaments">
      <div className="container" style={{ padding: '24px 24px 80px', background: '#F7F7F7', minHeight: 'calc(100dvh - var(--header-height, 56px) - 40px)' }}>
        <KSTable<Tournament>
          data={tournaments}
          columns={columns}
          title="Tournaments"
          subtitle="Manage all tournaments across the platform"
          stats={stats}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          onSortChange={handleSortChange}
          searchPlaceholder="Search tournaments, organizers, cities..."
          filters={statusFilters}
          loading={loading}
          emptyMessage="No tournaments found"
        />
      </div>
    </AdminLayout>
  );
}
