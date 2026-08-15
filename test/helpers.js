import net from 'node:net';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-32+';
process.env.ALLOW_REGISTRATION = '1';

/**
 * config.js reads ORIGIN once, at import time, and the CSRF Origin check
 * compares against it — so the port has to be known before the first import.
 * Reserve an ephemeral port, release it, then set ORIGIN and import.
 */
const PORT = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
process.env.ORIGIN = `http://127.0.0.1:${PORT}`;

const { createDb } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');

/**
 * The auth rate limiter is keyed on IP, and every test connects from 127.0.0.1,
 * so a suite that creates a dozen accounts would trip it. Tests that are not
 * about rate limiting clear the counter first; the limiter itself is covered by
 * its own dedicated test.
 */
let currentDb = null;
export function resetRateLimits() {
  currentDb?.prepare('DELETE FROM login_attempts').run();
}

/** Boots the real app on the reserved port with an in-memory database. */
export async function startServer() {
  const db = createDb(':memory:');
  currentDb = db;
  const app = createApp(db);
  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
  });
  const origin = `http://127.0.0.1:${PORT}`;

  return {
    db,
    origin,
    client: makeClient(origin),
    async close() {
      clearInterval(app.locals.sweepTimer);
      await new Promise((resolve) => server.close(resolve));
      db.close();
    },
  };
}

/** Minimal cookie-jar fetch client that behaves like a browser tab. */
export function makeClient(origin) {
  const jar = new Map();

  const cookieHeader = () =>
    [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const absorb = (res) => {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }
  };

  async function call(method, path, body, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };
    if (jar.size) headers.Cookie = cookieHeader();
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (method !== 'GET' && !('X-CSRF-Token' in headers) && options.csrf !== false) {
      headers['X-CSRF-Token'] = jar.get('csrf') || '';
    }
    if (options.origin !== null && !('Origin' in headers)) {
      headers.Origin = options.origin || origin;
    }

    const res = await fetch(origin + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    absorb(res);

    let data = null;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text();
    }
    return { status: res.status, data, headers: res.headers };
  }

  return {
    jar,
    get: (path, options) => call('GET', path, undefined, options),
    post: (path, body, options) => call('POST', path, body, options),
    put: (path, body, options) => call('PUT', path, body, options),
    del: (path, body, options) => call('DELETE', path, body, options),
    /** Fetch a page so the CSRF cookie is issued, like a real first page load. */
    async bootstrap() {
      await call('GET', '/api/config');
      return this;
    },
  };
}

export const goodPassword = 'correct-horse-battery-9';
export const goodEmail = 'saad@example.com';

export async function registerAndLogin(client, email = goodEmail, password = goodPassword) {
  await client.bootstrap();
  resetRateLimits();
  const res = await client.post('/api/auth/register', { email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res;
}
