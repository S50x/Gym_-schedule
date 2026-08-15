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

  const readRow = (userId) => {
    const row = db
      .prepare('SELECT doc, version, updated_at FROM app_state WHERE user_id = ?')
      .get(userId);
    if (row) return row;
    const now = Date.now();
    const doc = JSON.stringify(emptyState());
    db.prepare(
      'INSERT INTO app_state (user_id, doc, version, updated_at) VALUES (?, ?, 0, ?)'
    ).run(userId, doc, now);
    return { doc, version: 0, updated_at: now };
  };

  router.get('/', requireAuth, (req, res) => {
    const row = readRow(req.user.userId);
    res.json({ version: row.version, doc: JSON.parse(row.doc), updatedAt: row.updated_at });
  });

  router.put('/', requireAuth, (req, res) => {
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
    const write = db.transaction(() => {
      const row = readRow(req.user.userId);

      if (row.version !== baseVersion) {
        // Conflict: merge instead of rejecting, so no workout is ever lost.
        const merged = mergeStates(JSON.parse(row.doc), result.doc);
        const version = row.version + 1;
        db.prepare(
          'UPDATE app_state SET doc = ?, version = ?, updated_at = ? WHERE user_id = ?'
        ).run(JSON.stringify(merged), version, now, req.user.userId);
        return { conflict: true, version, doc: merged };
      }

      const version = row.version + 1;
      db.prepare(
        'UPDATE app_state SET doc = ?, version = ?, updated_at = ? WHERE user_id = ?'
      ).run(JSON.stringify(result.doc), version, now, req.user.userId);
      return { conflict: false, version, doc: result.doc };
    });

    const out = write();
    res
      .status(out.conflict ? 409 : 200)
      .json({ version: out.version, doc: out.doc, merged: out.conflict, updatedAt: now });
  });

  router.delete('/', requireAuth, (req, res) => {
    const now = Date.now();
    const row = readRow(req.user.userId);
    db.prepare(
      'UPDATE app_state SET doc = ?, version = ?, updated_at = ? WHERE user_id = ?'
    ).run(JSON.stringify(emptyState()), row.version + 1, now, req.user.userId);
    res.json({ version: row.version + 1, doc: emptyState() });
  });

  return router;
}
