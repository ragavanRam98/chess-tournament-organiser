'use client';

/**
 * NavHeader — role-aware sticky header with profile avatar and logout dropdown.
 *
 * GAP 1: Provides logout button for all authenticated roles (Organizer, Admin).
 *        Critical for shared-device scenarios (school labs, cyber cafes).
 * GAP 2: Shows initials-based avatar, truncated display name, and role badge
 *        in the top-right corner. Colour-coded by role:
 *          SUPER_ADMIN → coral/red  (#f43f5e)
 *          ORGANIZER   → blue       (#2563eb)
 *          (Player accounts reserved for Phase 2)
 *
 * No external avatar service — initials are generated client-side. Zero cost.
 */

import { useEffect, useRef, useState } from 'react';
import {
  getUserInfo,
  fetchAndCacheUserInfo,
  logout,
  getAccessToken,
  type UserInfo,
} from '@/lib/api';

/* ── Role colour map ─────────────────────────────────────────────────── */

const ROLE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  SUPER_ADMIN: { bg: '#C41E1E', text: '#fff', label: 'Admin' },
  ORGANIZER:   { bg: '#1A1A1A', text: '#fff', label: 'Organizer' },
};

const DEFAULT_COLOR = { bg: '#10b981', text: '#fff', label: 'Player' };

function getRoleStyle(role: string) {
  return ROLE_COLORS[role] ?? DEFAULT_COLOR;
}

/** Returns up to 2 uppercase initials from a display name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── Component ───────────────────────────────────────────────────────── */

