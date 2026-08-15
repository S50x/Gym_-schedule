import crypto from 'node:crypto';
import helmet from 'helmet';
import { config } from './config.js';
import { CSRF_COOKIE, setCsrfCookie } from './auth.js';

/* ────────────────────────── headers ────────────────────────── */

export function securityHeaders() {
  return [
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          'manifest-src': ["'self'"],
          'worker-src': ["'self'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          ...(config.secureCookies ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.secureCookies
        ? { maxAge: 31536000, includeSubDomains: true, preload: false }
        : false,
      // The app is same-origin only; these add nothing but noise.
      originAgentCluster: true,
      xPoweredBy: false,
    }),
    (req, res, next) => {
      res.removeHeader('X-Powered-By');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
      next();
    },
  ];
}

/* ────────────────────────── CSRF ────────────────────────── */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Hands out a CSRF token cookie on safe requests so the client always has one. */
export function issueCsrf(req, res, next) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    token = crypto.randomBytes(32).toString('base64url');
    setCsrfCookie(res, token);
  }
  res.locals.csrfToken = token;
  next();
}

/**
 * Three independent checks, any one of which stops a cross-site write:
 *  1. Origin/Referer must match our own origin.
 *  2. A header token must equal the cookie token (double submit).
 *  3. The session cookie itself is SameSite=Strict.
 */
export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get('origin');
  if (origin) {
    if (origin !== config.origin) {
      return res.status(403).json({ error: 'bad_origin', message: 'طلب من مصدر غير موثوق.' });
    }
  } else {
    const referer = req.get('referer');
    if (referer && !referer.startsWith(config.origin + '/') && referer !== config.origin) {
      return res.status(403).json({ error: 'bad_origin', message: 'طلب من مصدر غير موثوق.' });
    }
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');
  if (!cookieToken || !headerToken || !timingSafeEqualStr(cookieToken, headerToken)) {
    return res
      .status(403)
      .json({ error: 'bad_csrf', message: 'انتهت صلاحية الصفحة. حدّث الصفحة وحاول مرة ثانية.' });
  }
  return next();
}

/* ────────────────────────── rate limiting ────────────────────────── */

/** In-memory sliding window. Per-process, which is fine for a single-node app. */
export function memoryRateLimit({ windowMs, max, keyFn, message }) {
  const hits = new Map();
  let lastSweep = Date.now();

  return function limiter(req, res, next) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [k, times] of hits) {
        const kept = times.filter((t) => now - t < windowMs);
        if (kept.length) hits.set(k, kept);
        else hits.delete(k);
      }
      lastSweep = now;
    }
    const key = keyFn ? keyFn(req) : clientIp(req);
    const times = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - times[0])) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'rate_limited',
        retryAfter,
        message: message || `محاولات كثيرة. جرّب بعد ${retryAfter} ثانية.`,
      });
    }
    times.push(now);
    hits.set(key, times);
    return next();
  };
}

/**
 * Durable limiter for authentication. Backed by SQLite so restarting the
 * process does not hand an attacker a fresh budget, and keyed on both IP and
 * account so neither a single IP nor a single account can be hammered.
 */
export function authRateLimit(db, { windowMs, max }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    const buckets = [`ip:${clientIp(req)}`];
    const email = typeof req.body?.email === 'string' ? normalizeEmailForBucket(req.body.email) : '';
    if (email) buckets.push(`acct:${email}`);

    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE bucket = ? AND created_at > ?`
    );
    for (const bucket of buckets) {
      const { n } = count.get(bucket, now - windowMs);
      if (n >= max) {
        const retryAfter = Math.ceil(windowMs / 1000);
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'rate_limited',
          retryAfter,
          message: 'محاولات دخول كثيرة. انتظر شوي وحاول مرة ثانية.',
        });
      }
    }

    // Record the attempt now; routes clear it again on success.
    const insert = db.prepare('INSERT INTO login_attempts (bucket, created_at) VALUES (?, ?)');
    for (const bucket of buckets) insert.run(bucket, now);
    req.rateLimitBuckets = buckets;
    return next();
  };
}

export function clearAuthAttempts(db, req) {
  for (const bucket of req.rateLimitBuckets || []) {
    db.prepare('DELETE FROM login_attempts WHERE bucket = ?').run(bucket);
  }
}

function normalizeEmailForBucket(email) {
  return email.trim().toLowerCase().slice(0, 320);
}

export function clientIp(req) {
  // req.ip already honours the trust-proxy setting configured on the app.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
