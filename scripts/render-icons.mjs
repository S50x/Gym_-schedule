/**
 * Renders the PNG icons from public/img/icon-v2.svg (see ICON below).
 *
 *   npm run icons
 *
 * The SVG is the source of truth, but it is not what a phone puts on its home
 * screen: iOS uses the 180px apple-touch-icon and Android reads the manifest's
 * PNGs. Change the SVG without running this and the icon looks unchanged on
 * every device that matters.
 *
 * There is no image library in this project and none is added for four files.
 * Chromium is already here for the browser journeys, and rasterising an SVG is
 * the one thing a browser is guaranteed to do exactly like the browsers that
 * will display it.
 *
 * CHANGING THE ICON MEANS A NEW FILE NAME. Everything under /img is served
 * `immutable` for a year (server/app.js), so a phone that has fetched
 * icon-v2-180.png once will never ask for it again. Redraw the artwork under
 * the same name and every device that ever saw the old one keeps it — even
 * after the home-screen icon is deleted and re-added, because that does not
 * clear Safari's cache. That exact thing happened with the first glass icon.
 * So: bump ICON below, run this, then update the names in index.html,
 * manifest.webmanifest and sw.js. test/shell.test.js fails if one is missed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const IMG = fileURLToPath(new URL('../public/img/', import.meta.url));
const ICON = 'icon-v2';
const SOURCE = path.join(IMG, `${ICON}.svg`);

/**
 * `any` keeps the rounded plate; `maskable` fills the square edge to edge and
 * pulls the barbell into the middle 80%, because Android crops a maskable icon
 * to whatever shape the launcher uses and anything in the corners is lost.
 */
const OUTPUTS = [
  { file: `${ICON}-180.png`, size: 180, purpose: 'any' },
  { file: `${ICON}-192.png`, size: 192, purpose: 'any' },
  { file: `${ICON}-512.png`, size: 512, purpose: 'any' },
  { file: `${ICON}-maskable.png`, size: 512, purpose: 'maskable' },
];

/** Mirrors resolveChrome() in test/browser/helpers.mjs. */
function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    if (!name.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome']) {
      const candidate = path.join(root, name, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`No Chromium under ${root}. Set CHROME_PATH.`);
}

/**
 * The maskable variant, built from the same file rather than kept as a second
 * copy that would drift: square corners, and the artwork scaled about centre.
 *
 * It also drops the corner glow and the sheen. Not to save work — the launcher
 * crops exactly the band they live in, so on a maskable icon they are a smooth
 * gradient nobody ever sees, and a smooth gradient is most of what a PNG this
 * size costs. Without them the file is about a seventh of the weight.
 */
function maskable(svg) {
  const SAFE = 0.8;
  const offset = (512 * (1 - SAFE)) / 2;
  return svg
    .replaceAll('rx="112"', 'rx="0"')
    .replace(/\s*<rect width="512" height="512" rx="0" fill="url\(#lime\)"\/>/, '')
    .replace(/\s*<path d="M0 112[\s\S]*?fill="url\(#sheen\)"\/>/, '')
    .replace(
      /(<g fill="url\(#bar\)">[\s\S]*?<\/g>\s*<circle[^>]*\/>)/,
      `<g transform="translate(${offset} ${offset}) scale(${SAFE})">$1</g>`
    );
}

const svg = fs.readFileSync(SOURCE, 'utf8');
const browser = await chromium.launch({ executablePath: resolveChrome(), args: ['--no-sandbox'] });

try {
  for (const { file, size, purpose } of OUTPUTS) {
    const markup = purpose === 'maskable' ? maskable(svg) : svg;
    if (purpose === 'maskable' && markup === svg) {
      throw new Error(`the maskable transform matched nothing — has ${ICON}.svg changed shape?`);
    }
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    // A transparent page, so `any` keeps its rounded corners instead of
    // inheriting a white square behind them.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">` +
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>` +
        markup
    );
    const png = await page.screenshot({ omitBackground: true });
    fs.writeFileSync(path.join(IMG, file), png);
    await page.close();
    console.log(`${file.padEnd(20)} ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`);
  }
} finally {
  await browser.close();
}
