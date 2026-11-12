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

/**
 * Everything under /img is served `immutable` for a year, so an icon cannot be
 * changed in place — a phone that fetched it once never asks again, and
 * deleting the home-screen icon does not clear Safari's cache. Changing one
 * therefore means renaming it, and a rename is exactly when one reference gets
 * missed. A missing icon fails silently: iOS puts a screenshot of the page on
 * the home screen instead, and nothing logs an error.
 */
test('every image the shell points at exists', async () => {
  const sources = {
    'index.html': await readFile(new URL('index.html', PUBLIC), 'utf8'),
    'manifest.webmanifest': await readFile(new URL('manifest.webmanifest', PUBLIC), 'utf8'),
    'sw.js': await readFile(new URL('sw.js', PUBLIC), 'utf8'),
  };
  const onDisk = new Set(await readdir(new URL('img/', PUBLIC)));

  let seen = 0;
  for (const [file, text] of Object.entries(sources)) {
    for (const [, name] of text.matchAll(/["']\/img\/([^"'/]+)["']/g)) {
      seen++;
      assert.ok(onDisk.has(name), `${file} points at /img/${name}, which does not exist`);
    }
  }
  // Guards the regex as much as the files: a pattern that matched nothing
  // would pass this test on a shell with no icons at all.
  assert.ok(seen >= 6, `expected the icon references, found ${seen}`);
});

/**
 * One digit system on screen. The goal cards and three verdict lines were
 * written with Arabic-Indic digits (٣ أيام حديد) while every computed number
 * in the app is Latin, so onboarding read "٣" and the screen after it "3".
 */
test('no Arabic-Indic digits in the app text', async () => {
  const offenders = [];
  for (const file of await jsUnder(new URL('js/', PUBLIC))) {
    const text = await readFile(new URL(file.replace(/^\//, ''), PUBLIC), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (/[٠-٩]/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'write digits as 0-9; these lines use ٠-٩');
});

/**
 * Every theme the picker offers has a token block, and the one a page with no
 * attribute paints is the fallback the script would have chosen. A theme added
 * to the list without its block silently paints as whatever came before it.
 */
test('every theme has a token block, and the bare page is the fallback', async () => {
  const { THEMES, THEME_INFO, THEME_FALLBACK } = await import('../public/js/display.js');
  const css = await readFile(new URL('css/app.css', PUBLIC), 'utf8');
  const html = await readFile(new URL('index.html', PUBLIC), 'utf8');
  for (const theme of THEMES) {
    assert.match(css, new RegExp(`:root\\[data-theme='${theme}'\\] \\{`), `no token block for ${theme}`);
    assert.ok(THEME_INFO[theme]?.label && THEME_INFO[theme]?.chrome, `no label or chrome colour for ${theme}`);
    assert.match(css, new RegExp(`\\.tsw-${theme} \\{`), `no picker swatch for ${theme}`);
  }
  assert.match(css, new RegExp(`:root:not\\(\\[data-theme\\]\\),\\n:root\\[data-theme='${THEME_FALLBACK}'\\] \\{`));
  assert.ok(
    html.includes(`<meta name="theme-color" content="${THEME_INFO[THEME_FALLBACK].chrome}" />`),
    'index.html paints the status bar for a different theme than the fallback'
  );
});
