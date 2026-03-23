'use client';

import { useEffect, useState } from 'react';
import {
  api,
  getAccessToken,
  setAccessToken,
  fetchAndCacheUserInfo,
  getUserInfo,
  decodeJwtRole,
} from '@/lib/api';
import css from './AdminLayout.module.css';

/* ─── Inline Admin Login ─────────────────────────────────────────── */

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
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
    <div className={css.loginWrap}>
      <div className={css.loginCard}>
        <div className={`${css.loginHeader} animate-fadeInUp`}>
          <div className={css.loginIcon}>&#128737;</div>
          <h1 className={css.loginTitle}>Admin Portal</h1>
          <p className={css.loginSub}>Sign in with super-admin credentials</p>
        </div>

        <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-100" style={{ padding: 32 }}>
          {error && <div className={css.loginError}>{error}</div>}
          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" placeholder="admin@easychess.local" autoFocus />
          </div>
          <div className="form-group" style={{ marginBottom: 28 }}>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-input" placeholder="••••••••" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', background: 'linear-gradient(135deg, #dc2626, #b91c1c)' }}>
            {loading ? 'Signing in...' : 'Sign In as Admin'}
          </button>
        </form>
      </div>
    </div>
  );
}

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
    if (!token) { setLoading(false); return; }

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

    setLoading(false);
  }, []);

  if (loading) return null; // avoid flash during hydration
  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />;

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
