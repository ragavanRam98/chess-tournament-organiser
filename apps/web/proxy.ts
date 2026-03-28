import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 proxy (formerly middleware) for server-side route protection.
 *
 * Reads the `ks_auth_role` cookie (set client-side when the JWT is stored)
 * to enforce role-based access before the page even renders:
 *
 *   /admin/*         → requires SUPER_ADMIN
 *   /organizer/*     → requires ORGANIZER role
 *
 * This is a first line of defence. Each page still has its own client-side
 * auth check, and the API enforces guards independently.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = request.cookies.get('ks_auth_role')?.value ?? null;

  // ── Admin routes: must be SUPER_ADMIN ──────────────────────────────
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (role !== 'SUPER_ADMIN') {
      // Organizer on admin route → send to organizer dashboard
      if (role === 'ORGANIZER') {
        return NextResponse.redirect(new URL('/organizer/dashboard', request.url));
      }
      // Anyone else (unauthenticated / unknown) → unified login
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  // ── Organizer routes: must be ORGANIZER ────────────────────────────
  if (
    pathname.startsWith('/organizer/dashboard') ||
    pathname.startsWith('/organizer/tournaments')
  ) {
    if (role !== 'ORGANIZER') {
      // Admin accidentally on organizer route → send to admin
      if (role === 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/admin', request.url));
      }
      // Anyone else (unauthenticated / unknown) → unified login
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin',
    '/admin/:path+',
    '/organizer/dashboard/:path*',
    '/organizer/tournaments/:path*',
  ],
};
