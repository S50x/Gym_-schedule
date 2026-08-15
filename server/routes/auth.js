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
import { authRateLimit, clearAuthAttempts } from '../security.js';
import { emptyState } from '../state-schema.js';

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

  router.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    const { count } = db
      .prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?')
      .get(req.user.userId);
    res.json({ email: req.user.email, devices: count });
  });

  router.post('/register', registerLimiter, (req, res) => {
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
      const info = db
        .prepare(
          `INSERT INTO users (email, email_norm, password_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(checked.email, emailNorm, hash, now, now);
      userId = Number(info.lastInsertRowid);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res
          .status(409)
          .json({ error: 'exists', message: 'فيه حساب مسجّل بهذا البريد. سجّل دخول بدل التسجيل.' });
      }
      throw err;
    }

    db.prepare(
      'INSERT INTO app_state (user_id, doc, version, updated_at) VALUES (?, ?, 0, ?)'
    ).run(userId, JSON.stringify(emptyState()), now);

    clearAuthAttempts(db, req);
    const token = createSession(db, userId, deviceLabel(req), now);
    setSessionCookie(res, token);
    res.status(201).json({ email: checked.email });
  });

  router.post('/login', loginLimiter, (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password || password.length > MAX_PASSWORD) {
      return res
        .status(400)
        .json({ error: 'invalid', message: 'اكتب بريدك وكلمة السر.' });
    }

    const row = db
      .prepare('SELECT id, email, password_hash FROM users WHERE email_norm = ?')
      .get(normalizeEmail(email));

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

    clearAuthAttempts(db, req);
    const token = createSession(db, row.id, deviceLabel(req));
    setSessionCookie(res, token);
    res.json({ email: row.email });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, req.cookies?.[sessionCookieName()]);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post('/logout-all', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    destroyAllSessions(db, req.user.userId);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.post('/change-password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });

    const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const checked = checkCredentials({ email: req.user.email, password: req.body?.newPassword });
    if (checked.error) return res.status(400).json({ error: 'invalid', message: checked.error });

    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.userId);
    if (!row || !verifyPassword(current, row.password_hash)) {
      return res
        .status(401)
        .json({ error: 'bad_credentials', message: 'كلمة السر الحالية غلط.' });
    }

    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(checked.password),
      Date.now(),
      req.user.userId
    );
    // Changing the password kicks every other device out.
    destroyAllSessions(db, req.user.userId);
    const token = createSession(db, req.user.userId, deviceLabel(req));
    setSessionCookie(res, token);
    res.status(204).end();
  });

  return router;
}
