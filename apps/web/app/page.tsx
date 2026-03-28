'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from './page.module.css';

interface Category {
  id: string; name: string; maxSeats: number; registeredCount: number; entryFeePaise: number;
}

interface Tournament {
  id: string; title: string; city: string; venue: string; startDate: string; endDate: string;
  registrationDeadline: string; status: string;
  organizer: { academyName: string; city: string };
  categories: Category[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysUntil(d: string) {
  const diff = (new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(diff));
}

function formatCurrency(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export default function HomePage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Tournament[]>('/tournaments?status=ACTIVE')
      .then(res => setTournaments(Array.isArray(res.data) ? res.data : (res as any).data?.tournaments ?? []))
      .catch(() => setTournaments([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* ── Hero ────────────────────────────── */}
      <section className="hero">
        <div className="container">
          <h1 className="hero-title animate-fadeInUp">Discover Chess Tournaments</h1>
          <p className="hero-subtitle animate-fadeInUp delay-100">
            Browse upcoming tournaments, register online, and secure your spot in minutes.
            India&apos;s premier chess tournament platform.
          </p>
        </div>
      </section>

      {/* ── Tournament Cards ────────────────── */}
      <section className="container" style={{ paddingTop: 48, paddingBottom: 80 }}>
        {loading ? (
          <div className="grid-cards">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="card" style={{ minHeight: 280 }}>
                <div className="card-body">
                  <div className="skeleton" style={{ height: 24, width: '70%', marginBottom: 16 }} />
                  <div className="skeleton" style={{ height: 16, width: '50%', marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 16, width: '40%', marginBottom: 24 }} />
                  <div className="skeleton" style={{ height: 32, width: '100%', marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 32, width: '100%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : tournaments.length === 0 ? (
          <div className="empty-state animate-fadeIn">
            <div className="empty-state-icon">♟</div>
            <h3 style={{ marginBottom: 8 }}>No tournaments available</h3>
            <p>Check back soon — new tournaments are posted regularly.</p>
          </div>
        ) : (
          <div className="grid-cards">
            {tournaments.map((t, i) => {
              const totalSeats = t.categories.reduce((s, c) => s + c.maxSeats, 0);
              const filledSeats = t.categories.reduce((s, c) => s + c.registeredCount, 0);
              const fillPct = totalSeats ? Math.round((filledSeats / totalSeats) * 100) : 0;
              const deadline = daysUntil(t.registrationDeadline);
              const minFee = Math.min(...t.categories.map(c => c.entryFeePaise));

              return (
                <Link href={`/tournaments/${t.id}`} key={t.id} className={`card ${styles.tournamentCard} animate-fadeInUp`} style={{ animationDelay: `${i * 80}ms` }}>
                  <div className={styles.cardBanner}>
                    <span className={styles.cardCity}>📍 {t.city}</span>
                    {deadline <= 3 && deadline > 0 && (
                      <span className="badge badge-warning">⏰ {deadline}d left</span>
                    )}
                    {deadline === 0 && <span className="badge badge-danger">Deadline today</span>}
                  </div>
                  <div className="card-body">
                    <h3 className={styles.cardTitle}>{t.title}</h3>
                    <p className={styles.cardOrganizer}>by {t.organizer?.academyName}</p>

                    <div className={styles.cardMeta}>
                      <span>🗓 {formatDate(t.startDate)}{t.startDate !== t.endDate ? ` – ${formatDate(t.endDate)}` : ''}</span>
                      <span>🏛 {t.venue}</span>
                    </div>

                    {/* Categories pills */}
                    <div className={styles.categoryPills}>
                      {t.categories.slice(0, 4).map(c => (
                        <span key={c.id} className={styles.pill}>{c.name}</span>
                      ))}
                      {t.categories.length > 4 && (
                        <span className={styles.pill}>+{t.categories.length - 4} more</span>
                      )}
                    </div>

                    {/* Seat availability */}
                    <div className={styles.seatInfo}>
                      <div className="flex-between" style={{ fontSize: '0.8rem', marginBottom: 4 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{filledSeats}/{totalSeats} seats filled</span>
                        <span style={{ fontWeight: 600 }}>{fillPct}%</span>
                      </div>
                      <div className="progress-bar">
                        <div className={`progress-fill ${fillPct > 85 ? 'danger' : fillPct > 60 ? 'warning' : ''}`} style={{ width: `${fillPct}%` }} />
                      </div>
                    </div>

                    <div className={styles.cardFooter}>
                      <span className={styles.price}>From {formatCurrency(minFee)}</span>
                      <span className="btn btn-primary btn-sm">Register →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
