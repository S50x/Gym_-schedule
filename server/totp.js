/**
 * التحقق بخطوتين — TOTP حسب معيار RFC 6238.
 *
 * Time-based one-time passwords, implemented on node:crypto alone so the app
 * gains no third-party dependency for an authentication primitive.
 *
 * Compatible with Google Authenticator, Authy, 1Password, Bitwarden and any
 * other RFC 6238 client: HMAC-SHA1, 6 digits, 30-second steps.
 */

import crypto from 'node:crypto';

export const DIGITS = 6;
export const PERIOD = 30;
/** Accept the neighbouring steps too, so a phone clock a few seconds off works. */
export const DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/* ────────────────────────── base32 (RFC 4648, unpadded) ────────────────────────── */

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input) {
  // Authenticator apps show the secret in groups of four; users paste it back
  // with the spaces, and some type lowercase or a trailing '='.
  const clean = String(input).toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean.length || /[^A-Z2-7]/.test(clean)) throw new Error('invalid base32');

  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/* ────────────────────────── secrets ────────────────────────── */

/** 20 random bytes → 32 base32 characters, the size RFC 4226 recommends for SHA-1. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * The URI an authenticator app reads out of the QR code.
 * Label and issuer must be percent-encoded; an unencoded ':' in the label
 * silently breaks parsing in several apps.
 */
export function otpauthUrl({ secret, account, issuer = 'Hadeed' }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ────────────────────────── codes ────────────────────────── */

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / PERIOD);
}

/** The 6-digit code for one time step. */
export function codeForStep(secret, step) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));

  const digest = crypto.createHmac('sha1', key).update(counter).digest();
  // Dynamic truncation, RFC 4226 §5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check a user-supplied code.
 *
 * @param {string} secret        base32 secret
 * @param {string} code          what the user typed
 * @param {object} [options]
 * @param {number} [options.lastStep]  the newest step already spent by this user
 * @param {number} [options.now]
 * @returns {{ok:true, step:number} | {ok:false, reason:'malformed'|'mismatch'|'replay'}}
 *
 * `lastStep` is what stops a shoulder-surfed or phished code from being used a
 * second time inside its 30-second life: each accepted step must be strictly
 * newer than the last one this account consumed.
 */
export function verifyCode(secret, code, { lastStep = 0, now = Date.now() } = {}) {
  const cleaned = String(code ?? '').replace(/\s/g, '');
  if (!new RegExp(`^[0-9]{${DIGITS}}$`).test(cleaned)) return { ok: false, reason: 'malformed' };

  const step = currentStep(now);
  for (let offset = -DRIFT_STEPS; offset <= DRIFT_STEPS; offset++) {
    const candidate = step + offset;
    if (!timingSafeEqualStr(cleaned, codeForStep(secret, candidate))) continue;
    if (candidate <= lastStep) return { ok: false, reason: 'replay' };
    return { ok: true, step: candidate };
  }
  return { ok: false, reason: 'mismatch' };
}

/* ────────────────────────── recovery codes ────────────────────────── */

/** Crockford-ish alphabet: no 0/O/1/I/L/U to survive being copied by hand. */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10; // ~49 bits of entropy per code

export function generateRecoveryCode() {
  const bytes = crypto.randomBytes(RECOVERY_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i++) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function normalizeRecoveryCode(code) {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}
