/**
 * المخزن: البيانات تنحفظ محلياً أول، وبعدين تتزامن مع السيرفر.
 *
 * Local-first store.
 *  - Every change lands in localStorage immediately, so the app keeps working
 *    with no signal in the middle of a gym.
 *  - A debounced push sends the whole document to the server; a pull happens on
 *    load, on focus and when the network comes back.
 *  - Conflicts are resolved per training week by timestamp, server-side, so two
 *    phones can log different days without either one losing work.
 */

import { api, ApiError, NetworkError } from './api.js';
import {
  baseWeights,
  exById,
  EXERCISE_IDS,
  DEFAULT_GOAL,
  DEFAULT_LEVEL,
  GOALS,
  LEVELS,
} from './program.js';
import { progress, verdict, MAX_WEEK } from './engine.js';

const KEY = 'hadeed:doc';
const META_KEY = 'hadeed:sync';
const PUSH_DELAY = 1500;

export const SYNC = {
  OFF: 'off', // not signed in — local only
  SYNCED: 'synced',
  PENDING: 'pending',
  SYNCING: 'syncing',
  OFFLINE: 'offline',
  ERROR: 'error',
};

export function emptyDoc() {
  return { schema: 1, meta: { week: 1 }, weeks: {}, nutrition: null, profile: null };
}

export function emptyWeek() {
  return { ts: 0, weights: {}, sets: {}, fb: {}, cardio: {}, cmach: {}, body: null, cal: { d: [], p: [] } };
}

class Store extends EventTarget {
  constructor() {
    super();
    this.doc = emptyDoc();
    this.user = null;
    this.version = 0;
    this.syncState = SYNC.OFF;
    this.lastError = null;
    this.viewWeek = 1; // what is on screen — deliberately NOT persisted
    this._pushTimer = null;
    this._pushing = false;
    this._dirty = false;
    this._weightCache = new Map();
  }

  /* ── lifecycle ─────────────────────────────────────────── */

