/**
 * منطق البرنامج: قرار الأسبوع، زيادة الأوزان، وحسبة السعرات.
 * Pure functions only — no DOM, no storage. Imported by the app and the tests.
 */

import { ALL_EXERCISES, exById } from './program.js';

export const MAX_WEEK = 520; // ~10 years. Bounds the week navigator and the stored doc.
export const KCAL_PER_KG = 7700;
export const HEIGHT_CM = 183;

/* ────────────────────────── weekly verdict ────────────────────────── */

/**
 * @param {{weight:number, muscle:number|null}|null} cur  this week's measurement
 * @param {{weight:number, muscle:number|null}|null} prev last week's measurement
 */
export function verdict(cur, prev) {
  if (!cur || !cur.weight) {
    return {
      gate: 'go',
      kind: 'go',
      t: 'ما فيه قياس لهالأسبوع',
      p: 'بنزيد على أساس إحساسك بالأوزان بس. سجّل وزنك آخر يوم بالأسبوع عشان القرار يصير أدق.',
    };
  }
  if (!prev || !prev.weight) {
    return {
      gate: 'go',
      kind: 'go',
      t: 'قياس الأساس انحفظ',
      p: 'هذا أول قياس، منه نبدأ نقيس. الأسبوع الجاي بتشوف المقارنة.',
    };
  }

  const dW = round1(cur.weight - prev.weight);
  const pct = (dW / prev.weight) * 100;
  const dM =
    Number.isFinite(cur.muscle) && Number.isFinite(prev.muscle)
      ? round1(cur.muscle - prev.muscle)
      : null;

  if (pct <= -1.2) {
    return {
      gate: 'hold',
      kind: 'warn',
      dW,
      dM,
      t: 'نزولك أسرع من اللازم',
      p: [
        'نزلت أكثر من 1.2% من وزنك بأسبوع واحد. بهالسرعة جزء من النزول عضل مو دهون، وجسمك ما يقدر يتعافى من زيادة أوزان. ',
        { b: 'ثبّت الأوزان هالأسبوع' },
        ' وارفع أكلك شوي — خصوصاً البروتين.',
      ],
    };
  }
  if (dM !== null && dM <= -0.5) {
    return {
      gate: 'hold',
      kind: 'warn',
      dW,
      dM,
      t: 'الكتلة العضلية نازلة',
      p: [
        'نزلت كتلتك العضلية نص كيلو أو أكثر. ثبّت الأوزان، ارفع البروتين، وخفّف الكارديو يوم واحد هالأسبوع. لو تكررت 3 أسابيع، العجز عندك كبير زيادة.',
      ],
    };
  }
  if (pct >= 0.6) {
    return {
      gate: 'go',
      kind: 'hold',
      dW,
      dM,
      t: 'وزنك طالع',
      p: [
        'وزنك زاد هالأسبوع. لو هدفك التنشيف، راجع أكلك. الأوزان بالحديد بتزيد عادي — ما تتأثر بهذا.',
      ],
    };
  }
  return {
    gate: 'go',
    kind: 'go',
    dW,
    dM,
    t: 'وضعك سليم — نزيد',
    p: [
      'نزولك بالمعدل الصحي (نصف كيلو لكيلو بالأسبوع تقريباً) وجسمك يتحمل زيادة الحمل. نمشي للأمام.',
    ],
  };
}

/* ────────────────────────── weight progression ────────────────────────── */

/**
 * Decide next week's working weights.
 * A lift only goes up when every set was completed AND the week's gate is "go".
 * "light" earns a double jump, unless that jump would exceed 20% of the load.
 */
