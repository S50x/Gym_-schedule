/**
 * تحقق صارم من شكل البيانات قبل ما تنحفظ.
 * Strict allow-list validation for the synced document.
 *
 * The server never trusts the client. Every key, every id and every number is
 * checked against the program definition, so a compromised or hostile client
 * cannot store arbitrary data that later gets rendered or fed to the engine.
 * Anything unrecognised is dropped, not stored.
 */

import {
  EXERCISE_IDS,
  MACHINE_KEYS,
  FEEDBACK_VALUES,
  LIFT_DAY_KEYS,
  MAX_SETS,
  MAX_LOAD,
  MAX_MACHINES_PER_DAY,
  GOAL_KEYS,
  LEVEL_KEYS,
  GROUP_KEYS,
} from '../public/js/program.js';
import { MAX_WEEK, MAX_FOODS, foodKey } from '../public/js/engine.js';

const EX_IDS = new Set(EXERCISE_IDS);
const DAY_OF_WEEK = new Set(LIFT_DAY_KEYS);
const MACHINES = new Set(MACHINE_KEYS);
const FEEDBACK = new Set(FEEDBACK_VALUES);
const GOALS = new Set(GOAL_KEYS);
const LEVELS = new Set(LEVEL_KEYS);
const DAY_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6']);

export const MAX_DOC_BYTES = 512 * 1024;
export const MAX_WEEKS_STORED = 520;

class Invalid extends Error {
  constructor(path, reason) {
    super(`${path}: ${reason}`);
    this.name = 'InvalidState';
    this.path = path;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(value, path, { min, max, integer = false, allowNull = false }) {
  if (value === null || value === undefined) {
    if (allowNull) return null;
    throw new Invalid(path, 'مطلوب');
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Invalid(path, 'ليس رقماً');
  if (integer && !Number.isInteger(n)) throw new Invalid(path, 'لازم عدد صحيح');
  if (n < min || n > max) throw new Invalid(path, `خارج المدى ${min}..${max}`);
  // Round to one decimal so we never persist float noise like 12.300000000000001.
  return integer ? n : Math.round(n * 10) / 10;
}

function weightsOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!EX_IDS.has(id)) continue; // unknown exercise → dropped
    out[id] = num(value, `${path}.${id}`, { min: 0, max: MAX_LOAD });
  }
  return out;
}

/**
 * Sets are bounded by the programme-wide maximum rather than the exercise's own
 * count, because that count now depends on the goal: strength runs five sets of
 * a lift that fat loss runs three of. Binding the limit to the document's goal
 * would mean that switching from strength to fat loss makes an already-saved
 * document invalid, and the user's sync stops entirely with a 400.
 */
/**
 * A set-log key is `day:exerciseId` — both halves checked against the program.
 * A bare exercise id is the older shape and still accepted: the client lifts it
 * onto a day-scoped key the next time that exercise belongs to a day, and until
 * then it is somebody's history that the server has no business dropping.
 */
function validSetsKey(key) {
  if (EX_IDS.has(key)) return true;
  const at = key.indexOf(':');
  if (at < 1) return false;
  return DAY_OF_WEEK.has(key.slice(0, at)) && EX_IDS.has(key.slice(at + 1));
}

function setsOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!validSetsKey(id) || !Array.isArray(value)) continue;
    if (value.length > MAX_SETS) throw new Invalid(`${path}.${id}`, 'مجموعات أكثر من المسموح');
    out[id] = value.map((x) => x === true);
  }
  return out;
}

function feedbackOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!EX_IDS.has(id)) continue;
    if (value === null || value === undefined) continue;
    if (!FEEDBACK.has(value)) throw new Invalid(`${path}.${id}`, 'قيمة إحساس غير معروفة');
    out[id] = value;
  }
  return out;
}

function dayFlagsOf(raw, _path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DAY_KEYS.has(String(key))) continue;
    if (value) out[String(key)] = true;
  }
  return out;
}

/**
 * A cardio day may now be split across several machines, so each value is a
 * list of { k, m }. A bare string is still accepted: that is what older clients
 * stored, and rejecting it would drop a day's machine on the first sync.
 */
function machinesOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DAY_KEYS.has(String(key))) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      if (!MACHINES.has(value)) throw new Invalid(`${path}.${key}`, 'جهاز غير معروف');
      out[String(key)] = value;
      continue;
    }

    if (!Array.isArray(value)) throw new Invalid(`${path}.${key}`, 'شكل غير صحيح');
    if (value.length > MAX_MACHINES_PER_DAY) {
      throw new Invalid(`${path}.${key}`, `أجهزة أكثر من ${MAX_MACHINES_PER_DAY}`);
    }
    const seen = new Set();
    const list = [];
    for (const [i, item] of value.entries()) {
      if (!isPlainObject(item)) throw new Invalid(`${path}.${key}[${i}]`, 'شكل غير صحيح');
      if (!MACHINES.has(item.k)) throw new Invalid(`${path}.${key}[${i}].k`, 'جهاز غير معروف');
      if (seen.has(item.k)) throw new Invalid(`${path}.${key}[${i}].k`, 'جهاز مكرر');
      seen.add(item.k);
      list.push({
        k: item.k,
        m: num(item.m ?? 0, `${path}.${key}[${i}].m`, { min: 0, max: 300, integer: true }),
      });
    }
    if (list.length) out[String(key)] = list;
  }
  return out;
}

