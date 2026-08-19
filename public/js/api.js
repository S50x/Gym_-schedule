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

/**
 * The request never reached the server, or the server never answered.
 *
 * Worth separating from ApiError, because the two need opposite advice. Free
 * hosting puts the service to sleep after a quiet spell, and the first request
 * afterwards can sit for the best part of a minute while it wakes. Telling
 * someone to "check your connection" at that moment blames the wrong thing —
 * their connection is fine, the server is starting.
 */
export class NetworkError extends Error {
  constructor(reason) {
    super(
      reason === 'offline'
        ? 'ما فيه اتصال بالإنترنت. بياناتك محفوظة على جهازك.'
        : 'السيرفر ما رد. لو هذي أول فتحة بعد فترة، الاستضافة المجانية تنام — انتظر دقيقة وجرّب مرة ثانية.'
    );
    this.name = 'NetworkError';
    this.reason = reason;
  }
}

// A waking free instance routinely takes 30–60s to answer the first request,
// so the ceiling has to sit above that or we would abort a request that was
// about to succeed.
const REQUEST_TIMEOUT_MS = 75_000;

async function request(method, path, body, { retryOnWake = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken();

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout?.(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new NetworkError('offline');
    }
    // Online but nothing answered: most often a sleeping instance dropping the
    // first connection as it starts. One quiet retry turns that into a slow
    // request instead of a visible failure.
    if (retryOnWake) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return request(method, path, body, { retryOnWake: false });
    }
    throw new NetworkError('unreachable');
  }

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
  forgotPassword: (email) => request('POST', '/api/auth/forgot', { email }),
  resetPassword: (token, password) => request('POST', '/api/auth/reset', { token, password }),
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
