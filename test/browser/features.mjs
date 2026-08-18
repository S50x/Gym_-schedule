/**
 * Day-to-day details that only show up in a real browser: bilingual names, the
 * bottom tab bar replacing the old back buttons, cardio split across machines,
 * and the plank counting itself down.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);
  await onboard(page, base, { goal: 0, weight: 95 });

  await step('no page has a back button — the tab bar navigates', async () => {
    for (const view of ['cardio', 'nutri', 'week', 'account']) {
      await tab(page, view);
      const backs = await page.locator('.back').count();
      if (backs) throw new Error(`${view} still has ${backs} back button(s)`);
    }
    await tab(page, 'home');
    if (await page.locator('.grid').count()) throw new Error('home still shows the old shortcut tiles');
  });

  await step('exercise names carry an English second line', async () => {
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    const en = (await page.textContent('.gname .en')).trim();
    if (!/^[A-Za-z][A-Za-z\s\-()]+$/.test(en)) throw new Error(`bad English name: "${en}"`);
    await page.click('#gx');
    await page.waitForTimeout(400);
  });

  await step('cardio splits minutes across two machines', async () => {
    await tab(page, 'cardio');
    const row = page.locator('.crow').nth(1);
    await row.locator('.mchip').nth(1).click();
    await page.waitForTimeout(250);
    if (await row.locator('.split').count()) throw new Error('a single machine should not show a split');

    await row.locator('.mchip').nth(2).click();
    await page.waitForTimeout(300);
    const minutes = await row.locator('.smin').allTextContents();
    if (minutes.length !== 2) throw new Error(`expected two machines, got ${minutes.length}`);

    const total = (await row.locator('.stotal').textContent()).trim();
    if (!total.includes('✓')) throw new Error(`split does not add up: "${total}"`);

    await row.locator('.sadj button').first().click();
    await page.waitForTimeout(300);
    const after = await row.locator('.smin').allTextContents();
    if (after[0] === minutes[0]) throw new Error('minute stepper did nothing');
  });

  await step('the plank counts itself down', async () => {
    await tab(page, 'home');
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });

    for (let i = 0; i < 8; i++) {
      const name = await page
        .locator('.gname')
        .evaluate((node) => node.childNodes[0].textContent.trim());
      if (name.includes('بلانك')) break;
      await page.locator('.arrows button').nth(1).click();
      await page.waitForTimeout(250);
    }
    if (!(await page.locator('.hold').count())) throw new Error('the plank has no timer control');

    await page.locator('.hold').click();
    await page.waitForTimeout(1600);
    if (!(await page.locator('.hold.run').count())) throw new Error('the countdown did not start');

    const shown = (await page.textContent('.htime')).trim();
    if (!/^\d+:\d\d$/.test(shown)) throw new Error(`bad countdown display: "${shown}"`);
    console.log(`      counting: ${shown}`);
    await page.click('#gx');
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
