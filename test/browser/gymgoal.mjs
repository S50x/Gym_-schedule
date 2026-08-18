/**
 * Gym mode must serve the programme of the goal the user is actually on.
 *
 * This is here because it once did not: gym.js kept importing the legacy plan,
 * so a strength trainee opened their squat day and got dumbbell presses. Every
 * unit test passed.
 */

import { newPage, onboard, runStandalone } from './helpers.mjs';

const CASES = [
  { goal: 0, label: 'تنشيف', expect: 'ضغط صدر دمبل مستوي', sets: 3 },
  { goal: 1, label: 'بناء عضل', expect: 'بنش بريس بار', sets: 4 },
  { goal: 4, label: 'قوة', expect: 'سكوات بار خلفي', sets: 5 },
];

export default async function run({ base, browser, problems, step }) {
  for (const { goal, label, expect, sets } of CASES) {
    await step(`${label}: opens ${expect} with ${sets} sets`, async () => {
      const page = await newPage(browser, problems);
      await onboard(page, base, { goal, weight: 90 });

      await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
      await page.waitForSelector('#gym.on', { timeout: 5000 });

      // .gname holds the Arabic label plus an English <small>, so textContent
      // would run them together. Read just the first text node.
      const name = await page
        .locator('.gname')
        .evaluate((node) => node.childNodes[0].textContent.trim());
      if (name !== expect) throw new Error(`expected "${expect}", got "${name}"`);

      const dots = await page.locator('.sdot').count();
      if (dots !== sets) throw new Error(`expected ${sets} set buttons, got ${dots}`);

      const sub = (await page.textContent('.gsub')).trim();
      console.log(`      ${label}: ${name} · ${sub}`);
      await page.context().close();
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
