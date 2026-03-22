'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import css from './KSTable.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════════════ */

export interface KSColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  hideOnMobile?: boolean;
  render?: (value: unknown, row: T) => React.ReactNode;
}

export interface KSTab {
  key: string;
  label: string;
  count: number;
}

export interface KSFilter {
  key: string;
  label: string;
  options: { value: string; label: string; dot?: string }[];
}

export interface KSStat {
  label: string;
  value: number | string;
  color?: 'default' | 'red' | 'green';
}

export interface KSTableProps<T> {
  data: T[];
  columns: KSColumn<T>[];
  tabs?: KSTab[];
  activeTab?: string;
  onTabChange?: (tabKey: string) => void;
  searchPlaceholder?: string;
  filters?: KSFilter[];
  stats?: KSStat[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  totalCount: number;
  page: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  onSearch: (query: string) => void;
  onFilterChange: (filters: Record<string, string>) => void;
  onSortChange: (key: string, dir: 'asc' | 'desc') => void;
  title: string;
  subtitle?: string;
  onExport?: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
  loading?: boolean;
  emptyMessage?: string;
}

/* ═══════════════════════════════════════════════════════════════════════
   KSTable Component
   ═══════════════════════════════════════════════════════════════════════ */

export default function KSTable<T extends object>({
  data,
  columns,
  tabs,
  activeTab,
  onTabChange,
  searchPlaceholder = 'Search...',
  filters,
  stats,
  defaultSortKey,
  defaultSortDir = 'desc',
  totalCount,
  page,
  pageSize = 20,
  onPageChange,
  onSearch,
  onFilterChange,
  onSortChange,
  title,
  subtitle,
  onExport,
  exportLabel = 'Export to Excel',
  exportDisabled,
  loading,
  emptyMessage = 'No results found',
}: KSTableProps<T>) {
  const [searchValue, setSearchValue] = useState('');
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState(defaultSortKey ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Search debounce ─────────────────────────────────────────────── */
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearch(val), 400);
  }, [onSearch]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  /* ── Filter cycling ──────────────────────────────────────────────── */
  const cycleFilter = (filter: KSFilter) => {
    const current = activeFilters[filter.key] ?? '';
    const idx = filter.options.findIndex(o => o.value === current);
    const nextIdx = idx + 1;
    const next = nextIdx < filter.options.length ? filter.options[nextIdx].value : '';
    const updated = { ...activeFilters };
    if (next) { updated[filter.key] = next; } else { delete updated[filter.key]; }
    setActiveFilters(updated);
    onFilterChange(updated);
  };

  const clearFilter = (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = { ...activeFilters };
    delete updated[key];
    setActiveFilters(updated);
    onFilterChange(updated);
  };

  /* ── Sort ─────────────────────────────────────────────────────────── */
  const handleSort = (key: string) => {
    let dir: 'asc' | 'desc' = 'asc';
    if (sortKey === key) { dir = sortDir === 'asc' ? 'desc' : 'asc'; }
    setSortKey(key);
    setSortDir(dir);
    onSortChange(key, dir);
  };

  /* ── Pagination helpers ──────────────────────────────────────────── */
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const showFrom = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const showTo = Math.min(page * pageSize, totalCount);

