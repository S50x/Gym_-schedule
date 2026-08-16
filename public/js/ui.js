/** أدوات واجهة مشتركة. Shared UI helpers. */

import { el } from './dom.js';

/* ── formatting ──────────────────────────────────────────── */

export const fmtN = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
export const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

/* ── toast ───────────────────────────────────────────────── */

let toastTimer = null;
export function toast(message) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
}

/* ── haptics + sound ─────────────────────────────────────── */

export function buzz(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

let audioCtx = null;

/**
 * iOS/Safari start an AudioContext in the "suspended" state and only allow
 * resuming from inside a user gesture. The original code created the context
 * lazily inside the timer callback, which is not a gesture — so the rest-timer
 * beep never played on iPhone. Prime it on the first tap instead.
 */
export function primeAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

export function beep() {
  try {
    if (!audioCtx) primeAudio();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (const offset of [0, 0.22, 0.44]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const t = audioCtx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  } catch {
    /* audio unavailable — the vibration and the visual bar still fire */
  }
}

/* ── sparkline ───────────────────────────────────────────── */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {number[]} values
 * @param {{fill?:boolean, stretch?:boolean}} [options]
 *   fill    — shade the area under the line.
 *   stretch — let the SVG scale to its container's width. The stroke is then
 *             kept at its authored thickness with vector-effect, otherwise a
 *             wide card would render a fat, distorted line.
 */
export function sparkline(values, { fill = false, stretch = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 96 30');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (stretch) svg.setAttribute('preserveAspectRatio', 'none');

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points =
    values.length === 1
      ? [
          [0, 15],
          [96, 15],
        ]
      : values.map((v, i) => [i * (96 / (values.length - 1)), 27 - ((v - min) / range) * 24]);

  const coords = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`);

  if (fill) {
    const area = document.createElementNS(SVG_NS, 'polygon');
    area.setAttribute('class', 'sfill');
    area.setAttribute('points', `0,30 ${coords.join(' ')} 96,30`);
    svg.appendChild(area);
  }

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M' + coords.join(' L'));
  if (stretch) path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);

  const [cx, cy] = points[points.length - 1];
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', cx.toFixed(1));
  dot.setAttribute('cy', cy.toFixed(1));
  dot.setAttribute('r', '3');
  // A circle in a stretched viewBox turns into an ellipse; a small rect reads
  // as an endpoint marker at any width.
  if (stretch) {
    const marker = document.createElementNS(SVG_NS, 'rect');
    marker.setAttribute('x', (cx - 2).toFixed(1));
    marker.setAttribute('y', (cy - 2).toFixed(1));
    marker.setAttribute('width', '4');
    marker.setAttribute('height', '4');
    marker.setAttribute('rx', '1');
    svg.appendChild(marker);
  } else {
    svg.appendChild(dot);
  }

  return svg;
}

/* ── QR code ─────────────────────────────────────────────── */

/**
 * Draws the matrix the server computed as an SVG, one <rect> per dark run.
 * Built with createElementNS rather than an SVG string so the page keeps its
 * no-innerHTML rule — and so the strict CSP needs no exception for it.
 *
 * Rendered on a permanently white plate: inverting a QR for dark mode makes it
 * unreadable to a good share of scanners.
 */
export function qrSvg({ size, rows }, pixelSize = 6) {
  const quiet = 4; // the mandatory light border, in modules
  const total = (size + quiet * 2) * pixelSize;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${total} ${total}`);
  svg.setAttribute('width', String(total));
  svg.setAttribute('height', String(total));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'رمز QR لإعداد تطبيق المصادقة');
  svg.setAttribute('shape-rendering', 'crispEdges');

  const background = document.createElementNS(SVG_NS, 'rect');
  background.setAttribute('width', String(total));
  background.setAttribute('height', String(total));
  background.setAttribute('fill', '#ffffff');
  svg.appendChild(background);

  for (let row = 0; row < size; row++) {
    const line = rows[row];
    let runStart = -1;
    for (let col = 0; col <= size; col++) {
      const dark = col < size && line[col] === '1';
      if (dark && runStart === -1) runStart = col;
      if (!dark && runStart !== -1) {
        // One rect per horizontal run keeps the node count low on big codes.
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String((runStart + quiet) * pixelSize));
        rect.setAttribute('y', String((row + quiet) * pixelSize));
        rect.setAttribute('width', String((col - runStart) * pixelSize));
        rect.setAttribute('height', String(pixelSize));
        rect.setAttribute('fill', '#000000');
        svg.appendChild(rect);
        runStart = -1;
      }
    }
  }
  return svg;
}

/* ── small building blocks ───────────────────────────────── */

export const bulletList = (items) =>
  el(
    'ul',
    { class: 't flush' },
    items.map((parts) => el('li', {}, ...(Array.isArray(parts) ? richParts(parts) : [parts])))
  );

function richParts(parts) {
  return parts.map((p) => (typeof p === 'string' ? p : el('b', { text: p.b })));
}

export const deltaChip = (label, value) => el('span', {}, label, el('b', { text: value }));
