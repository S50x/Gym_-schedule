import express from 'express';
import { memoryRateLimit, clientIp } from '../security.js';
import { encryptSecret, decryptSecret } from '../secrets.js';
import { checkKey, readFoodImage, GeminiError } from '../gemini.js';

/**
 * قراءة الأكل من الصور بمفتاح Gemini الخاص بالمستخدم.
 *
 *   GET    /api/food/key    → { saved, last4 }       never the key itself
 *   PUT    /api/food/key    { key }                  checked with Google, then stored encrypted
 *   DELETE /api/food/key
 *   POST   /api/food/scan   { image, mimeType }      → the reading, ready to fill a meal
 *
 * The app owner pays nothing: each person's scans run on their own free key,
 * and nothing about the image is kept once the answer is back.
 */

const KIND = 'gemini';

/**
 * Gemini keys are long tokens: the older "AIza…" kind, and the newer "AQ.…"
 * kind with dots in it. Anything with spaces or other symbols is a paste
 * mistake; Google itself has the last word when the key is checked.
 */
const KEY_SHAPE = /^[A-Za-z0-9._-]{20,300}$/;

/** Base64 of the downsized JPEG the client sends; well under the JSON limit. */
const IMAGE_MAX_CHARS = 560_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const MESSAGES = {
  bad_key: 'Google رفض المفتاح. تأكد إنك نسخته كامل، أو سوّ مفتاح جديد.',
  quota: 'خلصت حصتك المجانية من Google لهالفترة. جرّب بعد شوي، أو عبّي الأرقام بيدك.',
  unreadable: 'ما قدرت أقرأ الصورة. جرّب صورة أوضح للملصق أو للأكل.',
  unavailable: 'خدمة Google ما ردت الحين. جرّب بعد دقيقة.',
};

export function foodRouter(db) {
  const router = express.Router();

  const requireAuth = (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'unauthenticated', message: 'سجّل دخول عشان تستخدم قراءة الصور.' });
    }
    next();
  };
  const byUser = (req) => (req.user ? `food:${req.user.userId}` : clientIp(req));

  // Every save costs a round trip to Google; nobody legitimately pastes ten an hour.
  const keyLimiter = memoryRateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    keyFn: (req) => `key:${byUser(req)}`,
    message: 'محاولات حفظ كثيرة. جرّب بعد شوي.',
  });
  // Google's free tier has its own ceiling; this one stops a stuck button or a
  // script from burning through it in a minute.
  const scanLimiter = memoryRateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: Number(process.env.FOOD_SCANS_PER_DAY) || 30,
    keyFn: (req) => `scan:${byUser(req)}`,
    message: 'وصلت حد الصور لليوم. تقدر تعبّي الأرقام بيدك.',
  });

  const readKey = async (userId) => {
    const row = await db.one(
      'SELECT ciphertext, iv, tag, last4 FROM user_secrets WHERE user_id = $1 AND kind = $2',
      [userId, KIND]
    );
    if (!row) return null;
    return { plain: decryptSecret(row), last4: row.last4 };
  };

  router.get('/key', requireAuth, async (req, res) => {
    const key = await readKey(req.user.userId);
    // A key that no longer decrypts (secret rotated) is as good as none.
    res.json({ saved: !!key?.plain, last4: key?.plain ? key.last4 : null });
  });

  router.put('/key', requireAuth, keyLimiter, async (req, res) => {
    const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
    if (!KEY_SHAPE.test(key)) {
      return res.status(400).json({ error: 'invalid_key', message: 'هذا ما يشبه مفتاح Gemini. انسخه كامل من صفحة Google.' });
    }
    try {
      await checkKey(key);
    } catch (err) {
      const code = err instanceof GeminiError ? err.code : 'unavailable';
      return res.status(code === 'bad_key' ? 400 : 502).json({ error: code, message: MESSAGES[code] });
    }
    const sealed = encryptSecret(key);
    const last4 = key.slice(-4);
    await db.run(
      `INSERT INTO user_secrets (user_id, kind, ciphertext, iv, tag, last4, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, kind) DO UPDATE
         SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, tag = EXCLUDED.tag,
             last4 = EXCLUDED.last4, updated_at = EXCLUDED.updated_at`,
      [req.user.userId, KIND, sealed.ciphertext, sealed.iv, sealed.tag, last4, Date.now()]
    );
    res.json({ saved: true, last4 });
  });

  router.delete('/key', requireAuth, async (req, res) => {
    await db.run('DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2', [req.user.userId, KIND]);
    res.json({ saved: false, last4: null });
  });

  router.post('/scan', requireAuth, scanLimiter, async (req, res) => {
    const data = typeof req.body?.image === 'string' ? req.body.image : '';
    const mimeType = typeof req.body?.mimeType === 'string' ? req.body.mimeType : 'image/jpeg';
    if (!data || data.length > IMAGE_MAX_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data) || !MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'invalid_image', message: 'الصورة ما وصلت صح. جرّب مرة ثانية.' });
    }
    const key = await readKey(req.user.userId);
    if (!key?.plain) {
      return res.status(409).json({ error: 'no_key', message: 'ما حطيت مفتاح Gemini بعد.' });
    }
    try {
      const reading = await readFoodImage(key.plain, { data, mimeType });
      res.json(reading);
    } catch (err) {
      const code = err instanceof GeminiError ? err.code : 'unavailable';
      const status = { bad_key: 400, quota: 429, unreadable: 422 }[code] || 502;
      res.status(status).json({ error: code, message: MESSAGES[code] });
    }
  });

  return router;
}
