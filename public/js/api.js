/** غلاف بسيط حول fetch مع رمز CSRF. Thin fetch wrapper that carries the CSRF token. */

function csrfToken() {
  const match = /(?:^|;\s*)csrf=([A-Za-z0-9_-]+)/.exec(document.cookie);
  return match ? match[1] : '';
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error || 'error';
    this.body = body || {};
  }
}

async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken();

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  let payload = null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    payload = await res.json().catch(() => null);
  }

  // 409 on PUT /state is an expected outcome, not a failure — the caller handles it.
  if (!res.ok && res.status !== 409) throw new ApiError(res.status, payload);
  return { status: res.status, data: payload };
}

export const api = {
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/auth/me'),
  register: (email, password) => request('POST', '/api/auth/register', { email, password }),
  login: (email, password) => request('POST', '/api/auth/login', { email, password }),
  verifyMfa: (code) => request('POST', '/api/auth/login/verify', { code }),
  setup2fa: (password) => request('POST', '/api/auth/2fa/setup', { password }),
  enable2fa: (code) => request('POST', '/api/auth/2fa/enable', { code }),
  disable2fa: (password, code) => request('POST', '/api/auth/2fa/disable', { password, code }),
  newRecoveryCodes: (password) => request('POST', '/api/auth/2fa/recovery-codes', { password }),
  logout: () => request('POST', '/api/auth/logout', {}),
  logoutAll: () => request('POST', '/api/auth/logout-all', {}),
  changePassword: (currentPassword, newPassword) =>
    request('POST', '/api/auth/change-password', { currentPassword, newPassword }),
  getState: () => request('GET', '/api/state'),
  putState: (baseVersion, doc) => request('PUT', '/api/state', { baseVersion, doc }),
};
