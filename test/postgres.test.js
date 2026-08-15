import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, makeClient, registerAndLogin, goodPassword } from './helpers.js';

/**
 * Guards for the three things that behave differently under Postgres than they
 * did under SQLite. Each of these was a real defect risk during the port, not a
 * hypothetical one.
 */
test('postgres behaviour', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  await t.test('a duplicate email is a 409, not a 500', async () => {
    // SQLite signalled this in the exception *message* ("UNIQUE"); Postgres
    // uses SQLSTATE 23505. Matching on the old text would have turned "that
    // email is taken" into a server error.
    const first = makeClient(app.origin);
    await registerAndLogin(first, 'twice@example.com');

    const second = await makeClient(app.origin).bootstrap();
    const res = await second.post('/api/auth/register', {
      email: 'twice@example.com',
      password: goodPassword,
    });

    assert.equal(res.status, 409);
    assert.equal(res.data.error, 'exists');
  });

  await t.test('counts come back as numbers, not strings', async () => {
    // node-postgres returns BIGINT as a string unless a type parser is set.
    // Without it `devices` would serialise as "1" and every millisecond
    // timestamp comparison would compare strings.
    const client = makeClient(app.origin);
    await registerAndLogin(client, 'counts@example.com');

    const me = await client.get('/api/auth/me');
    assert.equal(typeof me.data.devices, 'number', 'devices must be a number');
    assert.equal(me.data.devices, 1);

    const row = await app.db.one('SELECT COUNT(*) AS n FROM users');
    assert.equal(typeof row.n, 'number', 'COUNT(*) must be a number');

    const user = await app.db.one('SELECT created_at FROM users WHERE email_norm = $1', [
      'counts@example.com',
    ]);
    assert.equal(typeof user.created_at, 'number', 'BIGINT timestamps must be numbers');
  });

  await t.test('two devices syncing at once keep both weeks', async () => {
    // End-to-end check of the conflict merge: whichever request loses the race
    // is merged rather than rejected, so neither workout disappears.
    //
    // Honest limit: PGlite runs on a single connection, so it serialises these
    // two requests no matter what. This test therefore proves the *merge* is
    // right, but cannot prove the row lock is present — verified by the
    // separate structural test below, which is what has teeth here.
    const phone = makeClient(app.origin);
    await registerAndLogin(phone, 'race@example.com');

    const laptop = await makeClient(app.origin).bootstrap();
    await laptop.post('/api/auth/login', { email: 'race@example.com', password: goodPassword });

    const week = (n, exercise) => ({
      meta: { week: n },
      nutrition: null,
      weeks: { [n]: { ts: 1000 + n, sets: { [exercise]: [true, true, true] } } },
    });

    // Both start from version 0 and fire together.
    const [a, b] = await Promise.all([
      phone.put('/api/state', { baseVersion: 0, doc: week(1, 'chest_db') }),
      laptop.put('/api/state', { baseVersion: 0, doc: week(2, 'sh_press') }),
    ]);

    assert.ok([200, 409].includes(a.status), `unexpected ${a.status}`);
    assert.ok([200, 409].includes(b.status), `unexpected ${b.status}`);

    const final = await phone.get('/api/state');
    assert.ok(final.data.doc.weeks['1'], 'the phone’s week survived');
    assert.ok(final.data.doc.weeks['2'], 'the laptop’s week survived');
    assert.deepEqual(final.data.doc.weeks['1'].sets.chest_db, [true, true, true]);
    assert.deepEqual(final.data.doc.weeks['2'].sets.sh_press, [true, true, true]);
  });

  await t.test('the sync write takes a row lock', async () => {
    // The PUT handler is a read-modify-write. Under SQLite every write was
    // serialised, so a plain read was safe. Postgres runs transactions
    // concurrently: without SELECT ... FOR UPDATE both devices read version N,
    // both write N+1, and the loser's workout is silently erased.
    //
    // This is asserted structurally because the local engine (PGlite) is
    // single-connection and cannot reproduce the race — removing the lock
    // leaves every behavioural test still passing, which is exactly the kind
    // of regression that would otherwise reach production unnoticed.
    const source = await readFile(new URL('../server/routes/state.js', import.meta.url), 'utf8');
    assert.match(source, /FOR UPDATE/, 'the state row must be locked for the transaction');
    assert.match(
      source,
      /readRow\(t, req\.user\.userId, \{ lock: true \}\)/,
      'the PUT handler must take the lock, not just have it available'
    );
  });

  await t.test('a failed transaction rolls back completely', async () => {
    const before = await app.db.one('SELECT COUNT(*) AS n FROM login_attempts');
    await assert.rejects(
      app.db.tx(async (tx) => {
        await tx.run('INSERT INTO login_attempts (bucket, created_at) VALUES ($1, $2)', [
          'rollback-probe',
          Date.now(),
        ]);
        throw new Error('boom');
      }),
      /boom/
    );
    const after = await app.db.one('SELECT COUNT(*) AS n FROM login_attempts');
    assert.equal(after.n, before.n, 'the inserted row must not survive');
  });

  await t.test('migrations are recorded and do not re-run', async () => {
    const { rows } = await app.db.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(
      rows.map((r) => Number(r.version)),
      [1, 2]
    );
  });
});
