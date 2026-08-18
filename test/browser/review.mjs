/**
 * The calorie target must follow the body, and the goal must be revisited.
 *
 * A target computed once at sign-up is wrong the moment the body changes — and
 * it drifts further the better the programme works.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const kcal = async (page) => Number((await page.textContent('.today.top .n')).replace(/[^\d]/g, ''));

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);
  let heavy = 0;

  await step('shows a target for a 100 kg trainee', async () => {
    await onboard(page, base, { goal: 0, weight: 100, height: 180, age: 30 });
    await tab(page, 'nutri');
    heavy = await kcal(page);
    if (!heavy) throw new Error('no calorie target rendered');
    console.log(`      at 100 kg → ${heavy} kcal`);
  });

  await step('the target drops after losing 9 kg', async () => {
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('hadeed:doc'));
      d.weeks['1'].body = { weight: 100, muscle: null };
      d.weeks['2'] = {
        ts: Date.now(), weights: {}, sets: {}, fb: {}, cardio: {}, cmach: {},
        body: { weight: 91, muscle: null }, cal: { d: [], p: [] },
      };
      d.meta.week = 2;
      localStorage.setItem('hadeed:doc', JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 8000 });

    await tab(page, 'nutri');
    const lighter = await kcal(page);
    console.log(`      at  91 kg → ${lighter} kcal`);
    if (lighter >= heavy) throw new Error(`target did not follow the weight (${heavy} → ${lighter})`);
    if (heavy - lighter < 100) throw new Error(`target barely moved: ${heavy - lighter} kcal`);
  });

  await step('a 9% change prompts a goal review, in the right direction', async () => {
    await tab(page, 'home');
    if (!(await page.locator('.review').count())) throw new Error('no review card appeared');
    const title = (await page.textContent('.review h4')).trim();
    if (!title.includes('نزلت')) throw new Error(`expected a "lost weight" prompt, got "${title}"`);
    console.log(`      "${title}"`);
  });

  await step('"keep my goal" dismisses it and re-anchors the baseline', async () => {
    await page.locator('.rbtns .cta.ghost').click();
    await page.waitForTimeout(700);
    if (await page.locator('.review').count()) throw new Error('the card came back after keeping the goal');
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
