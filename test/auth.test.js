import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer,
  makeClient,
  goodEmail,
  goodPassword,
  registerAndLogin,
  resetRateLimits,
} from './helpers.js';

test('auth', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('registers and returns a session cookie', async () => {
    const client = makeClient(app.origin);
    const res = await registerAndLogin(client);
    assert.equal(res.status, 201);
    assert.equal(res.data.email, goodEmail);
    assert.ok(client.jar.get('sid') || client.jar.get('__Host-sid'), 'session cookie set');

    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.email, goodEmail);
  });

  await t.test('session cookie is HttpOnly and SameSite=Strict', async () => {
    resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    const res = await fetch(app.origin + '/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: app.origin,
        'X-CSRF-Token': client.jar.get('csrf'),
        Cookie: `csrf=${client.jar.get('csrf')}`,
      },
      body: JSON.stringify({ email: goodEmail, password: goodPassword }),
    });
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => /^(__Host-)?sid=/.test(c));
    assert.ok(session, 'session cookie present');
    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Strict/i);
    assert.match(session, /Path=\//i);
  });

  await t.test('rejects a weak or short password', async () => {
    resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    const short = await client.post('/api/auth/register', { email: 'a@b.com', password: 'short1' });
    assert.equal(short.status, 400);

    const weak = await client.post('/api/auth/register', {
      email: 'weak@example.com',
      password: 'password123',
    });
    assert.equal(weak.status, 400);
  });

  await t.test('rejects a malformed email', async () => {
    resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    for (const email of ['not-an-email', 'a@b', 'a b@c.com', '<script>@x.com', 'a@.com']) {
      const res = await client.post('/api/auth/register', { email, password: goodPassword });
      assert.equal(res.status, 400, `expected 400 for ${email}`);
    }
  });

  await t.test('does not reveal whether an email is registered', async () => {
    resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    const known = await client.post('/api/auth/login', {
      email: goodEmail,
      password: 'definitely-the-wrong-password',
    });
    const unknown = await client.post('/api/auth/login', {
      email: 'nobody-here@example.com',
      password: 'definitely-the-wrong-password',
    });
    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.data, unknown.data);
  });

  await t.test('stores the password hashed, never in clear text', async () => {
    const row = app.db.prepare('SELECT password_hash FROM users WHERE email_norm = ?').get(goodEmail);
    assert.ok(row);
    assert.ok(!row.password_hash.includes(goodPassword));
    assert.match(row.password_hash, /^scrypt\$/);
  });

  await t.test('stores session tokens hashed, never raw', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'hashcheck@example.com');
    const raw = client.jar.get('sid') || client.jar.get('__Host-sid');
    const hit = app.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(raw);
    assert.equal(hit.n, 0, 'raw token must not appear in the sessions table');
  });

  await t.test('logout invalidates the session server-side', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'logout@example.com');
    const stolen = client.jar.get('sid') || client.jar.get('__Host-sid');

    await client.post('/api/auth/logout', {});
    const after = await fetch(app.origin + '/api/auth/me', {
      headers: { Cookie: `sid=${stolen}` },
    });
    assert.equal(after.status, 401, 'a replayed cookie must not work after logout');
  });

  await t.test('changing the password logs every other device out', async () => {
    const phone = makeClient(app.origin);
    await registerAndLogin(phone, 'multi@example.com');

    const laptop = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await laptop.post('/api/auth/login', { email: 'multi@example.com', password: goodPassword });
    assert.equal((await laptop.get('/api/auth/me')).status, 200);

    const changed = await phone.post('/api/auth/change-password', {
      currentPassword: goodPassword,
      newPassword: 'a-brand-new-passphrase-42',
    });
    assert.equal(changed.status, 204);

    assert.equal((await laptop.get('/api/auth/me')).status, 401, 'other device evicted');
    assert.equal((await phone.get('/api/auth/me')).status, 200, 'current device stays in');
  });

  await t.test('rate limits repeated failed logins', async () => {
    resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    let sawLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await client.post('/api/auth/login', {
        email: 'bruteforce@example.com',
        password: `wrong-password-${i}`,
      });
      if (res.status === 429) {
        sawLimit = true;
        assert.ok(res.headers.get('retry-after'), 'Retry-After header present');
        break;
      }
    }
    assert.ok(sawLimit, 'login must be rate limited');
  });
});
