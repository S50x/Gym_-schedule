import express from 'express';
import { config } from '../config.js';
import {
  hashPassword,
  verifyPassword,
  fakeVerify,
  createSession,
  destroySession,
  destroyAllSessions,
  setSessionCookie,
  clearSessionCookie,
  sessionCookieName,
} from '../auth.js';
import { authRateLimit, clearAuthAttempts, memoryRateLimit } from '../security.js';
import { emptyState } from '../state-schema.js';
import { UNIQUE_VIOLATION } from '../db.js';
import { generateSecret, otpauthUrl, verifyCode } from '../totp.js';
import { encodeQRRows } from '../qr.js';
import {
  MFA_COOKIE,
  createChallenge,
  lookupChallenge,
  consumeChallenge,
  recordFailedAttempt,
  setMfaCookie,
  clearMfaCookie,
  issueRecoveryCodes,
  countRecoveryCodes,
  checkSecondFactor,
} from '../mfa.js';

const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;
const MAX_EMAIL = 254;

/** Deliberately tiny — catches the passwords that actually get sprayed. */
const WEAK = new Set([
  'password',
  'password1',
  'password123',
  '1234567890',
  '12345678901',
  'qwertyuiop',
  'iloveyou11',
  'letmein123',
  'admin12345',
  'welcome123',
  'abc12345678',
  'passw0rd12',
]);

// Deliberately conservative: one dot-separated label set, no exotic local parts.
const EMAIL_RE = /^[^\s@,;:<>"'\\]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function checkCredentials(body) {
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { error: 'اكتب بريد إلكتروني صحيح.' };
  }
  if (password.length < MIN_PASSWORD) {
    return { error: `كلمة السر لازم ${MIN_PASSWORD} خانات على الأقل.` };
  }
  if (password.length > MAX_PASSWORD) {
    return { error: 'كلمة السر طويلة زيادة.' };
  }
  if (WEAK.has(password.toLowerCase())) {
    return { error: 'كلمة السر هذي معروفة ومكشوفة. اختر وحدة ثانية.' };
  }
  if (password.toLowerCase().includes(normalizeEmail(email).split('@')[0])) {
    return { error: 'لا تخلي كلمة السر جزء من بريدك.' };
  }
  return { email, password };
}

function deviceLabel(req) {
  const ua = req.get('user-agent') || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'جهاز';
}

