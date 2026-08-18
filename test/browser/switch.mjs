/**
 * Switching goal must never cost the user anything they logged.
 * Weights and sets are keyed by exercise id, so the old goal's numbers survive
 * and come back if they switch back.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const doc = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hadeed:doc')));

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);
  let before = null;

  await step('logs a workout on the fat-loss programme', async () => {
    await onboard(page, base, { goal: 0, weight: 90 });
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    for (let i = 0; i < 3; i++) {
      await page.locator('.sdot').nth(i).click();
      await page.waitForTimeout(120);
    }
    await page.click('#gx');
    await page.waitForTimeout(500);

    before = await doc(page);
    if (!Object.keys(before.weeks['1'].sets).length) throw new Error('nothing was logged');
  });

  await step('switches to strength and keeps the old sets', async () => {
    await tab(page, 'account');
    await page.locator('.cta.ghost').first().click();
    await page.waitForSelector('.onb', { timeout: 5000 });
    await page.locator('.gcard').nth(4).click();
    await page.locator('.big-cta').click();
    await page.waitForSelector('.today', { timeout: 8000 });

    const header = (await page.textContent('.logo small')).trim();
    if (!header.includes('قوة')) throw new Error(`goal did not switch: "${header}"`);

    const after = await doc(page);
    if (JSON.stringify(after.weeks['1'].sets) !== JSON.stringify(before.weeks['1'].sets)) {
      throw new Error('logged sets were lost on the switch');
    }
    if (after.profile?.goal !== 'strength') throw new Error('profile did not record the goal');
  });

  await step('switching back restores the original programme intact', async () => {
    await tab(page, 'account');
    await page.locator('.cta.ghost').first().click();
    await page.waitForSelector('.onb', { timeout: 5000 });
    await page.locator('.gcard').nth(0).click();
    await page.locator('.big-cta').click();
    await page.waitForSelector('.today', { timeout: 8000 });

    const back = await doc(page);
    if (JSON.stringify(back.weeks['1'].sets) !== JSON.stringify(before.weeks['1'].sets)) {
      throw new Error('sets did not survive the round trip');
    }
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
