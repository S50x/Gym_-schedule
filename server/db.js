import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

function open(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

const MIGRATIONS = [
  // 1 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        email         TEXT    NOT NULL,
        email_norm    TEXT    NOT NULL UNIQUE,
        password_hash TEXT    NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id          INTEGER PRIMARY KEY,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT    NOT NULL UNIQUE,
        created_at  INTEGER NOT NULL,
        expires_at  INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        label       TEXT
      );
      CREATE INDEX sessions_user_idx ON sessions(user_id);
      CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

      CREATE TABLE app_state (
        user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        doc        TEXT    NOT NULL,
        version    INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE login_attempts (
        id         INTEGER PRIMARY KEY,
        bucket     TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX login_attempts_bucket_idx ON login_attempts(bucket, created_at);
    `);
  },

  // 2 — two-factor authentication (TOTP + recovery codes)
  (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN totp_secret    TEXT;
      ALTER TABLE users ADD COLUMN totp_pending   TEXT;
      ALTER TABLE users ADD COLUMN totp_enabled   INTEGER NOT NULL DEFAULT 0;
      -- Newest time step already spent, so a code cannot be replayed inside
      -- the 30 seconds it stays valid.
      ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE recovery_codes (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash  TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX recovery_codes_user_idx ON recovery_codes(user_id);

      -- A password that checked out but still owes a second factor. Short
      -- lived, single use, and capped on attempts.
      CREATE TABLE mfa_challenges (
        id         INTEGER PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT    NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges(expires_at);
    `);
  },
];

export function createDb(dbPath = config.dbPath) {
  const db = open(dbPath);
  const current = db.pragma('user_version', { simple: true });
  for (let i = current; i < MIGRATIONS.length; i++) {
    const migrate = MIGRATIONS[i];
    db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

/** Delete expired sessions, challenges and stale rate-limit rows. Safe to call often. */
export function sweep(db, now = Date.now()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('DELETE FROM login_attempts WHERE created_at <= ?').run(now - 24 * 60 * 60 * 1000);
  db.prepare('DELETE FROM mfa_challenges WHERE expires_at <= ?').run(now);
}
