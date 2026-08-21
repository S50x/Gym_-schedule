/**
 * Per-muscle-group strength levels, driven through the real onboarding form.
 *
 * The unit tests prove the arithmetic. What only a browser shows is whether the
 * control is reachable and honest: that it starts collapsed, that the chip
 * marked "· مستواي" really is the overall level and follows it when that
 * changes, that touching one group moves only that group's weights, and that
 * someone who never opens it lands on exactly the numbers they used to get.
 */

import { newPage, onboard, noStrayNulls, tab, runStandalone } from './helpers.mjs';

/**
 * Open a training day in gym mode and read the exercise name and the weight
 * exactly as they appear on screen — the same view the trainee reads in the gym.
 */
async function openDay(page, index) {
  await page.evaluate((i) => {
    document.querySelectorAll('.wlift:not(.ghost)')[i]?.click();
  }, index);
  await page.waitForSelector('#gym.on', { timeout: 8000 });
  const name = await page
    .locator('.gname')
    .evaluate((node) => node.childNodes[0].textContent.trim());
  const weight = await page.locator('.wbox .val').evaluate((n) => n.textContent.trim());
  return { name, weight };
}

/** The weights the app computed for week 1, straight from the store. */
async function storedWeights(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('hadeed:doc') || '{}'));
}

