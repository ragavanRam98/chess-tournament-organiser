'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

interface RegistrationStatus {
  entry_number: string;
  player_name: string;
  tournament_title: string;
  category_name: string;
  status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'CANCELLED';
  confirmed_at: string | null;
}

export default function RegistrationConfirmationPage() {
  const params = useParams();
  const entryNumber = params.entryNumber as string;
  const [data, setData] = useState<RegistrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [pollCount, setPollCount] = useState(0);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get<RegistrationStatus>(`/registrations/${entryNumber}/status`);
        setData(res.data);
        setLoading(false);

        // Stop polling if CONFIRMED or CANCELLED
        if (res.data.status === 'CONFIRMED' || res.data.status === 'CANCELLED') return;

        // Continue polling while PENDING_PAYMENT (max 60 polls = 5 min)
        if (pollCount < 60) {
          setTimeout(() => setPollCount(p => p + 1), 5000);
        }
      } catch {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [entryNumber, pollCount]);

  if (loading) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <div className="skeleton" style={{ height: 200, marginBottom: 24 }} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="container empty-state" style={{ padding: '80px 24px' }}>
        <div className="empty-state-icon">🔍</div>
        <h3>Registration not found</h3>
        <p style={{ marginTop: 8 }}>Entry number <strong>{entryNumber}</strong> was not found.</p>
        <a href="/" className="btn btn-primary" style={{ marginTop: 20 }}>← Back to tournaments</a>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '60px 24px 80px', textAlign: 'center' }}>
      {data.status === 'CONFIRMED' ? (
        <div className="animate-scaleIn">
          {/* Animated checkmark */}
          <div style={{
            width: 100, height: 100, borderRadius: '50%', margin: '0 auto 24px',
            background: 'linear-gradient(135deg, var(--brand-emerald), #34d399)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 30px rgba(16,185,129,0.3)',
          }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path
                d="M12 24L20 32L36 16"
                stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 50, animation: 'checkmark 0.6s ease-out 0.3s both' }}
              />
            </svg>
          </div>

          <h1 style={{ fontSize: '1.75rem', marginBottom: 8, color: 'var(--brand-emerald)' }}>
            Registration Confirmed!
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
            You&apos;re all set for the tournament.
          </p>

          <div className="card card-body" style={{ textAlign: 'left' }}>
            <div style={{ display: 'grid', gap: 16 }}>
              <InfoRow label="Entry Number" value={data.entry_number} highlight />
              <InfoRow label="Player Name" value={data.player_name} />
              <InfoRow label="Tournament" value={data.tournament_title} />
              <InfoRow label="Category" value={data.category_name} />
              {data.confirmed_at && (
                <InfoRow label="Confirmed At" value={new Date(data.confirmed_at).toLocaleString('en-IN')} />
              )}
            </div>
          </div>

          <p style={{ marginTop: 24, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            A confirmation email has been sent. Please save your entry number for reference.
          </p>
        </div>
      ) : data.status === 'PENDING_PAYMENT' ? (
        <div className="animate-fadeIn">
          <div style={{
            width: 100, height: 100, borderRadius: '50%', margin: '0 auto 24px',
            background: 'linear-gradient(135deg, var(--brand-gold), var(--brand-gold-light))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem',
            boxShadow: '0 8px 30px rgba(245,158,11,0.3)', animation: 'pulse 2s ease infinite',
          }}>
            ⏳
          </div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: 8 }}>Awaiting Payment</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
            Your registration for <strong>{data.tournament_title}</strong> is pending payment.
          </p>
          <div className="card card-body" style={{ textAlign: 'left' }}>
            <InfoRow label="Entry Number" value={data.entry_number} highlight />
            <InfoRow label="Status" value="Pending Payment" />
          </div>
          <p style={{ marginTop: 24, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Your seat is reserved for 2 hours. Complete payment to confirm your registration.
          </p>
        </div>
      ) : (
        <div className="animate-fadeIn">
          <div style={{
            width: 100, height: 100, borderRadius: '50%', margin: '0 auto 24px',
            background: 'rgba(244,63,94,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem',
          }}>
            ✕
          </div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: 8, color: 'var(--brand-rose)' }}>Registration Cancelled</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            This registration has been cancelled. You can register again for an available tournament.
          </p>
          <a href="/" className="btn btn-primary" style={{ marginTop: 24 }}>Browse tournaments</a>
        </div>
      )}

      <a href="/" style={{ display: 'block', marginTop: 32, fontSize: '0.9rem' }}>← Back to tournaments</a>
    </div>
  );
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{label}</span>
      <span style={{
        fontWeight: highlight ? 800 : 600, fontSize: highlight ? '1.1rem' : '0.95rem',
        fontFamily: highlight ? "'Inter', sans-serif" : undefined,
        color: highlight ? 'var(--brand-blue)' : 'var(--text-primary)',
      }}>
        {value}
      </span>
    </div>
  );
}
