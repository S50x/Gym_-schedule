import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Load a .env file without pulling in a dependency. Existing env vars win. */
function loadDotEnv(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

loadDotEnv(path.resolve(process.cwd(), '.env'));

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

function requiredSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (isProd) {
    throw new Error(
      'SESSION_SECRET is missing or shorter than 32 characters. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
    );
  }
  // Dev/test only: ephemeral secret. Restarting invalidates sessions, which is fine locally.
  return crypto.randomBytes(48).toString('base64url');
}

const origin = (process.env.ORIGIN || `http://localhost:${process.env.PORT || 3000}`).replace(
  /\/+$/,
  ''
);

export const config = {
  env,
  isProd,
  isTest,
  port: Number(process.env.PORT || 3000),
  // Set DATABASE_URL and the app talks to a managed Postgres. Leave it unset
  // and it runs an embedded Postgres (PGlite) from a local folder, so `npm
  // start` works with nothing installed.
  databaseUrl: process.env.DATABASE_URL || '',
  dbDir: isTest ? '' : process.env.DB_PATH || './data/pgdata',
  sessionSecret: requiredSecret(),
  origin,
  // Secure cookies require HTTPS. Never force them on in plain-HTTP local dev or the
  // browser silently drops the cookie and login appears to "do nothing".
  secureCookies: isProd && origin.startsWith('https://'),
  trustProxy: process.env.TRUST_PROXY === '1',
  allowRegistration: process.env.ALLOW_REGISTRATION !== '0',
  // Transactional email for password resets, sent through Resend's HTTP API.
  // Leave RESEND_API_KEY unset and the reset flow degrades gracefully: the
  // endpoints still answer (and never reveal whether an account exists), but no
  // mail goes out and the boot log says so. One integration point, like the
  // database — set the key and a from-address and it works.
  mail: {
    resendApiKey: process.env.RESEND_API_KEY || '',
    resendApiUrl: process.env.RESEND_API_URL || 'https://api.resend.com/emails',
    from: process.env.MAIL_FROM || 'حديد <onboarding@resend.dev>',
    // How long a reset link stays valid.
    resetTtlMs: 60 * 60 * 1000, // 1 hour
  },
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  sessionIdleMs: 30 * 24 * 60 * 60 * 1000,
  scrypt: {
    // ~64 MiB, deliberately slow. Tuned down under test so the suite stays fast.
    N: isTest ? 1 << 12 : 1 << 16,
    r: 8,
    p: 1,
    keylen: 64,
    maxmem: 256 * 1024 * 1024,
  },
};

if (isProd && !origin.startsWith('https://')) {
  console.warn(
    '[warn] ORIGIN is not https:// — session cookies will NOT be marked Secure. ' +
      'Put the app behind TLS before using it for real data.'
  );
}
