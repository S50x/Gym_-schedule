import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQR, encodeQRRows } from '../server/qr.js';
import { otpauthUrl, generateSecret } from '../server/totp.js';

/**
 * The QR encoder is hand-written so the app ships no third-party code for it.
 * These tests are what makes that defensible: the output is compared
 * module-for-module against the `qrcode` package (a devDependency, never
 * shipped) across every supported version and at each capacity boundary.
 *
 * The reference is pinned to byte mode, because it otherwise auto-selects
 * alphanumeric segments — a smaller encoding this implementation deliberately
 * does not attempt.
 */
const reference = await import('qrcode').then((m) => m.default);

function referenceMatrix(text) {
  const qr = reference.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  return {
    size,
    at: (row, col) => !!qr.modules.data[row * size + col],
  };
}

function assertMatchesReference(text, label = `${Buffer.byteLength(text)} bytes`) {
  const mine = encodeQR(text);
  const ref = referenceMatrix(text);

  assert.equal(mine.size, ref.size, `size mismatch for ${label}`);
  for (let row = 0; row < mine.size; row++) {
    for (let col = 0; col < mine.size; col++) {
      assert.equal(mine.modules[row][col], ref.at(row, col), `module ${row},${col} for ${label}`);
    }
  }
}

test('QR encoder', async (t) => {
  await t.test('matches the reference implementation exactly', () => {
    for (const text of ['a', 'HELLO', 'test 123 ABC', '~!@#$%^&*()_+{}|:<>?', 'حديد']) {
      assertMatchesReference(text, JSON.stringify(text));
    }
  });

  await t.test('matches at every version boundary from 1 to 10', () => {
    // Byte-mode capacities for error-correction level M.
    const capacities = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
    capacities.forEach((capacity, index) => {
      const version = index + 1;
      // Exactly full, and one byte over (which must roll to the next version).
      assertMatchesReference('x'.repeat(capacity), `v${version} full`);
      if (version < 10) assertMatchesReference('x'.repeat(capacity + 1), `v${version} + 1`);
    });
  });

  await t.test('picks the smallest version that fits', () => {
    assert.equal(encodeQR('x'.repeat(14)).version, 1);
    assert.equal(encodeQR('x'.repeat(15)).version, 2);
    assert.equal(encodeQR('x'.repeat(213)).version, 10);
  });

  await t.test('refuses a payload it cannot encode instead of truncating it', () => {
    assert.throws(() => encodeQR('x'.repeat(214)), /too long/);
  });

  await t.test('encodes a real otpauth URI', () => {
    const url = otpauthUrl({ secret: generateSecret(), account: 'saad@example.com' });
    assertMatchesReference(url, 'otpauth URI');
    assert.ok(encodeQR(url).version <= 10);
  });

  await t.test('places the three finder patterns and the dark module', () => {
    const { modules, size } = encodeQR('test');
    for (const [row, col] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      // Outer ring dark, inner ring light, 3x3 core dark.
      assert.equal(modules[row][col], true, 'finder corner');
      assert.equal(modules[row + 1][col + 1], false, 'finder inner ring');
      assert.equal(modules[row + 3][col + 3], true, 'finder core');
    }
    assert.equal(modules[size - 8][8], true, 'the always-dark module');
  });

  await t.test('lays down the timing patterns', () => {
    const { modules, size } = encodeQR('test');
    for (let i = 8; i < size - 8; i++) {
      assert.equal(modules[6][i], i % 2 === 0, `horizontal timing at ${i}`);
      assert.equal(modules[i][6], i % 2 === 0, `vertical timing at ${i}`);
    }
  });

  await t.test('the wire format mirrors the matrix', () => {
    const text = 'otpauth://totp/Hadeed:x@y.com?secret=ABCDEFGHIJKLMNOP';
    const { size, rows } = encodeQRRows(text);
    const { modules } = encodeQR(text);

    assert.equal(rows.length, size);
    for (let row = 0; row < size; row++) {
      assert.equal(rows[row].length, size);
      assert.match(rows[row], /^[01]+$/);
      for (let col = 0; col < size; col++) {
        assert.equal(rows[row][col] === '1', modules[row][col], `row ${row} col ${col}`);
      }
    }
  });
});
