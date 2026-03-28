'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api, getAccessToken, getUserInfo, decodeJwtRole } from '@/lib/api';
import KSTable, {
  renderStatusBadge,
  type KSColumn,
  type KSTab,
  type KSFilter,
  type KSStat,
} from '@/components/ui/KSTable';

/* ── Types ────────────────────────────────────────────────────────────── */

interface Category {
  id: string;
  name: string;
  registeredCount: number;
  maxSeats: number;
}

interface Tournament {
  id: string;
  title: string;
  status: string;
  city: string;
  venue: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  createdAt: string;
  categories: Category[];
}

interface ListResponse {
  data: Tournament[];
  meta: { total: number; page: number; limit: number };
}

interface Summary {
  totalTournaments: number;
  activeTournaments: number;
  pendingApprovalCount: number;
  createdThisMonth: number;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Columns ───────────────────────────────────────────────────────────── */

const columns: KSColumn<Tournament>[] = [
  {
    key: 'title',
    label: 'Tournament',
    sortable: true,
    render: (v, row) => (
      <Link
        href={`/organizer/tournaments/${row.id}/registrations`}
        style={{ fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none' }}
      >
        {v as string}
      </Link>
    ),
  },
  {
    key: 'city',
    label: 'City',
    width: '120px',
    hideOnMobile: true,
    render: (_, row) => (
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        {row.venue ? `${row.venue}, ${row.city}` : row.city}
      </span>
    ),
  },
  {
    key: 'startDate',
    label: 'Start Date',
    sortable: true,
    width: '120px',
    hideOnMobile: true,
    render: (v) => (
      <span style={{ fontSize: '0.85rem' }}>{formatDate(v as string)}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    width: '130px',
    render: (v) => renderStatusBadge(v as string),
  },
  {
    key: 'categories',
    label: 'Regs',
    width: '80px',
    render: (_, row) => {
      const confirmed = row.categories.reduce((s, c) => s + c.registeredCount, 0);
      const total = row.categories.reduce((s, c) => s + c.maxSeats, 0);
      return (
        <span style={{ fontWeight: confirmed > 0 ? 600 : 400, color: confirmed === 0 ? 'var(--text-muted)' : undefined }}>
          {confirmed}/{total}
        </span>
      );
    },
  },
  {
    key: 'id',
    label: '',
    width: '140px',
    render: (_, row) => {
      switch (row.status) {
        case 'DRAFT':
          return (
            <Link href={`/organizer/tournaments/${row.id}/registrations`} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem' }}>
              Edit
            </Link>
          );
        case 'PENDING_APPROVAL':
          return (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
              Awaiting approval
            </span>
          );
        case 'APPROVED':
        case 'ACTIVE':
          return (
            <Link href={`/organizer/tournaments/${row.id}/registrations`} className="btn btn-primary btn-sm" style={{ fontSize: '0.75rem' }}>
              View Registrations
            </Link>
          );
        default:
          return (
            <Link href={`/organizer/tournaments/${row.id}/registrations`} className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }}>
              View
            </Link>
          );
      }
    },
  },
];

/* ── Filters ───────────────────────────────────────────────────────────── */

const statusFilterOptions: KSFilter[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'ACTIVE', label: 'Active', dot: '#3B6D11' },
      { value: 'APPROVED', label: 'Approved', dot: '#185FA5' },
      { value: 'PENDING_APPROVAL', label: 'Pending', dot: '#854F0B' },
      { value: 'DRAFT', label: 'Draft', dot: '#888' },
      { value: 'CLOSED', label: 'Closed', dot: '#666' },
      { value: 'CANCELLED', label: 'Cancelled', dot: '#A32D2D' },
    ],
  },
];

const DEFAULT_PAGE_SIZE = 10;

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function OrganizerTournamentsPage() {
  const [data, setData] = useState<Tournament[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState('startDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState('all');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const fetchTournaments = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({
      page: String(page),
      limit: String(pageSize),
      sortBy: sortKey,
      sortDir,
    });
    if (search) qp.set('search', search);
    // Tab-based status filter takes priority
    const statusFilter = activeTab !== 'all' ? activeTab : filters.status;
    if (statusFilter) qp.set('status', statusFilter);

    try {
      const res = await api.get<ListResponse>(`/organizer/tournaments?${qp}`);
      const d = res.data;
      setData(d.data);
      setTotal(d.meta.total);
    } catch {
      setData([]);
      setTotal(0);
    }
    setLoading(false);
  }, [page, pageSize, search, filters, sortKey, sortDir, activeTab]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { window.location.href = '/login'; return; }
    const role = getUserInfo()?.role ?? decodeJwtRole(token);
    if (role !== 'ORGANIZER') { window.location.href = '/'; return; }
    setAuthChecked(true);

    // Fetch summary for stats
    api.get<Summary>('/organizer/dashboard/summary')
      .then(res => setSummary(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    fetchTournaments();
  }, [fetchTournaments, authChecked]);

  const handleSearch = useCallback((q: string) => { setSearch(q); setPage(1); }, []);
  const handleFilterChange = useCallback((f: Record<string, string>) => { setFilters(f); setPage(1); }, []);
  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc') => { setSortKey(key); setSortDir(dir); setPage(1); }, []);
  const handleTabChange = useCallback((tab: string) => { setActiveTab(tab); setPage(1); }, []);

  // Tabs
  const tabs: KSTab[] = [
    { key: 'all', label: 'All', count: summary?.totalTournaments ?? total },
    { key: 'ACTIVE', label: 'Active', count: summary?.activeTournaments ?? 0 },
    { key: 'PENDING_APPROVAL', label: 'Pending', count: summary?.pendingApprovalCount ?? 0 },
    { key: 'DRAFT', label: 'Draft', count: 0 },
    { key: 'CLOSED', label: 'Closed', count: 0 },
  ];

  // Stats
  const stats: KSStat[] = summary ? [
    { label: 'Total Tournaments', value: summary.totalTournaments },
    { label: 'Active', value: summary.activeTournaments, color: 'green' },
    { label: 'Pending Approval', value: summary.pendingApprovalCount, color: summary.pendingApprovalCount > 0 ? 'red' : 'default' },
    { label: 'Created This Month', value: summary.createdThisMonth },
  ] : [];

  if (!authChecked) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 24px 80px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Link href="/organizer/dashboard" style={{ display: 'inline-flex', gap: 6, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          ← Back to Dashboard
        </Link>
        <Link
          href="/organizer/tournaments/new"
          className="btn btn-primary"
          style={{ fontSize: '0.85rem' }}
        >
          + Create Tournament
        </Link>
      </div>

      <KSTable<Tournament>
        data={data}
        columns={columns}
        title="My Tournaments"
        subtitle="All your tournaments in one place"
        totalCount={total}
        page={page}
        pageSize={pageSize}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        onPageChange={setPage}
        onSearch={handleSearch}
        onFilterChange={handleFilterChange}
        onSortChange={handleSortChange}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        searchPlaceholder="Search by tournament name..."
        filters={statusFilterOptions}
        stats={stats}
        defaultSortKey="startDate"
        defaultSortDir="desc"
        loading={loading}
        emptyMessage="No tournaments found"
      />
    </div>
  );
}
