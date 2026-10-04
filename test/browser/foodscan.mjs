/**
 * Reading a meal from a picture. Google is never reached: the two food
 * endpoints are answered by the page's network layer, so this checks the
 * screens — the step-by-step guide, saving a key, and a scan filling the meal
 * form with the gaps highlighted — not Gemini itself (server tests cover the
 * API with a fake client).
 */

import { newPage, onboard, tab, noStrayNulls, runStandalone } from './helpers.mjs';

// A real 1×1 PNG, so createImageBitmap and the canvas resize run for real.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export default async function run({ base, browser, problems, step }) {
  const page = await newPage(browser, problems);
  let saved = false;
  let scanned = null;

  await page.route('**/api/food/key', async (route) => {
    const method = route.request().method();
    if (method === 'PUT') saved = true;
    if (method === 'DELETE') saved = false;
    await route.fulfill({ json: saved ? { saved: true, last4: 'WXYZ' } : { saved: false, last4: null } });
  });
  await page.route('**/api/food/scan', async (route) => {
    scanned = JSON.parse(route.request().postData());
    await route.fulfill({
      json: {
        kind: 'label',
        name: 'لبن كامل الدسم',
        serving: '200 مل',
        per: 'serving',
        kcal: 120,
        protein: 6.4,
        fat: null,
        carbs: 9.2,
        items: [],
        confidence: 0.9,
        note: '',
      },
    });
  });

  await step('without an account the meal form says how to unlock it', async () => {
    await onboard(page, base, { goal: 0, weight: 90 });
    await tab(page, 'nutri');
    await page.waitForSelector('.mpanel .scan', { timeout: 5000 });
    const text = await page.textContent('.mpanel .scan');
    if (!text.includes('سجّل دخول')) throw new Error(`signed-out hint: ${text}`);
  });

  await step('account page: guide with a link straight to Google', async () => {
    await tab(page, 'account');
    await page.locator('.authtabs button', { hasText: 'حساب جديد' }).click();
    await page.fill('input[type=email]', `scan${Date.now()}@example.com`);
    await page.fill('input[type=password]', 'a-long-enough-passphrase-1');
    await page.locator('.cta', { hasText: 'سوّ الحساب' }).click();
    // Signing up lands on home; the key card lives on the account page.
    await page.waitForSelector('.sync.synced, .sync.pending, .sync.syncing', { timeout: 15_000 });
    await tab(page, 'account');
    await page.waitForSelector('.kguide a.cta', { timeout: 15_000 });

    const link = page.locator('.kguide a.cta');
    if ((await link.getAttribute('href')) !== 'https://aistudio.google.com/app/apikey') {
      throw new Error('wrong Google link');
    }
    if ((await link.getAttribute('target')) !== '_blank') throw new Error('link must open a new tab');
    if ((await page.locator('.ksteps li').count()) !== 4) throw new Error('expected four steps');
  });

  await step('saving a key shows it working, never the key itself', async () => {
    await page.fill('input[aria-label="مفتاح Gemini"]', 'AIzaSyD-browser-test-key-0123456WXYZ');
    await page.locator('.krow .cta', { hasText: 'حفظ' }).click();
    await page.waitForSelector('.formok', { timeout: 5000 });
    const ok = await page.textContent('.formok');
    if (!ok.includes('WXYZ') || ok.includes('AIza')) throw new Error(`status: ${ok}`);
  });

  await step('a scan fills the meal and marks what it could not read', async () => {
    await tab(page, 'nutri');
    await page.waitForSelector('.scanbtn', { timeout: 5000 });
    await page.locator('.mpanel input[type=file]').setInputFiles({
      name: 'label.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.waitForFunction(() => document.querySelector('.madd .mn')?.value, null, { timeout: 10_000 });

    if (!scanned?.image || scanned.mimeType !== 'image/jpeg') throw new Error('image not sent as JPEG');
    const name = await page.inputValue('.madd .mn');
    if (name !== 'لبن كامل الدسم') throw new Error(`name: ${name}`);
    const nums = page.locator('.madd .mgrid .mi');
    if ((await nums.nth(0).inputValue()) !== '120') throw new Error('kcal not filled');
    const fatMissing = await nums.nth(2).evaluate((n) => n.classList.contains('missing') && n.value === '');
    if (!fatMissing) throw new Error('unread fat should be empty and highlighted');

    await nums.nth(2).fill('6.6');
    await page.locator('.madd .cta', { hasText: 'حفظ الوجبة' }).click();
    await page.waitForSelector('.meal', { timeout: 5000 });
    const listed = await page.textContent('.meal');
    if (!listed.includes('لبن كامل الدسم')) throw new Error(`meal: ${listed}`);
    await noStrayNulls(page, 'meal after scan');
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
