/**
 * A load off the step lattice.
 *
 * `step` is the weekly jump, and the +/− buttons moved by that same number, so
 * every weight the app could reach was `base ± n · step`: from 6 kg with a 2 kg
 * step you got 6 · 8 · 10 and never the 7.5 dumbbell on the rack. Typing one in
 * must stick, survive a reload, and carry the ordinary step from there.
 */

import { newPage, onboard, noStrayNulls, runStandalone } from './helpers.mjs';

const shown = (page) => page.locator('.wnum').first().textContent();

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);

  await step('a half-kilo load can be typed into gym mode', async () => {
    await onboard(page, base, { goal: 0, weight: 90 });
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });

    await page.locator('button.wnum').click();
    await page.waitForSelector('input.wedit', { timeout: 5000 });
    await page.locator('input.wedit').fill('7.5');
    await page.keyboard.press('Enter');

    await page.waitForSelector('button.wnum', { timeout: 5000 });
    const value = (await shown(page)).trim();
    if (value !== '7.5') throw new Error(`expected 7.5 on screen, got "${value}"`);
    await noStrayNulls(page, 'gym mode · exact load');
  });

  await step('the step carries on from there', async () => {
    // chest_db moves in 2 kg, so the half-kilo rides along: 7.5 → 9.5.
    await page.locator('.adj button').first().click();
    const value = (await shown(page)).trim();
    if (value !== '9.5') throw new Error(`expected 9.5 after one step, got "${value}"`);
  });

  await step('and it survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 10_000 });
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    const value = (await shown(page)).trim();
    if (value !== '9.5') throw new Error(`expected 9.5 after a reload, got "${value}"`);
  });

  await step('a load set with the buttons survives a reload too', async () => {
    // The derived weight cache was filled by the paint that happens before the
    // stored document is read, and installing that document did not drop it, so
    // every hand-set load read back as the programme's starting number.
    await page.locator('.adj button').nth(1).click(); // −
    const stepped = (await shown(page)).trim();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 10_000 });
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    const value = (await shown(page)).trim();
    if (value !== stepped) throw new Error(`set ${stepped}, reopened at ${value}`);
  });

  await step('a load outside the allowed range is refused', async () => {
    const kept = (await shown(page)).trim();
    await page.locator('button.wnum').click();
    await page.waitForSelector('input.wedit', { timeout: 5000 });
    await page.locator('input.wedit').fill('4000');
    await page.keyboard.press('Enter');
    await page.waitForSelector('button.wnum', { timeout: 5000 });
    const value = (await shown(page)).trim();
    if (value !== kept) throw new Error(`expected ${kept} to stand, got "${value}"`);
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
