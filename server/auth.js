import crypto from 'node:crypto';
import { config } from './config.js';

export const SESSION_COOKIE = '__Host-sid';
export const CSRF_COOKIE = 'csrf';

/* ────────────────────────── passwords ────────────────────────── */

const SCRYPT_PREFIX = 'scrypt';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen, maxmem } = config.scrypt;
  const key = crypto.scryptSync(password.normalize('NFKC'), salt, keylen, { N, r, p, maxmem });
  return [SCRYPT_PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== SCRYPT_PREFIX) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    const key = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: config.scrypt.maxmem,
    });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same CPU as a real verify when the account does not exist,
 * so response timing does not reveal which emails are registered.
 */
const DUMMY_HASH = hashPassword('not-a-real-password-timing-equalizer');
export function fakeVerify(password) {
  verifyPassword(password, DUMMY_HASH);
}

/* ────────────────────────── sessions ────────────────────────── */

export function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** Peppered hash: a stolen database still does not yield usable session tokens. */
export function hashToken(token) {
  return crypto.createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

export async function createSession(db, userId, label, now = Date.now()) {
  const token = newToken();
  await db.run(
    `INSERT INTO sessions (user_id, token_hash, created_at, expires_at, last_seen_at, label)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, hashToken(token), now, now + config.sessionTtlMs, now, label ?? null]
  );
  return token;
}

export async function lookupSession(db, token, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const row = await db.one(
    `SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)]
  );
  if (!row) return null;
  if (row.expires_at <= now || now - row.last_seen_at > config.sessionIdleMs) {
    await db.run('DELETE FROM sessions WHERE id = $1', [row.id]);
    return null;
  }
  // Throttle the write: one touch per hour is enough to track idleness.
  if (now - row.last_seen_at > 60 * 60 * 1000) {
    await db.run('UPDATE sessions SET last_seen_at = $1 WHERE id = $2', [now, row.id]);
  }
  return { sessionId: row.id, userId: row.user_id, email: row.email };
}

export async function destroySession(db, token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

export async function destroyAllSessions(db, userId) {
  await db.run('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

/* ────────────────────────── cookies ────────────────────────── */

/**
 * The __Host- prefix is only honoured by browsers when the cookie is Secure,
 * Path=/ and has no Domain. Over plain HTTP (local dev) it would be rejected
 * outright, so fall back to a plain name there.
 */
export function sessionCookieName() {
  return config.secureCookies ? SESSION_COOKIE : 'sid';
}

export function setSessionCookie(res, token) {
  res.cookie(sessionCookieName(), token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName(), {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
  });
}

export function setCsrfCookie(res, token) {
  // Readable by our own JS on purpose — this is the "double submit" half.
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionTtlMs,
  });
}