function bodyOf(raw, path) {
  if (!isPlainObject(raw)) return null;
  const weight = num(raw.weight, `${path}.weight`, { min: 20, max: 400, allowNull: true });
  if (weight === null) return null;
  return {
    weight,
    muscle: num(raw.muscle, `${path}.muscle`, { min: 5, max: 300, allowNull: true }),
  };
}

function calOf(raw, path) {
  if (!isPlainObject(raw)) return { d: [], p: [] };
  const arr = (value, key, max) => {
    if (!Array.isArray(value)) return [];
    if (value.length > 7) throw new Invalid(`${path}.${key}`, 'أكثر من 7 أيام');
    return value.map((x, i) =>
      x === null || x === undefined || x === ''
        ? 0
        : num(x, `${path}.${key}[${i}]`, { min: 0, max, integer: true })
    );
  };
  const out = { d: arr(raw.d, 'd', 20000), p: arr(raw.p, 'p', 1000) };
  // Fat and carbs arrived with meal logging; older documents have neither.
  if (raw.f !== undefined) out.f = arr(raw.f, 'f', 2000);
  if (raw.c !== undefined) out.c = arr(raw.c, 'c', 3000);
  return out;
}

export const MAX_MEALS_PER_DAY = 20;
const MEAL_SOURCES = new Set(['manual', 'label', 'screen', 'photo', 'library']);
const MEAL_ID = /^[a-z0-9]{1,16}$/;

/**
 * A meal's name is free text the user (or an image reader) typed. It is
 * rendered with textContent only, never as HTML, but it is still trimmed to a
 * sane length and stripped of control characters so nothing odd is stored.
 */
function mealName(raw, path) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new Invalid(path, 'ليس نصاً');
  let out = '';
  for (const ch of raw) out += ch.charCodeAt(0) < 32 || ch === '\u007f' ? ' ' : ch;
  return out.trim().slice(0, 80);
}

/**
 * The foods the trainee has logged before, with the numbers they last saved —
 * what one-tap re-logging and "your numbers, not the scan's" are built on.
 */
function foodsOf(raw, path) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Invalid(path, 'شكل غير صحيح');
  if (raw.length > MAX_FOODS) throw new Invalid(path, 'أكلات كثيرة');
  return raw.map((f, i) => {
    const at = `${path}[${i}]`;
    if (!isPlainObject(f)) throw new Invalid(at, 'شكل غير صحيح');
    if (typeof f.id !== 'string' || !MEAL_ID.test(f.id)) throw new Invalid(`${at}.id`, 'معرّف غير صالح');
    const n = mealName(f.n, `${at}.n`);
    if (!n) throw new Invalid(`${at}.n`, 'بدون اسم');
    return {
      id: f.id,
      n,
      k: num(f.k ?? 0, `${at}.k`, { min: 0, max: 10000 }),
      p: num(f.p ?? 0, `${at}.p`, { min: 0, max: 1000 }),
      f: num(f.f ?? 0, `${at}.f`, { min: 0, max: 1000 }),
      c: num(f.c ?? 0, `${at}.c`, { min: 0, max: 1500 }),
      u: num(f.u ?? 0, `${at}.u`, { min: 0, max: 1_000_000, integer: true }),
      t: num(f.t ?? 0, `${at}.t`, { min: 0, max: 4102444800000, integer: true }),
    };
  });
}