export function authRouter(db) {
  const router = express.Router();

  const loginLimiter = authRateLimit(db, { windowMs: 15 * 60 * 1000, max: 8 });
  const registerLimiter = authRateLimit(db, { windowMs: 60 * 60 * 1000, max: 5 });

  router.get('/me', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    const devices = await db.one('SELECT COUNT(*) AS count FROM sessions WHERE user_id = $1', [
      req.user.userId,
    ]);
    const row = await db.one('SELECT totp_enabled FROM users WHERE id = $1', [req.user.userId]);
    res.json({
      email: req.user.email,
      devices: Number(devices?.count ?? 0),
      totpEnabled: !!row?.totp_enabled,
      recoveryCodesLeft: row?.totp_enabled ? await countRecoveryCodes(db, req.user.userId) : 0,
    });
  });

  router.post('/register', registerLimiter, async (req, res) => {
    if (!config.allowRegistration) {
      return res
        .status(403)
        .json({ error: 'registration_closed', message: 'التسجيل مقفل على هذا السيرفر.' });
    }
    const checked = checkCredentials(req.body);
    if (checked.error) return res.status(400).json({ error: 'invalid', message: checked.error });

    const emailNorm = normalizeEmail(checked.email);
    const now = Date.now();
    const hash = hashPassword(checked.password);

    let userId;
    try {
      const row = await db.one(
        `INSERT INTO users (email, email_norm, password_hash, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [checked.email, emailNorm, hash, now, now]
      );
      userId = Number(row.id);
    } catch (err) {
      // Postgres reports a duplicate key as SQLSTATE 23505. Matching on the
      // message text instead would turn "email already taken" into a 500.
      if (err.code === UNIQUE_VIOLATION) {
        return res
          .status(409)
          .json({ error: 'exists', message: 'فيه حساب مسجّل بهذا البريد. سجّل دخول بدل التسجيل.' });
      }
      throw err;
    }

    await db.run(
      'INSERT INTO app_state (user_id, doc, version, updated_at) VALUES ($1, $2, 0, $3)',
      [userId, JSON.stringify(emptyState()), now]
    );

    await clearAuthAttempts(db, req);
    const token = await createSession(db, userId, deviceLabel(req), now);
    setSessionCookie(res, token);
    res.status(201).json({ email: checked.email });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password || password.length > MAX_PASSWORD) {
      return res
        .status(400)
        .json({ error: 'invalid', message: 'اكتب بريدك وكلمة السر.' });
    }

    const row = await db.one(
      'SELECT id, email, password_hash, totp_enabled FROM users WHERE email_norm = $1',
      [normalizeEmail(email)]
    );

    // Same message and comparable timing whether the account exists or not,
    // so this endpoint cannot be used to enumerate registered emails.
    if (!row) {
      fakeVerify(password);
      return res
        .status(401)
        .json({ error: 'bad_credentials', message: 'البريد أو كلمة السر غلط.' });
    }
    if (!verifyPassword(password, row.password_hash)) {
      return res
        .status(401)
        .json({ error: 'bad_credentials', message: 'البريد أو كلمة السر غلط.' });
    }

    await clearAuthAttempts(db, req);

    // Password was right but a second factor is still owed. No session is
    // created here — only a short-lived challenge that grants nothing but the
    // right to present a code. Whether 2FA is on is revealed *after* the
    // password check, so it cannot be probed from outside.
    if (row.totp_enabled) {
      setMfaCookie(res, await createChallenge(db, row.id));
      return res.json({ mfaRequired: true });
    }

    const token = await createSession(db, row.id, deviceLabel(req));
    setSessionCookie(res, token);
    res.json({ email: row.email, mfaRequired: false });
  });

  /** Second step of login: the TOTP code, or one recovery code. */
  router.post(
    '/login/verify',
    memoryRateLimit({
      windowMs: 15 * 60 * 1000,
      max: 30,
      message: 'محاولات كثيرة. انتظر شوي وحاول مرة ثانية.',
    }),
    async (req, res) => {
      const challenge = await lookupChallenge(db, req.cookies?.[MFA_COOKIE]);
      if (!challenge) {
        clearMfaCookie(res);
        return res.status(401).json({
          error: 'challenge_expired',
          message: 'انتهت مهلة التحقق. سجّل دخول من جديد.',
        });
      }

      const result = await checkSecondFactor(db, {
        id: challenge.user_id,
        secret: challenge.totp_secret,
        lastStep: challenge.totp_last_step,
      }, req.body?.code);

      if (!result.ok) {
        const burned = await recordFailedAttempt(db, challenge);
        if (burned) {
          clearMfaCookie(res);
          return res.status(401).json({
            error: 'challenge_expired',
            message: 'محاولات كثيرة غلط. سجّل دخول من جديد.',
          });
        }
        return res.status(401).json({
          error: 'bad_code',
          message:
            result.reason === 'replay'
              ? 'هذا الرمز استُخدم. انتظر الرمز الجاي.'
              : 'الرمز غلط. تأكد من التطبيق وحاول مرة ثانية.',
        });
      }

      await consumeChallenge(db, challenge.id);
      clearMfaCookie(res);
      const token = await createSession(db, challenge.user_id, deviceLabel(req));
      setSessionCookie(res, token);

      const left = await countRecoveryCodes(db, challenge.user_id);
      res.json({
        email: challenge.email,
        usedRecovery: result.usedRecovery,
        recoveryCodesLeft: left,
      });
    }
  );

  router.post('/logout', async (req, res) => {
    await destroySession(db, req.cookies?.[sessionCookieName()]);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post('/logout-all', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    await destroyAllSessions(db, req.user.userId);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post('/change-password', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });

    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const checked = checkCredentials({ email: req.user.email, password: req.body?.newPassword });
    if (checked.error) return res.status(400).json({ error: 'invalid', message: checked.error });

    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
    if (!row || !verifyPassword(current, row.password_hash)) {
      return res
        .status(401)
        .json({ error: 'bad_credentials', message: 'كلمة السر الحالية غلط.' });
    }

    await db.run('UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3', [
      hashPassword(checked.password),
      Date.now(),
      req.user.userId,
    ]);
    // Changing the password kicks every other device out.
    await destroyAllSessions(db, req.user.userId);
    const token = await createSession(db, req.user.userId, deviceLabel(req));
    setSessionCookie(res, token);
    res.status(204).end();
  });

  /* ────────────────────────── two-factor authentication ────────────────────────── */

  const requireAuth = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    next();
  };

  /** Re-check the password before any change to the second factor. */
  const requirePassword = async (req, res, next) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password || password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: 'invalid', message: 'اكتب كلمة السر.' });
    }
    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.userId]);
    if (!row || !verifyPassword(password, row.password_hash)) {
      return res.status(401).json({ error: 'bad_credentials', message: 'كلمة السر غلط.' });
    }
    next();
  };

  const twoFactorLimiter = memoryRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: 'محاولات كثيرة. انتظر شوي.',
  });

  /**
   * Step 1 — hand out a secret and the QR code for it. Nothing is switched on
   * yet: the secret sits in `totp_pending` until a working code proves the
   * authenticator app actually holds it. Enabling without that check is how
   * people lock themselves out.
   */
  router.post('/2fa/setup', requireAuth, twoFactorLimiter, requirePassword, async (req, res) => {
    const row = await db.one('SELECT totp_enabled FROM users WHERE id = $1', [req.user.userId]);
    if (row?.totp_enabled) {
      return res
        .status(409)
        .json({ error: 'already_enabled', message: 'التحقق بخطوتين مفعّل أصلاً.' });
    }

    const secret = generateSecret();
    await db.run('UPDATE users SET totp_pending = $1, updated_at = $2 WHERE id = $3', [
      secret,
      Date.now(),
      req.user.userId,
    ]);

    const url = otpauthUrl({ secret, account: req.user.email });
    res.json({ secret, otpauthUrl: url, qr: encodeQRRows(url) });
  });

  /** Step 2 — a valid code proves the app is set up, so switch it on. */
  router.post('/2fa/enable', requireAuth, twoFactorLimiter, async (req, res) => {
    const row = await db.one('SELECT totp_pending, totp_enabled FROM users WHERE id = $1', [
      req.user.userId,
    ]);

    if (row?.totp_enabled) {
      return res
        .status(409)
        .json({ error: 'already_enabled', message: 'التحقق بخطوتين مفعّل أصلاً.' });
    }
    if (!row?.totp_pending) {
      return res
        .status(400)
        .json({ error: 'no_pending', message: 'ابدأ الإعداد من جديد.' });
    }

    const result = verifyCode(row.totp_pending, req.body?.code);
    if (!result.ok) {
      return res.status(400).json({
        error: 'bad_code',
        message: 'الرمز غلط. تأكد إن ساعة جوالك مضبوطة وجرّب الرمز الجديد.',
      });
    }

    await db.run(
      `UPDATE users
          SET totp_secret = totp_pending, totp_pending = NULL,
              totp_enabled = TRUE, totp_last_step = $1, updated_at = $2
        WHERE id = $3`,
      [result.step, Date.now(), req.user.userId]
    );
    const codes = await issueRecoveryCodes(db, req.user.userId);

    // Any other device signed in before 2FA existed keeps a session that never
    // passed a second factor, so those are dropped.
    await destroyAllSessions(db, req.user.userId);
    setSessionCookie(res, await createSession(db, req.user.userId, deviceLabel(req)));

    res.json({ recoveryCodes: codes });
  });

  router.post('/2fa/disable', requireAuth, twoFactorLimiter, requirePassword, async (req, res) => {
    const row = await db.one(
      'SELECT id, totp_secret, totp_enabled, totp_last_step FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (!row?.totp_enabled) {
      return res.status(400).json({ error: 'not_enabled', message: 'التحقق بخطوتين مو مفعّل.' });
    }

    // Password alone must not be enough to strip the second factor off, or the
    // second factor adds nothing against someone who has the password.
    const check = await checkSecondFactor(db, {
      id: row.id,
      secret: row.totp_secret,
      lastStep: row.totp_last_step,
    }, req.body?.code);

    if (!check.ok) {
      return res.status(401).json({ error: 'bad_code', message: 'الرمز غلط.' });
    }

    await db.tx(async (t) => {
      await t.run(
        `UPDATE users
            SET totp_secret = NULL, totp_pending = NULL, totp_enabled = FALSE,
                totp_last_step = 0, updated_at = $1
          WHERE id = $2`,
        [Date.now(), req.user.userId]
      );
      await t.run('DELETE FROM recovery_codes WHERE user_id = $1', [req.user.userId]);
    });

    res.status(204).end();
  });

  /** Fresh recovery codes; the old ones stop working immediately. */
  router.post(
    '/2fa/recovery-codes',
    requireAuth,
    twoFactorLimiter,
    requirePassword,
    async (req, res) => {
      const row = await db.one('SELECT totp_enabled FROM users WHERE id = $1', [req.user.userId]);
      if (!row?.totp_enabled) {
        return res.status(400).json({ error: 'not_enabled', message: 'التحقق بخطوتين مو مفعّل.' });
      }
      res.json({ recoveryCodes: await issueRecoveryCodes(db, req.user.userId) });
    }
  );

  return router;
}