  async init() {
    this.doc = readLocal() || migrateLegacy() || emptyDoc();
    const meta = readJson(META_KEY) || {};
    this.version = Number(meta.version) || 0;
    this._dirty = !!meta.dirty;
    this.viewWeek = clampWeek(this.doc.meta?.week || 1);

    // Ask /api/config first: it answers for anonymous visitors too, so a normal
    // signed-out load no longer fires a 401 that shows up as a console error.
    try {
      const cfg = await api.config();
      this.user = cfg?.data?.authenticated ? (await api.me()).data : null;
    } catch {
      this.user = null;
    }

    if (this.user) {
      this.setSync(this._dirty ? SYNC.PENDING : SYNC.SYNCING);
      await this.pull();
      if (this._dirty) this.schedulePush(0);
    } else {
      this.setSync(SYNC.OFF);
    }

    addEventListener('online', () => {
      if (this.user) this.schedulePush(0);
    });
    addEventListener('offline', () => this.setSync(SYNC.OFFLINE));
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.user) this.pull();
    });
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  setSync(state, error = null) {
    this.syncState = state;
    this.lastError = error;
    this.dispatchEvent(new CustomEvent('sync'));
  }

  /* ── reads ─────────────────────────────────────────────── */

  get currentWeek() {
    return clampWeek(this.doc.meta?.week || 1);
  }

  /**
   * The trainee's goal. A document saved before goals existed has no profile,
   * and fat loss is what that programme actually was — so it stays on it and
   * nothing about their history changes.
   */
  get goal() {
    const key = this.doc.profile?.goal;
    return key && GOALS[key] ? key : DEFAULT_GOAL;
  }

  get level() {
    const key = this.doc.profile?.level;
    return key && LEVELS[key] ? key : DEFAULT_LEVEL;
  }

  /** Has the trainee been through onboarding? */
  get hasProfile() {
    return !!(this.doc.profile?.goal && GOALS[this.doc.profile.goal]);
  }

  /**
   * Is there anything in here already?
   *
   * A document from before goals existed has no profile, and so does a brand new
   * one — the difference is history. Someone mid-programme must not be dragged
   * through onboarding; they keep the fat-loss programme they were already on and
   * can set a goal from the account page whenever they feel like it.
   */
  get hasHistory() {
    return Object.keys(this.doc.weeks || {}).length > 0 || !!this.doc.nutrition?.age;
  }

  /** Onboarding is for genuinely new documents only. */
  get needsOnboarding() {
    return !this.hasProfile && !this.hasHistory;
  }

  /**
   * Week 0 (and anything below 1) is "before the program started" and must come
   * back empty. Clamping it up to week 1 would make `week(wk - 1)` return the
   * *current* week, so the very first check-in compared a measurement against
   * itself and reported "وضعك سليم" instead of "قياس الأساس".
   */
  week(n = this.viewWeek) {
    const num = Math.floor(Number(n));
    if (!Number.isFinite(num) || num < 1) return emptyWeek();
    return this.doc.weeks[String(clampWeek(num))] || emptyWeek();
  }

  body(n) {
    return this.week(n).body;
  }

  /**
   * Working weights for a week, recomputed from week 1 every time.
   * `weights` in the document holds only the values the user changed by hand;
   * everything else is derived. That is why editing an old week now correctly
   * shifts every later week instead of leaving a stale cached number behind.
   */
  weightsFor(n = this.viewWeek) {
    const target = clampWeek(n);
    if (this._weightCache.has(target)) return this._weightCache.get(target);

    let weights = {
      ...baseWeights(this.goal, this.level),
      ...(this.doc.weeks['1']?.weights || {}),
    };
    for (let i = 2; i <= target; i++) {
      const prevWeek = this.doc.weeks[String(i - 1)] || emptyWeek();
      const gate = verdict(
        this.doc.weeks[String(i - 1)]?.body || null,
        this.doc.weeks[String(i - 2)]?.body || null,
        this.goal
      );
      weights = progress(weights, prevWeek, gate);
      const overrides = this.doc.weeks[String(i)]?.weights || {};
      for (const [id, value] of Object.entries(overrides)) {
        if (exById(id)) weights[id] = value;
      }
    }
    this._weightCache.set(target, weights);
    return weights;
  }

  /** Weight history across all weeks up to `n`, for the sparkline rail. */
  weightHistory(n = this.viewWeek) {
    const out = {};
    for (const id of EXERCISE_IDS) out[id] = [];
    for (let i = 1; i <= clampWeek(n); i++) {
      const w = this.weightsFor(i);
      for (const id of EXERCISE_IDS) if (Number.isFinite(w[id])) out[id].push(w[id]);
    }
    return out;
  }

  calHist() {
    const out = {};
    for (const [key, week] of Object.entries(this.doc.weeks)) out[Number(key)] = week.cal;
    return out;
  }

  bodyHist() {
    const out = {};
    for (const [key, week] of Object.entries(this.doc.weeks)) {
      if (week.body) out[Number(key)] = week.body;
    }
    return out;
  }

  /* ── writes ────────────────────────────────────────────── */

  /**
   * Apply a mutation to one training week. Stamps the week so the server can
   * resolve a two-device conflict without guessing.
   */
  update(weekNumber, mutator) {
    const key = String(clampWeek(weekNumber));
    const week = { ...emptyWeek(), ...(this.doc.weeks[key] || {}) };
    mutator(week);
    week.ts = Date.now();
    this.doc.weeks[key] = week;
    this._weightCache.clear();
    this.persist();
  }

  /**
   * Set the goal and level. Changing goal swaps the programme, so the derived
   * weight cache has to go — but nothing stored is deleted: weights and sets are
   * keyed by exercise id, so the old goal's numbers are still there if the user
   * comes back to it.
   */
  updateProfile(mutator) {
    const profile = { goal: this.goal, level: this.level, ...(this.doc.profile || {}) };
    mutator(profile);
    profile.ts = Date.now();
    this.doc.profile = profile;
    this._weightCache.clear();
    this.persist();
  }

  updateNutrition(mutator) {
    const nutrition = { ...(this.doc.nutrition || {}) };
    mutator(nutrition);
    nutrition.ts = Date.now();
    this.doc.nutrition = nutrition;
    this.persist();
  }

  /** Advance the "current" training week. Browsing back and forth must not. */
  advanceTo(n) {
    this.doc.meta.week = clampWeek(n);
    this.viewWeek = this.doc.meta.week;
    this.persist();
  }

  persist() {
    const written = writeLocal(this.doc);
    this._dirty = true;
    writeJson(META_KEY, { version: this.version, dirty: true });
    // Private-mode Safari and a full quota both fail silently otherwise, and
    // the user would keep logging sets that are never actually saved.
    if (!written) this.dispatchEvent(new CustomEvent('storage-error'));
    this.emit();
    if (this.user) this.schedulePush();
  }

  /* ── sync ──────────────────────────────────────────────── */

  schedulePush(delay = PUSH_DELAY) {
    if (!this.user) return;
    this.setSync(SYNC.PENDING);
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => this.push(), delay);
  }

  async pull() {
    if (!this.user) return;
    try {
      const res = await api.getState();
      const remote = res.data;
      if (!remote) return;

      if (remote.version > this.version && !this._dirty) {
        // Server is ahead and we have nothing local to lose — adopt it.
        this.doc = normalize(remote.doc);
        this.version = remote.version;
        writeLocal(this.doc);
        writeJson(META_KEY, { version: this.version, dirty: false });
        this._weightCache.clear();
        this.viewWeek = clampWeek(this.doc.meta?.week || 1);
        this.setSync(SYNC.SYNCED);
        this.emit();
      } else if (remote.version > this.version && this._dirty) {
        // Both sides changed — let the server merge on the next push.
        this.version = Math.min(this.version, remote.version - 1);
        this.schedulePush(0);
      } else if (!this._dirty) {
        this.setSync(SYNC.SYNCED);
      }
    } catch (err) {
      this.handleSyncError(err);
    }
  }

  async push() {
    if (!this.user || this._pushing) return;
    if (!navigator.onLine) {
      this.setSync(SYNC.OFFLINE);
      return;
    }
    this._pushing = true;
    this.setSync(SYNC.SYNCING);
    try {
      const res = await api.putState(this.version, this.doc);
      this.doc = normalize(res.data.doc);
      this.version = res.data.version;
      this._dirty = false;
      this._weightCache.clear();
      writeLocal(this.doc);
      writeJson(META_KEY, { version: this.version, dirty: false });
      this.setSync(SYNC.SYNCED);
      if (res.status === 409) this.emit(); // merged copy differs — repaint
    } catch (err) {
      this.handleSyncError(err);
    } finally {
      this._pushing = false;
    }
  }

  handleSyncError(err) {
    if (err instanceof ApiError && err.status === 401) {
      this.user = null;
      this.setSync(SYNC.OFF);
      this.emit();
      return;
    }
    if (!navigator.onLine || err instanceof NetworkError) {
      this.setSync(SYNC.OFFLINE);
      // Retry once the connection is back; the 'online' listener also fires.
      clearTimeout(this._pushTimer);
      this._pushTimer = setTimeout(() => this.push(), 15000);
      return;
    }
    this.setSync(SYNC.ERROR, err.message);
  }

  /**
   * Re-read the account (2FA state, device count) without touching the data.
   *
   * Deliberately silent: emitting here would repaint the screen, and a caller
   * part-way through a multi-step flow would have its DOM swapped out from
   * under it — which once meant the one-time recovery codes were rendered into
   * a detached node and lost. Callers repaint when they are ready.
   */
  async refreshUser() {
    try {
      const res = await api.me();
      this.user = res?.data || null;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.user = null;
    }
    return this.user;
  }

  async signedIn(user) {
    // Trust the server for the account details rather than the login response,
    // so flags like totpEnabled are always in step with what it actually holds.
    this.user = user;
    await this.refreshUser();
    this._weightCache.clear();
    // A local-only history from before signing in should not be thrown away:
    // mark it dirty so the first push merges it into the account.
    const hasLocal = Object.keys(this.doc.weeks).length > 0;
    this.setSync(SYNC.SYNCING);
    await this.pull();
    if (hasLocal) {
      this._dirty = true;
      await this.push();
    }
    this.emit();
  }

  async signOut({ wipeLocal }) {
    this.user = null;
    clearTimeout(this._pushTimer);
    if (wipeLocal) {
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(META_KEY);
      } catch {
        /* storage disabled */
      }
      this.doc = emptyDoc();
      this.version = 0;
      this._dirty = false;
      this._weightCache.clear();
      this.viewWeek = 1;
    }
    this.setSync(SYNC.OFF);
    this.emit();
  }
}