/** `{ "0": [meal, …], … }` — keyed by weekday like cardio, every meal optional. */
function mealsOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [day, list] of Object.entries(raw)) {
    if (!DAY_KEYS.has(day)) throw new Invalid(`${path}.${day}`, 'يوم غير معروف');
    if (!Array.isArray(list)) throw new Invalid(`${path}.${day}`, 'شكل غير صحيح');
    if (list.length > MAX_MEALS_PER_DAY) throw new Invalid(`${path}.${day}`, 'وجبات كثيرة');
    if (!list.length) continue;
    out[day] = list.map((m, i) => {
      const at = `${path}.${day}[${i}]`;
      if (!isPlainObject(m)) throw new Invalid(at, 'شكل غير صحيح');
      if (typeof m.id !== 'string' || !MEAL_ID.test(m.id)) throw new Invalid(`${at}.id`, 'معرّف غير صالح');
      const slot = m.s === undefined || m.s === null ? null : num(m.s, `${at}.s`, { min: 0, max: 3, integer: true });
      const src = m.src === undefined ? 'manual' : m.src;
      if (!MEAL_SOURCES.has(src)) throw new Invalid(`${at}.src`, 'مصدر غير معروف');
      return {
        id: m.id,
        n: mealName(m.n, `${at}.n`),
        s: slot,
        k: num(m.k ?? 0, `${at}.k`, { min: 0, max: 10000 }),
        p: num(m.p ?? 0, `${at}.p`, { min: 0, max: 1000 }),
        f: num(m.f ?? 0, `${at}.f`, { min: 0, max: 1000 }),
        c: num(m.c ?? 0, `${at}.c`, { min: 0, max: 1500 }),
        src,
        t: num(m.t ?? 0, `${at}.t`, { min: 0, max: 4102444800000, integer: true }),
      };
    });
  }
  return out;
}

function weekOf(raw, path) {
  if (!isPlainObject(raw)) throw new Invalid(path, 'شكل غير صحيح');
  return {
    ts: num(raw.ts ?? 0, `${path}.ts`, { min: 0, max: 4102444800000, integer: true }),
    weights: weightsOf(raw.weights, `${path}.weights`),
    sets: setsOf(raw.sets, `${path}.sets`),
    fb: feedbackOf(raw.fb, `${path}.fb`),
    cardio: dayFlagsOf(raw.cardio, `${path}.cardio`),
    cmach: machinesOf(raw.cmach, `${path}.cmach`),
    body: bodyOf(raw.body, `${path}.body`),
    cal: calOf(raw.cal, `${path}.cal`),
    meals: mealsOf(raw.meals, `${path}.meals`),
  };
}

function nutritionOf(raw, path) {
  if (!isPlainObject(raw)) return null;
  if (raw.age === undefined || raw.age === null) return null;
  const age = num(raw.age, `${path}.age`, { min: 14, max: 90, integer: true });
  const act = num(raw.act, `${path}.act`, { min: 1.2, max: 2.5 });
  // tdee/target are derived from today's weight now, so they are no longer
  // required — but older documents still carry them and must keep validating.
  const tdee = num(raw.tdee ?? null, `${path}.tdee`, {
    min: 800,
    max: 8000,
    integer: true,
    allowNull: true,
  });
  const target = num(raw.target ?? null, `${path}.target`, {
    min: 800,
    max: 8000,
    integer: true,
    allowNull: true,
  });
  return {
    age,
    act,
    // A maintenance figure backed out of real intake vs. weight change. When
    // present it overrides the formula, so it is stored rather than recomputed.
    measuredTdee: num(raw.measuredTdee ?? null, `${path}.measuredTdee`, {
      min: 800,
      max: 8000,
      integer: true,
      allowNull: true,
    }),
    // Optional so records saved before the height field still validate.
    height: num(raw.height ?? null, `${path}.height`, {
      min: 120,
      max: 230,
      integer: true,
      allowNull: true,
    }),
    tdee,
    target,
    protein: num(raw.protein ?? 0, `${path}.protein`, { min: 0, max: 500, integer: true }),
    ts: num(raw.ts ?? 0, `${path}.ts`, { min: 0, max: 4102444800000, integer: true }),
  };
}

/**
 * `{ push: 'beg', legs: 'adv' }` — a level for some muscle groups. Absent or
 * empty means every group follows the overall level, which is what every
 * document written before this existed says, so they keep working untouched.
 */
function groupLevelsOf(raw, path) {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) throw new Invalid(path, 'صيغة غير صالحة');
  const out = {};
  for (const key of GROUP_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (!LEVELS.has(value)) throw new Invalid(`${path}.${key}`, 'مستوى غير معروف');
    out[key] = value;
  }
  // Nothing set is the same as never having set anything.
  return Object.keys(out).length ? out : null;
}

/**
 * Weekdays off, Sat=0 … Fri=6. Absent means "the goal's own week", which is
 * what every older document says. How many fit depends on the goal and is
 * settled on the client (program.js normalizeRestDays) — a list too long for
 * the current goal falls back there, so storing it can never break a week.
 */
function restDaysOf(raw, path) {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw) || raw.length > 7) throw new Invalid(path, 'صيغة غير صالحة');
  const out = raw.map((d, i) => num(d, `${path}[${i}]`, { min: 0, max: 6, integer: true }));
  if (new Set(out).size !== out.length) throw new Invalid(path, 'يوم مكرر');
  return out.sort((a, b) => a - b);
}

