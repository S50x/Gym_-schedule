/**
 * Runs every browser journey against a server this script starts itself.
 *
 *   npm run browser              all journeys
 *   npm run browser -- goals     just the ones whose name matches
 *
 * Exits non-zero if anything failed, so it is safe to trust in a pipeline.
 */

import { startApp, launchBrowser, stepper } from './helpers.mjs';

const JOURNEYS = [
  ['goals', 'goals.mjs', 'the five goals + the pre-goals regression'],
  ['features', 'features.mjs', 'bilingual names, tab bar, cardio split, plank timer'],
  ['gymgoal', 'gymgoal.mjs', 'gym mode serves the right goal'],
  ['cardioonly', 'cardioonly.mjs', 'the goal with no iron in it'],
  ['load', 'load.mjs', 'exact loads off the step lattice'],
  ['switch', 'switch.mjs', 'switching goal loses nothing'],
  ['review', 'review.mjs', 'live calorie target + goal review'],
  ['smoke', 'smoke.mjs', 'full app, sync between browsers, XSS probes'],
  ['mfa', 'mfa.mjs', 'two-factor end to end'],
  ['reset', 'reset.mjs', 'forgot-password form + the reset screen'],
  ['groups', 'groups.mjs', 'per-muscle-group strength levels'],
];

const filter = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const selected = filter.length
  ? JOURNEYS.filter(([name]) => filter.some((f) => name.includes(f)))
  : JOURNEYS;

if (!selected.length) {
  console.error(`No journey matches ${filter.join(', ')}. Known: ${JOURNEYS.map((j) => j[0]).join(', ')}`);
  process.exit(2);
}

const app = await startApp();
console.log(`app running at ${app.base}`);
const browser = await launchBrowser();

const results = [];
for (const [name, file, description] of selected) {
  console.log(`\n──────── ${name} — ${description}`);
  const problems = [];
  const started = Date.now();
  try {
    const { default: journey } = await import(`./${file}`);
    await journey({ base: app.base, browser, problems, step: stepper(problems) });
  } catch (error) {
    problems.push(`CRASHED: ${error.message}`);
    console.log('  ✗ journey crashed →', error.message.split('\n')[0]);
  }
  results.push({ name, problems, ms: Date.now() - started });
}

await browser.close();
await app.stop();

console.log('\n════════ summary');
let failed = 0;
for (const { name, problems, ms } of results) {
  const unique = [...new Set(problems)];
  if (unique.length) {
    failed++;
    console.log(`  ✗ ${name} (${(ms / 1000).toFixed(1)}s) — ${unique.length} problem(s)`);
    for (const p of unique) console.log(`      · ${p}`);
  } else {
    console.log(`  ✓ ${name} (${(ms / 1000).toFixed(1)}s)`);
  }
}

console.log(
  failed
    ? `\n${failed} of ${results.length} journeys failed.`
    : `\nAll ${results.length} journeys clean — no console errors, no CSP violations.`
);
process.exit(failed ? 1 : 0);
