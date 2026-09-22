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

  /**
   * The top gap is adjustable now (Account → العرض), which adds exactly one new
   * way to break it: dragging it low enough to put content back under the notch
   * — the very thing the padding was raised to fix. The range's own floor is the
   * guarantee, so that floor is what this checks, along with the setting
   * actually surviving a reload rather than only applying in memory.
   */
  await step('the top-gap setting cannot put content back under the notch', async () => {
    await tab(page, 'account');
    const slider = page.locator('input[type=range].gap');
    if (!(await slider.count())) throw new Error('no top-gap slider on the account screen');

    const range = await slider.evaluate((el) => ({
      min: Number(el.min),
      max: Number(el.max),
      value: Number(el.value),
    }));

    const gapAt = () =>
      page.evaluate(() => {
        const wrap = document.querySelector('.wrap');
        const safeTop =
          parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
        return Math.round(wrap.firstElementChild.getBoundingClientRect().top - safeTop);
      });

    // Dragging is live: the gap moves before anything is reloaded.
    await slider.fill(String(range.max));
    await slider.dispatchEvent('input');
    const wide = await gapAt();
    if (wide < range.max) throw new Error(`max gave ${wide}px, expected at least ${range.max}`);

    // The floor still clears the safe area — this is the actual safety property.
    await slider.fill(String(range.min));
    await slider.dispatchEvent('input');
    await slider.dispatchEvent('change');
    const tight = await gapAt();
    if (tight < 12) throw new Error(`the lowest setting leaves only ${tight}px under the notch`);

    // And it was stored, not just applied.
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '59px');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
    });
    await tab(page, 'account');
    const after = await gapAt();
    if (after !== tight) throw new Error(`gap was ${tight}px, came back as ${after}px after reload`);
  });

  /**
   * The check above measures the first element's *box*. That is what let home
   * drift 18px below every other tab: .hd carried its own padding-top, which
   * lives inside the box and so never moved it. The property that actually
   * matters is where the content starts, not where its container does.
   *
   * A filled surface is exempt: a card's edge is its visual start, so its
   * padding is doing a real job. A transparent row has no edge to see, so its
   * text has to line up with everyone else's.
   */
  await step('every tab starts its content at the same height', async () => {
    const measured = {};
    for (const view of ['home', 'cardio', 'nutri', 'week', 'account']) {
      await tab(page, view);
      measured[view] = await page.evaluate(() => {
        const first = document.querySelector('.wrap').firstElementChild;
        const safeTop =
          parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
        const cs = getComputedStyle(first);
        const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        const node = walker.nextNode();
        const range = document.createRange();
        range.selectNodeContents(node);
        return {
          what: first.className || first.tagName.toLowerCase(),
          boxTop: Math.round(first.getBoundingClientRect().top - safeTop),
          inkTop: Math.round(range.getBoundingClientRect().top - safeTop),
          marginTop: Math.round(parseFloat(cs.marginTop)),
          filled:
            cs.backgroundImage !== 'none' ||
            !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor),
        };
      });
    }

    // Nobody adds their own margin on top of what the container already gave.
    for (const [view, m] of Object.entries(measured)) {
      if (m.marginTop !== 0) {
        throw new Error(`${view}: "${m.what}" adds margin-top ${m.marginTop}px over --top-gap`);
      }
    }

    // Every tab that opens with a transparent element must agree on where its
    // text begins — compared against each other, not against a magic number.
    const bare = Object.entries(measured).filter(([, m]) => !m.filled);
    if (bare.length < 2) throw new Error('expected several tabs to start with a bare element');
    const tops = bare.map(([, m]) => m.inkTop);
    const spread = Math.max(...tops) - Math.min(...tops);
    if (spread > 1) {
      const detail = bare.map(([v, m]) => `${v}(${m.what})=${m.inkTop}`).join(', ');
      throw new Error(`content starts at different heights: ${detail}`);
    }
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
