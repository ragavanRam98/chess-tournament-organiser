'use client';

/**
 * FideInput — GAP 4
 *
 * A drop-in replacement for the plain FIDE ID text input.
 * Performs a live debounced lookup against the local FIDE player table
 * (no external API — data is synced monthly from the public FIDE rating list).
 *
 * States:
 *   idle      — blank or too short (< 5 chars)
 *   loading   — debounce fired, waiting for API response
 *   verified  — found, name matches player name field (green ✓)
 *   mismatch  — found, but FIDE shows a different name (orange ⚠)
 *   not_found — numeric ID but not in our DB (red ✗)
 *   invalid   — non-numeric characters entered
 *
 * Props:
 *   value       — current FIDE ID string (controlled)
 *   onChange    — update callback (controlled)
 *   playerName  — current player name from the form (for mismatch detection)
 */

import { useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const DEBOUNCE_MS = 500;
const MIN_LENGTH = 5; // FIDE IDs are 7–8 digits; allow lookup after 5

type ValidationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'verified'; fideData: FideData }
  | { status: 'mismatch'; fideData: FideData }
  | { status: 'not_found' }
  | { status: 'invalid' };

interface FideData {
  fide_id: string;
  name: string;
  country: string;
  title: string | null;
  standard_rating: number | null;
  rapid_rating: number | null;
  blitz_rating: number | null;
}

interface FideInputProps {
  value: string;
  onChange: (value: string) => void;
  playerName: string;
  /** Called when a FIDE ID is successfully verified — lets the parent auto-fill rating fields. */
  onVerified?: (data: FideData) => void;
}

/** Normalise a name for comparison: lowercase, strip punctuation, collapse spaces. */
function normaliseName(n: string): string {
  return n.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Check if the FIDE name is a plausible match for the submitted player name.
 *  FIDE stores names as "SURNAME, Firstname" — we compare both orderings. */
function namesMatch(fideName: string, playerName: string): boolean {
  const fide = normaliseName(fideName);
  const player = normaliseName(playerName);
  if (!fide || !player) return false;

  // Exact match
  if (fide === player) return true;

  // FIDE "Surname, Firstname" → "firstname surname" reorder match
  const reversed = fide
    .split(',')
    .map(s => s.trim())
    .reverse()
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (reversed === player) return true;

  // Substring match (handles middle names / initials)
  const playerParts = player.split(' ');
  const fideParts = fide.replace(',', '').split(' ');
  return playerParts.every(part => fideParts.some(fp => fp.startsWith(part) || part.startsWith(fp)));
}

export default function FideInput({ value, onChange, playerName, onVerified }: FideInputProps) {
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle' });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Clear previous debounce + in-flight request
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    const trimmed = value.trim();

    if (!trimmed) {
      setValidation({ status: 'idle' });
      return;
    }

    if (!/^\d+$/.test(trimmed)) {
      setValidation({ status: 'invalid' });
      return;
    }

    if (trimmed.length < MIN_LENGTH) {
      setValidation({ status: 'idle' });
      return;
    }

    // Debounce the API call
    setValidation({ status: 'loading' });
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`${API_BASE}/fide/lookup?fide_id=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });

        if (res.status === 404) {
          setValidation({ status: 'not_found' });
          return;
        }
        if (!res.ok) {
          // Treat unexpected errors as idle — don't block registration
          setValidation({ status: 'idle' });
          return;
        }

        const data = await res.json();
        const fideData: FideData = data.data;

        if (playerName && !namesMatch(fideData.name, playerName)) {
          setValidation({ status: 'mismatch', fideData });
        } else {
          setValidation({ status: 'verified', fideData });
          onVerified?.(fideData);
        }
      } catch (err: unknown) {
        if ((err as Error).name !== 'AbortError') {
          setValidation({ status: 'idle' });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, playerName]);

  const borderColor = {
    idle: 'var(--border-medium)',
    loading: 'var(--border-medium)',
    verified: '#10b981',
    mismatch: '#f59e0b',
    not_found: '#f43f5e',
    invalid: '#f43f5e',
  }[validation.status];

  return (
    <div className="form-group">
      <label className="form-label">
        FIDE ID
        <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>(optional — leave blank if unrated)</span>
      </label>

      <div style={{ position: 'relative' }}>
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="form-input"
          placeholder="e.g. 35011263"
          maxLength={20}
          style={{
            borderColor,
            paddingRight: 40,
            transition: 'border-color var(--duration-fast) var(--ease-out)',
          }}
        />

        {/* Status icon — positioned inside the input on the right */}
        <span
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '1rem',
            lineHeight: 1,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          {validation.status === 'loading'  && <LoadingSpinner />}
          {validation.status === 'verified'  && '✓'}
          {validation.status === 'mismatch'  && '⚠'}
          {validation.status === 'not_found' && '✗'}
          {validation.status === 'invalid'   && '✗'}
        </span>
      </div>

      {/* Status message */}
      <ValidationMessage state={validation} />
    </div>
  );
}

/* ── Status message ────────────────────────────────────────────────── */

function ValidationMessage({ state }: { state: ValidationState }) {
  if (state.status === 'idle') {
    return (
      <span className="form-hint">
        Your 7–8 digit FIDE ID. We verify it against the official FIDE rating list.
      </span>
    );
  }

  if (state.status === 'loading') {
    return (
      <span className="form-hint" style={{ color: 'var(--text-muted)' }}>
        Looking up FIDE ID…
      </span>
    );
  }

  if (state.status === 'invalid') {
    return (
      <span className="form-error">
        FIDE IDs contain only digits.
      </span>
    );
  }

  if (state.status === 'not_found') {
    return (
      <span className="form-error">
        FIDE ID not found in our rating list. Check the number or leave blank if unrated.
      </span>
    );
  }

  if (state.status === 'verified') {
    const d = state.fideData;
    return (
      <span style={{ fontSize: '0.82rem', color: '#059669', fontWeight: 500, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span>✓ Verified —</span>
        <strong>{d.name}</strong>
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({d.country})</span>
        {d.title && (
          <span style={{
            background: 'rgba(16,185,129,0.1)', color: '#059669',
            padding: '1px 8px', borderRadius: 'var(--radius-full)',
            fontSize: '0.75rem', fontWeight: 700,
          }}>
            {d.title}
          </span>
        )}
        {d.standard_rating && (
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
            Std: <strong>{d.standard_rating}</strong>
          </span>
        )}
        {d.rapid_rating && (
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
            Rapid: <strong>{d.rapid_rating}</strong>
          </span>
        )}
      </span>
    );
  }

  if (state.status === 'mismatch') {
    const d = state.fideData;
    return (
      <span style={{ fontSize: '0.82rem', color: '#d97706', fontWeight: 500 }}>
        ⚠ Name mismatch — FIDE shows <strong>{d.name}</strong> ({d.country})
        {d.standard_rating && `, rating ${d.standard_rating}`}. Check the ID or your name spelling.
      </span>
    );
  }

  return null;
}

/* ── Loading spinner (inline SVG — no dependencies) ────────────────── */

function LoadingSpinner() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 16 16" fill="none"
      style={{ animation: 'spin 0.8s linear infinite', display: 'inline-block' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="8" cy="8" r="6" stroke="var(--border-medium)" strokeWidth="2"/>
      <path d="M8 2a6 6 0 0 1 6 6" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}
