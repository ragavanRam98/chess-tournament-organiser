'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { api, getAccessToken, setAccessToken, fetchAndCacheUserInfo } from '@/lib/api';
import KSTable, {
  renderActionBadge,
  formatIST,
  type KSColumn,
  type KSFilter,
} from '@/components/ui/KSTable';

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

/* ─── Inline Admin Login ───────────────────────────────────────────── */
function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post<{ access_token: string }>('/auth/login', { email, password });
      setAccessToken(res.data.access_token);
      fetchAndCacheUserInfo().catch(() => undefined);
      onLogin();
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      setError(apiErr?.error?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: 'calc(100dvh - var(--header-height))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="animate-fadeInUp" style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 'var(--radius-lg)', margin: '0 auto 16px',
            background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem',
            boxShadow: '0 8px 24px rgba(185,28,28,0.3)', color: '#fff',
          }}>&#128737;</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Admin Portal</h1>
          <p style={{ color: 'var(--text-muted)' }}>Sign in with super-admin credentials</p>
        </div>
        <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-100" style={{ padding: 32 }}>
          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', marginBottom: 20, fontSize: '0.9rem', fontWeight: 500 }}>
              {error}
            </div>
          )}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 28 }}>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-input" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
            {loading ? 'Signing in...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ─── Columns ──────────────────────────────────────────────────────── */
const auditColumns: KSColumn<AuditLog>[] = [
  {
    key: 'performedAt',
    label: 'Timestamp',
    width: '170px',
    render: (v) => {
      const d = v as string;
      return (
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{formatIST(d)}</div>
        </div>
      );
    },
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

const LIMIT = 50;

/* ─── Audit Logs Page ──────────────────────────────────────────────── */
export default function AuditLogsPage() {
  const [authed, setAuthed] = useState(false);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalEstimate, setTotalEstimate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  // Filters
  const [entityFilter, setEntityFilter] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  // Cursor map: page number -> cursor string
  const cursorMapRef = useRef<Record<number, string>>({ 1: '' });
  const hasNextRef = useRef(false);

  const loadLogs = useCallback(async (pageNum: number) => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', String(LIMIT));
    if (entityFilter.entityType) params.set('entityType', entityFilter.entityType);

    const cursor = cursorMapRef.current[pageNum];
    if (cursor) params.set('cursor', cursor);

    try {
      const res = await api.get<AuditLog[]>(`/admin/audit-logs?${params}`);
      // Response includes meta at top level due to our api wrapper
      const rawData = res as unknown as { data: AuditLog[]; meta: Meta };
      const items: AuditLog[] = Array.isArray(rawData.data) ? rawData.data : [];
      const meta: Meta = rawData.meta ?? { limit: LIMIT, next_cursor: null, has_next: false };

      // Apply client-side search filter (API doesn't support text search for audit logs)
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
      hasNextRef.current = meta.has_next;

      // Store cursor for next page
      if (meta.next_cursor) {
        cursorMapRef.current[pageNum + 1] = meta.next_cursor;
      }

      // Estimate total for display (cursor pagination doesn't give exact total)
      setTotalEstimate(meta.has_next ? pageNum * LIMIT + 1 : (pageNum - 1) * LIMIT + items.length);

      setAuthed(true);
    } catch {
      setAuthed(false);
    }
    setLoading(false);
  }, [entityFilter, search]);

  useEffect(() => {
    if (getAccessToken()) {
      loadLogs(1);
    } else {
      setLoading(false);
    }
  }, []);

  // Reload on filter change
  useEffect(() => {
    if (!authed) return;
    cursorMapRef.current = { 1: '' };
    setPage(1);
    loadLogs(1);
  }, [entityFilter]);

  const handlePageChange = (p: number) => {
    setPage(p);
    loadLogs(p);
  };

  const handleFilterChange = useCallback((f: Record<string, string>) => {
    setEntityFilter(f);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    // Client-side filter — reload current page
    if (authed) {
      cursorMapRef.current = { 1: '' };
      setPage(1);
      loadLogs(1);
    }
  }, [authed, loadLogs]);

  const handleSortChange = useCallback(() => {
    // Audit logs are always sorted by performedAt desc from the API
  }, []);

  if (!authed && !loading) {
    return <AdminLogin onLogin={() => loadLogs(1)} />;
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div className="animate-fadeInUp" style={{ marginBottom: 8 }}>
        <a href="/admin" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.9rem' }}>
          ← Dashboard
        </a>
      </div>

      <KSTable<AuditLog>
        data={logs}
        columns={auditColumns}
        title="Audit Logs"
        subtitle="Track all administrative actions across the platform"
        totalCount={totalEstimate}
        page={page}
        pageSize={LIMIT}
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
  );
}
