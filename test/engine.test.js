import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verdict,
  progress,
  dayVolume,
  tdeeFormula,
  safeTarget,
  proteinTarget,
  effectiveTdee,
  dailyTarget,
  goalReview,
  measuredTDEE,
  avgCal,
  todayKey,
  formatRest,
} from '../public/js/engine.js';
import { FIGURE_IDS, figureOf, hasFigure } from '../public/js/figure.js';
import {
  PLAN,
  ALL_EXERCISES,
  baseWeights,
  clashesOf,
  clashesWith,
  migrateSetsKeys,
  setsByExercise,
  setsKey,
  setsOfDay,
  exById,
  EXERCISE_IDS,
  fineStep,
  goalHasLoads,
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

test('the button notch and the weekly jump are different numbers', async (t) => {
  await t.test('a movement without its own notch falls back to the weekly step', () => {
    const machine = exById('leg_press');
    assert.equal(machine.fine, undefined, 'a stack has no finer notch than its pin');
    assert.equal(fineStep(machine), machine.step);
  });

  await t.test('the dumbbells reach the halves on the rack', () => {
    for (const id of ['chest_db', 'sh_press', 'curl', 'rdl']) {
      assert.equal(fineStep(exById(id)), 0.5, `${id} must move in halves`);
    }
  });

  await t.test('a barbell moves by the smallest pair of plates', () => {
    for (const id of ['squat_bb', 'dead_bb', 'hip_thrust']) {
      assert.equal(fineStep(exById(id)), 2.5, `${id} cannot change by less than a 1.25 pair`);
    }
  });

  await t.test('no notch is coarser than the weekly jump, or zero', () => {
    for (const e of ALL_EXERCISES) {
      if (e.body) {
        assert.equal(e.fine, undefined, `${e.id} carries no load to notch`);
        continue;
      }
      const fine = fineStep(e);
      assert.ok(fine > 0, `${e.id} must be adjustable`);
      // A movement with no weekly jump at all — a stretch held for 30 seconds
      // that must stay 30 seconds — is still adjustable by hand. Only a
      // movement that DOES progress can have its week outrun by one tap.
      if (e.step > 0) {
        assert.ok(fine <= e.step, `${e.id}: a button must never outrun the weekly jump`);
      }
    }
  });

  await t.test('a movement that never progresses stays put', () => {
    // The stretches are `step: 0` on purpose: 30 seconds must still be 30
    // seconds a year from now, not five minutes.
    const v = { gate: 'go' };
    for (const id of ['str_ham', 'str_back']) {
      const e = exById(id);
      const log = { sets: { [id]: Array.from({ length: e.sets }, () => true) }, fb: {} };
      assert.equal(progress({ [id]: 30 }, log, v)[id], 30, `${id} crept`);
    }
  });

  await t.test('a load reachable by the buttons is one the store can hold', () => {
    // The document keeps one decimal, so a notch finer than 0.1 would round
    // away and the button would appear to do nothing.
    for (const e of ALL_EXERCISES) {
      const fine = fineStep(e);
      assert.equal(Math.round(fine * 10) / 10, fine, `${e.id} notch survives rounding`);
    }
  });
});

test('a goal with no iron in it', async (t) => {
  await t.test('every movement it programmes is bodyweight or timed', () => {
    for (const day of Object.values(planOf('cardio'))) {
      for (const e of day.ex) {
        assert.ok(e.body || e.time, `cardio programmes ${e.id}, which carries a load`);
      }
    }
    assert.equal(goalHasLoads('cardio'), false);
  });

  await t.test('and it is the only one — the other five all lift', () => {
    for (const key of GOAL_KEYS) {
      if (key !== 'cardio') assert.equal(goalHasLoads(key), true, `${key} lost its lifts`);
    }
  });

  await t.test('six training days and six days of cardio', () => {
    assert.equal(Object.keys(planOf('cardio')).length, 6);
    assert.equal(cardioOf('cardio').filter((c) => !c.rest).length, 6);
    assert.equal(cardioOf('cardio').length, 7, 'a full week');
  });

  await t.test('every exercise states its own sets and reps', () => {
    // The trainee asked to see the rounds and the reps, so nothing here may
    // fall back to a catalogue default that was tuned for a different goal.
    for (const day of Object.values(planOf('cardio'))) {
      for (const e of day.ex) {
        assert.ok(e.sets >= 1, `${e.id} has no sets`);
        assert.ok(String(e.reps).length > 0, `${e.id} has no reps`);
      }
    }
  });

  await t.test('it speaks its own language, never the barbell\'s', () => {
    const said = [];
    for (const cur of [{ weight: 97 }, { weight: 99.4 }, { weight: 101 }]) {
      const v = verdict(cur, { weight: 100 }, 'cardio');
      said.push(v.t);
      const prose = [v.t, ...v.p.map((x) => (typeof x === 'string' ? x : x.b))].join(' ');
      assert.ok(!prose.includes('الأوزان'), `cardio verdict talks about weights: ${v.t}`);
    }
    // and not a silent fallback onto the fat-loss copy
    const cut = [{ weight: 97 }, { weight: 99.4 }, { weight: 101 }].map(
      (cur) => verdict(cur, { weight: 100 }, 'cut').t
    );
    assert.notDeepEqual(said, cut);
  });
});

test('every video link is a real link', async (t) => {
  await t.test('parses as https, and nothing points at a placeholder', () => {
    for (const e of ALL_EXERCISES) {
      if (!e.v) continue;
      const url = new URL(e.v);
      assert.equal(url.protocol, 'https:', `${e.id} is not https`);
      assert.ok(e.vlbl, `${e.id} has a link with no label`);
      assert.ok(!/example\.com|TODO|watch\?v=$/i.test(e.v), `${e.id} points at a placeholder`);
    }
  });

  await t.test('no two movements share one clip by accident', () => {
    // lat_pull and pullup deliberately share one; nothing else may.
    const byUrl = new Map();
    for (const e of ALL_EXERCISES) {
      if (!e.v) continue;
      byUrl.set(e.v, [...(byUrl.get(e.v) || []), e.id]);
    }
    const shared = [...byUrl.values()].filter((ids) => ids.length > 1);
    assert.deepEqual(shared, [['lat_pull', 'pullup']], 'unexpected duplicate clips');
  });

  await t.test('the movements this programme leans on all have one', () => {
    // Bodyweight form is the whole safety margin here — nobody should have to
    // guess what a bird dog looks like.
    for (const id of ['pushup', 'pushup_inc', 'crunch', 'plank', 'side_plank', 'birddog',
                      'glute_bridge', 'superman', 'str_ham', 'str_hipflex', 'str_calf',
                      'str_chest', 'str_back']) {
      assert.ok(exById(id).v, `${id} needs an explainer clip`);
    }
  });
});

test('a set log belongs to a day, not just to an exercise', async (t) => {
  const done = (n) => Array.from({ length: n }, () => true);

  await t.test('finishing one day leaves the same movement untouched elsewhere', () => {
    // The bug this exists for: `cardio` stretches the hamstrings on five days,
    // and one flat record per exercise meant ticking Tuesday ticked all five.
    const week = { sets: { [setsKey('tue', 'str_ham')]: done(2) } };
    assert.deepEqual(setsOfDay(week, 'tue'), { str_ham: [true, true] });
    for (const day of ['sun', 'thu', 'sat', 'wed']) {
      assert.deepEqual(setsOfDay(week, day), {}, `${day} was marked done by Tuesday`);
    }
  });

  await t.test('the goal really does repeat movements — that is the point', () => {
    const days = new Map();
    for (const [day, d] of Object.entries(planOf('cardio'))) {
      for (const e of d.ex) days.set(e.id, [...(days.get(e.id) || []), day]);
    }
    assert.ok(days.get('str_ham').length >= 3, 'the hamstring stretch must repeat');
  });

  await t.test('a movement rises only when every day it is on is finished', () => {
    const partial = { sets: { [setsKey('sat', 'plank')]: done(3) } };
    const folded = setsByExercise(partial, 'cardio');
    assert.ok(!folded.plank.every(Boolean), 'Saturday alone must not count as the week');

    const both = {
      sets: {
        [setsKey('sat', 'plank')]: done(3),
        [setsKey('wed', 'plank')]: done(3),
      },
    };
    assert.deepEqual(setsByExercise(both, 'cardio').plank, [true, true, true]);
  });

  await t.test('a goal that never repeats reads exactly as it always did', () => {
    const week = { sets: { [setsKey('sat', 'chest_db')]: done(3) } };
    assert.deepEqual(setsByExercise(week, 'cut').chest_db, [true, true, true]);
  });

  await t.test('an old flat log is lifted onto the day that programmes it', () => {
    const migrated = migrateSetsKeys({ chest_db: done(3), leg_press: done(3) }, 'cut');
    assert.deepEqual(migrated, {
      [setsKey('sat', 'chest_db')]: done(3),
      [setsKey('mon', 'leg_press')]: done(3),
    });
  });

  await t.test('migrating twice changes nothing', () => {
    const once = migrateSetsKeys({ chest_db: done(3) }, 'cut');
    assert.deepEqual(migrateSetsKeys(once, 'cut'), once);
  });

  await t.test('history under another goal is kept, never tidied away', () => {
    // squat_bb is not in the fat-loss programme. Dropping the key to make the
    // shape neat would be deleting a record the user gets back on switching.
    const kept = migrateSetsKeys({ squat_bb: done(5) }, 'cut');
    assert.deepEqual(kept, { squat_bb: done(5) });
    assert.deepEqual(migrateSetsKeys(kept, 'strength'), { [setsKey('sat', 'squat_bb')]: done(5) });
  });

  await t.test('junk in the log never becomes a key', () => {
    assert.deepEqual(migrateSetsKeys(null, 'cut'), {});
    assert.deepEqual(migrateSetsKeys({ chest_db: 'nope' }, 'cut'), {});
    assert.deepEqual(setsOfDay({ sets: { 'sat:chest_db': 'nope' } }, 'sat'), {});
  });
});

test('the teaching figures', async (t) => {
  const BOX = { x: 120, y: 80 };

  await t.test('every movement the cardio goal programmes has one', () => {
    const need = new Set(
      Object.values(planOf('cardio')).flatMap((d) => d.ex.map((e) => e.id))
    );
    for (const id of need) assert.ok(hasFigure(id), `${id} has no figure`);
  });

  await t.test('and no figure is drawn for a movement that does not exist', () => {
    for (const id of FIGURE_IDS) assert.ok(exById(id), `figure for unknown ${id}`);
    assert.equal(figureOf('nonsense'), null);
  });

  await t.test('both ends of every rep are a full six-joint chain', () => {
    // wrist · elbow · shoulder · hip · knee · ankle — the polyline is the body,
    // so a short chain silently drops a limb.
    for (const id of FIGURE_IDS) {
      const fig = figureOf(id);
      for (const end of ['a', 'b']) {
        assert.equal(fig[end].p.length, 6, `${id}.${end} is not six joints`);
        assert.equal(fig[end].head.length, 2, `${id}.${end} head`);
      }
    }
  });

  await t.test('nothing is drawn outside the box it is drawn in', () => {
    for (const id of FIGURE_IDS) {
      const fig = figureOf(id);
      for (const end of ['a', 'b']) {
        for (const [x, y] of [...fig[end].p, fig[end].head]) {
          assert.ok(x >= 0 && x <= BOX.x, `${id}.${end}: x=${x} off canvas`);
          assert.ok(y >= 0 && y <= BOX.y, `${id}.${end}: y=${y} off canvas`);
        }
      }
    }
  });

  await t.test('nobody stands below the floor', () => {
    // The floor is at y=67.5; a joint under it reads as sinking through it.
    for (const id of FIGURE_IDS) {
      const fig = figureOf(id);
      for (const end of ['a', 'b']) {
        for (const [, y] of fig[end].p) {
          assert.ok(y <= 68, `${id}.${end}: a joint at y=${y} is under the floor`);
        }
      }
    }
  });

  await t.test('the two ends actually differ, or it is not a movement', () => {
    for (const id of FIGURE_IDS) {
      const fig = figureOf(id);
      const moved = fig.a.p.reduce(
        (most, [x, y], i) => Math.max(most, Math.hypot(x - fig.b.p[i][0], y - fig.b.p[i][1])),
        0
      );
      // Plank and side plank are holds: they breathe rather than travel.
      const floor = ['plank', 'side_plank'].includes(id) ? 1 : 8;
      assert.ok(moved >= floor, `${id} barely moves (${moved.toFixed(1)})`);
      assert.ok(moved <= 60, `${id} teleports (${moved.toFixed(1)})`);
    }
  });

  await t.test('every movement says which muscle it is for', () => {
    // Marking the worked muscle is the one thing a photograph of a stranger
    // cannot do, so no figure ships without it.
    for (const id of FIGURE_IDS) {
      const { muscle } = figureOf(id);
      assert.ok(Array.isArray(muscle) && muscle.length, `${id} marks no muscle`);
      for (const m of muscle) {
        assert.ok(m.seg >= 0 && m.seg <= 4, `${id} marks segment ${m.seg}`);
        assert.ok(m.from >= 0 && m.to <= 1, `${id} marks ${m.from}..${m.to}`);
        assert.ok(m.to - m.from >= 0.15, `${id}'s mark is too short to see`);
      }
    }
  });

  await t.test('every rep has a sane tempo', () => {
    for (const id of FIGURE_IDS) {
      const { dur } = figureOf(id);
      assert.ok(dur >= 2 && dur <= 8, `${id} loops in ${dur}s`);
    }
  });
});

test('machines that fight each other', async (t) => {
  await t.test('names the pair and says why', () => {
    const [clash] = clashesOf(['ellip', 'stair']);
    assert.ok(clash, 'the knee pair must be flagged');
    assert.deepEqual([clash.a, clash.b], ['ellip', 'stair']);
    assert.ok(clash.why.length > 10, 'a flag with no reason is noise');
    assert.equal(clashesOf(['bike', 'row']).length, 1);
  });

  await t.test('order never matters', () => {
    assert.deepEqual(clashesOf(['stair', 'ellip']), clashesOf(['ellip', 'stair']));
    assert.deepEqual(clashesWith('ellip'), ['stair']);
    assert.deepEqual(clashesWith('stair'), ['ellip']);
  });

  await t.test('a sane day is left alone', () => {
    for (const day of [['walk'], ['walk', 'bike'], ['ellip', 'row'], [], ['stair']]) {
      assert.deepEqual(clashesOf(day), [], `${day.join('+')} must not be flagged`);
    }
  });

  await t.test('nothing conflicts with itself, and unknown keys are ignored', () => {
    assert.deepEqual(clashesOf(['bike', 'bike']), []);
    assert.deepEqual(clashesOf(['nonsense']), []);
    assert.deepEqual(clashesWith('nonsense'), []);
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

test('the calorie target follows the body', async (t) => {
  const nut = { age: 30, height: 180, act: 1.55 };

  await t.test('losing weight lowers maintenance and the target', () => {
    const heavy = dailyTarget(nut, 100, 'cut');
    const lighter = dailyTarget(nut, 85, 'cut');
    assert.ok(lighter < heavy, `${lighter} should be under ${heavy}`);
    // 15 kg is worth well over a hundred calories a day; a frozen target would
    // have had them eating for the body they used to have.
    assert.ok(heavy - lighter > 150, `difference was only ${heavy - lighter}`);
  });

  await t.test('a measured maintenance overrides the formula', () => {
    const measured = { ...nut, measuredTdee: 2400 };
    assert.equal(effectiveTdee(measured, 100), 2400);
    assert.equal(dailyTarget(measured, 100, 'cut'), safeTarget(2400, 'cut'));
  });

  await t.test('the same weight gives different targets per goal', () => {
    const targets = GOAL_KEYS.map((k) => dailyTarget(nut, 90, k));
    assert.equal(new Set(targets).size, GOAL_KEYS.length);
  });

  await t.test('falls back to the stored figure when there is nothing to compute from', () => {
    assert.equal(effectiveTdee({ tdee: 2500 }, null), 2500);
    assert.equal(effectiveTdee(null, 90), null);
  });
});

test('the goal is reviewed, not set and forgotten', async (t) => {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  await t.test('stays quiet on a fresh goal with little change', () => {
    const profile = { goal: 'cut', level: 'int', startWeight: 100, ts: now - WEEK_MS };
    assert.equal(goalReview({ profile, weight: 99, goalKey: 'cut', now }), null);
  });

  await t.test('speaks up once the body has moved far enough', () => {
    const profile = { goal: 'cut', level: 'int', startWeight: 100, ts: now - WEEK_MS };
    const review = goalReview({ profile, weight: 92, goalKey: 'cut', now });
    assert.ok(review, 'an 8% drop should prompt a review');
    assert.match(review.t, /نزلت/);
  });

  await t.test('reads the direction, so a bulk is told it gained', () => {
    const profile = { goal: 'muscle', level: 'int', startWeight: 80, ts: now - WEEK_MS };
    const review = goalReview({ profile, weight: 87, goalKey: 'muscle', now });
    assert.ok(review);
    assert.match(review.t, /زدت/);
  });

  await t.test('speaks up on time alone, even if the scale barely moved', () => {
    const profile = { goal: 'cut', level: 'int', startWeight: 100, ts: now - 9 * WEEK_MS };
    assert.ok(goalReview({ profile, weight: 99.5, goalKey: 'cut', now }));
  });

  await t.test('says nothing without a profile', () => {
    assert.equal(goalReview({ profile: null, weight: 90, now }), null);
    assert.equal(goalReview({ profile: { goal: 'cut' }, weight: 90, now }), null);
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
