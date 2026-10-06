/**
 * منطق البرنامج: قرار الأسبوع، زيادة الأوزان، وحسبة السعرات.
 * Pure functions only — no DOM, no storage. Imported by the app and the tests.
 */

import { ALL_EXERCISES, exById, goalOf, DEFAULT_GOAL, arrangeWeek, planOf } from './program.js';

export const MAX_WEEK = 520; // ~10 years. Bounds the week navigator and the stored doc.
export const KCAL_PER_KG = 7700;
export const HEIGHT_CM = 183;

/* ────────────────────────── weekly verdict ────────────────────────── */

/**
 * What each outcome says, per goal.
 *
 * The same measurement means opposite things depending on the goal: putting on
 * 0.4 kg is a warning while cutting and the whole point while building. Only
 * the prose lives here — the thresholds are data on the goal itself.
 */
const VERDICT_TEXT = {
  none: {
    t: 'ما فيه قياس لهالأسبوع',
    p: 'بنزيد على أساس إحساسك بالأوزان بس. سجّل وزنك آخر يوم بالأسبوع عشان القرار يصير أدق.',
  },
  base: {
    t: 'قياس الأساس انحفظ',
    p: 'هذا أول قياس، منه نبدأ نقيس. الأسبوع الجاي بتشوف المقارنة.',
  },
  cut: {
    fast: {
      t: 'نزولك أسرع من اللازم',
      p: [
        'نزلت أكثر من 1.2% من وزنك بأسبوع واحد. بهالسرعة جزء من النزول عضل مو دهون، وجسمك ما يقدر يتعافى من زيادة أوزان. ',
        { b: 'ثبّت الأوزان هالأسبوع' },
        ' وارفع أكلك شوي — خصوصاً البروتين.',
      ],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: [
        'نزلت كتلتك العضلية نص كيلو أو أكثر. ثبّت الأوزان، ارفع البروتين، وخفّف الكارديو يوم واحد هالأسبوع. لو تكررت 3 أسابيع، العجز عندك كبير زيادة.',
      ],
    },
    gain: {
      t: 'وزنك طالع',
      p: [
        'وزنك زاد هالأسبوع. لو هدفك التنشيف، راجع أكلك. الأوزان بالحديد بتزيد عادي — ما تتأثر بهذا.',
      ],
    },
    ok: {
      t: 'وضعك سليم — نزيد',
      p: [
        'نزولك بالمعدل الصحي (نصف كيلو لكيلو بالأسبوع تقريباً) وجسمك يتحمل زيادة الحمل. نمشي للأمام.',
      ],
    },
  },
  muscle: {
    fast: {
      t: 'تنزل وأنت تبي تكبّر',
      p: [
        'وزنك نزل، وما تكبر عضلة بعجز سعرات. ',
        { b: 'ارفع أكلك ٣٠٠ سعرة' },
        ' وثبّت الأوزان هالأسبوع لين وزنك يبدأ يطلع.',
      ],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: ['ثبّت الأوزان وارفع البروتين والسعرات. تنزل كتلة وأنت تبي تكبّر يعني أكلك قليل.'],
    },
    gain: {
      t: 'تكبر بسرعة زيادة',
      p: [
        'زيادتك أسرع من ',
        { b: '٠.٥٪ من وزنك بالأسبوع' },
        ' — يعني أغلب اللي يجيك دهون مو عضل. نزّل أكلك ١٥٠–٢٠٠ سعرة. الأوزان تكمل تزيد عادي.',
      ],
    },
    stall: {
      t: 'وزنك ثابت — ارفع أكلك',
      p: [
        'ما زاد وزنك هالأسبوع. لو تكرر أسبوعين، ',
        { b: 'ارفع سعراتك ٢٠٠' },
        '. الأوزان تكمل تزيد، بس نموّك بيتوقف بدون سعرات زايدة.',
      ],
    },
    ok: {
      t: 'تكبر بالمعدل الصح',
      p: [
        'زيادتك داخل المدى الصحي (٠.١٥–٠.٥٪ بالأسبوع). عضلك يبني وأنت ما تخزّن دهون كثير. كمّل على نفس النظام.',
      ],
    },
  },
  recomp: {
    fast: {
      t: 'نزولك أسرع من اللازم',
      p: [
        'هدفك تشد مو تنشّف بسرعة، وبهالمعدل بتخسر عضل معاها. ',
        { b: 'ثبّت الأوزان وارفع أكلك شوي' },
        '.',
      ],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: [
        'ثبّت الأوزان، ارفع البروتين، وخفّف الكارديو يوم واحد. الشد كله قائم على إن عضلك يبقى.',
      ],
    },
    gain: {
      t: 'وزنك طالع أكثر من اللازم',
      p: ['هدفك الثبات تقريبًا، فراجع أكلك. الأوزان بالحديد تكمل تزيد عادي.'],
    },
    ok: {
      t: 'وضعك سليم — نزيد',
      p: [
        'وزنك شبه ثابت وهذا بالضبط المطلوب في الشد: جسمك يستبدل دهون بعضل، فالميزان يتحرك ببطء والشكل يتغير.',
      ],
    },
  },
  fitness: {
    fast: {
      t: 'نزولك أسرع من اللازم',
      p: [
        'هدفك اللياقة مو النزول السريع. بهالمعدل بتحس بتعب داخل التمرين وأدائك ينزل. ',
        { b: 'ارفع أكلك' },
        '.',
      ],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: ['ارفع البروتين وثبّت الأوزان هالأسبوع.'],
    },
    ok: {
      t: 'وضعك سليم — نكمل',
      p: [
        'وزنك بمدى مستقر. مقياسك هنا مو الميزان — هو إنك تكمّل أيامك، ونفسك يطول، ونبضك يرجع أسرع بعد المجهود.',
      ],
    },
  },
  cardio: {
    fast: {
      t: 'نزولك أسرع من اللازم',
      p: [
        'نزلت أكثر من 1.5% من وزنك بأسبوع، وأنت ما ترفع أي وزن — يعني جزء كبير من اللي راح عضل مو دهون. ',
        { b: 'ارفع أكلك ٢٠٠ سعرة وثبّت على بروتينك' },
        '، وخفّف يوم كارديو واحد. الميزان بينزل أبطأ، بس اللي بينزل دهون.',
      ],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: [
        'نزلت كتلتك العضلية نص كيلو أو أكثر. بدون حديد هذا أهم إنذار عندك: ارفع البروتين، ولا تفوّت بلوك الجسم، وخفّف كارديو يوم واحد هالأسبوع.',
      ],
    },
    gain: {
      t: 'وزنك طالع',
      p: [
        'وزنك زاد هالأسبوع مع إن العجز كبير. راجع أكلك بصدق قبل ما تزيد الدقائق — ما ينحل بكارديو أكثر.',
      ],
    },
    ok: {
      t: 'ماشي صح — كمّل',
      p: [
        'نزولك بالمعدل اللي يخلي الدهون تروح والعضل يبقى. كمّل على نفس الدقائق، ولا تفوّت بلوك الجسم — هو اللي يفرّق بين إنك تنشف وإنك تصغر بس.',
      ],
    },
  },
  strength: {
    fast: {
      t: 'تنزل وأنت تبي تقوى',
      p: ['ما تقوى وأنت تنزل وزن. ', { b: 'ارفع أكلك' }, ' وثبّت الأوزان هالأسبوع.'],
    },
    muscle: {
      t: 'الكتلة العضلية نازلة',
      p: ['ارفع أكلك وبروتينك، وثبّت الأوزان. القوة تنبني على عضل موجود.'],
    },
    gain: {
      t: 'زيادتك أسرع من اللازم',
      p: ['تقدر تقوى بزيادة أبطأ من كذا. نزّل أكلك شوي — الأوزان تكمل تزيد عادي.'],
    },
    ok: {
      t: 'جاهز تزيد الأوزان',
      p: ['وزنك ثابت أو طالع شوي، وهذا بالضبط الوضع اللي تقوى فيه. زد الأوزان وحافظ على شكلك.'],
    },
  },
};

