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

  await step('the cue carries a looping figure, built only while it is open', async () => {
    if (await page.locator('.fig').count()) throw new Error('a closed cue is drawing a figure');
    await page.locator('.glink').last().click();
    await page.waitForSelector('.fig', { timeout: 4000 });

    // Five limbs at their own weights plus a neck, the far-side pair behind
    // them, the worked muscle over them, and a head. No <img>, no fetch: it
    // costs the page nothing to carry.
    const near = await page.locator('.fig .flimb').count();
    if (near !== 6) throw new Error(`expected 5 limbs and a neck, found ${near}`);
    const far = await page.locator('.fig .ffar').count();
    if (far !== 4) throw new Error(`expected a far arm and leg, found ${far}`);
    if (!(await page.locator('.fig .fmuscle').count())) throw new Error('no muscle marked');
    if (!(await page.locator('.fig .fhead').count())) throw new Error('no head');

    const widths = await page.locator('.fig .flimb').evaluateAll((ns) =>
      ns.map((n) => Number(n.getAttribute('stroke-width')))
    );
    if (new Set(widths).size < 3) throw new Error(`limbs all one weight: ${widths}`);

    // Every drawn part has to move, or it detaches from the body mid-rep.
    const lines = await page.locator('.fig .flimb, .fig .ffar, .fig .fmuscle').count();
    const animations = await page.locator('.fig animate').count();
    if (animations !== lines * 4 + 2) {
      throw new Error(`${lines} lines and a head need ${lines * 4 + 2} animations, found ${animations}`);
    }

    const box = await page.locator('.fig').boundingBox();
    if (!box || box.width < 120 || box.height < 60) throw new Error(`figure collapsed: ${JSON.stringify(box)}`);

    // A hidden <animate> keeps running, and gym mode redraws on every ticked
    // set, so closing the cue has to take the figure with it.
    await page.locator('.glink').last().click();
    await page.waitForTimeout(200);
    if (await page.locator('.fig').count()) throw new Error('the figure outlived the open cue');
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
