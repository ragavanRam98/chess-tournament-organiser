'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import AdminLayout from '@/components/admin/AdminLayout';
import KSTable, {
  renderActionBadge,
  formatIST,
  type KSColumn,
  type KSFilter,
} from '@/components/ui/KSTable';

/* ═══════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════ */

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  performedAt: string;
  performedBy: { email: string; role: string } | null;
}

interface Meta {
  limit: number;
  next_cursor: string | null;
  has_next: boolean;
}

/* ─── Value Diff Display ───────────────────────────────────────────── */
function ValueDiff({ value }: { value: Record<string, unknown> | null }) {
  if (!value || Object.keys(value).length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
      {Object.entries(value).map(([k, v]) => (
        <span key={k} style={{
          padding: '2px 8px', background: 'var(--ks-off-white, #f5f5f5)', borderRadius: 999,
          fontSize: '0.72rem', color: 'var(--text-secondary)', border: '1px solid var(--ks-border, #e0e0e0)',
        }}>
          {k}: <strong>{String(v ?? '—')}</strong>
        </span>
      ))}
    </span>
  );
}

/* ─── Columns ──────────────────────────────────────────────────────── */
const auditColumns: KSColumn<AuditLog>[] = [
  {
    key: 'performedAt',
    label: 'Timestamp',
    width: '170px',
    render: (v) => (
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{formatIST(v as string)}</div>
      </div>
    ),
  },
  {
    key: 'action',
    label: 'Action',
    width: '140px',
    render: (v) => renderActionBadge(v as string),
  },
  {
    key: 'entityType',
    label: 'Entity',
    width: '130px',
    hideOnMobile: true,
    render: (_, row) => (
      <div>
        <div style={{ fontSize: '0.85rem', fontWeight: 500, textTransform: 'capitalize' }}>{row.entityType}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          {row.entityId.slice(0, 8)}...
        </div>
      </div>
    ),
  },
  {
    key: 'oldValue',
    label: 'Changes',
    hideOnMobile: true,
    render: (_, row) => (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <ValueDiff value={row.oldValue} />
        {row.oldValue && row.newValue && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>&rarr;</span>}
        <ValueDiff value={row.newValue} />
      </div>
    ),
  },
  {
    key: 'performedBy',
    label: 'Performed By',
    width: '180px',
    render: (_, row) => row.performedBy ? (
      <div>
        <div style={{ fontSize: '0.85rem' }}>{row.performedBy.email}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{row.performedBy.role}</div>
      </div>
    ) : (
      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>System</span>
    ),
  },
];

const entityFilters: KSFilter[] = [
  {
    key: 'entityType',
    label: 'Entity Type',
    options: [
      { value: 'tournament', label: 'Tournament' },
      { value: 'organizer', label: 'Organizer' },
      { value: 'registration', label: 'Registration' },
    ],
  },
];

const DEFAULT_PAGE_SIZE = 10;

/* ─── Audit Logs Page ──────────────────────────────────────────────── */
export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalEstimate, setTotalEstimate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const [entityFilter, setEntityFilter] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const cursorMapRef = useRef<Record<number, string>>({ 1: '' });

  const loadLogs = useCallback(async (pageNum: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    if (entityFilter.entityType) params.set('entityType', entityFilter.entityType);

    const cursor = cursorMapRef.current[pageNum];
    if (cursor) params.set('cursor', cursor);

    try {
      const res = await api.get<AuditLog[]>(`/admin/audit-logs?${params}`);
      const rawData = res as unknown as { data: AuditLog[]; meta: Meta };
      const items: AuditLog[] = Array.isArray(rawData.data) ? rawData.data : [];
      const meta: Meta = rawData.meta ?? { limit: pageSize, next_cursor: null, has_next: false };

      let filtered = items;
      if (search) {
        const q = search.toLowerCase();
        filtered = items.filter(
          l =>
            l.action.toLowerCase().includes(q) ||
            l.entityType.toLowerCase().includes(q) ||
            l.performedBy?.email.toLowerCase().includes(q),
        );
      }

      setLogs(filtered);

      if (meta.next_cursor) {
        cursorMapRef.current[pageNum + 1] = meta.next_cursor;
      }

      setTotalEstimate(meta.has_next ? pageNum * pageSize + 1 : (pageNum - 1) * pageSize + items.length);
    } catch {
      // auth errors handled by api wrapper redirect
    }
    setLoading(false);
  }, [entityFilter, search, pageSize]);

  useEffect(() => { loadLogs(1); }, []);

  useEffect(() => {
    cursorMapRef.current = { 1: '' };
    setPage(1);
    loadLogs(1);
  }, [entityFilter, pageSize]);

  const handlePageChange = (p: number) => { setPage(p); loadLogs(p); };
  const handleFilterChange = useCallback((f: Record<string, string>) => setEntityFilter(f), []);
  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    cursorMapRef.current = { 1: '' };
    setPage(1);
    loadLogs(1);
  }, [loadLogs]);
  const handleSortChange = useCallback(() => {}, []);

  return (
    <AdminLayout activeNav="audit-logs">
      <div className="container" style={{ padding: '24px 24px 80px', background: '#F7F7F7', minHeight: 'calc(100dvh - var(--header-height, 56px) - 40px)' }}>
        <KSTable<AuditLog>
          data={logs}
          columns={auditColumns}
          title="Audit Logs"
          subtitle="Track all administrative actions across the platform"
          totalCount={totalEstimate}
          page={page}
          pageSize={pageSize}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); cursorMapRef.current = { 1: '' }; }}
          onPageChange={handlePageChange}
          onSearch={handleSearch}
          onFilterChange={handleFilterChange}
          onSortChange={handleSortChange}
          searchPlaceholder="Search actions, entities, users..."
          filters={entityFilters}
          loading={loading}
          emptyMessage="No audit logs found"
        />
      </div>
    </AdminLayout>
  );
}
