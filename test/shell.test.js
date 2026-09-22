import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

/**
 * The service worker precaches an explicit list of files. Adding a module and
 * forgetting the list breaks the app offline — silently, because everything
 * works while the network is up, and the browser journeys run over http, where
 * main.js does not register the worker at all.
 *
 * That has already happened once: §1 of HANDOFF lists a commit called
 * "Precache the modules the shell was missing". Keeping the list honest is a
 * job for a test rather than for whoever is paying attention that day.
 */

const PUBLIC = new URL('../public/', import.meta.url);

async function jsUnder(dir, prefix = '/js') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...(await jsUnder(new URL(`${entry.name}/`, dir), `${prefix}/${entry.name}`)));
    } else if (entry.name.endsWith('.js')) {
      out.push(`${prefix}/${entry.name}`);
    }
  }
  return out;
}

test('the service worker shell', async (t) => {
  const sw = await readFile(new URL('sw.js', PUBLIC), 'utf8');
  const listed = [...sw.matchAll(/'(\/js\/[^']+\.js)'/g)].map((m) => m[1]);
  const onDisk = await jsUnder(new URL('js/', PUBLIC));

  await t.test('precaches every module the app ships', () => {
    const missing = onDisk.filter((f) => !listed.includes(f)).sort();
    assert.deepEqual(missing, [], `not precached: ${missing.join(', ')}`);
  });

  await t.test('lists nothing that no longer exists', () => {
    const stale = listed.filter((f) => !onDisk.includes(f)).sort();
    assert.deepEqual(stale, [], `listed but missing from disk: ${stale.join(', ')}`);
  });

  await t.test('precaches the stylesheets too', async () => {
    const css = (await readdir(new URL('css/', PUBLIC))).filter((f) => f.endsWith('.css'));
    for (const file of css) {
      assert.ok(sw.includes(`'/css/${file}'`), `/css/${file} is not precached`);
    }
  });
});