export function progress(weights, log, v) {
  const out = {};
  const sets = log?.sets || {};
  const fbAll = log?.fb || {};

  for (const [id, rawW] of Object.entries(weights || {})) {
    const e = exById(id);
    const w = Number(rawW);
    if (!e || !Number.isFinite(w)) continue;
    if (e.body) {
      out[id] = w;
      continue;
    }
    const st = sets[id] || [];
    const done = st.length === e.sets && st.every(Boolean);
    const fb = fbAll[id];

    if (v?.gate === 'hold' || !done || fb === 'heavy') {
      out[id] = w;
      continue;
    }
    let mult = fb === 'light' ? 2 : 1;
    if (mult === 2 && !e.inverse && e.step * 2 > w * 0.2) mult = 1;
    out[id] = e.inverse ? Math.max(0, round1(w - e.step * mult)) : round1(w + e.step * mult);
  }
  return out;
}

/* ────────────────────────── volume ────────────────────────── */

export function dayVolume(dayExercises, weights, sets) {
  let total = 0;
  for (const e of dayExercises) {
    if (e.body || e.time || e.inverse) continue;
    const reps = e.repsN || 10;
    const done = (sets?.[e.id] || []).filter(Boolean).length;
    total += done * (Number(weights?.[e.id]) || 0) * reps * (e.hand ? 2 : 1);
  }
  return total;
}

/* ────────────────────────── nutrition ────────────────────────── */

/**
 * Mifflin-St Jeor, male.
 * Height matters: a taller body burns more at rest, so two people at the same
 * weight get different maintenance numbers. `height` falls back to a sane
 * default only for legacy records saved before the field existed.
 */
export function tdeeFormula(kg, age, activity, height = HEIGHT_CM) {
  const cm = Number.isFinite(height) ? height : HEIGHT_CM;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + 5;
  return Math.round(bmr * activity);
}

/** 500 kcal deficit, floored at the larger of 1700 kcal or 75% of maintenance. */
export function safeTarget(tdee) {
  const floor = Math.max(1700, Math.round(tdee * 0.75));
  return Math.max(floor, tdee - 500);
}

export function avgCal(cal) {
  const values = (cal?.d || []).filter((x) => Number(x) > 0).map(Number);
  if (!values.length) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return { avg: Math.round(sum / values.length), days: values.length, sum };
}

export function avgPro(cal) {
  const values = (cal?.p || []).filter((x) => Number(x) > 0).map(Number);
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Real maintenance calories measured from behaviour rather than a formula:
 *   maintenance = average intake − (weight change × 7700 / 7)
 * Only weeks with at least 4 logged days and a body weight on both ends count.
 */
export function measuredTDEE(calHist, bodyHist) {
  const samples = [];
  for (const key of Object.keys(calHist || {})) {
    const i = Number(key);
    if (!Number.isInteger(i)) continue;
    const a = avgCal(calHist[i]);
    const prev = bodyHist?.[i - 1];
    const cur = bodyHist?.[i];
    if (a && a.days >= 4 && prev?.weight && cur?.weight) {
      const dkg = cur.weight - prev.weight;
      samples.push(Math.round(a.avg - (dkg * KCAL_PER_KG) / 7));
    }
  }
  if (!samples.length) return null;
  return {
    val: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length),
    weeks: samples.length,
  };
}

export function proteinTarget(kg) {
  return Math.round(kg * 1.6);
}

/* ────────────────────────── misc ────────────────────────── */

export function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Sat=0 … Fri=6, matching the CARDIO/WEEK arrays. */
export function cardioIndexForToday(date = new Date()) {
  return [1, 2, 3, 4, 5, 6, 0][date.getDay()];
}

export function todayKey(date = new Date()) {
  const g = date.getDay();
  if (g === 6) return 'sat';
  if (g === 1) return 'mon';
  if (g === 3) return 'wed';
  if (g === 5) return 'rest';
  return 'cardio';
}

export function formatRest(seconds) {
  if (seconds >= 120 && seconds % 60 === 0) {
    const m = seconds / 60;
    return m === 2 ? 'دقيقتين' : `${m} دقائق`;
  }
  if (seconds === 60) return 'دقيقة';
  return `${seconds} ث`;
}

export const EXERCISE_COUNT = ALL_EXERCISES.length;
