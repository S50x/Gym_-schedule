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
  MAX_SETS,
  MAX_MACHINES_PER_DAY,
  exById,
} from '../public/js/program.js';
import { MAX_WEEK } from '../public/js/engine.js';

const EX_IDS = new Set(EXERCISE_IDS);
const MACHINES = new Set(MACHINE_KEYS);
const FEEDBACK = new Set(FEEDBACK_VALUES);
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
    out[id] = num(value, `${path}.${id}`, { min: 0, max: 1000 });
  }
  return out;
}

function setsOf(raw, path) {
  if (!isPlainObject(raw)) return {};
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!EX_IDS.has(id) || !Array.isArray(value)) continue;
    const limit = exById(id)?.sets ?? MAX_SETS;
    if (value.length > limit) throw new Invalid(`${path}.${id}`, 'مجموعات أكثر من المسموح');
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

function dayFlagsOf(raw, path) {
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
  return { d: arr(raw.d, 'd', 20000), p: arr(raw.p, 'p', 1000) };
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
  };
}

function nutritionOf(raw, path) {
  if (!isPlainObject(raw)) return null;
  if (raw.age === undefined || raw.age === null) return null;
  const age = num(raw.age, `${path}.age`, { min: 14, max: 90, integer: true });
  const act = num(raw.act, `${path}.act`, { min: 1.2, max: 2.5 });
  const tdee = num(raw.tdee, `${path}.tdee`, { min: 800, max: 8000, integer: true });
  const target = num(raw.target, `${path}.target`, { min: 800, max: 8000, integer: true });
  return {
    age,
    act,
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
  return { schema: 1, meta: { week: 1 }, weeks: {}, nutrition: null };
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

  return {
    schema: 1,
    meta: { week: incoming.meta?.week ?? base.meta?.week ?? 1 },
    weeks,
    nutrition: nutrition ?? null,
  };
}
