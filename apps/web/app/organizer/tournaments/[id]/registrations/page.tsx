'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, getAccessToken, getUserInfo, decodeJwtRole } from '@/lib/api';
import KSTable, {
  renderStatusBadge,
  renderFideCell,
  renderEntryNumber,
  type KSColumn,
  type KSTab,
  type KSFilter,
  type KSStat,
} from '@/components/ui/KSTable';

interface Registration {
  id: string;
  entryNumber: string;
  playerName: string;
  phone: string;
  email: string | null;
  city: string | null;
  status: string;
  registeredAt: string;
  confirmedAt: string | null;
  category: { id: string; name: string };
  fideId: string | null;
  fideRating: number | null;
  fideVerified: boolean | null;
}

interface CategoryInfo {
  id: string;
  name: string;
  maxSeats: number;
  registeredCount: number;
}

interface RegistrationsResponse {
  registrations: Registration[];
  total: number;
  page: number;
  pageSize: number;
  categories: CategoryInfo[];
  statusCounts: Record<string, number>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const PAGE_SIZE = 20;

const columns: KSColumn<Registration>[] = [
  {
    key: 'entryNumber',
    label: 'Entry #',
    sortable: true,
    width: '140px',
    render: (v) => renderEntryNumber(v as string),
  },
  {
    key: 'playerName',
    label: 'Player',
    sortable: true,
    render: (v) => <span style={{ fontWeight: 600 }}>{v as string}</span>,
  },
  {
    key: 'category',
    label: 'Category',
    width: '130px',
    render: (_, row) => row.category?.name ?? '',
  },
  {
    key: 'phone',
    label: 'Phone',
    width: '130px',
  },
  {
    key: 'city',
    label: 'City',
    sortable: true,
    width: '110px',
    hideOnMobile: true,
    render: (v) => (v as string) ?? '—',
  },
  {
    key: 'fideId',
    label: 'FIDE ID',
    width: '160px',
    hideOnMobile: true,
    render: (_, row) => renderFideCell(row.fideId, row.fideRating, row.fideVerified),
  },
  {
    key: 'status',
    label: 'Status',
    sortable: true,
    width: '120px',
    render: (v) => renderStatusBadge(v as string),
  },
  {
    key: 'registeredAt',
    label: 'Date',
    sortable: true,
    width: '80px',
    hideOnMobile: true,
    render: (v) => formatDate(v as string),
  },
];

const statusFilterOptions: KSFilter[] = [
  {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'CONFIRMED', label: 'Confirmed', dot: '#3B6D11' },
      { value: 'PENDING_PAYMENT', label: 'Pending', dot: '#854F0B' },
      { value: 'CANCELLED', label: 'Cancelled', dot: '#A32D2D' },
      { value: 'FAILED', label: 'Failed', dot: '#A32D2D' },
    ],
  },
  {
    key: 'fide',
    label: 'FIDE',
    options: [
      { value: 'rated', label: 'Rated' },
      { value: 'unrated', label: 'Unrated' },
    ],
  },
];

export default function OrganizerRegistrationsPage() {
  const params = useParams();
  const tournamentId = params.id as string;

  const [data, setData] = useState<Registration[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState('registeredAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [activeTab, setActiveTab] = useState('all');

  // Metadata from API
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});

  // Export
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const fetchRegistrations = useCallback(async () => {
    setLoading(true);
    const qp = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: sortKey,
      sortDir,
    });
    if (search) qp.set('search', search);
    if (filters.status) qp.set('status', filters.status);
    if (filters.fide) qp.set('fide', filters.fide);
    if (activeTab !== 'all') qp.set('categoryId', activeTab);

    try {
      const res = await api.get<RegistrationsResponse>(
        `/organizer/tournaments/${tournamentId}/registrations?${qp}`,
      );
      const d = res.data;
      setData(d.registrations);
      setTotal(d.total);
      if (d.categories) setCategories(d.categories);
      if (d.statusCounts) setStatusCounts(d.statusCounts);
    } catch {
      setData([]);
      setTotal(0);
    }
    setLoading(false);
  }, [tournamentId, page, search, filters, sortKey, sortDir, activeTab]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { window.location.href = '/organizer/login'; return; }
    // Verify role — an admin token should not access organizer pages
    const role = getUserInfo()?.role ?? decodeJwtRole(token);
    if (role !== 'ORGANIZER') { window.location.href = '/'; return; }
    fetchRegistrations();
  }, [fetchRegistrations]);

  // Reset page when filters change
  const handleSearch = useCallback((q: string) => { setSearch(q); setPage(1); }, []);
  const handleFilterChange = useCallback((f: Record<string, string>) => { setFilters(f); setPage(1); }, []);
  const handleSortChange = useCallback((key: string, dir: 'asc' | 'desc') => { setSortKey(key); setSortDir(dir); setPage(1); }, []);
  const handleTabChange = useCallback((tab: string) => { setActiveTab(tab); setPage(1); }, []);

  // Tabs from categories
  const totalAll = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const tabs: KSTab[] = [
    { key: 'all', label: 'All', count: totalAll },
    ...categories.map(c => ({ key: c.id, label: c.name, count: c.registeredCount })),
  ];

  // Stats
  const totalSeats = categories.reduce((s, c) => s + c.maxSeats, 0);
  const seatsRemaining = totalSeats - categories.reduce((s, c) => s + c.registeredCount, 0);
  const stats: KSStat[] = [
    { label: 'Total Registrations', value: totalAll },
    { label: 'Confirmed', value: statusCounts.CONFIRMED ?? 0, color: 'green' },
    { label: 'Pending Payment', value: statusCounts.PENDING_PAYMENT ?? 0, color: 'red' },
    { label: 'Seats Remaining', value: Math.max(0, seatsRemaining) },
  ];

  // Export handler
  const handleExport = async () => {
    setExporting(true);
    setExportMsg('');
    try {
      const res = await api.post<{ export_job_id: string }>(
        `/organizer/tournaments/${tournamentId}/exports`,
        { format: 'XLSX' },
      );
      const jobId = res.data.export_job_id;
      setExportMsg('Export queued — polling for download link...');

      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const status = await api.get<{ status: string; download_url?: string }>(
          `/organizer/exports/${jobId}`,
        );
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
      <a
        href="/organizer/dashboard"
        style={{ display: 'inline-flex', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}
      >
        ← Back to Dashboard
      </a>

      {exportMsg && (
        <div
          style={{
            padding: '10px 16px',
            background: 'var(--brand-blue-glow)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 16,
            fontSize: '0.9rem',
            color: 'var(--brand-blue)',
          }}
        >
          {exportMsg}
        </div>
      )}

      <KSTable<Registration>
        data={data}
        columns={columns}
        title="Registrations"
        subtitle={`${total} total registrations`}
        totalCount={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
        onSearch={handleSearch}
        onFilterChange={handleFilterChange}
        onSortChange={handleSortChange}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        searchPlaceholder="Search by player name..."
        filters={statusFilterOptions}
        stats={stats}
        defaultSortKey="registeredAt"
        defaultSortDir="desc"
        onExport={handleExport}
        exportLabel={exporting ? 'Exporting...' : 'Export to Excel'}
        exportDisabled={exporting}
        loading={loading}
        emptyMessage="No registrations found"
      />
    </div>
  );
}
