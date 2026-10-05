/**
 * Rest days the trainee picks: the onboarding chips, the week they produce on
 * the home screen, and that the choice survives a reload.
 */

import { newPage, onbNext, noStrayNulls, runStandalone } from './helpers.mjs';

/** The home strip, one entry per weekday: name, whether it lifts, whether it rests. */
const strip = (page) =>
  page.$$eval('.wrow', (rows) =>
    rows.map((row) => ({
      day: row.querySelector('.wl b')?.textContent.trim(),
      lift: !!row.querySelector('.wlift:not(.ghost)'),
      rest: row.classList.contains('dim'),
    }))
  );

export default async function run({ base, browser, problems, step }) {
  await step('fat loss with Saturday and Tuesday off', async () => {
    const page = await newPage(browser, problems);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.onb', { timeout: 10_000 });

    await page.locator('.gcard').nth(0).click();
    await onbNext(page);
    await page.locator('.lcard').nth(1).click();
    await onbNext(page);

    // Friday comes pre-selected (the goal's own rest day); swap it for Sat + Tue.
    const chip = (name) => page.locator('.onb .mchip', { hasText: name }).first();
    await chip('الجمعة').click();
    await chip('السبت').click();
    await chip('الثلاثاء').click();

    const pressed = await page.$$eval('.onb .mchip[aria-pressed="true"]', (c) =>
      c.map((x) => x.textContent.trim())
    );
    for (const name of ['السبت', 'الثلاثاء']) {
      if (!pressed.includes(name)) throw new Error(`${name} not pressed: ${pressed}`);
    }
    if (pressed.includes('الجمعة')) throw new Error('Friday still pressed');

    const preview = await page.$$eval('.wprow', (rows) => rows.map((r) => r.textContent));
    if (!preview[0].includes('راحة')) throw new Error(`preview Saturday: ${preview[0]}`);
    await onbNext(page);

    const inputs = page.locator('.onb .inp input');
    await inputs.nth(0).fill('90');
    await inputs.nth(1).fill('180');
    await inputs.nth(2).fill('30');
    await page.locator('.big-cta').click();
    await page.waitForSelector('.today', { timeout: 10_000 });

    const check = async (when) => {
      const days = await strip(page);
      if (days.length !== 7) throw new Error(`${when}: ${days.length} rows`);
      if (!days[0].rest || days[0].lift) throw new Error(`${when}: Saturday should rest`);
      if (!days[3].rest || days[3].lift) throw new Error(`${when}: Tuesday should rest`);
      const lifts = days.filter((d) => d.lift).length;
      if (lifts !== 3) throw new Error(`${when}: expected 3 lifting days, got ${lifts}`);
      if (days[6].rest) throw new Error(`${when}: Friday is a training day now`);
    };
    await check('after onboarding');
    await noStrayNulls(page, 'home with moved rest days');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.today', { timeout: 10_000 });
    await check('after reload');

    const days = await strip(page);
    console.log(`      ${days.map((d) => `${d.day}:${d.lift ? 'حديد' : d.rest ? 'راحة' : 'كارديو'}`).join(' ')}`);
    await page.context().close();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
