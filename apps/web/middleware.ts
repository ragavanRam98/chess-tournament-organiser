import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js middleware for server-side route protection.
 *
 * Reads the `ks_auth_role` cookie (set client-side when the JWT is stored)
 * to enforce role-based access before the page even renders:
 *
 *   /admin sub-pages → requires SUPER_ADMIN (exact /admin is allowed — it has its own login form)
 *   /organizer/*     → requires ORGANIZER role (except /organizer/login and /organizer/register)
 *
 * This is a first line of defence. Each page still has its own client-side
 * auth check, and the API enforces guards independently.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const role = request.cookies.get('ks_auth_role')?.value ?? null;

  // ── Admin sub-pages: must be SUPER_ADMIN ───────────────────────────
  // /admin itself is exempt — AdminLayout shows a login form there.
  if (pathname.startsWith('/admin/')) {
    if (role !== 'SUPER_ADMIN') {
      // Organizer on admin route → send to organizer dashboard
      if (role === 'ORGANIZER') {
        return NextResponse.redirect(new URL('/organizer/dashboard', request.url));
      }
      // Anyone else (unauthenticated / unknown) → admin login form
      return NextResponse.redirect(new URL('/admin', request.url));
    }
  }

  // ── Organizer routes (except login/register): must be ORGANIZER ────
  if (
    pathname.startsWith('/organizer/dashboard') ||
    pathname.startsWith('/organizer/tournaments')
  ) {
    if (role !== 'ORGANIZER') {
      // Admin accidentally on organizer route → send to admin
      if (role === 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/admin', request.url));
      }
      // Anyone else (unauthenticated / unknown) → organizer login
      return NextResponse.redirect(new URL('/organizer/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path+',
    '/organizer/dashboard/:path*',
    '/organizer/tournaments/:path*',
  ],
};
