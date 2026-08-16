/**
 * إدارة التحقق بخطوتين — التحديات ورموز الاسترجاع.
 * Second-factor state: login challenges and recovery codes.
 */

import crypto from 'node:crypto';
import { config } from './config.js';
import { hashToken } from './auth.js';
import {
  verifyCode,
  generateRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from './totp.js';

export const MFA_COOKIE = 'mfa';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGE_ATTEMPTS = 6;

/* ────────────────────────── login challenges ────────────────────────── */

/**
 * Issued once the password checks out but a second factor is still owed.
 * Deliberately NOT a session: it grants nothing except the right to present a
 * code, expires in five minutes, and dies after one use or six wrong tries.
 */
export async function createChallenge(db, userId, now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.run(
    `INSERT INTO mfa_challenges (user_id, token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, hashToken(token), now, now + CHALLENGE_TTL_MS]
  );
  return token;
}

export async function lookupChallenge(db, token, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const row = await db.one(
    `SELECT c.id, c.user_id, c.expires_at, c.attempts,
            u.email, u.totp_secret, u.totp_enabled, u.totp_last_step
       FROM mfa_challenges c JOIN users u ON u.id = c.user_id
      WHERE c.token_hash = $1`,
    [hashToken(token)]
  );
  if (!row) return null;
  if (row.expires_at <= now) {
    await db.run('DELETE FROM mfa_challenges WHERE id = $1', [row.id]);
    return null;
  }
  return row;
}

export async function consumeChallenge(db, challengeId) {
  await db.run('DELETE FROM mfa_challenges WHERE id = $1', [challengeId]);
}

/** @returns true when the challenge has been burned through and is now gone. */
export async function recordFailedAttempt(db, challenge) {
  const attempts = challenge.attempts + 1;
  if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
    await consumeChallenge(db, challenge.id);
    return true;
  }
  await db.run('UPDATE mfa_challenges SET attempts = $1 WHERE id = $2', [attempts, challenge.id]);
  return false;
}

export function setMfaCookie(res, token) {
  res.cookie(MFA_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: CHALLENGE_TTL_MS,
  });
}

export function clearMfaCookie(res) {
  res.clearCookie(MFA_COOKIE, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
  });
}

/* ────────────────────────── recovery codes ────────────────────────── */

/**
 * Hashed with the server-side pepper rather than stored as-is, so a stolen
 * database does not hand over a working way past the second factor.
 * A fast HMAC is the right tool here (unlike passwords): these codes are
 * randomly generated with ~49 bits of entropy, not chosen by a human.
 */
export async function issueRecoveryCodes(db, userId, now = Date.now()) {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  await db.tx(async (t) => {
    await t.run('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
    for (const code of codes) {
      await t.run('INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES ($1, $2, $3)', [
        userId,
        hashToken(normalizeRecoveryCode(code)),
        now,
      ]);
    }
  });
  return codes;
}

export async function countRecoveryCodes(db, userId) {
  const row = await db.one('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = $1', [userId]);
  return Number(row?.n ?? 0);
}

/** Single use: a matching code is deleted as it is accepted. */
export async function consumeRecoveryCode(db, userId, input) {
  const normalized = normalizeRecoveryCode(input);
  if (normalized.length < 8) return false;
  // Delete-and-report in one statement: two devices racing the same code
  // cannot both be told it worked.
  const deleted = await db.run(
    'DELETE FROM recovery_codes WHERE user_id = $1 AND code_hash = $2',
    [userId, hashToken(normalized)]
  );
  return deleted > 0;
}

/* ────────────────────────── second factor check ────────────────────────── */

/**
 * Accepts either a 6-digit TOTP code or one recovery code, in the same field —
 * the user should not have to tell the app which one they are typing.
 *
 * @param {{id:number, secret:string, lastStep:number}} account
 * @returns {{ok:true, usedRecovery:boolean} | {ok:false, reason:string}}
 */
export async function checkSecondFactor(db, account, input, now = Date.now()) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ok: false, reason: 'malformed' };

  const digitsOnly = raw.replace(/\s/g, '');
  if (/^[0-9]{6}$/.test(digitsOnly)) {
    const result = verifyCode(account.secret, digitsOnly, {
      lastStep: account.lastStep,
      now,
    });
    if (result.ok) {
      // Burn the step so the same code cannot be presented twice.
      await db.run('UPDATE users SET totp_last_step = $1 WHERE id = $2', [result.step, account.id]);
      return { ok: true, usedRecovery: false };
    }
    return { ok: false, reason: result.reason };
  }

  if (await consumeRecoveryCode(db, account.id, raw)) {
    return { ok: true, usedRecovery: true };
  }
  return { ok: false, reason: 'mismatch' };
}
