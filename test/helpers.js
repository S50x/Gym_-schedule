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
const { resetAllRateLimits } = await import('../server/security.js');

/**
 * The auth rate limiter is keyed on IP, and every test connects from 127.0.0.1,
 * so a suite that creates a dozen accounts would trip it. Tests that are not
 * about rate limiting clear the counter first; the limiter itself is covered by
 * its own dedicated test.
 */
let currentDb = null;
export async function resetRateLimits() {
  await currentDb?.run('DELETE FROM login_attempts');
  resetAllRateLimits();
}

/**
 * Set TEST_DATABASE_URL to run the whole suite against a real Postgres instead
 * of PGlite — which is what CI does, because PGlite is a WASM build and never
 * exercises the `pg` driver that postgres.test.js exists to guard.
 *
 * node:test runs one process per test file, concurrently. Against PGlite each
 * process has its own in-memory database, so nothing collides. A single shared
 * Postgres would: auth.test.js and reset.test.js both register the same default
 * address, and whichever lands second gets a 409. So each startServer() cuts
 * itself a fresh database and drops it on the way out.
 */
const PG_URL = process.env.TEST_DATABASE_URL || '';
let dbCounter = 0;

const withDbName = (url, name) => {
  const u = new URL(url);
  u.pathname = '/' + name;
  return u.toString();
};

/** A short-lived admin connection on the URL's own database, for CREATE/DROP. */
async function onAdmin(fn) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Boots the real app on the reserved port, against PGlite by default or a
 * throwaway Postgres database when TEST_DATABASE_URL is set.
 */
export async function startServer() {
  let db;
  let scratchDb = null;

  if (PG_URL) {
    // Generated here from pid and a counter — no caller input reaches it — and
    // still quoted, because an unquoted identifier is a habit worth not having.
    scratchDb = `hadeed_test_${process.pid}_${dbCounter++}`;
    await onAdmin((c) => c.query(`CREATE DATABASE "${scratchDb}"`));
    db = await createDb(withDbName(PG_URL, scratchDb));
  } else {
    db = await createDb('');
  }

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
      await db.close();
      if (scratchDb) {
        // FORCE because a pooled connection can outlive pool.end() by a moment.
        await onAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${scratchDb}" WITH (FORCE)`));
      }
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

    let data;
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
  await resetRateLimits();
  const res = await client.post('/api/auth/register', { email, password });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  return res;
}