export default function NavHeader() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [mounted, setMounted] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // On mount: read cached user info OR fetch it if a valid token exists.
  // Set mounted=true so we don't flash the "Sign in" button during SSR→client hydration.
  useEffect(() => {
    const cached = getUserInfo();
    if (cached) {
      setUser(cached);
    } else if (getAccessToken()) {
      fetchAndCacheUserInfo().then(setUser).catch(() => null);
    }
    setMounted(true);

    // Listen for auth changes (e.g. inline admin login on same page)
    const handleAuthChange = () => {
      const updated = getUserInfo();
      setUser(updated);
    };
    window.addEventListener('ks-auth-change', handleAuthChange);
    return () => window.removeEventListener('ks-auth-change', handleAuthChange);
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout(); // clears sessionStorage and redirects to '/'
  };

  const roleStyle = user ? getRoleStyle(user.role) : DEFAULT_COLOR;

  return (
    <header className="header">
      <div className="container header-inner">
        {/* ── Logo ─────────────────────────────────── */}
        <a href="/" className="logo">
          <span className="logo-icon">♔</span>
          KingSquare
        </a>

        {/* ── Nav + Profile ───────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <nav>
            <ul className="nav-links" style={{ marginRight: 8 }}>
              <li><a href="/" className="nav-link">Tournaments</a></li>
            </ul>
          </nav>

          {!mounted ? (
            /* ── Not yet hydrated — show neutral placeholder to avoid sign-in flash ── */
            <div style={{ width: 80, height: 36 }} />
          ) : user ? (
            /* ── Authenticated: avatar + dropdown ── */
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setDropdownOpen(o => !o)}
                aria-label="Account menu"
                aria-expanded={dropdownOpen}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px 6px 6px',
                  background: 'var(--ks-white)',
                  border: '1.5px solid var(--ks-border)',
                  borderRadius: 'var(--radius-full)',
                  cursor: 'pointer',
                  transition: 'border-color var(--duration-fast) var(--ease-out)',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--ks-red)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--ks-border)')}
              >
                {/* Initials avatar */}
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: roleStyle.bg,
                    color: roleStyle.text,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    flexShrink: 0,
                  }}
                >
                  {initials(user.displayName)}
                </span>

                {/* Name + role badge — hide on very small screens */}
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      maxWidth: 120,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {user.displayName}
                  </span>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: roleStyle.bg,
                    }}
                  >
                    {roleStyle.label}
                  </span>
                </span>

                {/* Chevron */}
                <svg
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{
                    color: 'var(--text-muted)',
                    transform: dropdownOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--duration-fast) var(--ease-out)',
                    flexShrink: 0,
                  }}
                >
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* ── Dropdown ────────────────────────── */}
              {dropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 8px)',
                    right: 0,
                    width: 220,
                    background: 'var(--ks-white)',
                    border: '1px solid var(--ks-border)',
                    borderRadius: 'var(--radius-md)',
                    boxShadow: 'var(--shadow-xl)',
                    overflow: 'hidden',
                    animation: 'scaleIn var(--duration-fast) var(--ease-spring) both',
                    zIndex: 200,
                  }}
                >
                  {/* User identity header */}
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--ks-border)', background: 'var(--ks-off-white)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          width: 36, height: 36,
                          borderRadius: '50%',
                          background: roleStyle.bg,
                          color: roleStyle.text,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: "'Inter', sans-serif",
                          fontWeight: 700, fontSize: '0.8rem', flexShrink: 0,
                        }}
                      >
                        {initials(user.displayName)}
                      </span>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user.displayName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {user.email}
                        </div>
                      </div>
                    </div>
                    {/* Role badge */}
                    <div style={{ marginTop: 8 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 'var(--radius-full)',
                          background: `${roleStyle.bg}18`,
                          color: roleStyle.bg,
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          textTransform: 'uppercase',
                        }}
                      >
                        {roleStyle.label}
                      </span>
                    </div>
                  </div>

                  {/* Menu items */}
                  <div style={{ padding: '6px 0' }}>
                    {user.role === 'ORGANIZER' && (
                      <>
                        <DropdownItem href="/organizer/dashboard" icon="🏆" label="My Tournaments" onClick={() => setDropdownOpen(false)} />
                        <DropdownItem href="/organizer/tournaments/new" icon="+" label="New Tournament" onClick={() => setDropdownOpen(false)} />
                      </>
                    )}
                    {user.role === 'SUPER_ADMIN' && (
                      <>
                        <DropdownItem href="/admin" icon="🛡️" label="Admin Dashboard" onClick={() => setDropdownOpen(false)} />
                        <DropdownItem href="/admin/tournaments" icon="🏆" label="Tournaments" onClick={() => setDropdownOpen(false)} />
                        <DropdownItem href="/admin/organizers" icon="👥" label="Organizers" onClick={() => setDropdownOpen(false)} />
                        <DropdownItem href="/admin/audit-logs" icon="📋" label="Audit Logs" onClick={() => setDropdownOpen(false)} />
                      </>
                    )}
                  </div>

                  {/* Logout */}
                  <div style={{ padding: '6px 0', borderTop: '1px solid var(--ks-border)' }}>
                    <button
                      onClick={handleLogout}
                      disabled={loggingOut}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 16px',
                        background: 'none',
                        border: 'none',
                        cursor: loggingOut ? 'not-allowed' : 'pointer',
                        color: 'var(--brand-rose)',
                        fontSize: '0.875rem',
                        fontWeight: 600,
                        fontFamily: "'Inter', sans-serif",
                        textAlign: 'left',
                        opacity: loggingOut ? 0.6 : 1,
                        transition: 'background var(--duration-fast) var(--ease-out)',
                      }}
                      onMouseEnter={e => !loggingOut && (e.currentTarget.style.background = 'rgba(244,63,94,0.06)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <span style={{ fontSize: '1rem' }}>↩</span>
                      {loggingOut ? 'Signing out…' : 'Sign out'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Guest: Sign in button ─────────────── */
            <a href="/login" className="btn btn-primary btn-sm">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

/* ── Dropdown menu item ─────────────────────────────────────────────── */

function DropdownItem({
  href, icon, label, onClick,
}: { href: string; icon: string; label: string; onClick: () => void }) {
  return (
    <a
      href={href}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        color: 'var(--text-secondary)',
        fontSize: '0.875rem',
        fontWeight: 500,
        transition: 'background var(--duration-fast) var(--ease-out)',
        textDecoration: 'none',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--ks-off-white)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
    >
      <span style={{ fontSize: '0.9rem', width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      {label}
    </a>
  );
}
