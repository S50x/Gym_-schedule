import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeClient, registerAndLogin } from './helpers.js';

test('security controls', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('sends a strict Content-Security-Policy with no unsafe-inline', async () => {
    const res = await fetch(app.origin + '/');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'CSP header present');
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.ok(!csp.includes("'unsafe-inline'"), 'no unsafe-inline');
    assert.ok(!csp.includes("'unsafe-eval'"), 'no unsafe-eval');
    // Everything is same-origin — no third-party host may appear anywhere.
    assert.ok(!/https?:\/\//.test(csp), 'no external origins allowed');
  });

  await t.test('sends the rest of the hardening headers', async () => {
    const res = await fetch(app.origin + '/');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
    assert.match(res.headers.get('permissions-policy') || '', /geolocation=\(\)/);
  });

  await t.test('the served HTML contains no inline script or style', async () => {
    const html = await (await fetch(app.origin + '/')).text();
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'no inline <script>');
    assert.ok(!/<style/i.test(html), 'no inline <style>');
    assert.ok(!/\son\w+\s*=/i.test(html), 'no inline event handler attributes');
  });

  await t.test('rejects a state-changing request with no CSRF token', async () => {
    const client = await makeClient(app.origin).bootstrap();
    const res = await client.post(
      '/api/auth/register',
      { email: 'csrf@example.com', password: 'a-good-long-password-1' },
      { headers: { 'X-CSRF-Token': '' } }
    );
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'bad_csrf');
  });

  await t.test('rejects a request carrying a mismatched CSRF token', async () => {
    const client = await makeClient(app.origin).bootstrap();
    const res = await client.post(
      '/api/auth/register',
      { email: 'csrf2@example.com', password: 'a-good-long-password-1' },
      { headers: { 'X-CSRF-Token': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }
    );
    assert.equal(res.status, 403);
  });

  await t.test('rejects a cross-site Origin outright', async () => {
    const client = await makeClient(app.origin).bootstrap();
    const res = await client.post(
      '/api/auth/login',
      { email: 'x@example.com', password: 'whatever-long-enough' },
      { origin: 'https://evil.example.com' }
    );
    assert.equal(res.status, 403);
    assert.equal(res.data.error, 'bad_origin');
  });

  await t.test('unauthenticated requests cannot touch state', async () => {
    const client = await makeClient(app.origin).bootstrap();
    assert.equal((await client.get('/api/state')).status, 401);
    assert.equal((await client.put('/api/state', { baseVersion: 0, doc: {} })).status, 401);
  });

  await t.test('one user cannot reach another user’s data', async () => {
    const a = makeClient(app.origin);
    await registerAndLogin(a, 'user-a@example.com');
    await a.put('/api/state', {
      baseVersion: 0,
      doc: { meta: { week: 4 }, weeks: {}, nutrition: null },
    });

    const b = makeClient(app.origin);
    await registerAndLogin(b, 'user-b@example.com');
    const res = await b.get('/api/state');
    assert.equal(res.status, 200);
    assert.equal(res.data.doc.meta.week, 1, 'B must see its own empty document');
  });

  await t.test('a forged session cookie is rejected', async () => {
    const res = await fetch(app.origin + '/api/auth/me', {
      headers: { Cookie: 'sid=' + 'A'.repeat(43) },
    });
    assert.equal(res.status, 401);
  });

  await t.test('API responses are never cached', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'cache@example.com');
    const res = await fetch(app.origin + '/api/state', {
      headers: { Cookie: [...client.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  await t.test('an oversized body is rejected, not stored', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'big@example.com');
    const res = await client.put('/api/state', {
      baseVersion: 0,
      doc: { meta: { week: 1 }, weeks: {}, nutrition: null, junk: 'x'.repeat(900 * 1024) },
    });
    assert.ok(res.status === 413 || res.status === 400, `expected 413/400, got ${res.status}`);
  });

  await t.test('errors do not leak stack traces', async () => {
    const client = await makeClient(app.origin).bootstrap();
    const res = await fetch(app.origin + '/api/state', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Origin: app.origin,
        'X-CSRF-Token': client.jar.get('csrf'),
        Cookie: `csrf=${client.jar.get('csrf')}`,
      },
      body: '{ not valid json',
    });
    const text = await res.text();
    assert.ok(!/at\s+\w+.*:\d+:\d+/.test(text), 'no stack frames in the response');
    assert.ok(!text.includes('node_modules'), 'no internal paths in the response');
  });
});
