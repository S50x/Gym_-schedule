import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Encode,
  base32Decode,
  generateSecret,
  otpauthUrl,
  codeForStep,
  verifyCode,
  currentStep,
  generateRecoveryCode,
  normalizeRecoveryCode,
  PERIOD,
} from '../server/totp.js';

/** RFC 6238 uses the ASCII secret "12345678901234567890". */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

test('base32', async (t) => {
  await t.test('round-trips arbitrary bytes', () => {
    for (const input of ['', 'a', 'ab', 'abc', 'abcd', 'abcde', '12345678901234567890']) {
      const buf = Buffer.from(input, 'ascii');
      if (!buf.length) continue;
      assert.deepEqual(base32Decode(base32Encode(buf)), buf, `failed for "${input}"`);
    }
  });

  await t.test('matches the RFC 4648 vectors', () => {
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.equal(base32Decode('MZXW6YTBOI').toString(), 'foobar');
  });

  await t.test('tolerates how users actually paste a secret', () => {
    const expected = base32Decode('MZXW6YTBOI');
    assert.deepEqual(base32Decode('mzxw6ytboi'), expected, 'lowercase');
    assert.deepEqual(base32Decode('MZXW 6YTB OI'), expected, 'spaced in groups');
    assert.deepEqual(base32Decode('MZXW6YTBOI======'), expected, 'padded');
  });

  await t.test('rejects characters outside the alphabet', () => {
    for (const bad of ['', '!!!!', 'ABC1', 'ABC8', '01234567']) {
      assert.throws(() => base32Decode(bad), `expected "${bad}" to throw`);
    }
  });
});

test('TOTP', async (t) => {
  await t.test('matches the RFC 6238 reference vectors', () => {
    // RFC 6238 lists 8-digit codes; the last 6 digits are the 6-digit code.
    const vectors = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, expected] of vectors) {
      const step = Math.floor(seconds / PERIOD);
      assert.equal(codeForStep(RFC_SECRET, step), expected, `at t=${seconds}`);
    }
  });

  await t.test('always produces six digits, zero-padded', () => {
    const secret = generateSecret();
    for (let step = 0; step < 500; step++) {
      assert.match(codeForStep(secret, step), /^[0-9]{6}$/);
    }
  });

  await t.test('accepts the code for the current step', () => {
    const secret = generateSecret();
    const now = Date.now();
    const code = codeForStep(secret, currentStep(now));
    assert.deepEqual(verifyCode(secret, code, { now }), { ok: true, step: currentStep(now) });
  });

  await t.test('tolerates one step of clock drift either way', () => {
    const secret = generateSecret();
    const now = Date.now();
    const step = currentStep(now);
    for (const offset of [-1, 1]) {
      const res = verifyCode(secret, codeForStep(secret, step + offset), { now });
      assert.equal(res.ok, true, `offset ${offset} should be accepted`);
    }
  });

  await t.test('rejects a code two steps away', () => {
    const secret = generateSecret();
    const now = Date.now();
    const res = verifyCode(secret, codeForStep(secret, currentStep(now) + 2), { now });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'mismatch');
  });

  await t.test('refuses to reuse a code inside its own window', () => {
    const secret = generateSecret();
    const now = Date.now();
    const step = currentStep(now);
    const code = codeForStep(secret, step);

    const first = verifyCode(secret, code, { now, lastStep: 0 });
    assert.equal(first.ok, true);

    // Same code, replayed after the account recorded that step as spent.
    const second = verifyCode(secret, code, { now, lastStep: first.step });
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'replay');
  });

  await t.test('rejects malformed input without touching the secret', () => {
    const secret = generateSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56', null, undefined, '<script>']) {
      const res = verifyCode(secret, bad);
      assert.equal(res.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    }
  });

  await t.test('ignores spaces the user types between digits', () => {
    const secret = generateSecret();
    const now = Date.now();
    const code = codeForStep(secret, currentStep(now));
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    assert.equal(verifyCode(secret, spaced, { now }).ok, true);
  });

  await t.test('a code from one secret never validates against another', () => {
    const a = generateSecret();
    const b = generateSecret();
    const now = Date.now();
    assert.equal(verifyCode(b, codeForStep(a, currentStep(now)), { now }).ok, false);
  });
});

test('otpauth URI', async (t) => {
  await t.test('is well-formed and carries every parameter', () => {
    const secret = generateSecret();
    const url = otpauthUrl({ secret, account: 'saad@example.com' });
    const parsed = new URL(url);

    assert.equal(parsed.protocol, 'otpauth:');
    assert.equal(parsed.host, 'totp');
    assert.equal(parsed.searchParams.get('secret'), secret);
    assert.equal(parsed.searchParams.get('issuer'), 'Hadeed');
    assert.equal(parsed.searchParams.get('algorithm'), 'SHA1');
    assert.equal(parsed.searchParams.get('digits'), '6');
    assert.equal(parsed.searchParams.get('period'), '30');
  });

  await t.test('percent-encodes the label so the account is not split on ":"', () => {
    const url = otpauthUrl({ secret: generateSecret(), account: 'a:b@example.com' });
    const label = url.slice('otpauth://totp/'.length, url.indexOf('?'));
    assert.equal(label.split(':').length, 2, 'exactly one separating colon');
    assert.equal(decodeURIComponent(label.split(':')[1]), 'a:b@example.com');
  });
});

test('recovery codes', async (t) => {
  await t.test('are unique and use an unambiguous alphabet', () => {
    const codes = new Set();
    for (let i = 0; i < 500; i++) {
      const code = generateRecoveryCode();
      assert.match(code, /^[2-9A-HJ-NP-TV-Z]{5}-[2-9A-HJ-NP-TV-Z]{5}$/, code);
      assert.ok(!/[01OILU]/.test(code), `ambiguous character in ${code}`);
      codes.add(code);
    }
    assert.equal(codes.size, 500, 'no collisions in 500 draws');
  });

  await t.test('normalises however the user types it back', () => {
    const code = generateRecoveryCode();
    const stripped = code.replace('-', '');
    assert.equal(normalizeRecoveryCode(code.toLowerCase()), stripped);
    assert.equal(normalizeRecoveryCode(` ${code} `), stripped);
    assert.equal(normalizeRecoveryCode(code.replace('-', ' ')), stripped);
  });
});
