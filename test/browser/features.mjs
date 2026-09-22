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

  /**
   * §7 of HANDOFF records "UI under the Dynamic Island" as a defect that no
   * screenshot ever showed, because env(safe-area-inset-*) resolves to 0 in
   * every desktop browser. It came back — the main scrolling container gave
   * content 6px over the inset while every other full-screen container gave
   * 10–28px, and on a notched phone the first heading crowded the status bar.
   *
   * The CSS reads the insets through --safe-* variables, so setting those
   * reproduces a notched phone faithfully. Nothing else here would.
   */
  await step('content clears the notch and the tab bar on a notched phone', async () => {
    // iPhone 15 Pro Max, portrait.
    await page.setViewportSize({ width: 430, height: 932 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '59px');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
    });

    const MIN_TOP = 12; // enough to read as deliberate space, not a near-miss
    for (const view of ['home', 'cardio', 'nutri', 'week', 'account']) {
      await tab(page, view);
      const m = await page.evaluate(() => {
        const wrap = document.querySelector('.wrap');
        const first = wrap && wrap.firstElementChild;
        const bar = document.querySelector('#tabbar');
        if (!first) return null;
        const safeTop = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--safe-top')
        ) || 0;
        return {
          gapTop: Math.round(first.getBoundingClientRect().top - safeTop),
          wrapPadBottom: Math.round(parseFloat(getComputedStyle(wrap).paddingBottom)),
          barHeight: bar && !bar.hidden ? Math.round(bar.getBoundingClientRect().height) : 0,
        };
      });
      if (!m) throw new Error(`${view}: no .wrap content to measure`);
      if (m.gapTop < MIN_TOP) {
        throw new Error(`${view}: only ${m.gapTop}px below the safe area, want >= ${MIN_TOP}`);
      }
      // The tab bar is fixed, so the scroller has to reserve room for it or the
      // last control sits under the blur and cannot be tapped.
      if (m.barHeight && m.wrapPadBottom < m.barHeight) {
        throw new Error(
          `${view}: bottom padding ${m.wrapPadBottom}px does not clear the ${m.barHeight}px tab bar`
        );
      }
    }
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
