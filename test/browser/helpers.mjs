/**
 * Shared plumbing for the browser journeys.
 *
 * These journeys exist because eight defects reached a green unit-test suite and
 * were only caught by driving the real app: recovery codes rendered into a
 * detached node, TLS verification that was silently discarded, a header under the
 * Dynamic Island, onboarding swallowing a user who already had history, gym mode
 * serving another goal's programme. Keep them runnable.
 *
 * The runner boots the server itself on a free port with a throwaway database, so
 * `npm run browser` works from a clean checkout with nothing else set up.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

/* ── browser ─────────────────────────────────────────────── */

/**
 * playwright-core ships no browsers, so it needs an explicit path. Look where
 * this project's environment puts them, and if that fails say exactly what to
 * set rather than dying with a stack trace about a missing executable.
 */
export function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const candidates = [];
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      if (!entry.startsWith('chromium')) continue;
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const full = path.join(root, entry, rel);
        if (fs.existsSync(full)) candidates.push(full);
      }
    }
  }
  if (candidates.length) return candidates.sort().at(-1);

  throw new Error(
    `No Chromium found under ${root}.\n` +
      'Set CHROME_PATH to a Chrome/Chromium binary, or PLAYWRIGHT_BROWSERS_PATH to a\n' +
      'directory containing chromium*/chrome-linux/chrome.'
  );
}

export function launchBrowser() {
  return chromium.launch({ executablePath: resolveChrome(), args: ['--no-sandbox'] });
}

/* ── the app under test ──────────────────────────────────── */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Start the real server on a free port against a throwaway PGlite directory.
 * @returns {Promise<{base:string, stop:()=>Promise<void>}>}
 */
export async function startApp() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'hadeed-browser-'));

  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ORIGIN: base,
      DB_PATH: dbPath,
      DATABASE_URL: '',
      ALLOW_REGISTRATION: '1',
      SESSION_SECRET: randomBytes(48).toString('base64url'),
    },
  });

  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`server did not become healthy in 60s:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(dbPath, { recursive: true, force: true });
  };

  return { base, stop };
}

/* ── pages ───────────────────────────────────────────────── */

/**
 * A phone-sized Arabic page that reports its own console errors and CSP
 * violations into `problems`. Every journey wants exactly this.
 */
export async function newPage(browser, problems, { allowRejections = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ar',
  });
  const page = await context.newPage();

  page.on('console', (message) => {
    const text = message.text();
    // Journeys that submit wrong passwords on purpose produce 400/401 console
    // noise, and a 409 on PUT /state is the documented merge path — both are the
    // app working, not defects.
    const expected = allowRejections && /status of (400|401|403|409|429)/.test(text);
    if ((message.type() === 'error' && !expected) || /Content Security Policy|Refused to/i.test(text)) {
      problems.push(`console.${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

  return page;
}

/**
 * Clear storage and walk through onboarding, which every journey now has to do
 * before it can reach the app at all.
 *
 * @param {number} goal  index into the goal cards (0 = تنشيف … 4 = قوة)
 */
export async function onboard(
  page,
  base,
  { goal = 0, level = 1, weight = 90, height = 180, age = 30, fresh = true } = {}
) {
  await page.goto(base, { waitUntil: 'networkidle' });
  if (fresh) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
  }
  await page.waitForSelector('.onb', { timeout: 10_000 });

  await page.locator('.gcard').nth(goal).click();
  await page.locator('.lcard').nth(level).click();
  const inputs = page.locator('.onb .inp input');
  await inputs.nth(0).fill(String(weight));
  await inputs.nth(1).fill(String(height));
  await inputs.nth(2).fill(String(age));
  await page.locator('.big-cta').click();
  await page.waitForSelector('.today', { timeout: 10_000 });
}

/** Go to a tab by its view name. */
export async function tab(page, view) {
  await page.click(`#tabbar .tab[data-view="${view}"]`);
  await page.waitForTimeout(350);
}

/* ── reporting ───────────────────────────────────────────── */

/** `step('does a thing', async () => { ... })` — records failures, never throws. */
export function stepper(problems) {
  return async function step(name, fn) {
    try {
      await fn();
      console.log('  ✓', name);
    } catch (error) {
      problems.push(`STEP "${name}": ${error.message}`);
      console.log('  ✗', name, '→', error.message.split('\n')[0]);
    }
  };
}

/** Run one journey on its own: `node test/browser/smoke.mjs`. */
export async function runStandalone(journey) {
  const app = await startApp();
  const browser = await launchBrowser();
  const problems = [];
  try {
    await journey({ base: app.base, browser, problems, step: stepper(problems) });
  } finally {
    await browser.close();
    await app.stop();
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of [...new Set(problems)]) console.log(' -', p);
  } else {
    console.log('\nclean.');
  }
  process.exit(problems.length ? 1 : 0);
}
