import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeClient, registerAndLogin, resetRateLimits, goodPassword } from './helpers.js';
import { codeForStep, currentStep } from '../server/totp.js';

const code = (secret, offset = 0) => codeForStep(secret, currentStep() + offset);

/** Registers an account and turns 2FA on, returning the secret and recovery codes. */
async function enrol(app, email) {
  const client = makeClient(app.origin);
  await registerAndLogin(client, email);

  const setup = await client.post('/api/auth/2fa/setup', { password: goodPassword });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));

  const secret = setup.data.secret;
  const enabled = await client.post('/api/auth/2fa/enable', { code: code(secret) });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.data));

  // Enabling spends the current time step (that is the replay guard doing its
  // job), so callers must reach for a later step to sign in afterwards.
  return { client, secret, recoveryCodes: enabled.data.recoveryCodes };
}

test('two-factor authentication', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('setup requires the password and does not enable anything yet', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'setup@example.com');

    const noPassword = await client.post('/api/auth/2fa/setup', {});
    assert.equal(noPassword.status, 400);

    const wrongPassword = await client.post('/api/auth/2fa/setup', { password: 'not-the-password' });
    assert.equal(wrongPassword.status, 401);

    const ok = await client.post('/api/auth/2fa/setup', { password: goodPassword });
    assert.equal(ok.status, 200);
    assert.match(ok.data.secret, /^[A-Z2-7]{32}$/);
    assert.match(ok.data.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.ok(ok.data.qr.size >= 21 && ok.data.qr.rows.length === ok.data.qr.size);

    // Still off until a working code proves the app holds the secret.
    const me = await client.get('/api/auth/me');
    assert.equal(me.data.totpEnabled, false);
  });

  await t.test('enable rejects a wrong code and leaves 2FA off', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'badenable@example.com');
    await client.post('/api/auth/2fa/setup', { password: goodPassword });

    const bad = await client.post('/api/auth/2fa/enable', { code: '000000' });
    assert.equal(bad.status, 400);
    assert.equal((await client.get('/api/auth/me')).data.totpEnabled, false);
  });

  await t.test('enable issues ten recovery codes and turns it on', async () => {
    const { client, recoveryCodes } = await enrol(app, 'enrol@example.com');
    assert.equal(recoveryCodes.length, 10);
    assert.equal(new Set(recoveryCodes).size, 10);

    const me = await client.get('/api/auth/me');
    assert.equal(me.data.totpEnabled, true);
    assert.equal(me.data.recoveryCodesLeft, 10);
  });

  await t.test('the raw recovery codes are never stored', async () => {
    const { recoveryCodes } = await enrol(app, 'rawcodes@example.com');
    const stored = app.db.prepare('SELECT code_hash FROM recovery_codes').all();
    const hashes = stored.map((r) => r.code_hash).join('|');
    for (const c of recoveryCodes) {
      assert.ok(!hashes.includes(c.replace('-', '')), 'a recovery code was stored in the clear');
    }
  });

  await t.test('login stops at the password and hands out no session', async () => {
    const { secret } = await enrol(app, 'twostep@example.com');

    const fresh = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    const first = await fresh.post('/api/auth/login', {
      email: 'twostep@example.com',
      password: goodPassword,
    });

    assert.equal(first.status, 200);
    assert.equal(first.data.mfaRequired, true);
    assert.equal(first.data.email, undefined, 'no account details before the second factor');
    assert.ok(!fresh.jar.get('sid') && !fresh.jar.get('__Host-sid'), 'no session cookie yet');
    assert.equal((await fresh.get('/api/auth/me')).status, 401, 'still unauthenticated');
    assert.equal((await fresh.get('/api/state')).status, 401, 'data stays out of reach');

    const second = await fresh.post('/api/auth/login/verify', { code: code(secret, 1) });
    assert.equal(second.status, 200, JSON.stringify(second.data));
    assert.equal(second.data.email, 'twostep@example.com');
    assert.equal((await fresh.get('/api/auth/me')).status, 200, 'now signed in');
  });

  await t.test('a wrong second-factor code does not sign anyone in', async () => {
    await enrol(app, 'wrongcode@example.com');

    const fresh = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await fresh.post('/api/auth/login', {
      email: 'wrongcode@example.com',
      password: goodPassword,
    });

    const bad = await fresh.post('/api/auth/login/verify', { code: '123456' });
    assert.equal(bad.status, 401);
    assert.equal((await fresh.get('/api/auth/me')).status, 401);
  });

  await t.test('the challenge dies after six wrong codes', async () => {
    await enrol(app, 'bruteforce2fa@example.com');

    const fresh = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await fresh.post('/api/auth/login', {
      email: 'bruteforce2fa@example.com',
      password: goodPassword,
    });

    let expired = false;
    for (let i = 0; i < 7; i++) {
      const res = await fresh.post('/api/auth/login/verify', {
        code: String(100000 + i).padStart(6, '0'),
      });
      if (res.data?.error === 'challenge_expired') {
        expired = true;
        break;
      }
    }
    assert.ok(expired, 'the challenge must burn out');
    assert.equal((await fresh.get('/api/auth/me')).status, 401);
  });

  await t.test('verifying with no challenge is refused', async () => {
    const fresh = await makeClient(app.origin).bootstrap();
    const res = await fresh.post('/api/auth/login/verify', { code: '123456' });
    assert.equal(res.status, 401);
    assert.equal(res.data.error, 'challenge_expired');
  });

  await t.test('a code cannot be replayed within its own window', async () => {
    const { secret } = await enrol(app, 'replay@example.com');
    const shared = code(secret, 1);

    const first = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await first.post('/api/auth/login', { email: 'replay@example.com', password: goodPassword });
    const accepted = await first.post('/api/auth/login/verify', { code: shared });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));

    // Same code, still inside its 30 seconds, from a second device.
    const second = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await second.post('/api/auth/login', { email: 'replay@example.com', password: goodPassword });
    const replayed = await second.post('/api/auth/login/verify', { code: shared });

    assert.equal(replayed.status, 401);
    assert.equal((await second.get('/api/auth/me')).status, 401);
  });

  await t.test('a recovery code works once and then is spent', async () => {
    const { recoveryCodes } = await enrol(app, 'recovery@example.com');
    const spare = recoveryCodes[0];

    const first = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await first.post('/api/auth/login', { email: 'recovery@example.com', password: goodPassword });
    const used = await first.post('/api/auth/login/verify', { code: spare });

    assert.equal(used.status, 200);
    assert.equal(used.data.usedRecovery, true);
    assert.equal(used.data.recoveryCodesLeft, 9);

    const second = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await second.post('/api/auth/login', { email: 'recovery@example.com', password: goodPassword });
    const reused = await second.post('/api/auth/login/verify', { code: spare });
    assert.equal(reused.status, 401, 'a recovery code is single use');
  });

  await t.test('recovery codes are accepted however they are typed', async () => {
    const { recoveryCodes } = await enrol(app, 'looselyped@example.com');

    const client = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await client.post('/api/auth/login', { email: 'looselyped@example.com', password: goodPassword });
    const res = await client.post('/api/auth/login/verify', {
      code: `  ${recoveryCodes[3].toLowerCase().replace('-', ' ')}  `,
    });
    assert.equal(res.status, 200);
  });

  await t.test('another account’s recovery code is useless', async () => {
    const a = await enrol(app, 'owner-a@example.com');
    await enrol(app, 'owner-b@example.com');

    const client = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await client.post('/api/auth/login', { email: 'owner-b@example.com', password: goodPassword });
    const res = await client.post('/api/auth/login/verify', { code: a.recoveryCodes[0] });
    assert.equal(res.status, 401);
  });

  await t.test('regenerating recovery codes invalidates the old set', async () => {
    const { client, recoveryCodes } = await enrol(app, 'regen@example.com');

    const fresh = await client.post('/api/auth/2fa/recovery-codes', { password: goodPassword });
    assert.equal(fresh.status, 200);
    assert.equal(fresh.data.recoveryCodes.length, 10);
    for (const old of recoveryCodes) {
      assert.ok(!fresh.data.recoveryCodes.includes(old), 'codes must be regenerated, not appended');
    }

    const attacker = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await attacker.post('/api/auth/login', { email: 'regen@example.com', password: goodPassword });
    const stale = await attacker.post('/api/auth/login/verify', { code: recoveryCodes[0] });
    assert.equal(stale.status, 401, 'an old code must stop working');
  });

  await t.test('disabling needs the password AND a valid code', async () => {
    const { client, secret } = await enrol(app, 'disable@example.com');

    const noCode = await client.post('/api/auth/2fa/disable', { password: goodPassword });
    assert.equal(noCode.status, 401, 'password alone must not be enough');

    const wrongPassword = await client.post('/api/auth/2fa/disable', {
      password: 'not-the-password',
      code: code(secret),
    });
    assert.equal(wrongPassword.status, 401);
    assert.equal((await client.get('/api/auth/me')).data.totpEnabled, true, 'still on');

    const ok = await client.post('/api/auth/2fa/disable', {
      password: goodPassword,
      code: code(secret, 1),
    });
    assert.equal(ok.status, 204);

    const me = await client.get('/api/auth/me');
    assert.equal(me.data.totpEnabled, false);
    assert.equal(
      app.db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = (SELECT id FROM users WHERE email_norm = ?)').get('disable@example.com').n,
      0,
      'recovery codes are cleared too'
    );
  });

  await t.test('enabling signs other devices out', async () => {
    const phone = makeClient(app.origin);
    await registerAndLogin(phone, 'evict@example.com');

    const laptop = await makeClient(app.origin).bootstrap();
    resetRateLimits();
    await laptop.post('/api/auth/login', { email: 'evict@example.com', password: goodPassword });
    assert.equal((await laptop.get('/api/auth/me')).status, 200);

    const setup = await phone.post('/api/auth/2fa/setup', { password: goodPassword });
    await phone.post('/api/auth/2fa/enable', { code: code(setup.data.secret) });

    assert.equal((await laptop.get('/api/auth/me')).status, 401, 'old session dropped');
    assert.equal((await phone.get('/api/auth/me')).status, 200, 'current device stays');
  });

  await t.test('2FA endpoints reject unauthenticated callers', async () => {
    const anon = await makeClient(app.origin).bootstrap();
    for (const path of ['/api/auth/2fa/setup', '/api/auth/2fa/enable', '/api/auth/2fa/disable']) {
      const res = await anon.post(path, { password: goodPassword, code: '123456' });
      assert.equal(res.status, 401, `${path} must require a session`);
    }
  });

  await t.test('the QR encodes exactly the otpauth URI the secret belongs to', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'qrcheck@example.com');
    const setup = await client.post('/api/auth/2fa/setup', { password: goodPassword });

    const url = new URL(setup.data.otpauthUrl);
    assert.equal(url.searchParams.get('secret'), setup.data.secret);
    assert.ok(decodeURIComponent(url.pathname).includes('qrcheck@example.com'));

    const { encodeQRRows } = await import('../server/qr.js');
    assert.deepEqual(setup.data.qr, encodeQRRows(setup.data.otpauthUrl));
  });
});
