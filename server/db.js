/**
 * طبقة قاعدة البيانات — Postgres.
 *
 * One SQL dialect everywhere, two drivers behind one interface:
 *
 *   - production : `pg` against DATABASE_URL (Render, Neon, Supabase, any host)
 *   - dev/tests  : PGlite — real Postgres compiled to WASM, running in-process,
 *                  so there is no server to install and tests stay hermetic
 *
 * Keeping a single dialect matters: supporting SQLite *and* Postgres would
 * double the query surface and let bugs hide in whichever path the tests do
 * not exercise. What runs locally is the same SQL that runs in production.
 */

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from './config.js';

/**
 * node-postgres hands back int8 (BIGINT) as a *string* by default, to avoid
 * silently truncating values past 2^53. Every BIGINT here is a millisecond
 * timestamp or a row count — far below that — so parsing to Number is safe,
 * and without this every `created_at` comparison would compare strings.
 * (PGlite already returns numbers; verified.)
 */
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

/** Postgres error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = '23505';

const SCHEMA = [
  // 1 — accounts, sessions, synced state, auth throttling
  `
  CREATE TABLE users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT    NOT NULL,
    email_norm    TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    BIGINT  NOT NULL,
    updated_at    BIGINT  NOT NULL
  );

  CREATE TABLE sessions (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT    NOT NULL UNIQUE,
    created_at   BIGINT  NOT NULL,
    expires_at   BIGINT  NOT NULL,
    last_seen_at BIGINT  NOT NULL,
    label        TEXT
  );
  CREATE INDEX sessions_user_idx ON sessions(user_id);
  CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE app_state (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    doc        TEXT    NOT NULL,
    version    INTEGER NOT NULL,
    updated_at BIGINT  NOT NULL
  );

  CREATE TABLE login_attempts (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    bucket     TEXT   NOT NULL,
    created_at BIGINT NOT NULL
  );
  CREATE INDEX login_attempts_bucket_idx ON login_attempts(bucket, created_at);
  `,

  // 2 — two-factor authentication
  `
  ALTER TABLE users ADD COLUMN totp_secret    TEXT;
  ALTER TABLE users ADD COLUMN totp_pending   TEXT;
  ALTER TABLE users ADD COLUMN totp_enabled   BOOLEAN NOT NULL DEFAULT FALSE;
  -- Newest time step already spent, so a code cannot be replayed inside the
  -- 30 seconds it stays valid.
  ALTER TABLE users ADD COLUMN totp_last_step BIGINT NOT NULL DEFAULT 0;

  CREATE TABLE recovery_codes (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT    NOT NULL,
    created_at BIGINT  NOT NULL
  );
  CREATE INDEX recovery_codes_user_idx ON recovery_codes(user_id);

  -- A password that checked out but still owes a second factor. Short lived,
  -- single use, capped on attempts.
  CREATE TABLE mfa_challenges (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT    NOT NULL UNIQUE,
    created_at BIGINT  NOT NULL,
    expires_at BIGINT  NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX mfa_challenges_expiry_idx ON mfa_challenges(expires_at);
  `,
];

/* ────────────────────────── drivers ────────────────────────── */

/**
 * Managed Postgres (Neon, Supabase, Render) requires TLS; a local socket does
 * not offer it.
 *
 * The certificate is *verified* by default. Turning verification off is the
 * usual copy-paste advice, but it means anyone able to sit between the app and
 * the database can read every row in transit — including password hashes and
 * session tokens. Providers with publicly-trusted certificates (Neon among
 * them) verify cleanly. A provider using a self-signed certificate can opt out
 * explicitly with `?sslmode=no-verify`, which at least makes the trade-off
 * visible in the connection string instead of hidden in the code.
 */
function tlsOptions(url) {
  if (/[?&]sslmode=disable/.test(url)) return false;
  if (/[?&]sslmode=no-verify/.test(url)) return { rejectUnauthorized: false };
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (local && !/[?&]sslmode=/.test(url)) return false;
  return { rejectUnauthorized: true };
}

