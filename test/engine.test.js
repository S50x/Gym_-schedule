import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verdict,
  progress,
  dayVolume,
  tdeeFormula,
  safeTarget,
  proteinTarget,
  measuredTDEE,
  avgCal,
  todayKey,
  formatRest,
} from '../public/js/engine.js';
import {
  PLAN,
  baseWeights,
  exById,
  EXERCISE_IDS,
  GOAL_KEYS,
  MAX_SETS,
  planOf,
  cardioOf,
} from '../public/js/program.js';

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

test('the goal decides what the scale means', async (t) => {
  // Same measurement, five goals. +0.69% in a week is over the line for a cut
  // and comfortably inside the range a bulk is aiming for.
  const gained = [{ weight: 102.7 }, { weight: 102 }];
  const lost = [{ weight: 101 }, { weight: 102 }]; // −0.98%

  await t.test('gaining is a warning when cutting, success when building', () => {
    const cut = verdict(...gained, 'cut');
    const muscle = verdict(...gained, 'muscle');
    assert.equal(cut.kind, 'hold', 'cutting: flagged');
    assert.equal(muscle.kind, 'go', 'building: on target');
    assert.notEqual(cut.t, muscle.t, 'and they must not say the same thing');
  });

  await t.test('a healthy cut is a red flag for a bulk', () => {
    assert.equal(verdict(...lost, 'cut').gate, 'go');
    const muscle = verdict(...lost, 'muscle');
    assert.equal(muscle.gate, 'hold', 'you cannot add load while under-eating');
    assert.equal(muscle.kind, 'warn');
  });

  await t.test('a stalled scale nags a bulk but not a cut', () => {
    const flat = [{ weight: 102 }, { weight: 102 }];
    assert.equal(verdict(...flat, 'cut').kind, 'go');
    assert.equal(verdict(...flat, 'muscle').kind, 'hold');
    assert.equal(verdict(...flat, 'muscle').gate, 'go', 'still allowed to progress');
  });

  await t.test('recomp treats a flat scale as the goal', () => {
    assert.equal(verdict({ weight: 102.1 }, { weight: 102 }, 'recomp').kind, 'go');
  });

  await t.test('every goal returns the shape the views rely on', () => {
    for (const key of GOAL_KEYS) {
      const v = verdict(...gained, key);
      assert.ok(['go', 'hold'].includes(v.gate), `${key} gate`);
      assert.ok(['go', 'hold', 'warn'].includes(v.kind), `${key} kind`);
      assert.equal(typeof v.t, 'string');
      assert.ok(v.t.length > 0, `${key} needs a headline`);
      assert.ok(v.p, `${key} needs an explanation`);
    }
  });

  await t.test('an unknown goal falls back instead of throwing', () => {
    assert.deepEqual(verdict(...gained, 'nonsense'), verdict(...gained, 'cut'));
  });
});

test('goal-aware nutrition', async (t) => {
  await t.test('cutting subtracts and building adds', () => {
    assert.ok(safeTarget(3000, 'cut') < 3000);
    assert.ok(safeTarget(3000, 'muscle') > 3000);
    assert.equal(safeTarget(3000, 'fitness'), 3000, 'fitness eats at maintenance');
  });

  await t.test('a surplus is capped so bulking is not a free-for-all', () => {
    // +300 would be 2300 on a 2000 maintenance, but the cap is +10–15%.
    assert.ok(safeTarget(2000, 'muscle') <= Math.round(2000 * 1.15));
  });

  await t.test('protein scales with the goal', () => {
    assert.ok(proteinTarget(100, 'cut') > proteinTarget(100, 'fitness'));
  });
});

