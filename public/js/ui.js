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

export function sparkline(values) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 96 30');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

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

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M' + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L'));
  svg.appendChild(path);

  const [cx, cy] = points[points.length - 1];
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', cx.toFixed(1));
  dot.setAttribute('cy', cy.toFixed(1));
  dot.setAttribute('r', '3');
  svg.appendChild(dot);

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
