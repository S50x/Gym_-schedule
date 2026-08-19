/**
 * Password reset — the two UI surfaces the unit tests can't see:
 *   1. the "forgot my password?" form under the login card
 *   2. the /reset?token=… screen the emailed link lands on
 *
 * The token happy-path (a real link actually changing the password) is covered
 * exhaustively in test/reset.test.js. What only a real browser can catch is what
 * §7 is full of: a form that renders into a detached node, a CSP violation, a
 * view that never appears. So this drives the screens and the client-side
 * validation, and confirms an invalid link fails gracefully with a way forward.
 */

import { newPage, runStandalone } from './helpers.mjs';

const PASSWORD = 'browser-reset-pass-31';

export default async function reset({ base, browser, problems, step }) {
  const page = await newPage(browser, problems, { allowRejections: true });
  const email = `reset-${Date.now()}@example.com`;

  // Someone who forgot their password reaches the login card the same way a new
  // device does: onboarding's "I already have an account" escape.
  await step('reaches the login card', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.onb', { timeout: 10_000 });
    await page.locator('.cta.ghost', { hasText: 'عندي حساب' }).click();
    await page.waitForSelector('.authtabs', { timeout: 8000 });
  });

  await step('the forgot link is shown only in login mode', async () => {
    const link = page.locator('.linkbtn', { hasText: 'نسيت كلمة السر' });
    if (!(await link.isVisible())) throw new Error('forgot link missing on the login tab');
    await page.locator('.authtabs button', { hasText: 'حساب جديد' }).click();
    if (await link.isVisible()) throw new Error('forgot link should hide on the register tab');
    await page.locator('.authtabs button', { hasText: 'تسجيل دخول' }).click();
    if (!(await link.isVisible())) throw new Error('forgot link should return on the login tab');
  });

  await step('asking for a link shows the generic confirmation', async () => {
    await page.fill('input[type=email]', email);
    await page.locator('.linkbtn', { hasText: 'نسيت كلمة السر' }).click();
    await page.locator('.cta', { hasText: 'أرسل رابط إعادة التعيين' }).click();
    await page.waitForSelector('.formok', { timeout: 10_000 });
  });

  await step('an unknown email gets the very same confirmation', async () => {
    await page.locator('.cta.ghost', { hasText: 'رجوع لتسجيل الدخول' }).click();
    await page.waitForSelector('.authtabs', { timeout: 8000 });
    await page.locator('.linkbtn', { hasText: 'نسيت كلمة السر' }).click();
    await page.fill('input[type=email]', `nobody-${Date.now()}@example.com`);
    await page.locator('.cta', { hasText: 'أرسل رابط إعادة التعيين' }).click();
    await page.waitForSelector('.formok', { timeout: 10_000 });
  });

  await step('the reset link lands on the reset screen', async () => {
    await page.goto(`${base}/reset?token=made-up-token-that-is-not-real`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('h3', { timeout: 10_000 });
    const heading = await page.locator('h3').first().innerText();
    if (!heading.includes('اختر كلمة سر جديدة')) {
      throw new Error(`reset screen not shown, saw heading: ${heading}`);
    }
    const fields = await page.locator('.card input[type=password]').count();
    if (fields !== 2) throw new Error(`expected two password fields, saw ${fields}`);
  });

  await step('mismatched passwords are caught before any request', async () => {
    const fields = page.locator('.card input[type=password]');
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill('a-different-passphrase-99');
    await page.locator('.cta', { hasText: 'احفظ كلمة السر الجديدة' }).click();
    await page.waitForSelector('.formerr', { timeout: 5000 });
    const err = await page.locator('.formerr').innerText();
    if (!err.includes('متطابقت')) throw new Error(`expected a mismatch error, saw: ${err}`);
  });

  await step('a dead link fails with a way to ask for a fresh one', async () => {
    const fields = page.locator('.card input[type=password]');
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill(PASSWORD);
    await page.locator('.cta', { hasText: 'احفظ كلمة السر الجديدة' }).click();
    await page.waitForSelector('.formerr', { timeout: 10_000 });
    await page.waitForSelector('.cta:has-text("اطلب رابط جديد")', { timeout: 10_000 });
  });

  await step('asking for a fresh link returns to login', async () => {
    await page.locator('.cta', { hasText: 'اطلب رابط جديد' }).click();
    await page.waitForSelector('.authtabs', { timeout: 10_000 });
    // The token is off the URL so a reload no longer reopens the reset screen.
    if (new URL(page.url()).pathname === '/reset') {
      throw new Error('reset token still on the URL after leaving');
    }
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) runStandalone(reset);
