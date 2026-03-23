const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/* ─── Types ──────────────────────────────────────────────────────────── */

export interface ApiResponse<T> {
  data: T;
  meta?: { total?: number; page?: number; limit?: number; next_cursor?: string | null; has_next?: boolean };
}

export interface ApiError {
  error: { code: string | number; message: string | string[]; path: string; timestamp: string };
}

/* ─── Token + user-info store (sessionStorage) ─────────────────────────── */

const TOKEN_KEY     = 'eca_access_token';
const USER_INFO_KEY = 'eca_user_info';

export interface UserInfo {
  id: string;
  email: string;
  role: 'SUPER_ADMIN' | 'ORGANIZER';
  displayName: string;
}

export function setAccessToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    // Set a non-httpOnly cookie with just the role so Next.js middleware
    // can enforce route protection server-side. The cookie contains only
    // the role string (e.g. "ORGANIZER"), not the full JWT.
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload?.role) {
        document.cookie = `ks_auth_role=${payload.role}; path=/; SameSite=Lax; max-age=86400`;
      }
    } catch { /* ignore decode failure */ }
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_INFO_KEY);
    // Clear the auth role cookie
    document.cookie = 'ks_auth_role=; path=/; max-age=0';
  }
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setUserInfo(info: UserInfo | null) {
  if (typeof window === 'undefined') return;
  if (info) {
    sessionStorage.setItem(USER_INFO_KEY, JSON.stringify(info));
  } else {
    sessionStorage.removeItem(USER_INFO_KEY);
  }
  // Notify NavHeader (and any other listener) that auth state changed
  window.dispatchEvent(new CustomEvent('ks-auth-change'));
}

export function getUserInfo(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(USER_INFO_KEY);
    return raw ? (JSON.parse(raw) as UserInfo) : null;
  } catch {
    return null;
  }
}

/** Decodes a JWT payload without verifying the signature (client-side only). */
export function decodeJwtRole(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload?.role ?? null;
  } catch {
    return null;
  }
}

/* ─── Core fetch wrapper ──────────────────────────────────────────── */

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getAccessToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // include cookies for refresh token
  });

  // Handle 401 — try token refresh once
  if (res.status === 401 && token) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      const newToken = getAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      const retryRes = await fetch(url, { ...options, headers, credentials: 'include' });
      if (retryRes.ok) return retryRes.json();
      throw await parseError(retryRes);
    }
    // Refresh failed — read role BEFORE clearing, then redirect
    const cached = getUserInfo();
    setAccessToken(null);
    setUserInfo(null);
    if (typeof window !== 'undefined') {
      window.location.href = cached?.role === 'SUPER_ADMIN' ? '/admin' : '/organizer/login';
    }
    throw new Error('Session expired');
  }

  if (!res.ok) throw await parseError(res);
  
  // Handle 204 No Content
  if (res.status === 204) return { data: {} as T };
  
  return res.json();
}

/* ─── Convenience methods ──────────────────────────────────────────── */

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

/* ─── Auth helpers ─────────────────────────────────────────────────── */

export async function login(email: string, password: string) {
  const res = await api.post<{ access_token: string; user: any }>('/auth/login', { email, password });
  setAccessToken(res.data.access_token);
  // Fetch and cache the user profile for the NavHeader avatar.
  // Fire-and-forget — a failed /auth/me does not break the login flow.
  fetchAndCacheUserInfo().catch(() => undefined);
  return res.data;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setAccessToken(null);
  setUserInfo(null);
  if (typeof window !== 'undefined') window.location.href = '/';
}

/** Calls GET /auth/me and caches the result in sessionStorage. */
export async function fetchAndCacheUserInfo(): Promise<UserInfo | null> {
  try {
    const res = await api.get<UserInfo>('/auth/me');
    setUserInfo(res.data);
    return res.data;
  } catch {
    return null;
  }
}

async function tryRefreshToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return false;
    const data = await res.json();
    setAccessToken(data.data.access_token);
    return true;
  } catch {
    return false;
  }
}

/* ─── Error parsing ────────────────────────────────────────────────── */

async function parseError(res: Response): Promise<ApiError> {
  try {
    return await res.json();
  } catch {
    return {
      error: {
        code: res.status.toString(),
        message: res.statusText,
        path: '',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