/**
 * @param {{weight:number, muscle:number|null}|null} cur  this week's measurement
 * @param {{weight:number, muscle:number|null}|null} prev last week's measurement
 * @param {string} [goalKey] the trainee's goal; decides which direction is good
 */
export function verdict(cur, prev, goalKey = DEFAULT_GOAL) {
  if (!cur || !cur.weight) return { gate: 'go', kind: 'go', ...VERDICT_TEXT.none };
  if (!prev || !prev.weight) return { gate: 'go', kind: 'go', ...VERDICT_TEXT.base };

  const rules = goalOf(goalKey).verdict;
  const text = VERDICT_TEXT[goalKey] || VERDICT_TEXT[DEFAULT_GOAL];

  const dW = round1(cur.weight - prev.weight);
  const pct = (dW / prev.weight) * 100;
  const dM =
    Number.isFinite(cur.muscle) && Number.isFinite(prev.muscle)
      ? round1(cur.muscle - prev.muscle)
      : null;

  const out = (gate, kind, key) => ({ gate, kind, dW, dM, ...(text[key] || text.ok) });

  // Losing faster than the goal tolerates: no goal adds load on top of that.
  if (rules.holdLossBelow !== null && pct <= rules.holdLossBelow) return out('hold', 'warn', 'fast');
  if (rules.muscleDropKg !== null && dM !== null && dM <= rules.muscleDropKg) {
    return out('hold', 'warn', 'muscle');
  }
  // Gaining or stalling is worth saying, but neither blocks progression — the
  // bar does not care why the scale moved.
  if (rules.warnGainAbove !== null && pct >= rules.warnGainAbove) return out('go', 'hold', 'gain');
  if (rules.stallBelow !== null && pct < rules.stallBelow) return out('go', 'hold', 'stall');
  return out('go', 'go', 'ok');
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
 * Mifflin-St Jeor.
 * Height matters: a taller body burns more at rest, so two people at the same
 * weight get different maintenance numbers. `height` falls back to a sane
 * default only for legacy records saved before the field existed.
 */
export function bmrOf(kg, age, height = HEIGHT_CM, sex = 'm') {
  const cm = Number.isFinite(height) ? height : HEIGHT_CM;
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5);
}

