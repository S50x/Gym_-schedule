/**
 * Grades every exercise photograph to one look.
 *
 *   npm run photos
 *
 * The pairs come from different shoots — a warm-lit studio, a red-walled gym,
 * window light, and Bird Dog's pair from a third source entirely — so side by
 * side they read as a scrapbook. This pass gives them one white balance, one
 * exposure and one finish, so they read as one set inside the dark UI.
 *
 * SOURCES, NOT OUTPUTS. The originals live in scripts/photo-src/ and are never
 * served; the graded copies are written to public/img/ex/v2/. Grading is always
 * re-run from the originals, never from its own output, so tuning a number
 * below and running this again cannot stack one grade on another.
 *
 * ONE CORRECTION PER PAIR. Both frames of a movement are measured together and
 * get exactly the same adjustment. Correcting each frame on its own would give
 * the start and the end of the rep slightly different colours, and the
 * cross-fade between them would pulse.
 *
 * CHANGING THE LOOK MEANS A NEW FOLDER. /img is served `immutable` for a year
 * (server/app.js), so new pixels under an old name never reach a phone that has
 * seen the old ones (HANDOFF §7.15). Bump DIR here and in `photoFrame()`
 * (public/js/figure.js), and bump VERSION in sw.js.
 *
 * Like render-icons.mjs, this uses the Chromium the browser journeys already
 * need instead of adding an image library.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../test/browser/helpers.mjs';

const SRC = fileURLToPath(new URL('./photo-src/', import.meta.url));
const DIR = 'v2';
const OUT = fileURLToPath(new URL(`../public/img/ex/${DIR}/`, import.meta.url));

const LOOK = {
  // How far toward neutral grey the white balance goes. 1 would also bleach
  // skin; this takes the cast off the walls and leaves people looking alive.
  balance: 0.75,
  // Target mean luminance (0–1), reached with a gamma curve rather than an
  // offset: an offset lifts black to grey and turns a dark gym to haze, a
  // curve brightens the middle and leaves black black. `curve` bounds it.
  mean: 0.42,
  curve: [0.7, 1.35],
  saturation: 0.72,
  // Edges fall toward this near-black, so every frame sits in the graphite UI
  // the same way whichever theme is on.
  vignette: { strength: 0.42, colour: [20, 21, 19] },
  quality: 0.8,
};

/**
 * Pairs whose two frames were not shot together. Bird Dog's start and end come
 * from two separate generated images — a dark concrete room and a bright white
 * one — so one shared correction would keep that gap and the fade would flash.
 * These are corrected frame by frame instead, both toward the same target, with
 * a wider curve allowed to get there.
 */
const SEPARATE_SHOOTS = new Set(['birddog']);
const WIDE_CURVE = [0.5, 2.6];

const ids = [
  ...new Set(
    fs
      .readdirSync(SRC)
      .filter((f) => /-[01]\.webp$/.test(f))
      .map((f) => f.replace(/-[01]\.webp$/, ''))
  ),
].sort();

fs.mkdirSync(OUT, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage();

let total = 0;
for (const id of ids) {
  const frames = [0, 1].map((n) => fs.readFileSync(path.join(SRC, `${id}-${n}.webp`)).toString('base64'));
  const graded = await page.evaluate(
    async ({ frames, LOOK, separate, WIDE_CURVE }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/webp;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return { c, g, data: g.getImageData(0, 0, c.width, c.height) };
      };
      const pics = await Promise.all(frames.map(load));

      const luma = (R, G, B) => (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;

      /** White-balance gains and an exposure curve measured over `set`. */
      const correction = (set, bounds) => {
        let r = 0,
          gr = 0,
          b = 0,
          n = 0;
        for (const { data } of set) {
          const d = data.data;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            gr += d[i + 1];
            b += d[i + 2];
            n += 1;
          }
        }
        const grey = (r + gr + b) / (3 * n);
        const gain = [r, gr, b].map((sum) => 1 + LOOK.balance * (grey / (sum / n) - 1));

        let s = 0;
        for (const { data } of set) {
          const d = data.data;
          for (let i = 0; i < d.length; i += 4) s += luma(d[i] * gain[0], d[i + 1] * gain[1], d[i + 2] * gain[2]);
        }
        const mean = Math.min(0.95, Math.max(0.05, s / n));
        const gamma = Math.min(bounds[1], Math.max(bounds[0], Math.log(LOOK.mean) / Math.log(mean)));
        const lut = new Float32Array(256 * 4);
        for (let v = 0; v < lut.length; v++) lut[v] = 255 * Math.pow(Math.min(1, v / 4 / 255), gamma);
        return { gain, curve: (v) => lut[Math.min(lut.length - 1, Math.max(0, Math.round(v * 4)))] };
      };

      // Normally both frames are measured together and share one correction.
      const shared = separate ? null : correction(pics, LOOK.curve);
      const fixes = pics.map((pic) => shared || correction([pic], WIDE_CURVE));

      const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
      const [vr, vg, vb] = LOOK.vignette.colour;
      return pics.map(({ c, g, data }, f) => {
        const { gain, curve } = fixes[f];
        const d = data.data;
        const W = c.width,
          H = c.height;
        for (let i = 0; i < d.length; i += 4) {
          let R = d[i] * gain[0],
            G = d[i + 1] * gain[1],
            B = d[i + 2] * gain[2];
          // Exposure: the same curve on every channel.
          R = curve(R);
          G = curve(G);
          B = curve(B);
          // Saturation around the pixel's own luminance.
          const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          R = Y + (R - Y) * LOOK.saturation;
          G = Y + (G - Y) * LOOK.saturation;
          B = Y + (B - Y) * LOOK.saturation;
          // Vignette: an ellipse fitted to the frame, flat in the middle.
          const p = i / 4;
          const x = ((p % W) / W) * 2 - 1;
          const y = (Math.floor(p / W) / H) * 2 - 1;
          const t = Math.min(1, Math.max(0, (Math.sqrt(x * x + y * y) - 0.55) / 0.85));
          const v = LOOK.vignette.strength * t * t;
          d[i] = clamp(R + (vr - R) * v);
          d[i + 1] = clamp(G + (vg - G) * v);
          d[i + 2] = clamp(B + (vb - B) * v);
        }
        g.putImageData(data, 0, 0);
        return c.toDataURL('image/webp', LOOK.quality).split(',')[1];
      });
    },
    { frames, LOOK, separate: SEPARATE_SHOOTS.has(id), WIDE_CURVE }
  );
  graded.forEach((b64, n) => {
    const file = path.join(OUT, `${id}-${n}.webp`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    total += fs.statSync(file).size;
  });
  console.log(`  ${id}`);
}

await browser.close();
console.log(`${ids.length} pairs → public/img/ex/${DIR}/  (${(total / 1024).toFixed(0)} KB)`);
