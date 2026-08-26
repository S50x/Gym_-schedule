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

  await step('the cue carries a photographed pair of the movement', async () => {
    if (await page.locator('.fphoto, .fig').count()) throw new Error('a closed cue is drawing');
    await page.locator('.glink').last().click();
    await page.waitForSelector('.fphoto', { timeout: 5000 });

    const frames = page.locator('.fphoto img');
    if ((await frames.count()) !== 2) throw new Error('a rep has a start and an end');
    // Both must actually decode: a 404 pulls the box and leaves the cue bare.
    const loaded = await frames.evaluateAll((imgs) =>
      imgs.every((i) => i.complete && i.naturalWidth > 0)
    );
    if (!loaded) throw new Error('a frame failed to load');
    if (!(await frames.first().getAttribute('alt'))) throw new Error('the pair is unlabelled');

    const box = await page.locator('.fphoto').boundingBox();
    if (!box || box.width < 120 || box.height < 60) throw new Error(`collapsed: ${JSON.stringify(box)}`);

    await page.locator('.glink').last().click();
    await page.waitForTimeout(200);
    if (await page.locator('.fphoto').count()) throw new Error('the pair outlived the open cue');
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

  await step('a movement with no photograph falls back to the drawing', async () => {
    // bird dog is the one movement in this programme the photo set has no
    // entry for, so it is the case that proves the fallback is wired up.
    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[2]?.click());
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    for (let i = 0; i < 8; i++) {
      const name = await page.locator('.gname').evaluate((n) => n.childNodes[0].textContent.trim());
      if (name.includes('بيرد')) break;
      await page.locator('.arrows button').nth(1).click();
    }
    await page.locator('.glink').last().click();
    await page.waitForSelector('.fig', { timeout: 5000 });
    if (await page.locator('.fphoto').count()) throw new Error('bird dog claims a photograph');
    if (!(await page.locator('.fig .fmuscle').count())) throw new Error('the drawing lost its muscle mark');
    await page.locator('#gx').click();
    await page.waitForSelector('#gym.on', { state: 'hidden', timeout: 5000 });
  });

  await step('finishing one day does not tick the same movement on another', async () => {
    // The reported bug: this goal stretches the hamstrings on five days, and a
    // set log keyed by exercise alone meant Tuesday's work marked Sunday and
    // Thursday done as well.
    const counts = () =>
      page.locator('.wrow .wlift:not(.ghost) .n').allTextContents().then((t) => t.map((x) => x.trim()));
    const before = await counts();
    if (before.some((c) => !c.startsWith('0/'))) throw new Error(`not a clean week: ${before}`);

    await page.evaluate(() => document.querySelectorAll('.wlift:not(.ghost)')[3]?.click()); // الثلاثاء
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    const day = (await page.textContent('#gcount')).trim();
    if (!day.includes('الثلاثاء')) throw new Error(`opened "${day}", expected Tuesday`);

    const dots = page.locator('.sdot');
    const n = await dots.count();
    for (let i = 0; i < n; i++) await dots.nth(i).click();

    // The write must be day-scoped, with nothing left on the old flat shape.
    const keys = await page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem('hadeed:doc'));
      return Object.keys(doc.weeks['1'].sets);
    });
    if (!keys.every((k) => k.startsWith('tue:'))) throw new Error(`stray keys: ${keys.join(', ')}`);

    await page.locator('#gx').click();
    await page.waitForSelector('#gym.on', { state: 'hidden', timeout: 5000 });

    const after = await counts();
    const [sat, sun, mon, tue, wed, thu] = after;
    if (tue !== '1/5') throw new Error(`Tuesday should read 1/5, reads ${tue}`);
    for (const [name, value] of [['الأحد', sun], ['الخميس', thu]]) {
      if (value !== '0/5') throw new Error(`${name} was marked by Tuesday's work: ${value}`);
    }
    for (const [name, value] of [['السبت', sat], ['الاثنين', mon], ['الأربعاء', wed]]) {
      if (value !== '0/7') throw new Error(`${name} was marked by Tuesday's work: ${value}`);
    }
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
