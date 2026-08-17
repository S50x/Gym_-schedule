import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeClient, registerAndLogin } from './helpers.js';
import { validateState, mergeStates } from '../server/state-schema.js';
import { MAX_SETS } from '../public/js/program.js';

const docWith = (weeks, extra = {}) => ({ meta: { week: 1 }, weeks, nutrition: null, ...extra });

test('state validation', async (t) => {
  await t.test('accepts a realistic document', () => {
    const res = validateState(
      docWith({
        1: {
          ts: 1700000000000,
          weights: { chest_db: 12.5 },
          sets: { chest_db: [true, true, false] },
          fb: { chest_db: 'light' },
          cardio: { 0: true },
          cmach: { 0: 'bike' },
          body: { weight: 101.4, muscle: 42.1 },
          cal: { d: [2100, 0, 0, 0, 0, 0, 0], p: [160, 0, 0, 0, 0, 0, 0] },
        },
      })
    );
    assert.equal(res.ok, true);
    assert.equal(res.doc.weeks['1'].weights.chest_db, 12.5);
  });

  await t.test('drops exercises that are not in the program', () => {
    const res = validateState(
      docWith({ 1: { weights: { chest_db: 10, evil_injected_id: 999 }, sets: {} } })
    );
    assert.equal(res.ok, true);
    assert.deepEqual(Object.keys(res.doc.weeks['1'].weights), ['chest_db']);
  });

  await t.test('strips unknown top-level keys instead of storing them', () => {
    const res = validateState({ ...docWith({}), attacker: '<img src=x onerror=alert(1)>' });
    assert.equal(res.ok, true);
    assert.equal(res.doc.attacker, undefined);
  });

  await t.test('rejects out-of-range numbers', () => {
    assert.equal(validateState(docWith({ 1: { weights: { chest_db: 99999 } } })).ok, false);
    assert.equal(validateState(docWith({ 1: { body: { weight: 5 } } })).ok, false);
    assert.equal(
      validateState(docWith({ 1: { cal: { d: [999999, 0, 0, 0, 0, 0, 0], p: [] } } })).ok,
      false
    );
  });

  await t.test('rejects values that are not numbers at all', () => {
    assert.equal(validateState(docWith({ 1: { weights: { chest_db: 'NaN' } } })).ok, false);
    assert.equal(validateState(docWith({ 1: { weights: { chest_db: Infinity } } })).ok, false);
    assert.equal(validateState(docWith({ 1: { fb: { chest_db: 'DROP TABLE' } } })).ok, false);
    assert.equal(validateState(docWith({ 1: { cmach: { 0: 'rocket' } } })).ok, false);
  });

  await t.test('a cardio day may be split across machines', () => {
    const res = validateState(
      docWith({ 1: { cmach: { 0: [{ k: 'bike', m: 20 }, { k: 'ellip', m: 20 }] } } })
    );
    assert.equal(res.ok, true);
    assert.deepEqual(res.doc.weeks['1'].cmach['0'], [
      { k: 'bike', m: 20 },
      { k: 'ellip', m: 20 },
    ]);
  });

  await t.test('a machine stored as a bare string still validates', () => {
    // What older clients wrote. Rejecting it would drop the day's machine.
    const res = validateState(docWith({ 1: { cmach: { 0: 'bike' } } }));
    assert.equal(res.ok, true);
    assert.equal(res.doc.weeks['1'].cmach['0'], 'bike');
  });

  await t.test('rejects bad machine splits', () => {
    const bad = [
      { 0: [{ k: 'rocket', m: 10 }] }, // unknown machine
      { 0: [{ k: 'bike', m: 10 }, { k: 'bike', m: 10 }] }, // duplicate
      { 0: [{ k: 'bike', m: -5 }] }, // negative minutes
      { 0: [{ k: 'bike', m: 9999 }] }, // absurd minutes
      { 0: [{ k: 'bike' }, { k: 'ellip' }, { k: 'row' }, { k: 'walk' }] }, // too many
      { 0: [{ m: 10 }] }, // no machine key
      { 0: ['bike'] }, // wrong element shape
    ];
    for (const cmach of bad) {
      assert.equal(validateState(docWith({ 1: { cmach } })).ok, false, JSON.stringify(cmach));
    }
  });

  await t.test('accepts a valid profile', () => {
    const res = validateState(docWith({}, { profile: { goal: 'muscle', level: 'adv', ts: 5 } }));
    assert.equal(res.ok, true);
    assert.deepEqual(res.doc.profile, { goal: 'muscle', level: 'adv', ts: 5 });
  });

  await t.test('a document with no profile is valid — that is every old one', () => {
    const res = validateState(docWith({}));
    assert.equal(res.ok, true);
    assert.equal(res.doc.profile, null);
  });

  await t.test('rejects a made-up goal or level', () => {
    const bad = [
      { goal: 'shredded' },
      { goal: '__proto__' },
      { goal: 'constructor' },
      { goal: 'muscle', level: 'pro' },
      { goal: 1 },
      { goal: ['muscle'] },
      { goal: 'muscle', ts: -1 },
    ];
    for (const profile of bad) {
      assert.equal(
        validateState(docWith({}, { profile })).ok,
        false,
        JSON.stringify(profile)
      );
    }
  });

  await t.test('a profile cannot smuggle extra keys through', () => {
    const res = validateState(
      docWith({}, { profile: { goal: 'cut', level: 'int', evil: 'x', ts: 1 } })
    );
    assert.equal(res.ok, true);
    assert.deepEqual(Object.keys(res.doc.profile).sort(), ['goal', 'level', 'ts']);
  });

  await t.test('rejects nonsense week keys', () => {
    for (const key of ['0', '-1', 'abc', '__proto__', '1.5', '99999']) {
      assert.equal(validateState(docWith({ [key]: {} })).ok, false, `key ${key} must be rejected`);
    }
  });

  await t.test('does not let a payload pollute Object.prototype', () => {
    const res = validateState(JSON.parse('{"weeks":{},"meta":{"week":1},"__proto__":{"polluted":1}}'));
    assert.equal(res.ok, true);
    assert.equal({}.polluted, undefined);
  });

  await t.test('bounds stored sets by the programme-wide maximum', () => {
    // The limit is deliberately not the exercise's own set count, which now
    // depends on the goal. A lift run for five sets under "strength" must stay
    // valid after switching to a three-set goal — otherwise the switch would
    // make the whole document unsyncable.
    assert.equal(
      validateState(docWith({ 1: { sets: { chest_db: Array(MAX_SETS).fill(true) } } })).ok,
      true,
      'a document saved under a higher-set goal must survive a goal switch'
    );
    assert.equal(
      validateState(docWith({ 1: { sets: { chest_db: Array(MAX_SETS + 1).fill(true) } } })).ok,
      false,
      'but nothing beyond the programme maximum is storable'
    );
  });

  await t.test('merges two devices by week timestamp', () => {
    const phone = validateState(
      docWith({ 1: { ts: 200, sets: { chest_db: [true, true, true] } }, 2: { ts: 100 } })
    ).doc;
    const laptop = validateState(
      docWith({ 1: { ts: 100, sets: { chest_db: [true, false, false] } }, 3: { ts: 300 } })
    ).doc;

    const merged = mergeStates(phone, laptop);
    assert.deepEqual(merged.weeks['1'].sets.chest_db, [true, true, true], 'newer week 1 wins');
    assert.ok(merged.weeks['2'], 'week only on one side is kept');
    assert.ok(merged.weeks['3'], 'week only on the other side is kept');
  });

  await t.test('the most recent goal change wins the merge', () => {
    const older = validateState(docWith({}, { profile: { goal: 'cut', level: 'int', ts: 100 } })).doc;
    const newer = validateState(
      docWith({}, { profile: { goal: 'muscle', level: 'adv', ts: 300 } })
    ).doc;

    assert.equal(mergeStates(older, newer).profile.goal, 'muscle', 'newer incoming wins');
    assert.equal(mergeStates(newer, older).profile.goal, 'muscle', 'older incoming does not undo it');
  });

  await t.test('a device that has no profile does not erase one', () => {
    const withProfile = validateState(
      docWith({}, { profile: { goal: 'strength', level: 'int', ts: 50 } })
    ).doc;
    const without = validateState(docWith({})).doc;
    assert.equal(mergeStates(withProfile, without).profile?.goal, 'strength');
  });

  await t.test('switching to a goal with fewer sets keeps the document syncable', () => {
    // A strength user logs five sets, then switches to a three-set goal. The
    // stored array is longer than the new goal asks for and must still validate,
    // or every later sync would 400 and their history would stop moving.
    const logged = docWith(
      { 1: { sets: { squat_bb: [true, true, true, true, true] } } },
      { profile: { goal: 'strength', level: 'int', ts: 1 } }
    );
    assert.equal(validateState(logged).ok, true);

    const switched = { ...logged, profile: { goal: 'cut', level: 'int', ts: 2 } };
    assert.equal(validateState(switched).ok, true, 'still valid after the switch');
    assert.deepEqual(validateState(switched).doc.weeks['1'].sets.squat_bb.length, 5);
  });
});

