import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXERCISES,
  ALL_EXERCISES,
  GROUPS,
  GROUP_KEYS,
  LEVELS,
  LEVEL_KEYS,
  GOAL_KEYS,
  groupCount,
  levelForGroup,
  baseWeights,
} from '../public/js/program.js';
import { validateState } from '../server/state-schema.js';

const docWith = (profile) => ({
  schema: 1,
  meta: { week: 1 },
  weeks: {},
  nutrition: null,
  profile,
});

test('muscle groups', async (t) => {
  await t.test('every exercise carries a group, and it is a known one', () => {
    const known = new Set(['push', 'pull', 'legs', 'core']);
    for (const e of ALL_EXERCISES) {
      assert.ok(e.g, `${e.id} has no group`);
      assert.ok(known.has(e.g), `${e.id} has unknown group ${e.g}`);
    }
  });

  await t.test('every offered group actually holds exercises', () => {
    for (const key of GROUP_KEYS) {
      assert.ok(groupCount(key) > 0, `${key} is offered but empty`);
    }
  });

  await t.test('the offered groups are a subset of the tagged ones', () => {
    const tagged = new Set(ALL_EXERCISES.map((e) => e.g));
    for (const key of GROUP_KEYS) assert.ok(tagged.has(key), `${key} is not tagged on anything`);
  });

  await t.test('GROUPS entries are complete enough to render', () => {
    for (const g of GROUPS) {
      assert.ok(g.k && g.n && g.sub, `group ${g.k} is missing a label`);
    }
  });

  /* ── levelForGroup ── */

  await t.test('a group with no override follows the overall level', () => {
    assert.equal(levelForGroup('legs', 'adv', null), 'adv');
    assert.equal(levelForGroup('legs', 'adv', {}), 'adv');
    assert.equal(levelForGroup('legs', 'adv', { push: 'beg' }), 'adv');
  });

  await t.test('an override wins for its own group only', () => {
    const levels = { legs: 'beg' };
    assert.equal(levelForGroup('legs', 'adv', levels), 'beg');
    assert.equal(levelForGroup('push', 'adv', levels), 'adv');
  });

  await t.test('a nonsense override or level falls back instead of throwing', () => {
    assert.equal(levelForGroup('legs', 'int', { legs: 'superhuman' }), 'int');
    assert.equal(levelForGroup('legs', 'made-up'), 'int');
    assert.equal(levelForGroup('unknown-group', 'adv'), 'adv');
  });

  /* ── baseWeights ── */

  await t.test('no overrides reproduces the old numbers exactly', () => {
    for (const goal of GOAL_KEYS) {
      for (const level of LEVEL_KEYS) {
        assert.deepEqual(
          baseWeights(goal, level, null),
          baseWeights(goal, level),
          `${goal}/${level} drifted`
        );
        assert.deepEqual(baseWeights(goal, level, {}), baseWeights(goal, level));
      }
    }
  });

  await t.test('an override moves its own group and nothing else', () => {
    const plain = baseWeights('strength', 'int');
    const legsBeg = baseWeights('strength', 'int', { legs: 'beg' });

    let moved = 0;
    for (const [id, before] of Object.entries(plain)) {
      const after = legsBeg[id];
      const e = EXERCISES[id];
      if (e.g === 'legs' && !e.body && e.base) {
        if (before !== after) moved++;
      } else {
        assert.equal(after, before, `${id} (${e.g}) moved but should not have`);
      }
    }
    assert.ok(moved > 0, 'no leg weight changed at all');
  });

  await t.test('a per-group override equals setting that level overall', () => {
    // Every leg movement on `beg` overall must match the same movement when
    // only legs are `beg` — that is what "this group is at that level" means.
    const allBeg = baseWeights('strength', 'beg');
    const legsBeg = baseWeights('strength', 'int', { legs: 'beg' });
    for (const [id, weight] of Object.entries(legsBeg)) {
      if (EXERCISES[id].g === 'legs') assert.equal(weight, allBeg[id], id);
    }
  });

  await t.test('two groups can differ at once', () => {
    const mixed = baseWeights('strength', 'int', { legs: 'beg', push: 'adv' });
    const allBeg = baseWeights('strength', 'beg');
    const allAdv = baseWeights('strength', 'adv');
    const plain = baseWeights('strength', 'int');
    for (const [id, weight] of Object.entries(mixed)) {
      const g = EXERCISES[id].g;
      const expected = g === 'legs' ? allBeg[id] : g === 'push' ? allAdv[id] : plain[id];
      assert.equal(weight, expected, `${id} (${g})`);
    }
  });

  await t.test('bodyweight movements ignore the level entirely', () => {
    const a = baseWeights('cut', 'int');
    const b = baseWeights('cut', 'int', { push: 'adv', pull: 'beg', legs: 'adv' });
    for (const [id, weight] of Object.entries(a)) {
      const e = EXERCISES[id];
      if (e.body || !e.base) assert.equal(b[id], weight, `${id} should not scale`);
    }
  });

  /* ── the synced document ── */

  await t.test('the server keeps a valid set of overrides', () => {
    const res = validateState(
      docWith({ goal: 'cut', level: 'int', levels: { legs: 'beg', push: 'adv' }, ts: 1 })
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.doc.profile.levels, { legs: 'beg', push: 'adv' });
  });

  await t.test('an unknown group is dropped, a bad level is refused', () => {
    const dropped = validateState(
      docWith({ goal: 'cut', level: 'int', levels: { legs: 'beg', wings: 'adv' }, ts: 1 })
    );
    assert.equal(dropped.ok, true);
    assert.deepEqual(dropped.doc.profile.levels, { legs: 'beg' }, 'unknown group must not persist');

    for (const levels of [{ legs: 'superhuman' }, { push: 1 }, { pull: {} }]) {
      assert.equal(validateState(docWith({ goal: 'cut', levels, ts: 1 })).ok, false);
    }
  });

  await t.test('prototype keys cannot ride in as groups', () => {
    const res = validateState(
      docWith({ goal: 'cut', level: 'int', levels: { __proto__: 'adv', constructor: 'adv' }, ts: 1 })
    );
    assert.equal(res.ok, true);
    assert.equal(res.doc.profile.levels, null);
    assert.equal({}.adv, undefined, 'prototype untouched');
  });

  await t.test('an empty or absent set is stored as nothing', () => {
    for (const levels of [undefined, null, {}]) {
      const res = validateState(docWith({ goal: 'cut', level: 'int', levels, ts: 1 }));
      assert.equal(res.ok, true);
      assert.equal(res.doc.profile.levels, null);
    }
  });

  await t.test('a document written before this feature still validates', () => {
    const res = validateState(docWith({ goal: 'cut', level: 'int', startWeight: 90, ts: 1 }));
    assert.equal(res.ok, true);
    assert.equal(res.doc.profile.levels, null);
    assert.equal(res.doc.profile.goal, 'cut');
  });

  await t.test('every level key is renderable in a chip', () => {
    for (const key of LEVEL_KEYS) assert.ok(LEVELS[key].n, `${key} has no Arabic name`);
  });
});
