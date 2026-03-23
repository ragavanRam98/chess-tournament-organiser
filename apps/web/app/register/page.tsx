'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

interface FormState {
  email: string; password: string; confirmPassword: string;
  academyName: string; contactPhone: string; city: string; state: string; description: string;
}

export default function RegisterPage() {
  const [form, setForm] = useState<FormState>({
    email: '', password: '', confirmPassword: '',
    academyName: '', contactPhone: '', city: '', state: '', description: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/register', {
        email: form.email,
        password: form.password,
        academyName: form.academyName,
        contactPhone: form.contactPhone,
        city: form.city,
        state: form.state,
        description: form.description || undefined,
      });
      setDone(true);
    } catch (err: unknown) {
      const apiErr = err as { error?: { message?: string } };
      const msg = apiErr?.error?.message ?? 'Registration failed. Please try again.';
      setError(msg === 'EMAIL_ALREADY_REGISTERED'
        ? 'This email is already registered. Try signing in instead.'
        : msg);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div style={{ minHeight: 'calc(100dvh - var(--header-height))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="card card-body animate-scaleIn" style={{ maxWidth: 480, width: '100%', textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>&#9989;</div>
          <h2 style={{ fontSize: '1.4rem', marginBottom: 12 }}>Registration submitted!</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 28 }}>
            Your academy account is <strong>pending admin verification</strong>.<br />
            You&apos;ll be able to sign in once an admin approves your application.
          </p>
          <a href="/login" className="btn btn-primary" style={{ display: 'inline-block' }}>
            Back to Sign In
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div className="animate-fadeInUp" style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{
          width: 64, height: 64, borderRadius: 'var(--radius-lg)', margin: '0 auto 14px',
          background: 'var(--ks-red)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.8rem',
          boxShadow: '0 8px 24px rgba(15,23,42,0.3)',
        }}>&#9812;</div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 6 }}>Register your Academy</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Create an organizer account to host chess tournaments on KingSquare.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-100" style={{ padding: 32, display: 'grid', gap: 20 }}>
        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', fontSize: '0.9rem', fontWeight: 500 }}>
            {error}
          </div>
        )}

        {/* Account credentials */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4 }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Account Credentials
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Email *</label>
          <input type="email" name="email" value={form.email} onChange={handleChange} required className="form-input" placeholder="organizer@yourchessacademy.com" autoFocus />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Password *</label>
            <input type="password" name="password" value={form.password} onChange={handleChange} required minLength={8} className="form-input" placeholder="Min. 8 characters" />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password *</label>
            <input type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} required className="form-input" placeholder="Repeat password" />
          </div>
        </div>

        {/* Academy details */}
        <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 4, marginTop: 4 }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Academy Details
          </p>
        </div>

        <div className="form-group">
          <label className="form-label">Academy / Club Name *</label>
          <input type="text" name="academyName" value={form.academyName} onChange={handleChange} required className="form-input" placeholder="e.g. Brilliant Minds Chess Academy" />
        </div>

        <div className="form-group">
          <label className="form-label">Contact Phone *</label>
          <input type="tel" name="contactPhone" value={form.contactPhone} onChange={handleChange} required className="form-input" placeholder="+91 98765 43210" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">City *</label>
            <input type="text" name="city" value={form.city} onChange={handleChange} required className="form-input" placeholder="Chennai" />
          </div>
          <div className="form-group">
            <label className="form-label">State *</label>
            <input type="text" name="state" value={form.state} onChange={handleChange} required className="form-input" placeholder="Tamil Nadu" />
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            Description
            <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>(optional)</span>
          </label>
          <textarea
            name="description" value={form.description} onChange={handleChange}
            className="form-input" placeholder="Tell us about your academy — experience, achievements, coaching staff..."
            rows={3} style={{ resize: 'vertical', minHeight: 80 }}
          />
        </div>

        <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '12px 16px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          After submitting, your account will be reviewed by an admin. You will receive approval confirmation before you can sign in.
        </div>

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
          {loading ? 'Submitting...' : 'Submit Registration'}
        </button>
      </form>

      <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Already have an account? <a href="/login">Sign in</a>
      </p>
    </div>
  );
}
