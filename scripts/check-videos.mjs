/**
 * فحص روابط يوتيوب في البرنامج.
 * Checks every YouTube link in public/js/program.js against YouTube's oEmbed
 * endpoint, which answers without an API key:
 *   200        → the video exists and can be embedded
 *   401        → the video exists but its owner turned embedding off (still fine
 *                for us: the app opens it on YouTube, it never embeds it)
 *   403        → private: nobody but the owner can watch it, so it is dead to us
 *   400 / 404  → removed or a broken id
 *
 * Usage: node scripts/check-videos.mjs     (exits 1 if any link is dead)
 *
 * Runs in CI (.github/workflows/videos.yml), not in the test suite: the tests
 * stay offline, and a video disappearing is not a reason to block every merge.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXERCISES } from '../public/js/program.js';

const SOURCE = fileURLToPath(new URL('../public/js/program.js', import.meta.url));
const YOUTUBE = /https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{6,}/g;

/** Every YouTube URL in the file, with the exercises that use it. */
function collect() {
  const urls = new Map();
  for (const url of fs.readFileSync(SOURCE, 'utf8').match(YOUTUBE) || []) urls.set(url, []);
  for (const [id, e] of Object.entries(EXERCISES)) {
    if (e.v && urls.has(e.v)) urls.get(e.v).push(id);
  }
  return urls;
}

async function check(url, attempts = 3) {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const { title } = await res.json();
        return { state: 'ok', title };
      }
      if (res.status === 401) return { state: 'no-embed' };
      if (res.status === 403) return { state: 'dead', detail: 'private' };
      if (res.status === 400 || res.status === 404) return { state: 'dead', detail: `HTTP ${res.status}` };
      // 429 / 5xx: YouTube's problem, not the link's — retry, then report.
      if (i >= attempts) return { state: 'unknown', detail: `HTTP ${res.status}` };
    } catch (err) {
      if (i >= attempts) return { state: 'unknown', detail: err.message };
    }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}

const urls = collect();
let dead = 0;
let unknown = 0;
for (const [url, ids] of urls) {
  const r = await check(url);
  const who = ids.length ? ids.join(', ') : '(not on an exercise)';
  const mark = { ok: '✓', 'no-embed': '~', dead: '✗', unknown: '?' }[r.state];
  console.log(`${mark} ${url}  ${who}${r.title ? `  — ${r.title}` : ''}${r.detail ? `  (${r.detail})` : ''}`);
  if (r.state === 'dead') dead++;
  if (r.state === 'unknown') unknown++;
}

console.log(`\n${urls.size} links · ${dead} dead · ${unknown} could not be checked`);
if (dead) process.exit(1);
