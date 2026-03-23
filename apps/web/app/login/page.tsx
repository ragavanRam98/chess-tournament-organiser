'use client';

import { useState } from 'react';
import { login, decodeJwtRole, getAccessToken } from '@/lib/api';

/**
 * Unified login page — all roles land here.
 * After successful login the user is redirected based on their JWT role:
 *   SUPER_ADMIN → /admin
 *   ORGANIZER   → /organizer/dashboard
 */

const ROLE_DESTINATIONS: Record<string, string> = {
  SUPER_ADMIN: '/admin',
  ORGANIZER: '/organizer/dashboard',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      // Decode role from the just-stored JWT to decide where to go
      const token = getAccessToken();
      const role = token ? decodeJwtRole(token) : null;
      window.location.href = ROLE_DESTINATIONS[role ?? ''] ?? '/';
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
        {/* Logo block */}
        <div className="animate-fadeInUp" style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 'var(--radius-lg)', margin: '0 auto 16px',
            background: 'var(--ks-red)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', color: '#fff',
            boxShadow: '0 8px 24px rgba(196,30,30,0.25)',
          }}>&#9812;</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Welcome to KingSquare</h1>
          <p style={{ color: 'var(--text-muted)' }}>Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-100" style={{ padding: 32 }}>
          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', marginBottom: 20, fontSize: '0.9rem', fontWeight: 500 }}>
              {error}
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="form-input" placeholder="you@example.com" autoFocus />
          </div>

          <div className="form-group" style={{ marginBottom: 28 }}>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="form-input" placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;" />
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Don&apos;t have an account? <a href="/register">Register as organizer</a>
        </p>
      </div>
    </div>
  );
}
