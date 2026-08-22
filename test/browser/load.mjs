/**
 * A load off the weekly-jump lattice.
 *
 * `step` is how much a lift climbs in a week, and the +/− buttons used to move
 * by that same number, so every load the app could reach was `base ± n · step`:
 * from 6 kg with a 2 kg step you got 6 · 8 · 10 and never the 7.5 dumbbell on
 * the rack. The buttons now move by `fine` — what the equipment can actually
 * do — and the reading can still be typed for a jump neither one is worth.
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

  await step('the button moves by the rack, not by the weekly jump', async () => {
    // chest_db climbs 2 kg a week, but a dumbbell rack goes in halves.
    await page.locator('.adj button').first().click(); // +
    const value = (await shown(page)).trim();
    if (value !== '8') throw new Error(`expected 8 after one tap on a dumbbell, got "${value}"`);
    await page.locator('.adj button').nth(1).click(); // − back to where we were
    if ((await shown(page)).trim() !== '7.5') throw new Error('a tap back must undo a tap');
  });



  await step('and it survives a reload', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 10_000 });
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    const value = (await shown(page)).trim();
    if (value !== '7.5') throw new Error(`expected the typed 7.5 after a reload, got "${value}"`);
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

  await step('a barbell moves by the smallest pair of plates', async () => {
    // The squat climbs 5 kg a week, but you cannot load a bar with less than a
    // 1.25 pair, so the button has to stop at half the weekly jump.
    const bar = await newPage(browser, problems);
    await onboard(bar, base, { goal: 4, weight: 90 }); // قوة — opens on the squat
    await bar.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await bar.waitForSelector('#gym.on', { timeout: 5000 });
    const name = await bar.locator('.gname').evaluate((n) => n.childNodes[0].textContent.trim());
    if (name !== 'سكوات بار خلفي') throw new Error(`expected the squat, got "${name}"`);

    const before = Number.parseFloat((await shown(bar)).trim());
    await bar.locator('.adj button').first().click();
    const after = Number.parseFloat((await shown(bar)).trim());
    if (after - before !== 2.5) throw new Error(`the bar moved by ${after - before}, expected 2.5`);
    await bar.context().close();
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
