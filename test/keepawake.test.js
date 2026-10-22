import test from 'node:test';
import assert from 'node:assert/strict';
import { keepAwakeUrl, startKeepAwake } from '../server/keepawake.js';

test('keep-awake: where it pings', async (t) => {
  await t.test('off unless asked for', () => {
    assert.equal(keepAwakeUrl({ RENDER_EXTERNAL_URL: 'https://a.onrender.com' }), null);
    assert.equal(keepAwakeUrl({ KEEP_AWAKE: '0', ORIGIN: 'https://a.example' }), null);
  });
  await t.test("prefers Render's own URL, then ORIGIN", () => {
    assert.equal(
      keepAwakeUrl({ KEEP_AWAKE: '1', RENDER_EXTERNAL_URL: 'https://a.onrender.com', ORIGIN: 'https://b.example' }),
      'https://a.onrender.com/api/health'
    );
    assert.equal(keepAwakeUrl({ KEEP_AWAKE: '1', ORIGIN: 'https://b.example' }), 'https://b.example/api/health');
  });
  await t.test('an explicit KEEP_AWAKE_URL wins', () => {
    assert.equal(
      keepAwakeUrl({ KEEP_AWAKE: '1', KEEP_AWAKE_URL: 'https://c.example', RENDER_EXTERNAL_URL: 'https://a.onrender.com' }),
      'https://c.example/api/health'
    );
  });
  await t.test('nowhere valid → off, never a plain-http or garbage target', () => {
    assert.equal(keepAwakeUrl({ KEEP_AWAKE: '1' }), null);
    assert.equal(keepAwakeUrl({ KEEP_AWAKE: '1', ORIGIN: 'http://localhost:3000' }), null);
    assert.equal(keepAwakeUrl({ KEEP_AWAKE: '1', ORIGIN: 'not a url' }), null);
  });
});

test('keep-awake: pinging', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = [];
  const logs = [];
  let ok = true;
  const fetchImpl = async (url) => {
    calls.push(url);
    if (!ok) throw new Error('down');
    return { ok: true, status: 200 };
  };
  const log = { log: (m) => logs.push(m), warn: (m) => logs.push(m) };
  const timer = startKeepAwake('https://a.onrender.com/api/health', { intervalMs: 1000, fetchImpl, log });

  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['https://a.onrender.com/api/health']);
  assert.deepEqual(logs, []);

  // A failure is reported once, not on every tick, then recovery is noted.
  ok = false;
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.equal(logs.filter((m) => m.includes('failed')).length, 1);
  ok = true;
  t.mock.timers.tick(1000);
  await new Promise(setImmediate);
  assert.ok(logs.at(-1).includes('back to normal'));
  assert.equal(calls.length, 4);
  clearInterval(timer);
});
