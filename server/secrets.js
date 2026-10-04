/**
 * تشفير المفاتيح اللي يحطها المستخدم (مثل مفتاح Gemini).
 *
 * A user's own third-party API key is a credential to *their* account
 * elsewhere, so it is never stored as plain text. AES-256-GCM with a key
 * derived from SESSION_SECRET: a copy of the database alone yields nothing, and
 * GCM's tag means a tampered row fails to decrypt instead of decrypting to
 * garbage that gets sent to Google. The derived key is bound to its purpose
 * (HKDF info), so it never doubles as the session HMAC key.
 *
 * Rotating SESSION_SECRET makes stored keys undecryptable; decryptSecret then
 * returns null and the user is simply asked to paste their key again.
 */

import crypto from 'node:crypto';
import { config } from './config.js';

const KEY = Buffer.from(
  crypto.hkdfSync('sha256', config.sessionSecret, 'hadeed-user-secrets', 'aes-256-gcm v1', 32)
);

/** @returns {{ ciphertext: string, iv: string, tag: string }} base64 parts */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** The plain text, or null if the row was tampered with or the secret rotated. */
export function decryptSecret({ ciphertext, iv, tag }) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
