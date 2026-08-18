/**
 * The full app journey: gym mode, the weekly measurement, an account, sync
 * between two browsers, and stored-XSS probes.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const PASSWORD = 'a-really-good-passphrase';

export default async function run({ base, browser, problems, step }) {
  const email = `e2e-${Date.now()}@example.com`;
  const page = await newPage(browser, problems, { allowRejections: true });

  console.log('\n== boot ==');
  await step('onboarding leads into a rendered home screen', async () => {
    await onboard(page, base, { goal: 0, weight: 102, height: 183, age: 28 });
    const logo = await page.textContent('.logo');
    if (!logo.includes('حديد')) throw new Error('logo missing');
  });

  await step('fonts load from our own origin', async () => {
    const ok = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('900 16px Cairo');
    });
    if (!ok) throw new Error('Cairo 900 did not load');
  });

  await step('the week strip shows all seven days', async () => {
    const rows = await page.locator('.wrow').count();
    if (rows !== 7) throw new Error(`expected 7 rows, got ${rows}`);
  });

  console.log('\n== gym mode ==');
  await step('opens from the week strip', async () => {
    await page.locator('.wrow .wlift:not(.ghost)').first().click();
    await page.waitForSelector('#gym.on', { timeout: 5000 });
    if (!(await page.textContent('.gname')).trim()) throw new Error('exercise name empty');
  });

  await step('the weight stepper changes the load', async () => {
    const before = await page.textContent('.wnum');
    await page.locator('.adj button', { hasText: '+' }).click();
    const after = await page.textContent('.wnum');
    if (before === after) throw new Error(`weight did not change: ${before}`);
  });

  await step('completing a set marks it and starts the rest timer', async () => {
    await page.locator('.gfoot .big').first().click();
    await page.waitForSelector('#rest.on', { timeout: 5000 });
    await page.click('#rskip');
    if (!(await page.locator('.sdot.done').count())) throw new Error('no set marked done');
  });

  await step('the double-tap guard blocks a second immediate press', async () => {
    const button = page.locator('.gfoot .big').first();
    await button.click();
    await page.click('#rskip').catch(() => {});
    const before = await page.locator('.sdot.done').count();
    await button.click({ force: true });
    await button.click({ force: true });
    await page.click('#rskip').catch(() => {});
    const after = await page.locator('.sdot.done').count();
    if (after > before + 1) throw new Error(`guard failed: ${before} → ${after}`);
  });

  await step('the cue renders as elements, never as markup', async () => {
    await page.locator('.glink', { hasText: 'الشرح' }).click();
    await page.waitForTimeout(400);
    const text = await page.textContent('.cue div');
    if (/<b>|<\/b>/.test(text)) throw new Error('raw HTML leaked into the cue');
    if (!(await page.locator('.cue div b').count())) throw new Error('bold segments not rendered');
    await page.click('#gx');
    await page.waitForSelector('#gym', { state: 'hidden', timeout: 5000 });
  });

  console.log('\n== weekly measurement ==');
  await step('saves a measurement and shows a verdict', async () => {
    await tab(page, 'week');
    await page.fill('#bw', '102');
    await page.locator('.cta', { hasText: 'احسب قرار الأسبوع' }).click();
    await page.waitForSelector('.verdict', { timeout: 5000 });
    if (!(await page.textContent('.verdict h4')).trim()) throw new Error('empty verdict');
  });

  await step('rejects an out-of-range weight', async () => {
    await page.fill('#bw', '900');
    await page.locator('.cta', { hasText: 'احسب قرار الأسبوع' }).click();
    await page.waitForSelector('.toast.show', { timeout: 5000 });
    const toast = await page.textContent('#toast');
    if (!toast.includes('400')) throw new Error(`expected a range warning, got: ${toast}`);
  });

  console.log('\n== account and sync ==');
  await step('creates an account', async () => {
    await tab(page, 'account');
    await page.locator('.authtabs button', { hasText: 'حساب جديد' }).click();
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PASSWORD);
    await page.locator('.cta', { hasText: 'سوّ الحساب' }).click();
    await page.waitForSelector('.sync.synced, .sync.pending, .sync.syncing', { timeout: 15_000 });
  });

  await step('the measurement reaches the server', async () => {
    await page.waitForFunction(
      () => document.querySelector('.sync')?.classList.contains('synced'),
      { timeout: 20_000 }
    );
    const state = await page.evaluate(() =>
      fetch('/api/state', { credentials: 'same-origin' }).then((r) => r.json())
    );
    if (!state.doc?.weeks?.['1']?.body?.weight) {
      throw new Error('measurement not on server: ' + JSON.stringify(state.doc));
    }
    if (state.doc.profile?.goal !== 'cut') throw new Error('profile did not sync');
  });

  await step('a second browser signs in and sees the same data', async () => {
    const other = await newPage(browser, problems, { allowRejections: true });
    await other.goto(base, { waitUntil: 'networkidle' });
    // A genuinely new device: it lands on onboarding and takes the "I already
    // have an account" route rather than inventing a programme.
    await other.waitForSelector('.onb', { timeout: 10_000 });
    await other.locator('.cta.ghost', { hasText: 'عندي حساب' }).click();
    await other.waitForSelector('.authtabs', { timeout: 8000 });
    await other.fill('input[type=email]', email);
    await other.fill('input[type=password]', PASSWORD);
    await other.locator('.cta', { hasText: 'دخول' }).click();
    await other.waitForSelector('.today', { timeout: 15_000 });

    await tab(other, 'week');
    await other.waitForSelector('#bw', { timeout: 8000 });
    const value = await other.inputValue('#bw');
    if (value !== '102') throw new Error(`second device saw "${value}" instead of 102`);
    await other.context().close();
  });

  console.log('\n== stored-XSS probes ==');
  await step('a poisoned document cannot inject script or markup', async () => {
    const probe = await newPage(browser, problems, { allowRejections: true });
    await probe.goto(base, { waitUntil: 'networkidle' });
    await probe.evaluate(() => {
      localStorage.setItem('hadeed:doc', JSON.stringify({
        schema: 1,
        meta: { week: 1 },
        weeks: {
          1: {
            ts: 1,
            weights: { chest_db: '<img src=x onerror="window.__pwned=1">' },
            sets: {}, fb: {}, cardio: {}, cmach: {},
            body: { weight: '<script>window.__pwned=1</script>', muscle: null },
            cal: { d: [], p: [] },
          },
        },
        nutrition: null,
        profile: { goal: 'cut', level: 'int', ts: 1 },
      }));
    });
    await probe.reload({ waitUntil: 'networkidle' });
    await probe.waitForTimeout(700);

    if (await probe.evaluate(() => window.__pwned === 1)) {
      throw new Error('script executed from stored data');
    }
    if (await probe.locator('img[src="x"]').count()) {
      throw new Error('markup was parsed from stored data');
    }
    await probe.context().close();
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
