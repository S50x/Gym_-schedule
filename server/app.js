import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { lookupSession, sessionCookieName } from './auth.js';
import { securityHeaders, issueCsrf, requireCsrf, memoryRateLimit } from './security.js';
import { authRouter } from './routes/auth.js';
import { stateRouter } from './routes/state.js';
import { sweep } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, '..', 'public');

export function createApp(db) {
  const app = express();

  app.disable('x-powered-by');
  app.set('etag', 'strong');
  // Only trust the first proxy hop, and only when told to. Trusting blindly
  // lets anyone forge X-Forwarded-For and walk straight through the rate limiter.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(securityHeaders());
  app.use(cookieParser());
  app.use(issueCsrf);

  /* ── static assets ─────────────────────────────────────────── */

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      dotfiles: 'ignore',
      redirect: false,
      setHeaders(res, filePath) {
        if (/[\\/](fonts|img)[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-cache');
        } else {
          // Revalidate on every load so a deploy reaches phones immediately.
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  /* ── session ───────────────────────────────────────────────── */

  app.use(async (req, res, next) => {
    const token = req.cookies?.[sessionCookieName()];
    req.user = token ? await lookupSession(db, token) : null;
    next();
  });

  /* ── API ───────────────────────────────────────────────────── */

  const api = express.Router();
  api.use(express.json({ limit: '600kb' }));
  api.use(
    memoryRateLimit({
      windowMs: 60 * 1000,
      max: 240,
      message: 'طلبات كثيرة بسرعة. انتظر دقيقة.',
    })
  );
  api.use(requireCsrf);
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (req, res) => res.json({ ok: true }));
  api.get('/config', (req, res) =>
    res.json({ allowRegistration: config.allowRegistration, authenticated: !!req.user })
  );
  api.use('/auth', authRouter(db));
  api.use('/state', stateRouter(db));

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));

  app.use('/api', api);

  /* ── app shell ─────────────────────────────────────────────── */

  // `/` and `/reset` both serve the single-page shell; the reset link lands on
  // /reset?token=… and the client reads the token from the URL.
  app.get(/^\/(?:index\.html|reset)?$/, (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('غير موجود'));

  /* ── errors ────────────────────────────────────────────────── */

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    if (res.headersSent) return;
    // Never echo a stack trace or a driver message back to the client.
    res.status(status).json(
      status === 413
        ? { error: 'too_large', message: 'حجم البيانات كبير زيادة.' }
        : status === 400
          ? { error: 'bad_request', message: 'طلب غير صالح.' }
          : { error: 'server_error', message: 'صار خطأ بالسيرفر. حاول مرة ثانية.' }
    );
  });

  // Housekeeping: drop expired sessions and stale rate-limit rows hourly.
  const timer = setInterval(() => {
    sweep(db).catch((err) => console.error('[sweep]', err));
  }, 60 * 60 * 1000);
  timer.unref?.();
  app.locals.sweepTimer = timer;

  return app;
}