/** The legacy one-multiplier estimate: BMR × an activity factor that already includes the gym. */
export function tdeeFormula(kg, age, activity, height = HEIGHT_CM) {
  return Math.round(bmrOf(kg, age, height) * activity);
}

/**
 * What the day looks like outside the gym. The factor covers the body at rest
 * plus everything that is not planned exercise — walking to the car, standing
 * at a counter, carrying boxes — and nothing else: the training is added on
 * top from the programme itself, so it is never counted twice.
 */
export const JOBS = [
  { k: 'desk', f: 1.2, n: 'مكتبي — جالس أغلب اليوم', hint: 'دوام مكتب، طالب، سواقة' },
  { k: 'light', f: 1.3, n: 'خفيف — أقوم وأتحرك شوي', hint: 'معلم، مبيعات، شغل بين مكتب وميدان' },
  { k: 'feet', f: 1.42, n: 'واقف أغلب اليوم', hint: 'كاشير، مطبخ، تمريض، محل' },
  { k: 'labor', f: 1.6, n: 'شغل بدني', hint: 'بناء، مستودع، توصيل، شيل وحمل' },
];
export const JOB_KEYS = JOBS.map((j) => j.k);
export const jobOf = (key) => JOBS.find((j) => j.k === key) || null;

/**
 * The old single activity factor (gym included) mapped to the nearest job, so
 * the edit form opens on something sensible for a profile saved before jobs.
 */
export function jobFromAct(act) {
  if (!Number.isFinite(act)) return 'light';
  if (act <= 1.45) return 'desk';
  if (act <= 1.65) return 'light';
  return 'labor';
}

/**
 * Metabolic equivalents for a whole session, rest periods included, from the
 * 2024 Adult Compendium of Physical Activities: resistance training with
 * multiple exercises ≈ 3.5–5, calisthenics at moderate effort ≈ 3.8,
 * stretching ≈ 2.3, steady cardio "out of breath but can talk" ≈ 5–7
 * depending on the machine.
 */
export const MET = { lift: 4.5, body: 3.8, stretch: 2.3, cardio: 5.8 };
/** Seconds one working set takes before its rest, for exercises counted in reps. */
const SET_SECONDS = 40;

