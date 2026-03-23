'use client';

import { useEffect, useState } from 'react';
import {
  getAccessToken,
  getUserInfo,
  decodeJwtRole,
} from '@/lib/api';
import css from './AdminLayout.module.css';

/* ─── Admin Layout ───────────────────────────────────────────────── */

const NAV_LINKS = [
  { href: '/admin', key: 'dashboard', label: 'Dashboard' },
  { href: '/admin/tournaments', key: 'tournaments', label: 'Tournaments' },
  { href: '/admin/organizers', key: 'organizers', label: 'Organizers' },
  { href: '/admin/audit-logs', key: 'audit-logs', label: 'Audit Logs' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  activeNav?: string;
}

export default function AdminLayout({ children, activeNav }: AdminLayoutProps) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) { window.location.href = '/login'; return; }

    // Fast client-side role check — no extra API call.
    // SECURITY NOTE: decodeJwtRole does NOT verify the JWT signature.
    // This is intentional — it only gates UI rendering, not data access.
    // All admin API endpoints enforce JwtAuthGuard + RolesGuard server-side,
    // so a forged token would fail on every data fetch.
    const user = getUserInfo();
    if (user?.role === 'SUPER_ADMIN') {
      setAuthed(true); setLoading(false); return;
    }
    const role = decodeJwtRole(token);
    if (role === 'SUPER_ADMIN') {
      setAuthed(true); setLoading(false); return;
    }

    // Has a token but wrong role — redirect to login
    window.location.href = '/login';
  }, []);

  if (loading) return null; // avoid flash during hydration
  if (!authed) return null; // redirecting to /login

  return (
    <>
      <nav className={css.adminNav}>
        <div className={css.navInner}>
          {NAV_LINKS.map(l => (
            <a
              key={l.key}
              href={l.href}
              className={`${css.navLink} ${activeNav === l.key ? css.navLinkActive : ''}`}
            >
              {l.label}
            </a>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
