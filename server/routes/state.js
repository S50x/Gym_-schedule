import express from 'express';
import { validateState, mergeStates, emptyState } from '../state-schema.js';

/**
 * مزامنة البيانات بين الأجهزة.
 * One JSON document per user, guarded by an integer version:
 *  - GET  /api/state             → { version, doc }
 *  - PUT  /api/state             → { baseVersion, doc }
 *      200 { version, doc }      saved
 *      409 { version, doc }      someone else wrote first; the server has
 *                                already merged both sides, so the client just
 *                                adopts the returned document.
 */
export function stateRouter(db) {
  const router = express.Router();

  const requireAuth = (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json({ error: 'unauthenticated', message: 'سجّل دخول عشان تتزامن بياناتك.' });
    }
    next();
  };

  /**
   * Read the row, creating it if this is the account's first sync.
   * `lock` takes a row-level lock for the rest of the transaction — see the
   * note in the PUT handler for why that is not optional.
   */
  const readRow = async (t, userId, { lock = false } = {}) => {
    const row = await t.one(
      `SELECT doc, version, updated_at FROM app_state WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
      [userId]
    );
    if (row) return row;

    const now = Date.now();
    const doc = JSON.stringify(emptyState());
    // Another request may have created it in the meantime.
    await t.run(
      `INSERT INTO app_state (user_id, doc, version, updated_at) VALUES ($1, $2, 0, $3)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, doc, now]
    );
    return (
      (await t.one(
        `SELECT doc, version, updated_at FROM app_state WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
        [userId]
      )) ?? { doc, version: 0, updated_at: now }
    );
  };

  router.get('/', requireAuth, async (req, res) => {
    const row = await db.tx((t) => readRow(t, req.user.userId));
    res.json({ version: row.version, doc: JSON.parse(row.doc), updatedAt: row.updated_at });
  });

  router.put('/', requireAuth, async (req, res) => {
    const baseVersion = Number(req.body?.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 0) {
      return res.status(400).json({ error: 'invalid', message: 'baseVersion مفقود أو غير صحيح.' });
    }

    const result = validateState(req.body?.doc);
    if (!result.ok) {
      return res
        .status(400)
        .json({ error: 'invalid_state', message: 'بيانات غير صالحة.', detail: result.message });
    }

    const now = Date.now();
    const out = await db.tx(async (t) => {
      // SELECT ... FOR UPDATE, not a plain read. This is a read-modify-write:
      // under SQLite every write was serialised so a plain read was safe, but
      // Postgres runs transactions concurrently. Without the row lock two
      // devices syncing at the same moment can both read version N and both
      // write N+1 — and the second one silently erases the first one's workout.
      const row = await readRow(t, req.user.userId, { lock: true });

      if (row.version !== baseVersion) {
        // Conflict: merge instead of rejecting, so no workout is ever lost.
        const merged = mergeStates(JSON.parse(row.doc), result.doc);
        const version = row.version + 1;
        await t.run(
          'UPDATE app_state SET doc = $1, version = $2, updated_at = $3 WHERE user_id = $4',
          [JSON.stringify(merged), version, now, req.user.userId]
        );
        return { conflict: true, version, doc: merged };
      }

      const version = row.version + 1;
      await t.run(
        'UPDATE app_state SET doc = $1, version = $2, updated_at = $3 WHERE user_id = $4',
        [JSON.stringify(result.doc), version, now, req.user.userId]
      );
      return { conflict: false, version, doc: result.doc };
    });

    res
      .status(out.conflict ? 409 : 200)
      .json({ version: out.version, doc: out.doc, merged: out.conflict, updatedAt: now });
  });

  router.delete('/', requireAuth, async (req, res) => {
    const now = Date.now();
    const out = await db.tx(async (t) => {
      const row = await readRow(t, req.user.userId, { lock: true });
      const version = row.version + 1;
      await t.run(
        'UPDATE app_state SET doc = $1, version = $2, updated_at = $3 WHERE user_id = $4',
        [JSON.stringify(emptyState()), version, now, req.user.userId]
      );
      return version;
    });
    res.json({ version: out, doc: emptyState() });
  });

  return router;
}