/** One exercise's share of a session, in minutes, with the rest after each set. */
function exerciseMinutes(e) {
  const work = e.time ? Number(e.base) || 30 : SET_SECONDS;
  return ((Number(e.sets) || 0) * (work + (Number(e.rest) || 0))) / 60;
}

const kindOf = (e) => (e.time && !e.step ? 'stretch' : e.body || e.time ? 'body' : 'lift');

/**
 * The planned training of one week, weekday by weekday, and what it burns on
 * top of the day itself. Net of rest: the BMR × job figure already counts the
 * hour spent in the gym as an ordinary hour, so only the extra is added —
 * (MET − 1) × kg × hours.
 *
 * Derived from the goal and the trainee's rest days, so switching from a
 * three-day cut to a six-day cardio week moves the number without anyone
 * touching a setting.
 *
 * @returns {{ days: {lift:number, cardio:number, kcal:number}[], liftMin:number,
 *   cardioMin:number, weekKcal:number, perDay:number }}
 */
export function trainingBurn(goalKey = DEFAULT_GOAL, restDays = null, kg = 80) {
  const { lift, cardio } = arrangeWeek(goalKey, restDays);
  const plan = planOf(goalKey, restDays);
  const days = lift.map((key, i) => {
    const kcalPerMin = { lift: 0, body: 0, stretch: 0 };
    let liftMin = 0;
    for (const e of key ? plan[key]?.ex || [] : []) {
      const min = exerciseMinutes(e);
      liftMin += min;
      kcalPerMin[kindOf(e)] += min;
    }
    const cardioMin = Number(cardio[i]?.min) || 0;
    const kcal =
      ((kcalPerMin.lift * (MET.lift - 1) +
        kcalPerMin.body * (MET.body - 1) +
        kcalPerMin.stretch * (MET.stretch - 1) +
        cardioMin * (MET.cardio - 1)) *
        kg) /
      60;
    return { lift: Math.round(liftMin), cardio: cardioMin, kcal: Math.round(kcal) };
  });
  const weekKcal = days.reduce((a, d) => a + d.kcal, 0);
  return {
    days,
    liftMin: days.reduce((a, d) => a + d.lift, 0),
    cardioMin: days.reduce((a, d) => a + d.cardio, 0),
    weekKcal,
    perDay: Math.round(weekKcal / 7),
  };
}

/**
 * Maintenance, piece by piece: the body at rest, the day around it, and the
 * programme's training averaged over the week. Null when the profile predates
 * the job question — `formulaTdee` then keeps the old single factor.
 */
export function energyBreakdown(nutrition, weight, goalKey = DEFAULT_GOAL, restDays = null) {
  const job = jobOf(nutrition?.job);
  if (!job || !Number.isFinite(weight) || !Number.isFinite(nutrition.age)) return null;
  const bmr = Math.round(bmrOf(weight, nutrition.age, nutrition.height, nutrition.sex));
  const daily = Math.round(bmr * job.f) - bmr;
  const training = trainingBurn(goalKey, restDays, weight);
  return { bmr, job, daily, training, tdee: bmr + daily + training.perDay };
}

/**
 * The daily calorie target for a goal.
 *
 * A deficit is floored so nobody is ever told to eat too little; a surplus is
 * capped so "bulking" does not become an excuse to gain mostly fat.
 */
