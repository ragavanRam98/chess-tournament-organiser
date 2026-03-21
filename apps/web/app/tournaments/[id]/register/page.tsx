'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import FideInput from '@/components/FideInput';

interface Category {
  id: string; name: string; minAge: number; maxAge: number;
  maxSeats: number; registeredCount: number; entryFeePaise: number;
}

interface Tournament {
  id: string; title: string; city: string; categories: Category[];
}

function formatCurrency(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function RegistrationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const tournamentId = params.id as string;
  const preselectedCategory = searchParams.get('category');

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'form' | 'payment'>('form');

  // Form state
  const [form, setForm] = useState({
    playerName: '', playerDob: '', phone: '', email: '', city: '',
    categoryId: preselectedCategory ?? '', fideId: '', fideRating: '',
  });

  useEffect(() => {
    api.get<Tournament>(`/tournaments/${tournamentId}`)
      .then(res => setTournament(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [tournamentId]);

  const selectedCategory = tournament?.categories.find(c => c.id === form.categoryId);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Normalize phone to E.164: if user enters 10 digits without +91, prepend it
      let phone = form.phone.replace(/[\s\-()]/g, '');
      if (/^\d{10}$/.test(phone)) phone = `+91${phone}`;
      else if (!phone.startsWith('+')) phone = `+${phone}`;

      const payload = {
        tournamentId,
        categoryId: form.categoryId,
        playerName: form.playerName,
        playerDob: form.playerDob,
        phone,
        email: form.email || undefined,
        city: form.city || undefined,
        fideId: form.fideId || undefined,
        fideRating: form.fideRating ? parseInt(form.fideRating) : undefined,
      };

      const res = await api.post<{
        registration_id: string; entry_number: string; status: string;
        razorpay_order_id?: string; amount_paise?: number;
      }>('/registrations', payload);

      const data = res.data;

      if (data.razorpay_order_id && data.amount_paise) {
        // Open Razorpay checkout
        setStep('payment');
        openRazorpayCheckout(data.razorpay_order_id, data.amount_paise, data.entry_number);
      } else {
        // Free registration — redirect to confirmation
        window.location.href = `/registration/${data.entry_number}`;
      }
    } catch (err: any) {
      const msg = err?.error?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const openRazorpayCheckout = (orderId: string, amountPaise: number, entryNumber: string) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => {
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '',
        amount: amountPaise,
        currency: 'INR',
        name: 'KingSquare',
        description: `Tournament Registration — ${entryNumber}`,
        order_id: orderId,
        handler: () => {
          window.location.href = `/registration/${entryNumber}`;
        },
        prefill: {
          name: form.playerName,
          email: form.email,
          contact: form.phone,
        },
        theme: { color: '#2563eb' },
        modal: {
          ondismiss: () => {
            setStep('form');
            setError('Payment cancelled. You can try again.');
          },
        },
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    };
    document.head.appendChild(script);
  };

  if (loading) {
    return (
      <div className="container" style={{ padding: '60px 24px', maxWidth: 640, margin: '0 auto' }}>
        <div className="skeleton" style={{ height: 32, width: '60%', marginBottom: 24 }} />
        <div className="skeleton" style={{ height: 400, width: '100%' }} />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="container empty-state" style={{ padding: '80px 24px' }}>
        <div className="empty-state-icon">🔍</div>
        <h3>Tournament not found</h3>
        <a href="/" className="btn btn-primary" style={{ marginTop: 16 }}>← Back</a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px 80px' }}>
      <a href={`/tournaments/${tournamentId}`} style={{ display: 'inline-flex', gap: 6, marginBottom: 24, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        ← Back to {tournament.title}
      </a>

      <h1 className="animate-fadeInUp" style={{ fontSize: '1.75rem', marginBottom: 8 }}>
        Register for Tournament
      </h1>
      <p className="animate-fadeInUp delay-100" style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
        {tournament.title}
      </p>

      {step === 'payment' ? (
        <div className="card card-body animate-scaleIn" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '2rem', marginBottom: 16 }}>💳</div>
          <h3>Processing Payment...</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 8 }}>
            Complete your payment in the Razorpay window.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card card-body animate-fadeInUp delay-200">
          {error && (
            <div style={{ padding: '12px 16px', background: 'rgba(244,63,94,0.08)', borderRadius: 'var(--radius-md)', color: 'var(--brand-rose)', marginBottom: 20, fontSize: '0.9rem', fontWeight: 500 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gap: 20 }}>
            {/* Category */}
            <div className="form-group">
              <label className="form-label">Category *</label>
              <select name="categoryId" value={form.categoryId} onChange={handleChange} required className="form-select">
                <option value="">Select a category</option>
                {tournament.categories.map(c => {
                  const full = c.registeredCount >= c.maxSeats;
                  return (
                    <option key={c.id} value={c.id} disabled={full}>
                      {c.name} — {c.entryFeePaise === 0 ? 'Free' : formatCurrency(c.entryFeePaise)}
                      {full ? ' (FULL)' : ` (${c.maxSeats - c.registeredCount} seats left)`}
                    </option>
                  );
                })}
              </select>
              {selectedCategory && (
                <span className="form-hint">
                  Age: {selectedCategory.minAge === 0 && selectedCategory.maxAge >= 999 ? 'Open' : `${selectedCategory.minAge}–${selectedCategory.maxAge} years`}
                  {' · '}Fee: {selectedCategory.entryFeePaise === 0 ? 'Free' : formatCurrency(selectedCategory.entryFeePaise)}
                </span>
              )}
            </div>

            {/* Player Name */}
            <div className="form-group">
              <label className="form-label">Player Full Name *</label>
              <input type="text" name="playerName" value={form.playerName} onChange={handleChange} required className="form-input" placeholder="Enter player's full name" />
            </div>

            {/* DOB */}
            <div className="form-group">
              <label className="form-label">Date of Birth *</label>
              <input type="date" name="playerDob" value={form.playerDob} onChange={handleChange} required className="form-input" />
            </div>

            {/* Phone */}
            <div className="form-group">
              <label className="form-label">Phone Number *</label>
              <input type="tel" name="phone" value={form.phone} onChange={handleChange} required className="form-input" placeholder="9876543210 or +919876543210" pattern="[\+]?[0-9]{10,15}" />
            </div>

            {/* Email */}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" name="email" value={form.email} onChange={handleChange} className="form-input" placeholder="player@example.com" />
              <span className="form-hint">Optional — for confirmation email</span>
            </div>

            {/* City */}
            <div className="form-group">
              <label className="form-label">City</label>
              <input type="text" name="city" value={form.city} onChange={handleChange} className="form-input" placeholder="Chennai" />
            </div>

            {/* FIDE */}
            <FideInput
              value={form.fideId}
              onChange={v => setForm(prev => ({ ...prev, fideId: v }))}
              playerName={form.playerName}
              onVerified={d => setForm(prev => ({
                ...prev,
                fideRating: prev.fideRating || String(d.standard_rating ?? d.rapid_rating ?? ''),
              }))}
            />
            <div className="form-group">
              <label className="form-label">
                FIDE Rating
                <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>(optional)</span>
              </label>
              <input type="number" name="fideRating" value={form.fideRating} onChange={handleChange} className="form-input" placeholder="e.g. 1450" min={0} max={3400} />
              <span className="form-hint">Leave blank if unrated — we auto-fill from FIDE ID when verified.</span>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: 28 }}>
            {submitting ? 'Processing...' : selectedCategory && selectedCategory.entryFeePaise > 0
              ? `Pay ${formatCurrency(selectedCategory.entryFeePaise)} & Register`
              : 'Register (Free)'}
          </button>
        </form>
      )}
    </div>
  );
}