test('starting weights follow the level', async (t) => {
  await t.test('intermediate is the catalogue as written', () => {
    assert.deepEqual(baseWeights('cut', 'int'), baseWeights());
    assert.equal(baseWeights('cut', 'int').leg_press, exById('leg_press').base);
  });

  await t.test('beginner is lighter and advanced is heavier', () => {
    const beg = baseWeights('cut', 'beg').leg_press;
    const adv = baseWeights('cut', 'adv').leg_press;
    assert.ok(beg < exById('leg_press').base);
    assert.ok(adv > exById('leg_press').base);
  });

  // Only the scaled levels are checked. "int" is passed through verbatim on
  // purpose — a couple of catalogue values (lat_raise starts at 5 kg with a 2 kg
  // step) are not multiples of their own step, and rounding them would move an
  // existing user's starting weight.
  await t.test('scaled weights land on a real plate, not 38.7 kg', () => {
    for (const level of ['beg', 'adv']) {
      for (const [id, value] of Object.entries(baseWeights('cut', level))) {
        const step = exById(id).step;
        if (!step) continue;
        assert.equal(
          Math.round((value / step) * 1000) % 1000,
          0,
          `${id} at ${level} = ${value} is not a multiple of ${step}`
        );
      }
    }
  });

  await t.test('only the goal\'s own exercises are seeded', () => {
    const strength = baseWeights('strength', 'int');
    assert.ok('squat_bb' in strength, 'strength squats');
    assert.ok(!('plank' in strength), 'and does not carry a lift it never programmes');
  });
});

test('goals differ in substance, not just wording', async (t) => {
  await t.test('each goal has a distinct programme', () => {
    const shapes = GOAL_KEYS.map((key) => {
      const plan = planOf(key);
      return JSON.stringify(
        Object.values(plan).map((d) => d.ex.map((e) => `${e.id}:${e.sets}x${e.reps}`))
      );
    });
    assert.equal(new Set(shapes).size, GOAL_KEYS.length, 'no two goals share a programme');
  });

  await t.test('every programmed exercise exists in the catalogue', () => {
    for (const key of GOAL_KEYS) {
      for (const day of Object.values(planOf(key))) {
        assert.ok(day.ex.length > 0, `${key} has an empty day`);
        for (const e of day.ex) {
          assert.ok(exById(e.id), `${key} references unknown ${e.id}`);
          assert.ok(e.sets >= 1 && e.sets <= MAX_SETS, `${key}/${e.id} sets=${e.sets}`);
        }
      }
    }
  });

  await t.test('cardio load actually varies by goal', () => {
    const days = GOAL_KEYS.map((k) => cardioOf(k).filter((c) => !c.rest).length);
    assert.ok(Math.max(...days) > Math.min(...days), 'cardio volume must differ');
    for (const key of GOAL_KEYS) {
      assert.equal(cardioOf(key).length, 7, `${key} needs a full week`);
    }
  });

  await t.test('the fat-loss programme is unchanged', () => {
    // The historical programme, so nobody already using the app is moved.
    const plan = planOf('cut');
    assert.deepEqual(Object.keys(plan), ['sat', 'mon', 'wed']);
    assert.equal(plan.sat.ex[0].id, 'chest_db');
    assert.equal(plan.sat.ex[0].sets, 3);
    assert.equal(plan.sat.ex.length, 7);
    assert.equal(cardioOf('cut').filter((c) => !c.rest).length, 6);
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

  await t.test('height feeds into the estimate', () => {
    // BMR = 10×102 + 6.25×170 − 5×28 + 5 = 1947.5 → ×1.55
    assert.equal(tdeeFormula(102, 28, 1.55, 170), Math.round(1947.5 * 1.55));
    // A taller person at the same weight burns more.
    assert.ok(tdeeFormula(102, 28, 1.55, 190) > tdeeFormula(102, 28, 1.55, 170));
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

  // A link is optional: an exercise added without one verified is shipped
  // without it rather than pointing at a guess. What must never happen is a
  // link over plain http, or anything that is not a link at all.
  await t.test('a video link, when present, is https', () => {
    for (const id of EXERCISE_IDS) {
      const link = exById(id).v;
      if (link === undefined) continue;
      assert.match(link, /^https:\/\//, `${id} link must be https`);
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
