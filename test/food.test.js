import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, makeClient, registerAndLogin, resetRateLimits } from './helpers.js';

// After helpers.js: it sets ORIGIN and SESSION_SECRET before anything reads
// config.js, and a static import here could be evaluated ahead of that.
const { setGeminiClientFactory, cleanReading } = await import('../server/gemini.js');
const { encryptSecret, decryptSecret } = await import('../server/secrets.js');

/**
 * Food scanning with the user's own Gemini key. Google is never called: the
 * SDK client is swapped for a fake that records what it was handed.
 */

const GOOD_KEY = 'AIzaSyD-test-key-0123456789abcdefWXYZ';
const IMAGE = Buffer.from('fake jpeg bytes').toString('base64');

let calls = [];
let answer = null;
let failWith = null;

setGeminiClientFactory((apiKey) => ({
  models: {
    async get() {
      calls.push({ op: 'get', apiKey });
      if (apiKey !== GOOD_KEY) throw Object.assign(new Error('API key not valid'), { status: 400 });
      return {};
    },
    async generateContent(req) {
      calls.push({ op: 'generate', apiKey, req });
      if (failWith) throw failWith;
      return { text: JSON.stringify(answer) };
    },
  },
}));

const LABEL = {
  kind: 'label',
  meal_name: 'لبن المراعي',
  serving: '200 مل',
  per: 'serving',
  kcal: 120,
  protein: 6.4,
  fat: 6,
  carbs: 9.2,
  found: { name: true, kcal: true, protein: true, fat: true, carbs: true },
  items: [],
  confidence: 0.95,
  note: '',
};

test('secret encryption', async (t) => {
  await t.test('round-trips, and a tampered row reads as nothing', () => {
    const sealed = encryptSecret(GOOD_KEY);
    assert.ok(!sealed.ciphertext.includes('AIza'));
    assert.equal(decryptSecret(sealed), GOOD_KEY);
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] ^= 1;
    assert.equal(decryptSecret({ ...sealed, ciphertext: flipped.toString('base64') }), null);
    assert.equal(decryptSecret({ ...sealed, tag: Buffer.alloc(16).toString('base64') }), null);
  });

  await t.test('the same key never seals to the same bytes twice', () => {
    assert.notEqual(encryptSecret(GOOD_KEY).ciphertext, encryptSecret(GOOD_KEY).ciphertext);
  });
});

test('reading a model answer', async (t) => {
  await t.test('values not found come back null, not a made-up zero', () => {
    const r = cleanReading({
      ...LABEL,
      fat: 0,
      carbs: 0,
      found: { ...LABEL.found, fat: false, carbs: false },
    });
    assert.equal(r.kcal, 120);
    assert.equal(r.fat, null);
    assert.equal(r.carbs, null);
  });

  await t.test('items fill totals the model left out, and junk is clamped', () => {
    const r = cleanReading({
      kind: 'food',
      meal_name: '',
      per: 'total',
      found: {},
      items: [
        { name: 'رز', kcal: 300, protein: 6, fat: 1, carbs: 66 },
        { name: 'دجاج', kcal: 250, protein: 40, fat: 9, carbs: 0 },
      ],
      confidence: 7,
    });
    assert.equal(r.kcal, 550);
    assert.equal(r.protein, 46);
    assert.equal(r.confidence, 1);
    assert.equal(r.name, null);
    const wild = cleanReading({ kind: 'hack', kcal: -5, protein: 1e9, found: { kcal: true, protein: true }, items: [] });
    assert.equal(wild.kind, 'unknown');
    assert.equal(wild.kcal, 0);
    assert.equal(wild.protein, 1000);
  });

  await t.test('a lone item names the meal', () => {
    const r = cleanReading({ meal_name: '', found: {}, items: [{ name: 'شاورما', kcal: 500 }] });
    assert.equal(r.name, 'شاورما');
  });
});

