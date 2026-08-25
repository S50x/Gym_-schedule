/**
 * The six goals, and the regression that matters most:
 * a document saved before goals existed must look exactly as it did.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const GOAL_NAMES = ['تنشيف', 'بناء عضل', 'شد الجسم', 'لياقة وصحة', 'قوة', 'كارديو فقط'];

export default async function run({ base, browser, problems, step }) {
  console.log('\n== a document from before goals existed ==');

  await step('renders normally and never sees onboarding', async () => {
    const page = await newPage(browser, problems);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const weeks = {};
      const ids = {
        chest_db: [10, 2], sh_press: [8, 2], lat_pull: [35, 2.5],
        cable_row: [35, 2.5], leg_press: [60, 5], row_1arm: [14, 2],
      };
      for (let w = 1; w <= 3; w++) {
        const weights = {}, sets = {}, fb = {};
        for (const [id, [b, s]] of Object.entries(ids)) {
          weights[id] = b + s * (w - 1);
          sets[id] = [true, true, true];
          fb[id] = 'ok';
        }
        weeks[String(w)] = {
          ts: Date.now(), weights, sets, fb, cardio: {}, cmach: {},
          body: { weight: 102 - w * 0.4, muscle: null }, cal: { d: [], p: [] },
        };
      }
      // The old shape exactly: no `profile` key at all.
      localStorage.setItem('hadeed:doc', JSON.stringify({
        schema: 1, meta: { week: 3 }, weeks,
        nutrition: { age: 28, act: 1.55, tdee: 3145, target: 2645, protein: 163, ts: 1 },
      }));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 10_000 });

    if (await page.locator('.onb').count()) {
      throw new Error('an existing user was dragged into onboarding');
    }
    const header = (await page.textContent('.logo small')).trim();
    if (!header.includes('تنشيف')) throw new Error(`expected the fat-loss programme, got "${header}"`);
    if (!(await page.locator('.pcard').count())) throw new Error('progress cards missing');

    await tab(page, 'week');
    const verdict = (await page.textContent('.verdict h4')).trim();
    if (!verdict) throw new Error('no weekly verdict rendered');
    await page.context().close();
  });

  console.log('\n== each goal produces a different programme ==');
  const seen = [];

  for (const [index, name] of GOAL_NAMES.entries()) {
    await step(`${name}: distinct calories, lifting days and cardio`, async () => {
      const page = await newPage(browser, problems);
      await onboard(page, base, { goal: index, weight: 85, height: 178, age: 30 });

      const liftDays = await page.locator('.wrow .wlift:not(.ghost)').count();

      await tab(page, 'nutri');
      const kcal = (await page.textContent('.today.top .n')).trim();

      await tab(page, 'cardio');
      const cardioDays = await page.locator('.crow').count();

      seen.push({ name, kcal, liftDays, cardioDays });
      console.log(`      ${name}: ${kcal} kcal · ${liftDays} lift days · ${cardioDays} cardio days`);
      await page.context().close();
    });
  }

  await step('no two goals are the same programme', () => {
    const shapes = seen.map((s) => `${s.kcal}|${s.liftDays}|${s.cardioDays}`);
    if (new Set(shapes).size !== shapes.length) {
      throw new Error(`goals collapsed together: ${JSON.stringify(seen)}`);
    }
    if (new Set(seen.map((s) => s.kcal)).size !== seen.length) {
      throw new Error('calorie targets are not distinct');
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
