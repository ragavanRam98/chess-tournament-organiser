const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/* ─── Types ──────────────────────────────────────────────────────────── */

export interface ApiResponse<T> {
  data: T;
  meta?: { total?: number; page?: number; limit?: number; next_cursor?: string | null; has_next?: boolean };
}

export interface ApiError {
  error: { code: string | number; message: string | string[]; path: string; timestamp: string };
}

/* ─── Token store (sessionStorage — survives navigations, cleared on tab close) */

const TOKEN_KEY = 'eca_access_token';

export function setAccessToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(TOKEN_KEY);
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
    // Refresh failed — clear token
    setAccessToken(null);
    if (typeof window !== 'undefined') {
      window.location.href = '/organizer/login';
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
  return res.data;
}

export async function logout() {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setAccessToken(null);
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
