'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import AdminLayout from '@/components/admin/AdminLayout';
import KSTable, {
  type KSColumn,
  type KSFilter,
  type KSStat,
} from '@/components/ui/KSTable';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface Organizer {
  id: string; academyName: string; contactPhone: string;
  city: string; state: string | null;
  verifiedAt: string | null; createdAt: string;
  user: { email: string; status: string; createdAt: string };
}

interface Meta { total: number; page: number; limit: number }

/* ═══════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════ */

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ═══════════════════════════════════════════════════════════════════
   Inline Verify Button
   ═══════════════════════════════════════════════════════════════════ */

function VerifyButton({ organizerId, status, onVerified }: {
  organizerId: string; status: string; onVerified: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  if (status === 'ACTIVE' || done) {
    return (
      <span style={{
        fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px',
        borderRadius: 999, background: '#EAF3DE', color: '#3B6D11',
      }}>
        Active
      </span>
    );
  }

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        try {
          await api.patch(`/admin/organizers/${organizerId}/verify`);
          setDone(true);
          onVerified();
        } catch (err: unknown) {
          const apiErr = err as { error?: { message?: string } };
          alert(apiErr?.error?.message ?? 'Verify failed');
        }
        setLoading(false);
      }}
      disabled={loading}
      data-testid={`verify-organizer-btn-${organizerId}`}
      style={{
        fontSize: '0.72rem', fontWeight: 500, color: '#3B6D11',
        border: '0.5px solid #3B6D11', borderRadius: 4,
        padding: '3px 8px', background: 'transparent',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : 'Verify'}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Page
   ═══════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

export default function AdminOrganizersPage() {
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<KSStat[]>([]);

  const loadData = useCallback(async (p: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(p));
    params.set('limit', String(PAGE_SIZE));

    try {
      const res = await api.get<Organizer[]>(`/admin/organizers?${params}`);
      const raw = res as unknown as { data: Organizer[]; meta: Meta };
      let items = Array.isArray(raw.data) ? raw.data : [];

      // Client-side filters
      if (filters.status === 'PENDING') {
        items = items.filter(o => o.user.status === 'PENDING_VERIFICATION');
      } else if (filters.status === 'ACTIVE') {
        items = items.filter(o => o.user.status === 'ACTIVE');
      }

      if (search) {
        const q = search.toLowerCase();
        items = items.filter(o =>
          o.academyName.toLowerCase().includes(q) ||
          o.user.email.toLowerCase().includes(q) ||
          o.city.toLowerCase().includes(q) ||
          o.contactPhone.includes(q)
        );
      }

      setOrganizers(items);
      setTotalCount(raw.meta?.total ?? items.length);
    } catch {
      // auth errors handled by api wrapper
    }
    setLoading(false);
  }, [filters, search]);

  // Load stats
  useEffect(() => {
    api.get<any>('/admin/analytics').then(r => {
      const d = r.data;
      setStats([
        { label: 'Total', value: d.organizers.total },
        { label: 'Verified', value: d.organizers.total - d.organizers.pending_verification, color: 'green' },
        { label: 'Pending', value: d.organizers.pending_verification, color: d.organizers.pending_verification > 0 ? 'red' : 'default' },
      ]);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadData(1); setPage(1); }, [filters, search]);
  useEffect(() => { loadData(page); }, [page]);

  const handlePageChange = (p: number) => setPage(p);
  const handleFilterChange = useCallback((f: Record<string, string>) => setFilters(f), []);
  const handleSearch = useCallback((q: string) => setSearch(q), []);
  const handleSortChange = useCallback(() => {}, []);

  const refreshStats = () => {
    api.get<any>('/admin/analytics').then(r => {
      const d = r.data;
      setStats([
        { label: 'Total', value: d.organizers.total },
        { label: 'Verified', value: d.organizers.total - d.organizers.pending_verification, color: 'green' },
        { label: 'Pending', value: d.organizers.pending_verification, color: d.organizers.pending_verification > 0 ? 'red' : 'default' },
      ]);
    }).catch(() => {});
  };

  const tableColumns: KSColumn<Organizer>[] = [
    {
      key: 'academyName',
      label: 'Name',
      sortable: true,
      render: (_, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: '50%',
            background: row.user.status === 'ACTIVE' ? '#1A1A1A' : '#C41E1E',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 600, flexShrink: 0,
          }}>
            {initials(row.academyName)}
          </span>
          <div>
            <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>{row.academyName}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted, #999)' }}>{row.city}{row.state ? `, ${row.state}` : ''}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'user',
      label: 'Email',
      hideOnMobile: true,
      render: (_, row) => <span style={{ fontSize: '0.85rem' }}>{row.user.email}</span>,
    },
    {
      key: 'contactPhone',
      label: 'Phone',
      width: '120px',
      hideOnMobile: true,
      render: (v) => <span style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>{v as string}</span>,
    },
    {
      key: 'createdAt',
      label: 'Registered',
      width: '120px',
      sortable: true,
      hideOnMobile: true,
      render: (v) => <span style={{ fontSize: '0.85rem' }}>{formatDate(v as string)}</span>,
    },
    {
      key: 'id',
      label: 'Status',
      width: '100px',
      render: (_, row) => (
        <VerifyButton
          organizerId={row.id}
          status={row.user.status}
          onVerified={refreshStats}
        />
      ),
    },
  ];

  const statusFilterConfig: KSFilter[] = [
    {
      key: 'status',
      label: 'Status',
      options: [
        { value: 'PENDING', label: 'Pending', dot: '#BA7517' },
        { value: 'ACTIVE', label: 'Active', dot: '#3B6D11' },
      ],
    },
  ];

  return (
    <AdminLayout activeNav="organizers">
      <div className="container" style={{ padding: '24px 24px 80px', background: '#F7F7F7', minHeight: 'calc(100dvh - var(--header-height, 56px) - 40px)' }}>
        <KSTable<Organizer>
          data={organizers}
          columns={tableColumns}
          title="Organizers"
          subtitle="Manage organizer accounts and verification"
          stats={stats}
          totalCount={totalCount}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          onSortChange={handleSortChange}
          searchPlaceholder="Search by name, email, city, phone..."
          filters={statusFilterConfig}
          loading={loading}
          emptyMessage="No organizers found"
        />
      </div>
    </AdminLayout>
  );
}