export function safeTarget(tdee, goalKey = DEFAULT_GOAL) {
  const n = goalOf(goalKey).nutrition;
  const raw = Math.round(tdee + n.delta);
  if (n.delta < 0) {
    const floor = Math.max(n.floorKcal ?? 1700, Math.round(tdee * (n.floorPct ?? 0.75)));
    return Math.max(floor, raw);
  }
  if (n.delta > 0) return Math.min(Math.round(tdee * (n.capPct ?? 1.15)), raw);
  return raw;
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

/** How hard each new week pulls the learned maintenance toward what it saw. */
export const LEARN_RATE = 0.3;
/** The most one week may move the learned maintenance, in kcal/day. */
export const LEARN_MAX_STEP = 250;
/** How far the learned value may stray from the formula before it is distrusted. */
export const LEARN_MAX_DRIFT = 0.35;
/** Smoothing for the trend weight; a single scale reading only counts this much. */
const TREND_ALPHA = 0.4;

/**
 * Real maintenance calories, learned week by week from behaviour:
 *   sample = average intake − (trend-weight change × 7700 / 7)
 *
 * One raw week is a poor witness. A kilo of water lost in the first week of a
 * diet reads as 1,100 extra calories a day, and one heavy weigh-in reads as a
 * feast. So the scale reading goes through a trend line first, and each week
 * only nudges the estimate a fraction of the way toward its sample, starting
 * from the formula (`prior`). The more weeks logged, the further the estimate
 * is allowed to have walked from the formula — but never past LEARN_MAX_DRIFT.
 *
 * Only weeks with at least 4 logged days and a body weight on both ends count.
 * Without a prior the first sample seeds the estimate.
 *
 * @returns {{val:number, weeks:number, samples:Array<{week:number, avg:number,
 *   trendKg:number, sample:number, est:number}>}|null}
 */
export function measuredTDEE(calHist, bodyHist, prior = null) {
  const trend = {};
  const weekNums = Object.keys(bodyHist || {})
    .map(Number)
    .filter((n) => Number.isInteger(n) && Number(bodyHist[n]?.weight) > 0)
    .sort((a, b) => a - b);
  let last = null;
  for (const n of weekNums) {
    const w = Number(bodyHist[n].weight);
    last = last === null ? w : last + TREND_ALPHA * (w - last);
    trend[n] = last;
  }

  const hasPrior = Number.isFinite(prior);
  let est = hasPrior ? prior : null;
  const samples = [];
  const calWeeks = Object.keys(calHist || {})
    .map(Number)
    .filter(Number.isInteger)
    .sort((a, b) => a - b);
  for (const i of calWeeks) {
    const a = avgCal(calHist[i]);
    if (!a || a.days < 4 || trend[i - 1] === undefined || trend[i] === undefined) continue;
    const dkg = trend[i] - trend[i - 1];
    const sample = Math.round(a.avg - (dkg * KCAL_PER_KG) / 7);
    if (est === null) {
      est = sample;
    } else {
      const step = LEARN_RATE * (sample - est);
      est += Math.max(-LEARN_MAX_STEP, Math.min(LEARN_MAX_STEP, step));
    }
    if (hasPrior) {
      est = Math.max(prior * (1 - LEARN_MAX_DRIFT), Math.min(prior * (1 + LEARN_MAX_DRIFT), est));
    }
    samples.push({ week: i, avg: a.avg, trendKg: Math.round(dkg * 10) / 10, sample, est: Math.round(est) });
  }
  if (!samples.length) return null;
  return { val: Math.round(est), weeks: samples.length, samples };
}

export function proteinTarget(kg, goalKey = DEFAULT_GOAL) {
  return Math.round(kg * goalOf(goalKey).nutrition.proteinPerKg);
}

/* ────────────────────────── meals and macros ────────────────────────── */

/** Calories per gram. */
const KCAL_PER_G = { p: 4, f: 9, c: 4 };

/**
 * The day's four targets. Protein comes from the goal; fat is about a quarter
 * of the calories but never under 0.6 g/kg (hormones need it); carbs fill
 * whatever is left. Carbs are the flexible part — cutting them is how the
 * deficit is made, so they absorb the difference rather than protein or fat.
 */
export function macroTargets(kcal, kg, goalKey = DEFAULT_GOAL) {
  const protein = proteinTarget(kg, goalKey);
  const fat = Math.max(Math.round(kg * 0.6), Math.round((kcal * 0.27) / KCAL_PER_G.f));
  const carbs = Math.max(0, Math.round((kcal - protein * KCAL_PER_G.p - fat * KCAL_PER_G.f) / KCAL_PER_G.c));
  return { kcal: Math.round(kcal), protein, fat, carbs };
}

/** Sum of a day's meals. An empty or missing list is "not logged": null, not zeros. */
export function mealTotals(meals) {
  if (!Array.isArray(meals) || !meals.length) return null;
  const sum = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const m of meals) {
    sum.kcal += Number(m.k) || 0;
    sum.protein += Number(m.p) || 0;
    sum.fat += Number(m.f) || 0;
    sum.carbs += Number(m.c) || 0;
  }
  return {
    kcal: Math.round(sum.kcal),
    protein: Math.round(sum.protein),
    fat: Math.round(sum.fat),
    carbs: Math.round(sum.carbs),
  };
}

