/**
 * تفضيلات العرض — لكل جهاز، ما تتزامن.
 *
 * Deliberately not part of store.js. That module owns the synced document, and
 * this is the one kind of setting that must *not* sync: a phone has a notch and
 * a laptop does not, so a gap that reads well on one is wrong on the other.
 * Keeping it here also keeps it out of state-schema.js, which never has to grow
 * an allow-list entry for it.
 *
 * The theme lives here for the same reason and one more: a screen read in a
 * bright gym is a property of that room, not of the account.
 */

const KEY = 'hadeed:display';

/**
 * One localStorage key holds every preference in this module, so a writer that
 * replaces the whole object silently drops the settings it does not know about.
 * Every write goes through writeSaved(), which merges.
 */
function readSaved() {
  try {
    // localStorage throws in private mode, and the stored value is whatever a
    // previous version — or a hand-edited devtools session — left behind.
    const raw = localStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function writeSaved(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readSaved(), ...patch }));
  } catch {
    // Out of quota or blocked: the change still applies for this session, which
    // is better than refusing to move at all.
  }
}

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
  const saved = readSaved().topGap;
  return saved === undefined ? TOP_GAP.fallback : clampGap(saved);
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
  // Merged, not replaced: writing { topGap } alone would wipe the theme.
  writeSaved({ topGap: gap });
  return gap;
}

/* ── الثيم ────────────────────────────────────────────────────────────────
   Six looks over one layout. Each is a set of custom properties in app.css
   under :root[data-theme='…'] plus an identity layer at the end of that file
   (its own type, shapes and motif), so switching is one attribute — never a
   style="" the CSP would reject. */

export const THEMES = ['sadu', 'najd', 'chalk', 'volt', 'midnight', 'copper'];

/** Arabic label, one line on what sets it apart, and the colour the OS chrome
    takes while that theme is on. */
export const THEME_INFO = {
  sadu: { label: 'سدو', note: 'أحمر وزعفراني، وسجادة تنحاك مع التزامك', chrome: '#18110f' },
  najd: { label: 'نجد', note: 'كحلي وذهبي، وحلقة تقدّم لتمرين اليوم', chrome: '#0e1424' },
  chalk: { label: 'طباشير', note: 'فاتح للنادي، وكل وزن مرسوم بأطباقه', chrome: '#eceef0' },
  volt: { label: 'فولت', note: 'ليموني بزوايا مقصوصة وأرقام مايلة', chrome: '#0f1109' },
  midnight: { label: 'زجاج ليلي', note: 'أزرق هادي بزجاج وحلقات', chrome: '#05070e' },
  copper: { label: 'نحاس', note: 'نحاس مطروق وأخضر الزنجار', chrome: '#150e0a' },
};

/** The one the CSS paints when no attribute is set — so a dead script still
    leaves a finished-looking app rather than an unstyled one. */
export const THEME_FALLBACK = 'sadu';

/** Reads the stored theme, falling back on anything unexpected. */
export function readTheme() {
  const saved = readSaved().theme;
  return THEMES.includes(saved) ? saved : THEME_FALLBACK;
}

/**
 * Applies a theme. Returns the key actually applied, after validation.
 *
 * The status bar and the PWA chrome follow too: leaving theme-color on the one
 * baked into index.html would put a graphite bar above a midnight-blue screen.
 */
export function applyTheme(key) {
  const theme = THEMES.includes(key) ? key : THEME_FALLBACK;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_INFO[theme].chrome);
  return theme;
}

/** Applies and persists. Returns what was actually stored. */
export function setTheme(key) {
  const theme = applyTheme(key);
  // Merged, not replaced: writing { theme } alone would wipe the top gap.
  writeSaved({ theme });
  return theme;
}
