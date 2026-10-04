/**
 * Meals: today's panel opens by itself, a meal adds up into the day's totals,
 * an over-target day says so, and deleting the last meal leaves the day
 * "not logged" again rather than zero.
 */

import { newPage, onboard, tab, noStrayNulls, runStandalone } from './helpers.mjs';

export default async function run({ base, browser, problems, step }) {
  await step('log, total, warn, delete', async () => {
    const page = await newPage(browser, problems);
    await onboard(page, base, { goal: 0, weight: 90 });
    await tab(page, 'nutri');

    // The current week opens today's day by itself.
    await page.waitForSelector('.mpanel', { timeout: 5000 });
    if ((await page.locator('.mpanel').count()) !== 1) throw new Error('expected one open day');
    if ((await page.locator('.meal').count()) !== 0) throw new Error('a new day has meals');
    // An empty day with no alerts once printed the word "null" under the bars.
    await noStrayNulls(page, 'empty meal panel');

    const add = async (name, k, p, f, c) => {
      const form = page.locator('.madd');
      await form.locator('.mn').fill(name);
      const nums = form.locator('.mgrid .mi');
      await nums.nth(0).fill(String(k));
      await nums.nth(1).fill(String(p));
      await nums.nth(2).fill(String(f));
      await nums.nth(3).fill(String(c));
      await form.locator('.cta').click();
    };

    await add('شوفان بالحليب', 450, 20, 12, 65);
    await add('صدر دجاج ورز', 800, 60, 20, 90);
    if ((await page.locator('.meal').count()) !== 2) throw new Error('two meals not listed');

    // The day's boxes now show the sum and are locked to it.
    const row = page.locator('.nday:has(.mpanel) .nrow');
    const kcal = await row.locator('.ni').nth(0).inputValue();
    const disabled = await row.locator('.ni').nth(0).isDisabled();
    if (kcal !== '1250' || !disabled) throw new Error(`row total ${kcal}, disabled ${disabled}`);

    // Way over: the alert is on screen the same day.
    await add('بوفيه', 3000, 40, 150, 300);
    const alerts = await page.locator('.malert.over').allTextContents();
    if (!alerts.some((a) => a.includes('السعرات'))) throw new Error(`no kcal alert: ${alerts}`);

    await noStrayNulls(page, 'meal panel');

    // Remove everything: the day is empty again, editable, and not "0".
    while ((await page.locator('.mdel').count()) > 0) await page.locator('.mdel').first().click();
    const after = await row.locator('.ni').nth(0).inputValue();
    if (after !== '' || (await row.locator('.ni').nth(0).isDisabled())) {
      throw new Error(`after delete: value "${after}"`);
    }

    // And it survives a reload.
    await add('تمر', 100, 1, 0, 27);
    await page.reload({ waitUntil: 'networkidle' });
    await tab(page, 'nutri');
    await page.waitForSelector('.meal', { timeout: 5000 });
    const names = await page.locator('.meal .mname b').allTextContents();
    if (names.join() !== 'تمر') throw new Error(`after reload: ${names}`);
    await page.context().close();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
