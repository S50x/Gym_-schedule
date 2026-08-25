/**
 * The goal with no iron in it.
 *
 * Six days of cardio, bodyweight blocks and stretches, and nothing that loads a
 * bar. Everything here is a place the app used to assume a barbell: the week
 * strip called every training day "حديد", the progress rail promised weights
 * that will never exist, and the finish screen printed a volume of 0 kg. The
 * machine chips also flag a pair that fights itself — a warning, never a block.
 */

import { newPage, onboard, tab, noStrayNulls, runStandalone } from './helpers.mjs';

const CARDIO_GOAL = 5; // the sixth card in onboarding

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);

  await step('the sixth goal can be chosen and names itself', async () => {
    await onboard(page, base, { goal: CARDIO_GOAL, weight: 100, height: 183, age: 30 });
    const header = (await page.textContent('.logo small')).trim();
    if (!header.includes('كارديو فقط')) throw new Error(`header says "${header}"`);
  });

  await step('the week never says "حديد"', async () => {
    const strip = await page.locator('.wrow .wl').allTextContents();
    const iron = strip.filter((row) => row.includes('حديد'));
    if (iron.length) throw new Error(`week strip still talks about iron: ${iron.join(' | ')}`);
    if (!strip.some((row) => row.includes('تمارين جسم'))) {
      throw new Error('no bodyweight day on the strip');
    }
    // The cardio minutes are the day here, so they belong on the line.
    if (!strip.some((row) => row.includes('دقيقة'))) {
      throw new Error('the strip never mentions the cardio minutes');
    }
    await noStrayNulls(page, 'cardio-only · home');
  });

  await step('the progress rail promises nothing it cannot keep', async () => {
    const rail = (await page.textContent('.pgrid, .card')).trim();
    if (rail.includes('أول أسبوع')) {
      throw new Error('a goal with no loads still promises weights next week');
    }
  });

  await step('a bodyweight day opens with its rounds and reps on screen', async () => {
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[0]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });

    const name = await page.locator('.gname').evaluate((n) => n.childNodes[0].textContent.trim());
    const sub = (await page.textContent('.gsub')).trim();
    if (!/\d+\s*مجموعات/.test(sub)) throw new Error(`no rounds shown for ${name}: "${sub}"`);

    // Every movement in the day states rounds and reps, and offers a clip.
    const count = await page.locator('.arrows button').count();
    for (let i = 0; i < 12; i++) {
      const line = (await page.textContent('.gsub')).trim();
      const label = await page.locator('.gname').evaluate((n) => n.childNodes[0].textContent.trim());
      if (!/\d+\s*مجموعات\s*×/.test(line)) throw new Error(`${label}: "${line}"`);
      if (!(await page.locator('.glink[href]').count())) throw new Error(`${label} has no clip`);
      const next = page.locator('.arrows button').nth(1);
      if (await next.isDisabled()) break;
      await next.click();
    }
    if (!count) throw new Error('no navigation arrows');
    await noStrayNulls(page, 'cardio-only · gym');
  });

  await step('a timed stretch counts itself down', async () => {
    // Walk to a stretch: it is timed, so it gets the hold control.
    for (let i = 0; i < 12; i++) {
      if (await page.locator('.hold').count()) break;
      const next = page.locator('.arrows button').nth(1);
      if (await next.isDisabled()) throw new Error('no timed movement in the day');
      await next.click();
    }
    if (!(await page.locator('.hold').count())) throw new Error('the stretch has no countdown');
    const seconds = (await page.textContent('.wnum')).trim();
    if (seconds !== '30') throw new Error(`stretch starts at "${seconds}", expected 30`);
    await page.locator('#gx').click();
    await page.waitForSelector('#gym.on', { state: 'hidden', timeout: 5000 });
  });

  await step('pairing two machines that fight is warned about, not blocked', async () => {
    await tab(page, 'cardio');
    const chips = page.locator('.crow').first().locator('.mchip');
    const byName = async (n) => chips.filter({ hasText: n }).first();

    await (await byName('غزالة')).click();
    if (await page.locator('.crow').first().locator('.mwarn').count()) {
      throw new Error('one machine on its own must not warn');
    }

    const stair = await byName('درج');
    if (await stair.isDisabled()) throw new Error('the clashing chip was disabled — it must stay live');
    await stair.click();

    const warn = page.locator('.crow').first().locator('.mwarn');
    if (!(await warn.count())) throw new Error('غزالة + درج produced no warning');
    const text = (await warn.first().textContent()).trim();
    if (!text.includes('غزالة') || !text.includes('درج')) throw new Error(`warning is vague: "${text}"`);
    if (!(await page.locator('.crow').first().locator('.mchip.warn').count())) {
      throw new Error('the flagged chips are not marked');
    }
    // Still selected — a warning does not undo the choice.
    if ((await stair.getAttribute('aria-pressed')) !== 'true') {
      throw new Error('the warning removed the machine instead of flagging it');
    }
    await noStrayNulls(page, 'cardio-only · cardio page');
  });

  await step('dropping one of the pair clears the warning', async () => {
    const chips = page.locator('.crow').first().locator('.mchip');
    await chips.filter({ hasText: 'درج' }).first().click();
    if (await page.locator('.crow').first().locator('.mwarn').count()) {
      throw new Error('the warning outlived the clash');
    }
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
