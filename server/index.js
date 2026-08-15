import { config } from './config.js';
import { createDb, sweep } from './db.js';
import { createApp } from './app.js';

const db = await createDb();
await sweep(db);

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.log(`حديد — يشتغل على المنفذ ${config.port} (${config.env})`);
  console.log(`Origin: ${config.origin}  ·  Secure cookies: ${config.secureCookies}`);
  console.log(
    config.databaseUrl
      ? 'Database: Postgres (DATABASE_URL)'
      : `Database: embedded Postgres at ${config.dbDir} — data is NOT durable on a host without a disk`
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} — إغلاق...`);
  clearInterval(app.locals.sweepTimer);

  // Do not hang forever on a stuck keep-alive connection.
  const bail = setTimeout(() => process.exit(1), 10_000);
  bail.unref();

  await new Promise((resolve) => server.close(resolve));
  try {
    await db.close();
  } catch {
    /* already closed */
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
