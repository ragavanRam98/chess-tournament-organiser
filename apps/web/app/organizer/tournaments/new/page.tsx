'use client';

import { useState } from 'react';
import { api, getAccessToken } from '@/lib/api';

interface CategoryInput {
  key: number; name: string; minAge: string; maxAge: string; entryFeePaise: string; maxSeats: string;
}

let categoryKey = 1;

export default function CreateTournamentPage() {
  const [form, setForm] = useState({
    title: '', description: '', city: '', venue: '',
    startDate: '', endDate: '', registrationDeadline: '',
  });
  const [categories, setCategories] = useState<CategoryInput[]>([
    { key: 0, name: '', minAge: '0', maxAge: '999', entryFeePaise: '', maxSeats: '' },
  ]);
  const [posterFile, setPosterFile] = useState<File | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!getAccessToken()) {
    if (typeof window !== 'undefined') window.location.href = '/organizer/login';
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }));
  };

  const updateCategory = (key: number, field: string, value: string) => {
    setCategories(prev => prev.map(c => c.key === key ? { ...c, [field]: value } : c));
  };

  const handlePosterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPosterFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setPosterPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPosterPreview(null);
    }
  };

  const addCategory = () => {
    setCategories(prev => [...prev, { key: ++categoryKey, name: '', minAge: '0', maxAge: '999', entryFeePaise: '', maxSeats: '' }]);
  };

  const removeCategory = (key: number) => {
    if (categories.length <= 1) return;
    setCategories(prev => prev.filter(c => c.key !== key));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        ...form,
        categories: categories.map(c => ({
          name: c.name,
          minAge: parseInt(c.minAge) || 0,
          maxAge: parseInt(c.maxAge) || 999,
          entryFeePaise: parseInt(c.entryFeePaise) || 0,
          maxSeats: parseInt(c.maxSeats) || 50,
        })),
      };
      const res = await api.post<any>('/organizer/tournaments', payload);
      const tournamentId = res.data?.id;

      // Upload poster if selected
      if (posterFile && tournamentId) {
        try {
          const formData = new FormData();
          formData.append('poster', posterFile);
          const token = getAccessToken();
          const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
          await fetch(`${API_BASE}/organizer/tournaments/${tournamentId}/poster`, {
            method: 'POST',
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: formData,
          });
        } catch {
          // Poster upload failed silently — tournament was created
        }
      }

      window.location.href = '/organizer/dashboard';
    } catch (err: any) {
      const msg = err?.error?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Failed to create tournament');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 80px' }}>
      <a href="/organizer/dashboard" style={{ display: 'inline-flex', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        ← Back to Dashboard
      </a>

      <h1 className="animate-fadeInUp" style={{ fontSize: '1.75rem', marginBottom: 8 }}>Create Tournament</h1>
      <p className="animate-fadeInUp delay-100" style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
        Set up your chess tournament with categories and pricing.
      </p>

      <form onSubmit={handleSubmit}>
        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', marginBottom: 20, fontSize: '0.9rem', fontWeight: 500 }}>
            {error}
          </div>
        )}

        {/* Tournament details */}
        <div className="card card-body animate-fadeInUp delay-200" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 20 }}>Tournament Details</h3>
          <div style={{ display: 'grid', gap: 20 }}>
            <div className="form-group">
              <label className="form-label">Tournament Title *</label>
              <input type="text" name="title" value={form.title} onChange={handleChange} required className="form-input" placeholder="e.g. Chennai Open 2026" />
            </div>
            <div className="form-group">
              <label className="form-label">Description</label>
              <textarea name="description" value={form.description} onChange={handleChange} className="form-textarea" rows={3} placeholder="Tournament details, rules, prizes..." />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">City *</label>
                <input type="text" name="city" value={form.city} onChange={handleChange} required className="form-input" placeholder="Chennai" />
              </div>
              <div className="form-group">
                <label className="form-label">Venue *</label>
                <input type="text" name="venue" value={form.venue} onChange={handleChange} required className="form-input" placeholder="Convention Centre" />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Start Date *</label>
                <input type="date" name="startDate" value={form.startDate} onChange={handleChange} required className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">End Date *</label>
                <input type="date" name="endDate" value={form.endDate} onChange={handleChange} required className="form-input" />
              </div>
              <div className="form-group">
                <label className="form-label">Reg. Deadline *</label>
                <input type="date" name="registrationDeadline" value={form.registrationDeadline} onChange={handleChange} required className="form-input" />
              </div>
            </div>
          </div>
        </div>

        {/* Poster Upload */}
        <div className="card card-body animate-fadeInUp delay-300" style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 16 }}>Tournament Poster</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Upload a poster image (JPEG, PNG, or WebP, max 5 MB). This will be shown on the tournament page.
          </p>
          <div style={{
            border: '2px dashed var(--ks-border)', borderRadius: 'var(--radius-md)',
            padding: posterPreview ? 0 : 32, textAlign: 'center', cursor: 'pointer',
            position: 'relative', overflow: 'hidden', transition: 'border-color 0.2s',
          }}
            onClick={() => document.getElementById('poster-input')?.click()}
          >
            {posterPreview ? (
              <div style={{ position: 'relative' }}>
                <img src={posterPreview} alt="Poster preview" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', display: 'block' }} />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setPosterFile(null); setPosterPreview(null); }}
                  style={{
                    position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.6)', color: '#fff',
                    border: 'none', borderRadius: 'var(--radius-full)', width: 28, height: 28,
                    cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >✕</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.4 }}>🖼</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                  Click to upload or drag &amp; drop
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  JPEG, PNG, or WebP — max 5 MB
                </div>
              </>
            )}
            <input
              id="poster-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePosterChange}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* Categories */}
        <div className="card card-body animate-fadeInUp delay-300" style={{ marginBottom: 28 }}>
          <div className="flex-between" style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '1.1rem' }}>Categories</h3>
            <button type="button" onClick={addCategory} className="btn btn-secondary btn-sm">+ Add Category</button>
          </div>

          <div style={{ display: 'grid', gap: 20 }}>
            {categories.map((c, i) => (
              <div key={c.key} style={{ padding: 20, background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', position: 'relative' }}>
                {categories.length > 1 && (
                  <button type="button" onClick={() => removeCategory(c.key)}
                    style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand-rose)', fontSize: '1.1rem', fontWeight: 700 }}
                    title="Remove category">✕</button>
                )}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12, fontWeight: 600 }}>
                  Category {i + 1}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Name *</label>
                    <input type="text" value={c.name} onChange={e => updateCategory(c.key, 'name', e.target.value)} required className="form-input" placeholder="e.g. Under 10" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Min Age</label>
                    <input type="number" value={c.minAge} onChange={e => updateCategory(c.key, 'minAge', e.target.value)} className="form-input" placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Max Age</label>
                    <input type="number" value={c.maxAge} onChange={e => updateCategory(c.key, 'maxAge', e.target.value)} className="form-input" placeholder="999" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Entry Fee (₹ paise) *</label>
                    <input type="number" value={c.entryFeePaise} onChange={e => updateCategory(c.key, 'entryFeePaise', e.target.value)} required className="form-input" placeholder="50000 = ₹500" />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Max Seats *</label>
                    <input type="number" value={c.maxSeats} onChange={e => updateCategory(c.key, 'maxSeats', e.target.value)} required className="form-input" placeholder="50" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
          {submitting ? 'Creating...' : 'Create Tournament'}
        </button>
      </form>
    </div>
  );
}