test('state sync API', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('round-trips a document and bumps the version', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'sync1@example.com');

    const initial = await client.get('/api/state');
    assert.equal(initial.data.version, 0);

    const saved = await client.put('/api/state', {
      baseVersion: 0,
      doc: docWith({ 1: { ts: 1, weights: { chest_db: 14 } } }),
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.version, 1);

    const reread = await client.get('/api/state');
    assert.equal(reread.data.doc.weeks['1'].weights.chest_db, 14);
  });

  await t.test('a second device sees the first device’s data', async () => {
    const phone = makeClient(app.origin);
    await registerAndLogin(phone, 'twodev@example.com');
    await phone.put('/api/state', {
      baseVersion: 0,
      doc: docWith({ 3: { ts: 10, body: { weight: 99.5, muscle: null } } }, { meta: { week: 3 } }),
    });

    const laptop = await makeClient(app.origin).bootstrap();
    await laptop.post('/api/auth/login', {
      email: 'twodev@example.com',
      password: 'correct-horse-battery-9',
    });
    const res = await laptop.get('/api/state');
    assert.equal(res.data.doc.meta.week, 3);
    assert.equal(res.data.doc.weeks['3'].body.weight, 99.5);
  });

  await t.test('a stale write is merged, not silently lost', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'conflict@example.com');

    await client.put('/api/state', {
      baseVersion: 0,
      doc: docWith({ 1: { ts: 500, sets: { chest_db: [true, true, true] } } }),
    });

    // Second device still thinks the version is 0 and edits a different week.
    const stale = await client.put('/api/state', {
      baseVersion: 0,
      doc: docWith({ 2: { ts: 600, sets: { sh_press: [true, false, false] } } }),
    });

    assert.equal(stale.status, 409);
    assert.equal(stale.data.merged, true);
    assert.deepEqual(stale.data.doc.weeks['1'].sets.chest_db, [true, true, true], 'week 1 kept');
    assert.ok(stale.data.doc.weeks['2'], 'week 2 kept');
  });

  await t.test('rejects a bad baseVersion', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'badver@example.com');
    const res = await client.put('/api/state', { baseVersion: -1, doc: docWith({}) });
    assert.equal(res.status, 400);
  });

  await t.test('rejects an invalid document without touching what is stored', async () => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'reject@example.com');
    await client.put('/api/state', { baseVersion: 0, doc: docWith({ 1: { ts: 1, weights: { chest_db: 20 } } }) });

    const bad = await client.put('/api/state', {
      baseVersion: 1,
      doc: docWith({ 1: { weights: { chest_db: -50 } } }),
    });
    assert.equal(bad.status, 400);

    const after = await client.get('/api/state');
    assert.equal(after.data.doc.weeks['1'].weights.chest_db, 20, 'stored data unchanged');
    assert.equal(after.data.version, 1);
  });
});