/** The trainee's goal and experience level — what the whole programme hangs on. */
function profileOf(raw, path) {
  if (!isPlainObject(raw)) return null;
  if (raw.goal === undefined || raw.goal === null) return null;
  if (!GOALS.has(raw.goal)) throw new Invalid(`${path}.goal`, 'هدف غير معروف');
  const level = raw.level ?? null;
  if (level !== null && !LEVELS.has(level)) throw new Invalid(`${path}.level`, 'مستوى غير معروف');
  return {
    goal: raw.goal,
    level,
    // Optional per-muscle-group overrides. Rebuilt key by key like everything
    // else here: an unknown group or an unknown level is dropped rather than
    // stored, so nothing a client invents reaches the document.
    levels: groupLevelsOf(raw.levels, `${path}.levels`),
    restDays: restDaysOf(raw.restDays, `${path}.restDays`),
    // Body weight when this goal was chosen — the baseline the review prompt
    // measures progress against.
    startWeight: num(raw.startWeight ?? null, `${path}.startWeight`, {
      min: 20,
      max: 400,
      allowNull: true,
    }),
    ts: num(raw.ts ?? 0, `${path}.ts`, { min: 0, max: 4102444800000, integer: true }),
  };
}

/**
 * @returns {{ok:true, doc:object} | {ok:false, message:string, path:string}}
 */
export function validateState(input) {
  try {
    if (!isPlainObject(input)) throw new Invalid('doc', 'شكل غير صحيح');

    const weeksRaw = isPlainObject(input.weeks) ? input.weeks : {};
    const weekKeys = Object.keys(weeksRaw);
    if (weekKeys.length > MAX_WEEKS_STORED) {
      throw new Invalid('doc.weeks', `أسابيع أكثر من ${MAX_WEEKS_STORED}`);
    }

    const weeks = {};
    for (const key of weekKeys) {
      if (!/^[1-9][0-9]{0,3}$/.test(key)) throw new Invalid(`doc.weeks.${key}`, 'رقم أسبوع غير صالح');
      const n = Number(key);
      if (n < 1 || n > MAX_WEEK) throw new Invalid(`doc.weeks.${key}`, 'رقم أسبوع خارج المدى');
      weeks[key] = weekOf(weeksRaw[key], `doc.weeks.${key}`);
    }

    const doc = {
      schema: 1,
      meta: {
        week: num(input.meta?.week ?? 1, 'doc.meta.week', {
          min: 1,
          max: MAX_WEEK,
          integer: true,
        }),
      },
      weeks,
      nutrition: nutritionOf(input.nutrition, 'doc.nutrition'),
      profile: profileOf(input.profile, 'doc.profile'),
      foods: foodsOf(input.foods, 'doc.foods'),
    };

    const size = Buffer.byteLength(JSON.stringify(doc), 'utf8');
    if (size > MAX_DOC_BYTES) throw new Invalid('doc', 'حجم البيانات كبير زيادة');

    return { ok: true, doc };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, message: err.message, path: err.path };
    throw err;
  }
}

export function emptyState() {
  return { schema: 1, meta: { week: 1 }, weeks: {}, nutrition: null, profile: null, foods: [] };
}

/**
 * Two devices' food lists: one entry per food, the one used most recently
 * winning — so a correction made on the phone is not undone by the laptop.
 */
function mergeFoods(a = [], b = []) {
  const byKey = new Map();
  for (const f of [...(a || []), ...(b || [])]) {
    const key = foodKey(f.n);
    const have = byKey.get(key);
    if (!have || (f.t || 0) >= (have.t || 0)) byKey.set(key, f);
  }
  return [...byKey.values()].sort((x, y) => (y.t || 0) - (x.t || 0)).slice(0, MAX_FOODS);
}

/**
 * Deterministic merge used when two devices raced.
 * Weeks are the merge unit: whichever side edited a given week last wins that
 * week outright, so a half-finished workout is never spliced into a finished one.
 */
export function mergeStates(base, incoming) {
  const weeks = { ...base.weeks };
  for (const [key, week] of Object.entries(incoming.weeks || {})) {
    const existing = weeks[key];
    if (!existing || (week.ts || 0) >= (existing.ts || 0)) weeks[key] = week;
  }
  const nutrition =
    (incoming.nutrition?.ts || 0) >= (base.nutrition?.ts || 0)
      ? (incoming.nutrition ?? base.nutrition)
      : base.nutrition;

  // Same rule for the profile: the device that changed goal most recently wins,
  // so switching goal on the phone is not undone by an older tab pushing back.
  const profile =
    (incoming.profile?.ts || 0) >= (base.profile?.ts || 0)
      ? (incoming.profile ?? base.profile)
      : base.profile;

  return {
    schema: 1,
    meta: { week: incoming.meta?.week ?? base.meta?.week ?? 1 },
    weeks,
    nutrition: nutrition ?? null,
    profile: profile ?? null,
    foods: mergeFoods(base.foods, incoming.foods),
  };
}