/**
 * Same-day alerts, most important first. Going over shows the moment it
 * happens; protein short is only raised late in the evening of the day itself,
 * because at lunch half of it simply has not been eaten yet. A day with nothing
 * logged raises nothing — skipping a meal is a choice, not a mistake.
 *
 * @param {{kcal,protein,fat,carbs}|null} totals
 * @param {{kcal,protein,fat,carbs}} targets
 * @param {{ isToday?: boolean, hour?: number }} [when]
 * @returns {{ key: string, level: 'over'|'short', text: string }[]}
 */
export function mealAlerts(totals, targets, { isToday = false, hour = 12 } = {}) {
  if (!totals || !targets) return [];
  const out = [];
  const over = (key, limit, label) => {
    if (targets[key] > 0 && totals[key] > targets[key] * limit) {
      out.push({
        key,
        level: 'over',
        text: `${label} ${totals[key]} من ${targets[key]} — فوق هدفك بـ ${totals[key] - targets[key]}`,
      });
    }
  };
  over('kcal', 1.1, 'السعرات');
  over('fat', 1.2, 'الدهون');
  over('carbs', 1.25, 'الكارب');
  const dayDone = !isToday || hour >= 20;
  if (dayDone && targets.protein > 0 && totals.protein < targets.protein * 0.7) {
    out.push({
      key: 'protein',
      level: 'short',
      text: `البروتين ${totals.protein} من ${targets.protein} — ناقص ${targets.protein - totals.protein} جرام`,
    });
  }
  return out;
}

/** فطور / غدا / عشا / سناك — an optional tag on a meal, not a slot to fill. */
export const MEAL_SLOTS = ['فطور', 'غدا', 'عشا', 'سناك'];

/** A sensible default tag from the time of day; the user can change or clear it. */
export function slotForHour(hour) {
  if (hour >= 4 && hour < 11) return 0;
  if (hour >= 11 && hour < 16) return 1;
  if (hour >= 18 && hour < 23) return 2;
  return 3;
}

/** Weeks of meal detail kept; older weeks keep their daily totals only. */
export const MEAL_WEEKS_KEPT = 26;

/**
 * Maintenance calories from the formula alone, at today's weight: BMR × the
 * job, plus the programme's own training. A profile saved before the job
 * question keeps its single activity factor until it is edited.
 */
export function formulaTdee(nutrition, weight, goalKey = DEFAULT_GOAL, restDays = null) {
  if (!nutrition) return null;
  const parts = energyBreakdown(nutrition, weight, goalKey, restDays);
  if (parts) return parts.tdee;
  if (Number.isFinite(weight) && Number.isFinite(nutrition.age)) {
    return tdeeFormula(weight, nutrition.age, nutrition.act ?? 1.55, nutrition.height);
  }
  // Nothing to recompute from: fall back to whatever was last stored.
  return Number.isFinite(nutrition.tdee) ? nutrition.tdee : null;
}

/**
 * Maintenance calories as of today.
 *
 * Deliberately derived rather than stored. A number worked out once at sign-up
 * is wrong the moment the body it describes changes — lose fifteen kilos on a
 * frozen target and you are eating for a person who no longer exists. The same
 * goes for a measured value: `learned` is recomputed from the log every time
 * (see measuredTDEE) and beats the formula, because it comes from what
 * actually happened to this person's weight at a known intake. The stored
 * `nutrition.measuredTdee` is no longer read: it froze one reading forever.
 */
export function effectiveTdee(nutrition, weight, learned = null, goalKey = DEFAULT_GOAL, restDays = null) {
  if (!nutrition) return null;
  if (Number.isFinite(learned)) return learned;
  return formulaTdee(nutrition, weight, goalKey, restDays);
}

/** The daily calorie target for today's weight, the current goal and its week. */
export function dailyTarget(nutrition, weight, goalKey = DEFAULT_GOAL, learned = null, restDays = null) {
  const tdee = effectiveTdee(nutrition, weight, learned, goalKey, restDays);
  return tdee === null ? null : safeTarget(tdee, goalKey);
}