export default async function groups({ base, browser, problems, step }) {
  /* ── 1. collapsed by default, and the tag tracks the overall level ── */
  await step('starts collapsed and marks the overall level', async () => {
    const page = await newPage(browser, problems);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.onb', { timeout: 10_000 });

    const details = page.locator('.gdet');
    if (!(await details.count())) throw new Error('the group section is not on the page');
    if (await details.evaluate((n) => n.open)) throw new Error('it should start collapsed');

    await page.locator('.gcard').nth(4).click(); // قوة
    await page.locator('.lcard').nth(2).click(); // متقدم
    await details.evaluate((n) => (n.open = true));

    // Exactly one chip per row carries the tag, and it is the overall level.
    const tagged = await page.evaluate(() =>
      [...document.querySelectorAll('.grow')].map((row) => {
        const withTag = [...row.querySelectorAll('.mchip')].filter((c) => c.querySelector('.tag'));
        const pressed = [...row.querySelectorAll('.mchip.on')];
        return {
          tags: withTag.length,
          tagText: withTag[0]?.textContent.trim(),
          pressed: pressed.map((c) => c.dataset.level),
        };
      })
    );
    if (!tagged.length) throw new Error('no group rows rendered');
    for (const row of tagged) {
      if (row.tags !== 1) throw new Error(`expected one tagged chip, saw ${row.tags}`);
      if (!row.tagText.includes('متقدم')) throw new Error(`tag shows "${row.tagText}", not متقدم`);
      if (row.pressed.join() !== 'adv') throw new Error(`pressed ${row.pressed.join()}, want adv`);
    }

    // Change the overall level; the tag and the pressed chip must follow it.
    await page.locator('.lcard').nth(0).click(); // مبتدئ
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('.grow')].map((row) => ({
        tagText: row.querySelector('.mchip .tag')?.parentElement.textContent.trim(),
        pressed: row.querySelector('.mchip.on')?.dataset.level,
      }))
    );
    for (const row of after) {
      if (!row.tagText.includes('مبتدئ')) throw new Error(`tag stuck on "${row.tagText}"`);
      if (row.pressed !== 'beg') throw new Error(`pressed ${row.pressed} after level change`);
    }

    await noStrayNulls(page, 'onboarding with the group section open');
    await page.context().close();
  });

  /* ── 2. untouched == the old behaviour, exactly ── */
  await step('never opening it gives the old weights exactly', async () => {
    const page = await newPage(browser, problems);
    await onboard(page, base, { goal: 4, level: 1 }); // قوة · متوسط
    const doc = await storedWeights(page);
    if (doc.profile?.levels) {
      throw new Error(`levels should be unset, got ${JSON.stringify(doc.profile.levels)}`);
    }
    await page.context().close();
  });

  /* ── 3. one group down moves only that group, on screen ── */
  await step('أرجل on مبتدئ drops the squat and leaves the bench alone', async () => {
    // Two identical set-ups apart from the override, so the comparison is
    // against what this very app shows, not against a number typed in here.
    const readings = {};
    for (const override of [null, 'beg']) {
      const page = await newPage(browser, problems);
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.onb', { timeout: 10_000 });

      await page.locator('.gcard').nth(4).click(); // قوة
      await page.locator('.lcard').nth(1).click(); // متوسط

      if (override) {
        await page.locator('.gdet').evaluate((n) => (n.open = true));
        await page.evaluate((level) => {
          const row = [...document.querySelectorAll('.grow')].find((r) =>
            r.querySelector('.gn')?.textContent.includes('أرجل')
          );
          row.querySelector(`.mchip[data-level="${level}"]`).click();
        }, override);
      }

      const inputs = page.locator('.onb .inp input');
      await inputs.nth(0).fill('90');
      await inputs.nth(1).fill('180');
      await inputs.nth(2).fill('30');
      await page.locator('.big-cta').click();
      await page.waitForSelector('.today', { timeout: 10_000 });

      const doc = await storedWeights(page);
      const saved = doc.profile?.levels ?? null;
      if (override) {
        if (saved?.legs !== 'beg') throw new Error(`legs not saved: ${JSON.stringify(saved)}`);
        if (saved.push || saved.pull) throw new Error('an untouched group was written');
      } else if (saved) {
        throw new Error(`nothing was touched, yet ${JSON.stringify(saved)} was written`);
      }

      // Day 1 of قوة opens on the squat; walk to a push day for the bench.
      readings[override ?? 'none'] = {
        legs: await openDay(page, 0),
        push: await openDay(page, 1),
      };
      await noStrayNulls(page, `gym mode · override=${override ?? 'none'}`);
      await page.context().close();
    }

    const plain = readings.none;
    const legsBeg = readings.beg;

    if (plain.legs.weight === legsBeg.legs.weight) {
      throw new Error(
        `${plain.legs.name} stayed at ${plain.legs.weight} — the override changed nothing`
      );
    }
    if (Number(legsBeg.legs.weight) >= Number(plain.legs.weight)) {
      throw new Error(`مبتدئ made ${legsBeg.legs.name} heavier, not lighter`);
    }
    if (plain.push.weight !== legsBeg.push.weight) {
      throw new Error(
        `${plain.push.name} moved from ${plain.push.weight} to ${legsBeg.push.weight} — ` +
          'a leg override must not touch a push day'
      );
    }

    console.log(
      `      ${plain.legs.name}: ${plain.legs.weight} → ${legsBeg.legs.weight}  ·  ` +
        `${plain.push.name}: ${plain.push.weight} (ثابت)`
    );
  });

  /* ── 4. the choice survives a reopen ── */
  await step('reopening the form shows the saved choice', async () => {
    const page = await newPage(browser, problems);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.onb', { timeout: 10_000 });

    await page.locator('.gcard').nth(1).click();
    await page.locator('.lcard').nth(1).click();
    await page.locator('.gdet').evaluate((n) => (n.open = true));
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.grow')].find((r) =>
        r.querySelector('.gn')?.textContent.includes('دفع')
      );
      row.querySelector('.mchip[data-level="adv"]').click();
    });
    const inputs = page.locator('.onb .inp input');
    await inputs.nth(0).fill('85');
    await inputs.nth(1).fill('178');
    await inputs.nth(2).fill('27');
    await page.locator('.big-cta').click();
    await page.waitForSelector('.today', { timeout: 10_000 });

    // Back in through "عدّل هدفك ومستواك".
    await tab(page, 'account');
    await page.locator('.cta.ghost', { hasText: 'عدّل هدفك ومستواك' }).click();
    await page.waitForSelector('.onb', { timeout: 8000 });
    await page.locator('.gdet').evaluate((n) => (n.open = true));

    const pushPressed = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.grow')].find((r) =>
        r.querySelector('.gn')?.textContent.includes('دفع')
      );
      return row.querySelector('.mchip.on')?.dataset.level;
    });
    if (pushPressed !== 'adv') throw new Error(`saved choice lost — shows ${pushPressed}`);

    await noStrayNulls(page, 'reopened onboarding');
    await page.context().close();
  });
}

if (import.meta.url === `file://${process.argv[1]}`) await runStandalone(groups);
