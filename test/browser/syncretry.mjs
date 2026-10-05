/**
 * Sync when the server fails, in the two ways that need opposite handling.
 *
 * A free host answers the first request after a quiet spell with a 502/503
 * from its proxy while the service wakes. That used to park the app in "sync
 * error" with no retry, so a laptop opened after a few hours showed an error
 * and sent nothing until something was edited. It must retry on its own.
 *
 * A request the server refuses (400) is different: retrying sends the same
 * thing again. That one stops, and the account screen has to say why — the
 * reason used to be kept and never shown.
 */

import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const PASSWORD = 'a-really-good-passphrase';

const syncClass = (page) => page.evaluate(() => document.querySelector('.sync')?.className || '');

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems, { allowRejections: true });
  await onboard(page, base, { goal: 0, weight: 92 });

  await step('signs up and syncs', async () => {
    await tab(page, 'account');
    await page.locator('.authtabs button', { hasText: 'حساب جديد' }).click();
    await page.fill('input[type=email]', `retry-${Date.now()}@example.com`);
    await page.fill('input[type=password]', PASSWORD);
    await page.locator('.cta', { hasText: 'سوّ الحساب' }).click();
    await tab(page, 'home');
    await page.waitForFunction(() => document.querySelector('.sync')?.classList.contains('synced'), {
      timeout: 20_000,
    });
  });

  await step('a 502 from a waking host is retried, not reported as an error', async () => {
    let failed = 0;
    await page.route('**/api/state', (route) => {
      if (route.request().method() === 'PUT' && failed < 1) {
        failed++;
        return route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' });
      }
      return route.continue();
    });

    await page.locator('.wrow .ck').first().click();
    // Pushes are debounced, so wait for the failing request itself.
    for (let i = 0; i < 40 && !failed; i++) await page.waitForTimeout(250);
    if (!failed) throw new Error('the failing request was never made');
    await page.waitForTimeout(500);
    const after = await syncClass(page);
    if (after.includes('error')) throw new Error('a 502 put the app in sync error');
    if (!after.includes('pending')) throw new Error(`after a 502 the sync pill reads "${after}", not pending`);

    // First retry is due ten seconds after the failure.
    await page.waitForFunction(() => document.querySelector('.sync')?.classList.contains('synced'), {
      timeout: 25_000,
    });
    await page.unroute('**/api/state');

    const state = await page.evaluate(() => fetch('/api/state').then((r) => r.json()));
    if (!Object.values(state.doc?.weeks?.['1']?.cardio || {}).some(Boolean)) {
      throw new Error('the edit made during the outage never reached the server');
    }
  });

  await step('a refused write says why, and can be retried by hand', async () => {
    await page.route('**/api/state', (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'invalid_state', message: 'بيانات غير صالحة.', detail: 'weeks.1.cardio' }),
          })
        : route.continue()
    );
    await page.locator('.wrow .ck').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.sync')?.classList.contains('error'), {
      timeout: 10_000,
    });

    await tab(page, 'account');
    const reason = (await page.textContent('.syncerr .formerr')) || '';
    if (!reason.includes('weeks.1.cardio')) throw new Error(`the reason is not shown: "${reason}"`);

    await page.unroute('**/api/state');
    await page.locator('.syncerr .cta', { hasText: 'جرّب المزامنة الحين' }).click();
    await page.waitForFunction(() => !document.querySelector('.syncerr'), { timeout: 15_000 });
  });

  await page.close();
}

runStandalone(run);