/* ────────────────────────── goal review ────────────────────────── */

export const GOAL_REVIEW_WEEKS = 8;
export const GOAL_REVIEW_PCT = 7;

/**
 * Is it time to ask whether the goal still fits?
 *
 * A goal is a phase, not a setting. Someone who set out to cut and has since
 * dropped 8% of their body weight is probably done cutting, and nothing in the
 * app would ever have said so.
 *
 * @returns {{t:string, p:string}|null}
 */
export function goalReview({ profile, weight, goalKey = DEFAULT_GOAL, now = Date.now() }) {
  if (!profile?.ts) return null;
  const goal = goalOf(goalKey);

  const start = Number(profile.startWeight);
  if (Number.isFinite(start) && start > 0 && Number.isFinite(weight)) {
    const pct = ((weight - start) / start) * 100;
    if (Math.abs(pct) >= GOAL_REVIEW_PCT) {
      const moved = round1(Math.abs(weight - start));
      const down = pct < 0;
      return {
        t: down ? `نزلت ${moved} كجم على هدف ${goal.n}` : `زدت ${moved} كجم على هدف ${goal.n}`,
        p: down
          ? 'تغيّر واضح. لو وصلت للي تبيه، فكّر تنتقل لبناء عضل أو شد الجسم — الاستمرار بعجز طويل يوقف تقدمك.'
          : 'تغيّر واضح. لو وصلت للي تبيه، فكّر تنتقل للتنشيف أو شد الجسم.',
      };
    }
  }

  const weeks = Math.floor((now - profile.ts) / (7 * 24 * 60 * 60 * 1000));
  if (weeks >= GOAL_REVIEW_WEEKS) {
    return {
      t: `صار لك ${weeks} أسبوع على هدف ${goal.n}`,
      p: 'راجع هدفك لو تغيّر وضعك. ولو لسا نفس الهدف، كمّل — بس خلّ الاختيار قرارك مو نسيان.',
    };
  }
  return null;
}

/* ────────────────────────── records ────────────────────────── */

/**
 * The lifts whose working weight this week beats every earlier week.
 *
 * The app logs the weight a lift was done at and whether each set was
 * finished — not reps — so a record here is "the heaviest you have trained
 * this movement at", which is what the progression actually moves. On an
 * assisted lift less help is the stronger number, so the comparison flips.
 *
 * @param {Record<string, number[]>} history  per exercise, one value per week, oldest first
 * @param {string[]} ids  which lifts to consider, in display order
 * @param {(id: string) => boolean} [inverse]  true where lower is better
 * @returns {{id: string, now: number, best: number}[]}  best = the record it beat
 */
