import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verdict,
  progress,
  dayVolume,
  tdeeFormula,
  safeTarget,
  measuredTDEE,
  avgCal,
  todayKey,
  formatRest,
} from '../public/js/engine.js';
import { PLAN, baseWeights, exById, EXERCISE_IDS } from '../public/js/program.js';

const fullSets = (id) => Array.from({ length: exById(id).sets }, () => true);

test('weekly verdict', async (t) => {
  await t.test('no measurement yet → go', () => {
    assert.equal(verdict(null, null).gate, 'go');
  });

  await t.test('first measurement → baseline, still go', () => {
    assert.equal(verdict({ weight: 102 }, null).gate, 'go');
  });

  await t.test('losing faster than 1.2% in a week → hold', () => {
    const v = verdict({ weight: 100 }, { weight: 102 }); // −1.96%
    assert.equal(v.gate, 'hold');
    assert.equal(v.kind, 'warn');
    assert.equal(v.dW, -2);
  });

  await t.test('losing half a kilo of muscle → hold', () => {
    const v = verdict({ weight: 101.5, muscle: 41 }, { weight: 102, muscle: 41.6 });
    assert.equal(v.gate, 'hold');
  });

  await t.test('a healthy loss → go', () => {
    const v = verdict({ weight: 101.3 }, { weight: 102 }); // −0.69%
    assert.equal(v.gate, 'go');
    assert.equal(v.kind, 'go');
  });

  await t.test('gaining weight still allows lifts to rise', () => {
    const v = verdict({ weight: 103 }, { weight: 102 });
    assert.equal(v.gate, 'go');
    assert.equal(v.kind, 'hold');
  });
});

test('weight progression', async (t) => {
  const go = { gate: 'go' };
  const hold = { gate: 'hold' };

  await t.test('completed + "ok" → one step up', () => {
    const out = progress(
      { chest_db: 10 },
      { sets: { chest_db: fullSets('chest_db') }, fb: { chest_db: 'ok' } },
      go
    );
    assert.equal(out.chest_db, 12);
  });

  await t.test('completed + "light" → double step when the jump is small enough', () => {
    const out = progress(
      { leg_press: 100 },
      { sets: { leg_press: fullSets('leg_press') }, fb: { leg_press: 'light' } },
      go
    );
    assert.equal(out.leg_press, 110, '5 kg step doubled on a 100 kg lift');
  });

  await t.test('"light" falls back to a single step when doubling exceeds 20%', () => {
    const out = progress(
      { chest_db: 10 },
      { sets: { chest_db: fullSets('chest_db') }, fb: { chest_db: 'light' } },
      go
    );
    assert.equal(out.chest_db, 12, '2 kg × 2 would be 40% of 10 kg — too much');
  });

  await t.test('"heavy" holds the weight', () => {
    const out = progress(
      { chest_db: 10 },
      { sets: { chest_db: fullSets('chest_db') }, fb: { chest_db: 'heavy' } },
      go
    );
    assert.equal(out.chest_db, 10);
  });

  await t.test('an incomplete exercise never goes up', () => {
    const out = progress(
      { chest_db: 10 },
      { sets: { chest_db: [true, true, false] }, fb: { chest_db: 'light' } },
      go
    );
    assert.equal(out.chest_db, 10);
  });

  await t.test('a "hold" week freezes everything', () => {
    const out = progress(
      { chest_db: 10, leg_press: 60 },
      {
        sets: { chest_db: fullSets('chest_db'), leg_press: fullSets('leg_press') },
        fb: { chest_db: 'light', leg_press: 'ok' },
      },
      hold
    );
    assert.deepEqual(out, { chest_db: 10, leg_press: 60 });
  });

  await t.test('assisted pull-ups progress downward and never below zero', () => {
    let w = 5;
    for (let i = 0; i < 4; i++) {
      w = progress({ pullup: w }, { sets: { pullup: fullSets('pullup') }, fb: { pullup: 'ok' } }, go)
        .pullup;
    }
    assert.equal(w, 0, 'assistance bottoms out at 0, never negative');
  });

  await t.test('bodyweight exercises are left alone', () => {
    const out = progress(
      { deadbug: 0 },
      { sets: { deadbug: fullSets('deadbug') }, fb: { deadbug: 'light' } },
      go
    );
    assert.equal(out.deadbug, 0);
  });

  await t.test('no floating point drift over many weeks', () => {
    let weights = baseWeights();
    const log = {
      sets: Object.fromEntries(EXERCISE_IDS.map((id) => [id, fullSets(id)])),
      fb: Object.fromEntries(EXERCISE_IDS.map((id) => [id, 'ok'])),
    };
    for (let i = 0; i < 52; i++) weights = progress(weights, log, go);
    for (const [id, value] of Object.entries(weights)) {
      assert.equal(value, Math.round(value * 10) / 10, `${id} stayed clean: ${value}`);
    }
  });
});