  function getPageNumbers(): (number | '...')[] {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | '...')[] = [];
    if (page <= 3) {
      pages.push(1, 2, 3, 4, '...', totalPages);
    } else if (page >= totalPages - 2) {
      pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
    }
    return pages;
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  return (
    <div className={css.wrapper} data-testid="ks-table">
      {/* Header */}
      <div className={css.header}>
        <div>
          <h2 className={css.headerTitle}>{title}</h2>
          {subtitle && <div className={css.headerSubtitle}>{subtitle}</div>}
        </div>
        {onExport && (
          <button className={css.exportBtn} onClick={onExport} disabled={exportDisabled} data-testid="ks-export">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {exportLabel}
          </button>
        )}
      </div>

      {/* Stats */}
      {stats && stats.length > 0 && (
        <div className={css.statsBar}>
          {stats.map(s => (
            <div key={s.label} className={css.statCard}>
              <div className={`${css.statValue} ${s.color === 'red' ? css.statValueRed : s.color === 'green' ? css.statValueGreen : ''}`}>
                {s.value}
              </div>
              <div className={css.statLabel}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className={css.toolbar}>
        <div className={css.searchBox}>
          <svg className={css.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            className={css.searchInput}
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={handleSearchChange}
            data-testid="ks-table-search"
          />
        </div>

        {filters && filters.length > 0 && (
          <>
            <div className={css.divider} />
            {filters.map(f => {
              const active = activeFilters[f.key];
              const activeOpt = f.options.find(o => o.value === active);
              return (
                <button
                  key={f.key}
                  className={`${css.filterChip} ${active ? css.filterChipActive : ''}`}
                  onClick={() => cycleFilter(f)}
                  data-testid={`ks-filter-${f.key}`}
                >
                  {activeOpt?.dot && <span className={css.filterChipDot} style={{ background: activeOpt.dot }} />}
                  {activeOpt ? activeOpt.label : f.label}
                  {active && <span className={css.filterChipX} onClick={(e) => clearFilter(f.key, e)}>✕</span>}
                </button>
              );
            })}
          </>
        )}

        <span className={css.resultCount}>{totalCount} result{totalCount !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabs */}
      {tabs && tabs.length > 0 && (
        <div className={css.tabs}>
          {tabs.map(t => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                className={`${css.tab} ${isActive ? css.tabActive : ''}`}
                onClick={() => onTabChange?.(t.key)}
                data-testid={`ks-tab-${t.key}`}
              >
                {t.label}
                <span className={`${css.tabBadge} ${isActive ? css.tabBadgeActive : ''}`}>{t.count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className={css.tableContainer}>
        <table className={css.table}>
          <thead className={css.thead}>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`${css.th} ${col.sortable ? css.thSortable : ''} ${col.hideOnMobile ? css.colHideMobile : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && (
                    <span className={`${css.sortIcon} ${sortKey === col.key ? css.sortIconActive : ''}`}>
                      {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="ks-table-body">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skel-${i}`} className={css.tr} data-testid="ks-loading">
                  {columns.map(col => (
                    <td key={col.key} className={`${css.td} ${col.hideOnMobile ? css.colHideMobile : ''}`}>
                      <div className={css.skeletonCell} style={{ width: `${60 + Math.random() * 30}%` }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={css.empty} data-testid="ks-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => {
                const rec = row as Record<string, unknown>;
                return (
                  <tr key={(rec.id as string) ?? idx} className={css.tr} data-testid={`ks-row-${idx}`}>
                    {columns.map(col => (
                      <td key={col.key} className={`${css.td} ${col.hideOnMobile ? css.colHideMobile : ''}`}>
                        {col.render
                          ? col.render(rec[col.key], row)
                          : String(rec[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalCount > 0 && (
        <div className={css.pagination}>
          <span className={css.paginationInfo}>
            Showing {showFrom}–{showTo} of {totalCount}
          </span>
          <div className={css.paginationBtns}>
            <button className={css.pageBtn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>‹</button>
            {getPageNumbers().map((p, i) =>
              p === '...' ? (
                <span key={`ell-${i}`} className={css.ellipsis}>...</span>
              ) : (
                <button
                  key={p}
                  className={`${css.pageBtn} ${page === p ? css.pageBtnActive : ''}`}
                  onClick={() => onPageChange(p)}
                >
                  {p}
                </button>
              ),
            )}
            <button className={css.pageBtn} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>›</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Cell Renderers
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  CONFIRMED:       { bg: '#EAF3DE', color: '#3B6D11' },
  PENDING_PAYMENT: { bg: '#FAEEDA', color: '#854F0B' },
  FAILED:          { bg: '#FCEBEB', color: '#A32D2D' },
  CANCELLED:       { bg: '#FCEBEB', color: '#A32D2D' },
  // Audit action badges
  APPROVED:          { bg: '#EAF3DE', color: '#3B6D11' },
  VERIFIED:          { bg: '#EAF3DE', color: '#3B6D11' },
  PAYMENT_CONFIRMED: { bg: '#EAF3DE', color: '#3B6D11' },
  REJECTED:          { bg: '#FCEBEB', color: '#A32D2D' },
  SUSPENDED:         { bg: '#FAEEDA', color: '#854F0B' },
  REFUNDED:          { bg: '#FAEEDA', color: '#854F0B' },
};

export function renderStatusBadge(status: string): React.ReactNode {
  const style = STATUS_COLORS[status] ?? { bg: '#f0f0f0', color: '#666' };
  return (
    <span className={css.statusBadge} style={{ background: style.bg, color: style.color }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function renderFideCell(
  fideId: string | null,
  fideRating: number | null,
  fideVerified: boolean | null,
): React.ReactNode {
  if (!fideId) return <span className={css.fideUnrated}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {fideVerified === true && <span className={css.fideDot} />}
      <span className={fideVerified === true ? css.fideId : undefined} style={{ fontFamily: 'monospace', fontSize: 11 }}>{fideId}</span>
      {fideVerified === false && <span className={css.fideWarning}>⚠ Unverified</span>}
      {fideRating != null && <span className={css.fideRating}>({fideRating})</span>}
    </span>
  );
}

export function renderEntryNumber(entryNo: string): React.ReactNode {
  return <span className={css.entryNumber}>{entryNo}</span>;
}

export function renderViewButton(onClick: () => void, testId?: string): React.ReactNode {
  return (
    <button className={css.viewBtn} onClick={(e) => { e.stopPropagation(); onClick(); }} data-testid={testId}>
      View
    </button>
  );
}

export function renderActionBadge(action: string): React.ReactNode {
  return renderStatusBadge(action);
}

export function formatIST(dateStr: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(dateStr));
}