export function newRecords(history, ids, inverse = () => false) {
  const out = [];
  for (const id of ids) {
    const values = history[id];
    if (!values || values.length < 2) continue;
    const now = values[values.length - 1];
    const earlier = values.slice(0, -1);
    const lower = inverse(id);
    const best = lower ? Math.min(...earlier) : Math.max(...earlier);
    if (lower ? now < best : now > best) out.push({ id, now, best });
  }
  return out;
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

/* ────────────────────────── learning from what was eaten ────────────────────────── */

/** Most foods remembered; the least recently used one makes room for a new one. */
export const MAX_FOODS = 300;

/**
 * One spelling per food, so «أرز», «ارز» and «ارز » are the same entry: no
 * diacritics, one alef, ة→ه, ى→ي, lower case, single spaces.
 */
export function foodKey(name) {
  return String(name || '')
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remember a saved meal. The numbers stored are the ones the user saved last —
 * which after a correction are their own, not the scan's — so the next time
 * the same food comes up it fills in the way they fixed it.
 */
export function rememberFood(foods, meal, now = Date.now()) {
  const key = foodKey(meal?.n);
  if (!key) return foods || [];
  const list = [...(foods || [])];
  const at = list.findIndex((f) => foodKey(f.n) === key);
  const entry = {
    id: at >= 0 ? list[at].id : meal.id,
    n: String(meal.n).slice(0, 80),
    k: meal.k || 0,
    p: meal.p || 0,
    f: meal.f || 0,
    c: meal.c || 0,
    u: (at >= 0 ? list[at].u || 0 : 0) + 1,
    t: now,
  };
  if (at >= 0) list[at] = entry;
  else list.push(entry);
  if (list.length > MAX_FOODS) {
    list.sort((a, b) => (b.t || 0) - (a.t || 0));
    list.length = MAX_FOODS;
  }
  return list;
}

/**
 * Foods to offer while typing a name — or, with nothing typed, the ones eaten
 * most often lately, for a one-tap re-log. Starts-with beats contains.
 */
export function suggestFoods(foods, query = '', limit = 5, now = Date.now()) {
  const q = foodKey(query);
  const score = (f) => (f.u || 1) / (1 + (now - (f.t || 0)) / (7 * 24 * 60 * 60 * 1000));
  const ranked = (foods || [])
    .map((f) => {
      const key = foodKey(f.n);
      const match = !q ? 1 : key.startsWith(q) ? 2 : key.includes(q) ? 1 : 0;
      return { f, match, s: score(f) };
    })
    .filter((x) => x.match > 0 && (!q || foodKey(x.f.n) !== q))
    .sort((a, b) => b.match - a.match || b.s - a.s);
  return ranked.slice(0, limit).map((x) => x.f);
}

/** The remembered food with exactly this name, if any. */
export const knownFood = (foods, name) => {
  const key = foodKey(name);
  return key ? (foods || []).find((f) => foodKey(f.n) === key) || null : null;
};

const WEEKDAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/**
 * Patterns across the last four finished weeks, at most two, most useful
 * first. Only logged days count: a skipped breakfast or an unlogged day is
 * never read as a problem.
 *
 *  - the same weekday over on calories or fat in at least 3 of 4 weeks
 *  - protein short on most logged days
 *  - snacks carrying more than a third of the calories on over days
 *
 * @param {Record<string, object>} weeks   the document's weeks
 * @param {number} currentWeek
 * @param {{kcal,protein,fat,carbs}} targets
 * @returns {{ key: string, text: string }[]}
 */
export function mealHabits(weeks, currentWeek, targets) {
  const recent = [];
  for (let n = currentWeek - 4; n < currentWeek; n++) {
    if (n >= 1 && weeks?.[String(n)]) recent.push(weeks[String(n)]);
  }
  if (!targets?.kcal || recent.length < 3) return [];

  const tips = [];
  const overBy = Array(7).fill(0);
  let logged = 0;
  let proteinShort = 0;
  let snackKcal = 0;
  let overKcal = 0;

  for (const week of recent) {
    for (let day = 0; day < 7; day++) {
      const meals = week.meals?.[day];
      const totals = mealTotals(meals);
      if (!totals) continue;
      logged++;
      const over = totals.kcal > targets.kcal * 1.1 || totals.fat > targets.fat * 1.2;
      if (over) {
        overBy[day]++;
        overKcal += totals.kcal;
        snackKcal += meals.filter((m) => m.s === 3).reduce((a, m) => a + (Number(m.k) || 0), 0);
      }
      if (totals.protein < targets.protein * 0.75) proteinShort++;
    }
  }

  const worst = overBy.reduce((best, count, day) => (count > overBy[best] ? day : best), 0);
  if (overBy[worst] >= 3) {
    tips.push({
      key: 'weekday',
      text: `كل ${WEEKDAY_NAMES[worst]} تقريباً تطلع فوق هدفك (${overBy[worst]} من آخر ${recent.length} أسابيع). خطّط له من بدري — وجبة أخف قبله أو بعده.`,
    });
  }
  if (logged >= 6 && proteinShort / logged >= 0.6) {
    tips.push({
      key: 'protein',
      text: `بروتينك ناقص في ${proteinShort} من ${logged} يوم سجّلته. أسهل حل: مصدر بروتين واحد زيادة (لبن، بيض، تونة، دجاج) بأي وجبة.`,
    });
  }
  if (overKcal > 0 && snackKcal / overKcal > 0.33) {
    tips.push({
      key: 'snacks',
      text: 'بالأيام اللي تزيد فيها، السناك يشيل أكثر من ثلث السعرات. هنا أسهل مكان تقص منه.',
    });
  }
  return tips.slice(0, 2);
}