test('volume', async (t) => {
  await t.test('counts only completed sets, and doubles per-hand lifts', () => {
    const sets = { chest_db: [true, true, false] };
    const volume = dayVolume(PLAN.sat.ex, { ...baseWeights(), chest_db: 10 }, sets);
    // 2 sets × 10 kg × 10 reps × 2 hands
    assert.equal(volume, 400);
  });

  await t.test('skips timed, bodyweight and assisted movements', () => {
    const volume = dayVolume(
      PLAN.sat.ex,
      { ...baseWeights(), plank: 30 },
      { plank: [true, true, true] }
    );
    assert.equal(volume, 0);
  });
});

test('nutrition', async (t) => {
  await t.test('Mifflin-St Jeor at a known point', () => {
    // BMR = 10×102 + 6.25×183 − 5×28 + 5 = 2028.75 → ×1.55
    assert.equal(tdeeFormula(102, 28, 1.55), Math.round(2028.75 * 1.55));
  });

  await t.test('the deficit never drops below the safety floor', () => {
    assert.equal(safeTarget(3000), 2500);
    assert.equal(safeTarget(2000), 1700, 'floored at 1700, not 1500');
    assert.equal(safeTarget(2400), 1900, 'floored at 75% of maintenance');
  });

  await t.test('averages ignore unlogged days', () => {
    assert.deepEqual(avgCal({ d: [2000, 0, 2200, 0, 0, 0, 0] }), { avg: 2100, days: 2, sum: 4200 });
    assert.equal(avgCal({ d: [] }), null);
  });

  await t.test('measured maintenance backs out the weight change', () => {
    const calHist = { 2: { d: [2000, 2000, 2000, 2000, 2000, 2000, 2000] } };
    const bodyHist = { 1: { weight: 102 }, 2: { weight: 101.5 } };
    const measured = measuredTDEE(calHist, bodyHist);
    // lost 0.5 kg → 0.5 × 7700 / 7 = 550 kcal/day deficit → maintenance ≈ 2550
    assert.equal(measured.val, 2550);
    assert.equal(measured.weeks, 1);
  });

  await t.test('ignores weeks with fewer than four logged days', () => {
    const calHist = { 2: { d: [2000, 2000, 0, 0, 0, 0, 0] } };
    const bodyHist = { 1: { weight: 102 }, 2: { weight: 101.5 } };
    assert.equal(measuredTDEE(calHist, bodyHist), null);
  });
});

test('calendar helpers', async (t) => {
  await t.test('maps weekdays to the right training day', () => {
    // 2026-08-15 is a Saturday.
    assert.equal(todayKey(new Date(2026, 7, 15)), 'sat');
    assert.equal(todayKey(new Date(2026, 7, 17)), 'mon');
    assert.equal(todayKey(new Date(2026, 7, 19)), 'wed');
    assert.equal(todayKey(new Date(2026, 7, 21)), 'rest');
    assert.equal(todayKey(new Date(2026, 7, 16)), 'cardio');
  });

  await t.test('formats rest periods in Arabic', () => {
    assert.equal(formatRest(90), '90 ث');
    assert.equal(formatRest(120), 'دقيقتين');
    assert.equal(formatRest(60), 'دقيقة');
  });
});

test('program data integrity', async (t) => {
  await t.test('every exercise id is unique', () => {
    assert.equal(new Set(EXERCISE_IDS).size, EXERCISE_IDS.length);
  });

  await t.test('every video link is https', () => {
    for (const id of EXERCISE_IDS) {
      assert.match(exById(id).v, /^https:\/\//, `${id} link must be https`);
    }
  });

  await t.test('cue text is structured data, never an HTML string', () => {
    for (const id of EXERCISE_IDS) {
      const cue = exById(id).cue;
      assert.ok(Array.isArray(cue), `${id} cue must be an array`);
      for (const part of cue) {
        const text = typeof part === 'string' ? part : part.b;
        assert.ok(!/[<>]/.test(text), `${id} cue must not contain markup`);
      }
    }
  });

  await t.test('every exercise has a positive rest period in seconds', () => {
    for (const id of EXERCISE_IDS) {
      const rest = exById(id).rest;
      assert.equal(typeof rest, 'number');
      assert.ok(rest > 0 && rest <= 600, `${id} rest = ${rest}`);
    }
  });
});