async function connectPg(url) {
  const pool = new pg.Pool({
    connectionString: url,
    // Free-tier Postgres allows few connections; a small pool avoids
    // exhausting them, and a short idle timeout releases them promptly.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: tlsOptions(url),
  });

  // Without this listener node-postgres raises an *unhandled* 'error' event
  // when an idle connection dies, which takes the whole process down. That is
  // not hypothetical here: free-tier Postgres (Neon, Supabase) suspends its
  // compute after a few minutes idle and drops open connections. The pool
  // discards the dead client and opens a fresh one on the next query.
  pool.on('error', (err) => {
    console.error('[db] idle connection dropped:', err.message);
  });

  // Fail loudly at boot rather than on the first request. A suspended instance
  // may need a moment to wake, so give it a couple of tries.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const probe = await pool.connect();
      probe.release();
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  if (lastError) throw lastError;

  return {
    kind: 'pg',
    query: (sql, params) => pool.query(sql, params),
    // No parameters → simple query protocol, which is the only one that
    // accepts a script of several statements (migrations need that).
    exec: (sql) => pool.query(sql),
    async connect() {
      const client = await pool.connect();
      // node-postgres clients expose only query(); give them the same shape
      // PGlite's do so the transaction wrapper stays driver-agnostic.
      client.exec = (sql) => client.query(sql);
      return client;
    },
    close: () => pool.end(),
  };
}

async function connectPglite(dir) {
  if (dir) fs.mkdirSync(path.resolve(dir), { recursive: true });
  const lite = await PGlite.create(dir ? { dataDir: path.resolve(dir) } : {});
  return {
    kind: 'pglite',
    query: async (sql, params) => lite.query(sql, params),
    exec: async (sql) => lite.exec(sql),
    // PGlite is single-connection by design, so a "client" is the database
    // itself. Transactions still work; they just cannot overlap.
    connect: async () => ({
      query: (sql, params) => lite.query(sql, params),
      exec: (sql) => lite.exec(sql),
      release: () => {},
    }),
    close: () => lite.close(),
  };
}

/* ────────────────────────── public interface ────────────────────────── */

function wrap(driver) {
  const api = {
    kind: driver.kind,

    /** @returns {Promise<{rows: object[], rowCount: number}>} */
    async query(sql, params = []) {
      const res = await driver.query(sql, params);
      return { rows: res.rows ?? [], rowCount: res.rowCount ?? res.rows?.length ?? 0 };
    },

    /** First row, or null. */
    async one(sql, params = []) {
      const { rows } = await api.query(sql, params);
      return rows[0] ?? null;
    },

    /** Number of rows affected. */
    async run(sql, params = []) {
      const { rowCount } = await api.query(sql, params);
      return rowCount;
    },

    /** Run a script of one or more statements. No parameters, no rows back. */
    async exec(sql) {
      await driver.exec(sql);
    },

    /**
     * Runs `fn` inside a transaction, rolling back on any throw.
     * `fn` receives a handle with the same query/one/run shape, bound to the
     * transaction's connection — using `db` directly inside would run outside it.
     */
    async tx(fn) {
      const client = await driver.connect();
      const scoped = {
        query: async (sql, params = []) => {
          const res = await client.query(sql, params);
          return { rows: res.rows ?? [], rowCount: res.rowCount ?? res.rows?.length ?? 0 };
        },
        one: async (sql, params = []) => (await scoped.query(sql, params)).rows[0] ?? null,
        run: async (sql, params = []) => (await scoped.query(sql, params)).rowCount,
        exec: async (sql) => {
          await client.exec(sql);
        },
      };
      try {
        await client.query('BEGIN');
        const result = await fn(scoped);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection already broken */
        }
        throw err;
      } finally {
        client.release();
      }
    },

    close: () => driver.close(),
  };
  return api;
}

export async function createDb(url = config.databaseUrl) {
  const driver = url ? await connectPg(url) : await connectPglite(config.dbDir);
  const db = wrap(driver);
  await migrate(db);
  return db;
}

/* ────────────────────────── migrations ────────────────────────── */

async function migrate(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )
  `);

  // Two instances booting at once would otherwise both try to create the same
  // tables. The lock is advisory and released with the transaction.
  await db.tx(async (t) => {
    if (db.kind === 'pg') await t.query('SELECT pg_advisory_xact_lock($1)', [727_314_001]);

    const { rows } = await t.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => Number(r.version)));

    for (let i = 0; i < SCHEMA.length; i++) {
      const version = i + 1;
      if (applied.has(version)) continue;
      await t.exec(SCHEMA[i]);
      await t.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [
        version,
        Date.now(),
      ]);
    }
  });
}

/* ────────────────────────── housekeeping ────────────────────────── */

/** Delete expired sessions, challenges and stale rate-limit rows. */
export async function sweep(db, now = Date.now()) {
  await db.run('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  await db.run('DELETE FROM login_attempts WHERE created_at <= $1', [now - 24 * 60 * 60 * 1000]);
  await db.run('DELETE FROM mfa_challenges WHERE expires_at <= $1', [now]);
}
