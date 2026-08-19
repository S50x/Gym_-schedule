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

// The mailer captures every message it builds into an outbox outside production,
// so a test can read the reset link that a real deployment would have emailed.
const { drainOutbox } = await import('../server/mailer.js');

const tokenFromOutbox = () => {
  const mail = drainOutbox().at(-1);
  assert.ok(mail, 'a reset email should have been queued');
  const match = /\/reset\?token=([^\s"<]+)/.exec(mail.text);
  assert.ok(match, 'the email should carry a /reset?token= link');
  return match[1];
};

const NEW_PASSWORD = 'a-fresh-reset-passphrase-77';

test('password reset', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('an unknown email gets the same generic answer and no mail', async () => {
    await resetRateLimits();
    drainOutbox();
    const client = await makeClient(app.origin).bootstrap();

    const known = await client.post('/api/auth/forgot', { email: 'ghost@example.com' });
    assert.equal(known.status, 200);
    assert.equal(known.data.ok, true);
    assert.equal(drainOutbox().length, 0, 'no mail for an address with no account');
  });

  await t.test('a registered email is answered the same, but is sent a link', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, goodEmail);
    await resetRateLimits();
    drainOutbox();

    const res = await client.post('/api/auth/forgot', { email: goodEmail });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
    const out = drainOutbox();
    assert.equal(out.length, 1, 'exactly one reset email');
    assert.match(out[0].text, /\/reset\?token=/);
    assert.equal(out[0].to, goodEmail);
  });

  await t.test('forgot cannot be used to tell registered from unregistered', async () => {
    await resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    const a = await client.post('/api/auth/forgot', { email: goodEmail });
    await resetRateLimits();
    const b = await client.post('/api/auth/forgot', { email: 'no-such-user@example.com' });
    assert.equal(a.status, b.status);
    assert.deepEqual(a.data, b.data);
  });

  await t.test('a valid token sets a new password and retires the old one', async () => {
    const email = 'reset-happy@example.com';
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    drainOutbox();

    await client.post('/api/auth/forgot', { email });
    const token = tokenFromOutbox();

    const fresh = await makeClient(app.origin).bootstrap();
    await resetRateLimits();
    const done = await fresh.post('/api/auth/reset', { token, password: NEW_PASSWORD });
    assert.equal(done.status, 200);
    assert.equal(done.data.ok, true);

    // Old password no longer works.
    await resetRateLimits();
    const old = await fresh.post('/api/auth/login', { email, password: goodPassword });
    assert.equal(old.status, 401);

    // New one does.
    await resetRateLimits();
    const login = await fresh.post('/api/auth/login', { email, password: NEW_PASSWORD });
    assert.equal(login.status, 200);
  });

  await t.test('a token works only once', async () => {
    const email = 'reset-once@example.com';
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    drainOutbox();

    await client.post('/api/auth/forgot', { email });
    const token = tokenFromOutbox();
    const fresh = await makeClient(app.origin).bootstrap();

    await resetRateLimits();
    assert.equal((await fresh.post('/api/auth/reset', { token, password: NEW_PASSWORD })).status, 200);
    await resetRateLimits();
    const replay = await fresh.post('/api/auth/reset', { token, password: 'another-passphrase-88' });
    assert.equal(replay.status, 400);
    assert.equal(replay.data.error, 'invalid_token');
  });

  await t.test('issuing a new link invalidates the previous one', async () => {
    const email = 'reset-newest@example.com';
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    drainOutbox();

    await client.post('/api/auth/forgot', { email });
    const first = tokenFromOutbox();
    await resetRateLimits();
    await client.post('/api/auth/forgot', { email });
    const second = tokenFromOutbox();
    assert.notEqual(first, second);

    const fresh = await makeClient(app.origin).bootstrap();
    await resetRateLimits();
    const stale = await fresh.post('/api/auth/reset', { token: first, password: NEW_PASSWORD });
    assert.equal(stale.status, 400, 'the superseded link must not work');
    await resetRateLimits();
    const ok = await fresh.post('/api/auth/reset', { token: second, password: NEW_PASSWORD });
    assert.equal(ok.status, 200, 'the newest link works');
  });

  await t.test('a rejected weak password leaves the token usable', async () => {
    const email = 'reset-weak@example.com';
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    drainOutbox();

    await client.post('/api/auth/forgot', { email });
    const token = tokenFromOutbox();
    const fresh = await makeClient(app.origin).bootstrap();

    await resetRateLimits();
    const weak = await fresh.post('/api/auth/reset', { token, password: 'short' });
    assert.equal(weak.status, 400);
    assert.equal(weak.data.error, 'invalid');

    // Token was not consumed by the failed attempt.
    await resetRateLimits();
    const ok = await fresh.post('/api/auth/reset', { token, password: NEW_PASSWORD });
    assert.equal(ok.status, 200);
  });

  await t.test('a garbage token is refused', async () => {
    await resetRateLimits();
    const fresh = await makeClient(app.origin).bootstrap();
    const res = await fresh.post('/api/auth/reset', {
      token: 'not-a-real-token',
      password: NEW_PASSWORD,
    });
    assert.equal(res.status, 400);
    assert.equal(res.data.error, 'invalid_token');
  });

  await t.test('resetting drops every existing session', async () => {
    const email = 'reset-sessions@example.com';
    const phone = makeClient(app.origin);
    await registerAndLogin(phone, email);
    assert.equal((await phone.get('/api/auth/me')).status, 200);

    await resetRateLimits();
    drainOutbox();
    await phone.post('/api/auth/forgot', { email });
    const token = tokenFromOutbox();

    const fresh = await makeClient(app.origin).bootstrap();
    await resetRateLimits();
    assert.equal((await fresh.post('/api/auth/reset', { token, password: NEW_PASSWORD })).status, 200);

    // The phone's pre-reset session is gone.
    assert.equal((await phone.get('/api/auth/me')).status, 401, 'old session evicted by reset');
  });

  await t.test('the raw token is never stored, only its hash', async () => {
    const email = 'reset-hash@example.com';
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    drainOutbox();

    await client.post('/api/auth/forgot', { email });
    const token = tokenFromOutbox();
    const hit = await app.db.one('SELECT COUNT(*) AS n FROM password_resets WHERE token_hash = $1', [
      token,
    ]);
    assert.equal(Number(hit.n), 0, 'the raw token must not appear in the table');
  });

  await t.test('the forgot endpoint is rate limited per address', async () => {
    await resetRateLimits();
    const client = await makeClient(app.origin).bootstrap();
    let sawLimit = false;
    for (let i = 0; i < 8; i++) {
      const res = await client.post('/api/auth/forgot', { email: goodEmail });
      if (res.status === 429) {
        sawLimit = true;
        assert.ok(res.headers.get('retry-after'), 'Retry-After header present');
        break;
      }
    }
    assert.ok(sawLimit, 'forgot must be rate limited');
  });
});
