/**
 * The six looks, and the one localStorage key they share with the top gap.
 *
 * None of this is reachable from a unit test: the themes are custom properties
 * resolved by the browser, and the bug they are most likely to grow is two
 * settings writing over each other in storage — which only shows up after a
 * reload, in a real browser, with both settings actually used.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const THEMES = ['sadu', 'najd', 'chalk', 'volt', 'midnight', 'copper'];

/** What the page is actually painting, not what it was told to paint. */
const painted = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const hero = document.querySelector('.today');
    return {
      attr: document.documentElement.dataset.theme,
      accent: root.getPropertyValue('--orange').trim(),
      accentText: root.getPropertyValue('--accent-text').trim(),
      ink: root.getPropertyValue('--ink').trim(),
      hero: hero ? getComputedStyle(hero).backgroundImage : '',
      chrome: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    };
  });

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);
  await onboard(page, base, { goal: 0, weight: 95 });

  const seen = [];

  await step('each theme paints a different screen, not just a different attribute', async () => {
    for (const theme of THEMES) {
      await tab(page, 'account');
      const chip = page.locator('.mchips .mchip').nth(THEMES.indexOf(theme));
      if (!(await chip.count())) throw new Error(`no chip for ${theme} on the account screen`);
      await chip.click();
      await page.waitForTimeout(150);

      await tab(page, 'home');
      const now = await painted(page);
      if (now.attr !== theme) throw new Error(`asked for ${theme}, <html> says ${now.attr}`);
      if (!now.accent || !now.ink) throw new Error(`${theme}: tokens did not resolve`);
      if (!now.hero || now.hero === 'none') throw new Error(`${theme}: today's card has no background`);
      if (now.chrome !== now.ink) {
        throw new Error(`${theme}: theme-color is ${now.chrome}, the page ground is ${now.ink}`);
      }
      seen.push(now);
    }

    // Three attributes pointing at one set of colours would pass every check
    // above and still ship one theme wearing three names.
    for (const key of ['accent', 'ink', 'hero']) {
      const values = new Set(seen.map((s) => s[key]));
      if (values.size !== THEMES.length) {
        throw new Error(`${key} is the same in ${THEMES.length - values.size + 1} themes: ${[...values].join(' · ')}`);
      }
    }
  });

  /**
   * A theme is more than its colours now: Sadu swaps the week strip for the
   * rug, Chalk draws each load, Najd and Midnight draw the session ring. All
   * of those are in the DOM for every theme and shown by CSS, so the failure
   * to guard is a part leaking into a theme it does not belong to — or the
   * week vanishing from one because both of its forms are hidden.
   */
  await step('each theme shows its own parts and exactly one week strip', async () => {
    const shown = (sel) =>
      page.evaluate((s) => {
        const node = document.querySelector(s);
        return !!node && getComputedStyle(node).display !== 'none';
      }, sel);
    for (const theme of THEMES) {
      await tab(page, 'account');
      await page.locator('.mchips .mchip').nth(THEMES.indexOf(theme)).click();
      await tab(page, 'home');
      const rug = await shown('.rugbox');
      const strip = await shown('.glance');
      if (rug === strip) throw new Error(`${theme}: rug ${rug} and strip ${strip} — wanted exactly one`);
      if (rug !== (theme === 'sadu')) throw new Error(`${theme}: the rug is ${rug ? 'showing' : 'hidden'}`);
      const glyph = await shown('.pcard .lg');
      if (glyph !== (theme === 'chalk')) throw new Error(`${theme}: the drawn load is ${glyph ? 'showing' : 'hidden'}`);
    }
  });

  await step('the accent has a lighter shade for text on every theme', async () => {
    // --orange is the fill; ink drawn in it uses --accent-text. If a theme
    // forgets the second one it inherits the previous theme's — which is how a
    // token set silently half-applies.
    for (const s of seen) {
      if (!s.accentText) throw new Error(`${s.attr}: --accent-text is missing`);
    }
  });

  await step('the chosen theme survives a reload', async () => {
    await tab(page, 'account');
    await page.locator('.mchips .mchip').nth(THEMES.indexOf('midnight')).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tabbar', { timeout: 8000 });
    const after = await painted(page);
    if (after.attr !== 'midnight') throw new Error(`after a reload the theme is ${after.attr}`);
  });

  /**
   * The one that matters. Both settings live under `hadeed:display`, and a
   * writer that replaces the object instead of merging into it wipes the other
   * one — invisibly, until the next launch.
   */
  await step('the theme and the top gap do not overwrite each other', async () => {
    await tab(page, 'account');
    const slider = page.locator('input[type=range].gap');
    await slider.evaluate((el) => {
      el.value = String(Number(el.max));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(150);

    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('hadeed:display') || '{}'));

    let store = await saved();
    if (store.theme !== 'midnight') throw new Error(`moving the gap wiped the theme: ${JSON.stringify(store)}`);
    if (!store.topGap) throw new Error(`the gap did not save: ${JSON.stringify(store)}`);
    const gap = store.topGap;

    // …and now the other direction.
    await tab(page, 'account');
    await page.locator('.mchips .mchip').nth(THEMES.indexOf('copper')).click();
    await page.waitForTimeout(150);
    store = await saved();
    if (store.topGap !== gap) throw new Error(`switching theme moved the gap to ${store.topGap}, was ${gap}`);
    if (store.theme !== 'copper') throw new Error(`the theme did not save: ${JSON.stringify(store)}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tabbar', { timeout: 8000 });
    const after = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      gap: getComputedStyle(document.documentElement).getPropertyValue('--top-gap').trim(),
    }));
    if (after.theme !== 'copper' || after.gap !== `${gap}px`) {
      throw new Error(`after a reload: theme ${after.theme}, gap ${after.gap} (wanted copper / ${gap}px)`);
    }
  });

  await step('a nonsense stored theme falls back instead of painting nothing', async () => {
    await page.evaluate(() =>
      localStorage.setItem('hadeed:display', JSON.stringify({ theme: 'neon', topGap: 20 }))
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tabbar', { timeout: 8000 });
    const after = await painted(page);
    if (after.attr !== 'sadu') throw new Error(`fell back to ${after.attr}, wanted sadu`);
    if (!after.accent) throw new Error('the fallback theme resolved no accent');
  });

  await page.close();
}

// Guarded like every other journey. Unguarded, importing this file from the
// runner started a second copy of it that ended the process when it finished —
// so every journey listed after it never ran, and the run still exited 0.
if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
