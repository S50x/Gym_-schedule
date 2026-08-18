/**
 * The whole two-factor journey: enrol, sign in on a fresh device, spend a
 * recovery code, and switch it off.
 *
 * Codes come from the app's own TOTP module, so this exercises the real
 * algorithm rather than a stub.
 */

import { codeForStep, currentStep } from '../../server/totp.js';
import { newPage, onboard, tab, runStandalone } from './helpers.mjs';

const PASSWORD = 'a-really-good-passphrase';

/**
 * Real time keeps moving while the browser drives, so a fixed offset drifts out
 * of the ±1 acceptance window. Always take the next step this account has not
 * spent yet, and wait for the clock to reach it — spending two codes inside one
 * 30-second window is exactly what the replay guard is supposed to refuse.
 */
function codes() {
  let lastUsed = -1;
  return {
    async fresh() {
      while (currentStep() <= lastUsed) await new Promise((r) => setTimeout(r, 1000));
    },
    next(secret) {
      const step = Math.max(currentStep(), lastUsed + 1);
      lastUsed = step;
      return codeForStep(secret, step);
    },
  };
}

export default async function run({ base, browser, problems, step }) {
  const email = `mfa-${Date.now()}@example.com`;
  const totp = codes();
  const page = await newPage(browser, problems, { allowRejections: true });

  let secret = null;
  let recovery = [];

  // Creating an account is a new trainee: they pick a programme first, then
  // register. Registering from the escape hatch would (correctly) bounce them
  // straight back to onboarding, since a brand new account still has no goal.
  const setUpThenOpenAccount = async (p) => {
    await onboard(p, base, { goal: 0, weight: 90 });
    await tab(p, 'account');
    await p.waitForSelector('.authtabs', { timeout: 8000 });
  };

  // Signing in on a second phone is the other path: onboarding's escape hatch,
  // because their real goal is about to arrive with their data.
  const openLoginForm = async (p) => {
    await p.goto(base, { waitUntil: 'networkidle' });
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForSelector('.onb', { timeout: 10_000 });
    await p.locator('.cta.ghost', { hasText: 'عندي حساب' }).click();
    await p.waitForSelector('.authtabs', { timeout: 8000 });
  };

  console.log('\n== enrolment ==');
  await step('creates an account', async () => {
    await setUpThenOpenAccount(page);
    await page.locator('.authtabs button', { hasText: 'حساب جديد' }).click();
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PASSWORD);
    await page.locator('.cta', { hasText: 'سوّ الحساب' }).click();
    // Registering drops you on the home screen, so come back to the account tab.
    await page.waitForSelector('.today', { timeout: 15_000 });
    await tab(page, 'account');
    // .acctrow exists signed out too (the programme card), so wait on the
    // two-factor pill — only a signed-in account renders that.
    await page.waitForSelector('.pill', { timeout: 15_000 });
  });

  await step('reports 2FA as off and asks for the password first', async () => {
    const pill = await page.locator('.pill').first().textContent();
    if (!pill.includes('مو مفعّل')) throw new Error(`expected "off", got "${pill}"`);
    await page.locator('.cta', { hasText: 'فعّل التحقق بخطوتين' }).click();
    await page.waitForSelector('input[type=password]', { timeout: 5000 });
  });

  await step('refuses a wrong password', async () => {
    await page.fill('input[type=password]', 'wrong-password-here');
    await page.locator('.cta', { hasText: 'كمّل' }).click();
    await page.waitForSelector('.formerr', { timeout: 8000 });
  });

  await step('renders a QR and the manual secret', async () => {
    await page.fill('input[type=password]', PASSWORD);
    await page.locator('.cta', { hasText: 'كمّل' }).click();
    await page.waitForSelector('.qrbox svg', { timeout: 12_000 });

    if ((await page.locator('.qrbox svg rect').count()) < 20) throw new Error('QR looks empty');
    await page.click('.manual summary');
    secret = (await page.textContent('.secret')).replace(/\s/g, '');
    if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error(`bad secret: ${secret}`);
  });

  await step('refuses a wrong code, then accepts the real one', async () => {
    await page.fill('.inp.ltr input[inputmode=numeric]', '000000');
    await page.locator('.cta', { hasText: 'تأكيد وتفعيل' }).click();
    await page.waitForSelector('.formerr', { timeout: 8000 });

    await page.fill('.inp.ltr input[inputmode=numeric]', totp.next(secret));
    await page.locator('.cta', { hasText: 'تأكيد وتفعيل' }).click();
    await page.waitForSelector('.codes code', { timeout: 12_000 });
  });

  await step('issues ten well-formed recovery codes', async () => {
    recovery = await page.locator('.codes code').allTextContents();
    if (recovery.length !== 10) throw new Error(`expected 10 codes, got ${recovery.length}`);
    for (const c of recovery) {
      if (!/^[2-9A-HJ-NP-TV-Z]{5}-[2-9A-HJ-NP-TV-Z]{5}$/.test(c)) throw new Error(`bad code: ${c}`);
    }
    await page.locator('.cta', { hasText: 'حفظتها، كمّل' }).click();
    await page.waitForTimeout(600);
    const pill = await page.locator('.pill').first().textContent();
    if (!pill.includes('مفعّل') || pill.includes('مو مفعّل')) throw new Error(`expected "on", got "${pill}"`);
  });

  console.log('\n== signing in elsewhere ==');
  const freshDevice = async () => {
    const p = await newPage(browser, problems, { allowRejections: true });
    await openLoginForm(p);
    await p.fill('input[type=email]', email);
    await p.fill('input[type=password]', PASSWORD);
    await p.locator('.cta', { hasText: 'دخول' }).click();
    return p;
  };

  await step('the password alone grants no session', async () => {
    const p = await freshDevice();
    await p.waitForSelector('.mfahead', { timeout: 12_000 });
    const status = await p.evaluate(() => fetch('/api/auth/me').then((r) => r.status));
    if (status !== 401) throw new Error(`should not be signed in yet, got ${status}`);
    await p.context().close();
  });

  await step('a wrong code is refused, the right one signs in', async () => {
    const p = await freshDevice();
    await p.waitForSelector('.mfahead', { timeout: 12_000 });

    await p.fill('.inp.ltr input[inputmode=numeric]', '111111');
    await p.locator('.cta', { hasText: 'تأكيد' }).click();
    await p.waitForSelector('.formerr', { timeout: 8000 });

    await totp.fresh();
    await p.fill('.inp.ltr input[inputmode=numeric]', totp.next(secret));
    await p.locator('.cta', { hasText: 'تأكيد' }).click();
    await p.waitForSelector('.today', { timeout: 12_000 });

    const me = await p.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
    if (me.email !== email) throw new Error('signed in as the wrong user');
    if (me.totpEnabled !== true) throw new Error('totpEnabled should be true');
    await p.context().close();
  });

  await step('a recovery code signs in once and is then spent', async () => {
    const spare = recovery[0];

    const first = await freshDevice();
    await first.waitForSelector('.mfahead', { timeout: 12_000 });
    await first.fill('.inp.ltr input[inputmode=numeric]', spare);
    await first.locator('.cta', { hasText: 'تأكيد' }).click();
    await first.waitForSelector('.today', { timeout: 12_000 });
    const me = await first.evaluate(() => fetch('/api/auth/me').then((r) => r.json()));
    if (me.recoveryCodesLeft !== 9) throw new Error(`expected 9 left, got ${me.recoveryCodesLeft}`);
    await first.context().close();

    const second = await freshDevice();
    await second.waitForSelector('.mfahead', { timeout: 12_000 });
    await second.fill('.inp.ltr input[inputmode=numeric]', spare);
    await second.locator('.cta', { hasText: 'تأكيد' }).click();
    await second.waitForSelector('.formerr', { timeout: 8000 });
    await second.context().close();
  });

  console.log('\n== switching off ==');
  await step('needs the password AND a code together', async () => {
    await page.reload({ waitUntil: 'networkidle' });
    await tab(page, 'account');
    await page.locator('.cta', { hasText: 'أوقف التحقق بخطوتين' }).click();
    await page.waitForSelector('input[type=password]', { timeout: 5000 });

    await page.fill('input[type=password]', PASSWORD);
    await page.fill('.inp.ltr input[inputmode=numeric]', '999999');
    await page.locator('.cta.danger', { hasText: 'أوقف' }).click();
    await page.waitForSelector('.formerr', { timeout: 8000 });

    await totp.fresh();
    await page.fill('input[type=password]', PASSWORD);
    await page.fill('.inp.ltr input[inputmode=numeric]', totp.next(secret));
    await page.locator('.cta.danger', { hasText: 'أوقف' }).click();
    await page.waitForTimeout(1500);

    const pill = await page.locator('.pill').first().textContent();
    if (!pill.includes('مو مفعّل')) throw new Error(`expected "off", got "${pill}"`);
  });

  await step('a plain password login works again', async () => {
    const p = await freshDevice();
    await p.waitForSelector('.today', { timeout: 12_000 });
    await p.context().close();
  });

  await page.context().close();
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(run);
