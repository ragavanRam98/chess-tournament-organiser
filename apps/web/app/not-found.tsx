import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: 'calc(100dvh - var(--header-height, 64px))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px',
      background: 'var(--bg-primary)',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        {/* Chess king icon */}
        <div style={{
          fontSize: '4rem',
          marginBottom: 16,
          filter: 'grayscale(0.3)',
          userSelect: 'none',
        }}>
          ♔
        </div>

        <h1 style={{
          fontSize: '5rem',
          fontWeight: 800,
          lineHeight: 1,
          marginBottom: 8,
          background: 'linear-gradient(135deg, var(--brand-blue), var(--brand-blue-light))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          404
        </h1>

        <h2 style={{
          fontSize: '1.4rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 12,
        }}>
          Page not found
        </h2>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '1rem',
          lineHeight: 1.6,
          marginBottom: 36,
        }}>
          This page doesn&apos;t exist or has been moved.<br />
          Check the URL or head back to find your next tournament.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-primary">
            View Tournaments
          </Link>
          <Link href="/organizer/login" className="btn btn-secondary">
            Organizer Login
          </Link>
        </div>
      </div>
    </div>
  );
}