/* ── helpers ─────────────────────────────────────────────── */

function clampWeek(n) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_WEEK);
}

function normalize(doc) {
  const out = emptyDoc();
  if (!doc || typeof doc !== 'object') return out;
  out.meta.week = clampWeek(doc.meta?.week || 1);
  out.nutrition = doc.nutrition || null;
  out.profile = doc.profile || null;
  for (const [key, week] of Object.entries(doc.weeks || {})) {
    out.weeks[String(clampWeek(key))] = { ...emptyWeek(), ...week };
  }
  return out;
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readLocal() {
  const doc = readJson(KEY);
  return doc ? normalize(doc) : null;
}

function writeLocal(doc) {
  return writeJson(KEY, doc);
}

/**
 * الترقية من النسخة القديمة (المفاتيح المنفصلة w:1 و log:1 …) للمستند الموحّد.
 * One-time migration from the original per-key localStorage layout.
 */
function migrateLegacy() {
  let found = false;
  const doc = emptyDoc();
  try {
    const metaWeek = Number(localStorage.getItem('meta:wk'));
    if (Number.isFinite(metaWeek) && metaWeek >= 1) {
      doc.meta.week = clampWeek(metaWeek);
      found = true;
    }
    for (let i = 1; i <= MAX_WEEK; i++) {
      const weights = readJson(`w:${i}`);
      const log = readJson(`log:${i}`);
      const body = readJson(`body:${i}`);
      const cal = readJson(`cal:${i}`);
      if (!weights && !log && !body && !cal) {
        // Two consecutive empty weeks past the recorded current week: stop.
        if (i > doc.meta.week + 1) break;
        continue;
      }
      found = true;
      doc.weeks[String(i)] = {
        ...emptyWeek(),
        ts: Date.now(),
        weights: weights || {},
        sets: log?.sets || {},
        fb: log?.fb || {},
        cardio: log?.cardio || {},
        cmach: log?.cmach || {},
        body: body || null,
        cal: cal || { d: [], p: [] },
      };
    }
    const nutrition = readJson('nutri');
    if (nutrition) {
      doc.nutrition = { ...nutrition, ts: Date.now() };
      found = true;
    }
  } catch {
    return null;
  }
  if (!found) return null;
  writeLocal(doc);
  return doc;
}

export const store = new Store();
