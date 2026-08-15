import { config } from './config.js';
import { createDb, sweep } from './db.js';
import { createApp } from './app.js';

const db = createDb();
sweep(db);

const app = createApp(db);
const server = app.listen(config.port, () => {
  console.log(`حديد — يشتغل على المنفذ ${config.port} (${config.env})`);
  console.log(`Origin: ${config.origin}  ·  Secure cookies: ${config.secureCookies}`);
});

function shutdown(signal) {
  console.log(`\n${signal} — إغلاق...`);
  clearInterval(app.locals.sweepTimer);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  // Do not hang forever on a stuck keep-alive connection.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
