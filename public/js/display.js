/**
 * تفضيلات العرض — لكل جهاز، ما تتزامن.
 *
 * Deliberately not part of store.js. That module owns the synced document, and
 * this is the one kind of setting that must *not* sync: a phone has a notch and
 * a laptop does not, so a gap that reads well on one is wrong on the other.
 * Keeping it here also keeps it out of state-schema.js, which never has to grow
 * an allow-list entry for it.
 */

const KEY = 'hadeed:display';

/**
 * The floor is the same 12px the notch journey asserts. A setting added to fix
 * content crowding the status bar must not be able to put it back there, so the
 * range itself is the guarantee — not the user's restraint.
 */
export const TOP_GAP = { min: 12, max: 72, step: 4, fallback: 20 };

const clampGap = (px) => {
  const n = Math.round(Number(px));
  if (!Number.isFinite(n)) return TOP_GAP.fallback;
  return Math.min(TOP_GAP.max, Math.max(TOP_GAP.min, n));
};

/** Reads the stored gap, falling back on anything unexpected. */
export function readTopGap() {
  try {
    // localStorage throws in private mode, and the stored value is whatever a
    // previous version — or a hand-edited devtools session — left behind.
    const raw = localStorage.getItem(KEY);
    if (!raw) return TOP_GAP.fallback;
    const saved = JSON.parse(raw)?.topGap;
    return saved === undefined ? TOP_GAP.fallback : clampGap(saved);
  } catch {
    return TOP_GAP.fallback;
  }
}

/**
 * Through the CSSOM, never a style="" attribute: the CSP forbids the attribute
 * form. Same reason el() in dom.js sets custom properties this way.
 */
export function applyTopGap(px) {
  const gap = clampGap(px);
  document.documentElement.style.setProperty('--top-gap', `${gap}px`);
  return gap;
}

/** Applies and persists. Returns what was actually stored, after clamping. */
export function setTopGap(px) {
  const gap = applyTopGap(px);
  try {
    localStorage.setItem(KEY, JSON.stringify({ topGap: gap }));
  } catch {
    // Out of quota or blocked: the gap still applies for this session, which is
    // better than refusing to move at all.
  }
  return gap;
}