test('food scanning API', async (t) => {
  const app = await startServer();
  t.after(() => app.close());

  const signedIn = async (email) => {
    const client = makeClient(app.origin);
    await registerAndLogin(client, email);
    await resetRateLimits();
    calls = [];
    answer = LABEL;
    failWith = null;
    return client;
  };

  await t.test('needs an account', async () => {
    const client = await makeClient(app.origin).bootstrap();
    assert.equal((await client.get('/api/food/key')).status, 401);
    assert.equal((await client.post('/api/food/scan', { image: IMAGE })).status, 401);
  });

  await t.test('a key is checked with Google, stored sealed, and never sent back', async () => {
    const client = await signedIn('key@example.com');
    assert.deepEqual((await client.get('/api/food/key')).data, { saved: false, last4: null });

    const bad = await client.put('/api/food/key', { key: 'AIza-not-a-real-one-xxxxxxxx' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.error, 'bad_key');

    const junk = await client.put('/api/food/key', { key: 'hello world' });
    assert.equal(junk.status, 400);
    assert.equal(junk.data.error, 'invalid_key');

    const ok = await client.put('/api/food/key', { key: `  ${GOOD_KEY} ` });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.data, { saved: true, last4: 'WXYZ' });

    const row = await app.db.one('SELECT * FROM user_secrets');
    assert.ok(!JSON.stringify(row).includes(GOOD_KEY), 'the plain key must not be in the row');

    const read = await client.get('/api/food/key');
    assert.deepEqual(read.data, { saved: true, last4: 'WXYZ' });
    assert.ok(!JSON.stringify(read.data).includes('AIza'));

    await client.del('/api/food/key');
    assert.deepEqual((await client.get('/api/food/key')).data, { saved: false, last4: null });
  });

  await t.test('a scan uses that user’s key and returns a clean reading', async () => {
    const client = await signedIn('scan@example.com');
    assert.equal((await client.post('/api/food/scan', { image: IMAGE })).data.error, 'no_key');

    await client.put('/api/food/key', { key: GOOD_KEY });
    const res = await client.post('/api/food/scan', { image: IMAGE, mimeType: 'image/jpeg' });
    assert.equal(res.status, 200);
    assert.equal(res.data.name, 'لبن المراعي');
    assert.equal(res.data.kcal, 120);
    assert.equal(res.data.per, 'serving');

    const gen = calls.find((c) => c.op === 'generate');
    assert.equal(gen.apiKey, GOOD_KEY);
    assert.equal(gen.req.contents[0].parts[0].inlineData.data, IMAGE);
    assert.equal(gen.req.config.responseMimeType, 'application/json');
  });

  await t.test('one user never scans on another user’s key', async () => {
    const owner = await signedIn('owner@example.com');
    await owner.put('/api/food/key', { key: GOOD_KEY });
    const other = await signedIn('other@example.com');
    const res = await other.post('/api/food/scan', { image: IMAGE });
    assert.equal(res.status, 409);
    assert.equal(calls.filter((c) => c.op === 'generate').length, 0);
  });

  await t.test('bad images are refused before Google is called', async () => {
    const client = await signedIn('img@example.com');
    await client.put('/api/food/key', { key: GOOD_KEY });
    for (const body of [
      {},
      { image: 'not base64 !!' },
      { image: IMAGE, mimeType: 'text/html' },
      { image: 'A'.repeat(600_000) },
    ]) {
      const res = await client.post('/api/food/scan', body);
      assert.equal(res.status, res.status === 413 ? 413 : 400, JSON.stringify(body).slice(0, 40));
    }
    assert.equal(calls.filter((c) => c.op === 'generate').length, 0);
  });

  await t.test('Google failures become messages the user can act on', async () => {
    const client = await signedIn('fail@example.com');
    await client.put('/api/food/key', { key: GOOD_KEY });

    failWith = Object.assign(new Error('Resource exhausted'), { status: 429 });
    let res = await client.post('/api/food/scan', { image: IMAGE });
    assert.equal(res.status, 429);
    assert.equal(res.data.error, 'quota');

    failWith = Object.assign(new Error('Permission denied'), { status: 403 });
    res = await client.post('/api/food/scan', { image: IMAGE });
    assert.equal(res.data.error, 'bad_key');

    failWith = null;
    answer = 'not json';
    res = await client.post('/api/food/scan', { image: IMAGE });
    assert.equal(res.status, 200, 'a JSON string is still JSON');
    // An answer that is not an object at all reads as an empty, unknown result.
    assert.equal(res.data.kind, 'unknown');
  });
});
