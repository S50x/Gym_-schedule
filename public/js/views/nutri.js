import { el, richText } from '../dom.js';
import { fmt, bulletList } from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
import { DAY_NAMES, DAY_LETTERS, goalOf } from '../program.js';
import {
  avgCal,
  avgPro,
  measuredTDEE,
  proteinTarget,
  effectiveTdee,
  formulaTdee,
  dailyTarget,
  energyBreakdown,
  macroTargets,
  mealTotals,
  mealAlerts,
  mealHabits,
} from '../engine.js';
import { mealPanel } from './meals.js';
import { scanActions } from './foodscan.js';

export function renderNutri(ctx) {
  const { store } = ctx;
  const wk = store.viewWeek;
  const week = store.week(wk);
  const goalKey = store.goal;
  const goal = goalOf(goalKey);
  const bodyWeight = week.body?.weight || lastKnownWeight(store) || 80;

  // Age and height are collected during onboarding. If they are missing the
  // document predates it, so send the user through it rather than duplicating
  // the form here.
  if (!store.doc.nutrition?.age) {
    return el(
      'div',
      { class: 'wrap' },
      el('h3', { class: 'first', text: 'ناقص إعداد بسيط' }),
      el(
        'div',
        { class: 'card' },
        el('div', {
          class: 'mut',
          text: 'أحتاج عمرك وطولك ونشاطك عشان أحسب سعراتك. دقيقة وحدة وتخلص.',
        }),
        el('button', {
          class: 'cta',
          text: 'كمّل الإعداد',
          on: { click: () => ctx.editProfile() },
        })
      )
    );
  }

  // Recomputed from today's weight and the whole log every time this page
  // opens, so the target follows the body instead of the number it had on day one.
  const { tdee, target, protein, parts, learned } = numbers(store, bodyWeight, goalKey);
  const targets = macroTargets(target, bodyWeight, goalKey);
  // Weekday index of today (Sat=0 … Fri=6), only meaningful in the current week.
  const todayIndex = wk === store.currentWeek ? [1, 2, 3, 4, 5, 6, 0][new Date().getDay()] : -1;

  /* ── day rows ── */
  const summaryBox = el('div', {});
  const heroArgs = { store, wk, todayIndex, target, tdee, protein, targets };
  // The card itself is the page's first child, not a wrapper around it — the
  // tabs line their first line of text up against each other — so a repaint
  // swaps the node rather than its contents.
  let heroBox = todayCard(heroArgs);
  const paint = () => {
    summaryBox.replaceChildren(summaryCard(store, wk, bodyWeight, goalKey));
    const next = todayCard(heroArgs);
    heroBox.replaceWith(next);
    heroBox = next;
  };

  const commit = (index, field, raw, input) => {
    const max = field === 'd' ? 20000 : 1000;
    let value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (value > max) value = max;
    input.value = value ? String(value) : '';

    store.update(wk, (w) => {
      const cal = { d: [...(w.cal?.d || [])], p: [...(w.cal?.p || [])] };
      while (cal.d.length < 7) cal.d.push(0);
      while (cal.p.length < 7) cal.p.push(0);
      cal[field][index] = value;
      w.cal = cal;
    });
    // Repaint only the summary: a full re-render would steal focus mid-typing.
    paint();
  };

  // One day open at a time; today's opens by itself so logging is one tap.
  let openDay = null;
  const panels = [];
  const toggles = [];

  /** Day totals come from its meals once it has any; the boxes then just show them. */
  const syncRow = (i, calInput, proInput, toggle) => {
    const w = store.week(wk);
    const meals = w.meals?.[i] || [];
    const fromMeals = meals.length > 0;
    calInput.disabled = fromMeals;
    proInput.disabled = fromMeals;
    if (fromMeals) {
      calInput.value = w.cal?.d?.[i] ? String(w.cal.d[i]) : '';
      proInput.value = w.cal?.p?.[i] ? String(w.cal.p[i]) : '';
    }
    toggle.textContent = fromMeals ? `${meals.length} 🍽` : '🍽';
    toggle.setAttribute('aria-label', `وجبات ${DAY_NAMES[i]} (${meals.length})`);
  };

  const rows = DAY_NAMES.map((name, i) => {
    const calInput = el('input', {
      class: 'ni',
      type: 'number',
      inputmode: 'numeric',
      min: '0',
      max: '20000',
      placeholder: 'سعرات',
      value: week.cal?.d?.[i] ? String(week.cal.d[i]) : '',
      attrs: { 'aria-label': `سعرات ${name}` },
    });
    const proInput = el('input', {
      class: 'ni p',
      type: 'number',
      inputmode: 'numeric',
      min: '0',
      max: '1000',
      placeholder: 'بروتين',
      value: week.cal?.p?.[i] ? String(week.cal.p[i]) : '',
      attrs: { 'aria-label': `بروتين ${name}` },
    });
    calInput.addEventListener('change', () => commit(i, 'd', calInput.value, calInput));
    proInput.addEventListener('change', () => commit(i, 'p', proInput.value, proInput));

    const toggle = el('button', {
      class: 'mopen',
      attrs: { type: 'button', 'aria-expanded': 'false' },
      on: { click: () => openPanel(openDay === i ? null : i) },
    });
    const panelSlot = el('div', { class: 'mslot' });
    panels[i] = panelSlot;
    toggles[i] = toggle;
    syncRow(i, calInput, proInput, toggle);

    const onChange = () => {
      syncRow(i, calInput, proInput, toggle);
      paint();
    };
    panelSlot.open = () =>
      panelSlot.replaceChildren(
        mealPanel({
          store,
          wk,
          day: i,
          targets,
          isToday: i === todayIndex,
          // Today's totals are the ring and bars at the top of the page.
          showBars: i !== todayIndex,
          onChange,
          extraActions: (form) => scanActions(ctx, form),
        })
      );

    return el(
      'div',
      { class: 'nday' },
      el('div', { class: 'nrow' }, el('span', { class: 'nd', text: name }), calInput, proInput, toggle),
      panelSlot
    );
  });

  function openPanel(day) {
    openDay = day;
    panels.forEach((slot, i) => {
      if (i === day) slot.open();
      else slot.replaceChildren();
      toggles[i].setAttribute('aria-expanded', String(i === day));
      toggles[i].classList.toggle('on', i === day);
    });
  }
  if (todayIndex >= 0) openPanel(todayIndex);

  paint();

  // Today's day first and on its own: it is the one being logged. The rest of
  // the week folds away until it is wanted.
  const isLive = todayIndex >= 0;
  const daysBlock = isLive
    ? [
        el('h3', { text: 'أكل اليوم' }),
        el('div', { class: 'card rows' }, rows[todayIndex]),
        el(
          'details',
          { class: 'card rows ndays' },
          el('summary', { text: `باقي أيام الأسبوع ${wk}` }),
          rows.filter((_, i) => i !== todayIndex)
        ),
      ]
    : [el('h3', { text: `سجّل يومك — أسبوع ${wk}` }), el('div', { class: 'card rows' }, rows)];

  return el(
    'div',
    { class: 'wrap' },
    heroBox,
    daysBlock,
    summaryBox,
    calcCard({ ctx, parts, goalKey, target, tdee, learned: learned?.val ?? null, todayIndex }),
    el(
      'details',
      { class: 'card why' },
      el('summary', { text: 'ليش هالأرقام؟' }),
      bulletList([
        [
          { b: 'الحديد يقرر شكل جسمك. السعرات تقرر حجمه.' },
          ' واحد بدون الثاني ما يوصلك لهدفك.',
        ],
        [
          { b: `هدفك الحالي مبني على ${goal.n}` },
          ` — عشان كذا الرقم ${fmt(target)} مو رقم عام، هو محسوب من وزنك وطولك وعمرك وشغلك وتمارين برنامجك.`,
        ],
        [{ b: 'سجّل ولو تقريبي.' }, ' تسجيل 5 أيام بدقة 80% أنفع من تسجيل يومين بدقة 100%.'],
        [
          { b: 'بعد أسبوعين بيصير عندك رقمك الحقيقي' },
          ' بدل تقدير المعادلة — وهذا اللي ما يعطيك إياه أي تطبيق جاهز.',
        ],
      ])
    ),
    el(
      'div',
      { class: 'card' },
      el('button', {
        class: 'cta ghost',
        text: 'عدّل هدفك وبياناتك',
        on: { click: () => ctx.editProfile() },
      })
    )
  );
}

/* ────────────────────────── how the number is made ────────────────────────── */

const signed = (n) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

/**
 * The target, line by line: the body at rest, the day around it, the
 * programme's training, and the goal. Shared with onboarding, which shows the
 * same rows live while the form is being filled.
 */
export function calcRows({ parts, goalKey, target, tdee = parts.tdee, learned = null }) {
  const goal = goalOf(goalKey);
  const t = parts.training;
  const row = (label, sub, value, cls) =>
    el(
      'div',
      { class: ['krow', cls || ''] },
      el('span', {}, el('b', { text: label }), sub ? el('small', { text: sub }) : null),
      el('b', { class: 'n', text: value })
    );
  const training = [
    t.liftMin ? `${t.liftMin} د تمرين` : '',
    t.cardioMin ? `${t.cardioMin} د كارديو` : '',
  ]
    .filter(Boolean)
    .join(' + ');
  const rows = [
    row('حرق جسمك وأنت مرتاح', 'من وزنك وطولك وعمرك', fmt(parts.bmr)),
    row('حركة يومك', parts.job.n, signed(parts.daily)),
    row('تمارين برنامجك', training ? `${training} بالأسبوع — متوسط اليوم` : 'ما فيه تمرين', signed(t.perDay)),
    row('احتياجك للثبات', null, fmt(parts.tdee), 'sum'),
  ];
  if (Number.isFinite(learned) && learned !== parts.tdee) {
    rows.push(row('رقمك الحقيقي من سجلك', 'أكلك مقابل تغيّر وزنك — يغلب المعادلة', fmt(learned), 'sum'));
  }
  const gap = target - tdee;
  rows.push(
    row(
      `هدف ${goal.n}`,
      gap === goal.nutrition.delta ? null : 'محدود بالحد الآمن',
      gap ? signed(gap) : '0'
    ),
    row('سعراتك اليومية', null, fmt(target), 'total')
  );
  return el('div', { class: 'kcalc' }, rows);
}

function calcCard({ ctx, parts, goalKey, target, tdee, learned, todayIndex }) {
  if (!parts) {
    // A profile from before the job question: the old single factor is still in
    // use, and one tap fixes it.
    return el(
      'div',
      { class: 'card' },
      el('b', { class: 'nexth', text: 'خلّ الحسبة أدق' }),
      el('div', {
        class: 'mut',
        text: 'اختر طبيعة شغلك، ونحسب حرق تمارينك من برنامجك نفسه بدل رقم عام.',
      }),
      el('button', { class: 'cta', text: 'اختر طبيعة شغلك', on: { click: () => ctx.editProfile() } })
    );
  }
  const today = todayIndex >= 0 ? parts.training.days[todayIndex] : null;
  return [
    el('h3', { text: 'كيف انحسب رقمك' }),
    el(
      'div',
      { class: 'card' },
      calcRows({ parts, goalKey, target, tdee, learned }),
      today
        ? el('div', {
            class: 'mut kday',
            text: today.kcal
              ? `تمرين اليوم يحرق تقريباً ${fmt(today.kcal)} سعرة فوق يومك العادي.`
              : 'اليوم راحة — ما فيه حرق تمرين.',
          })
        : null,
      el('div', {
        class: 'mut kday',
        text: 'الرقم يتغير لحاله لما يتغير وزنك أو هدفك أو أيام راحتك أو طبيعة شغلك.',
      })
    ),
  ];
}

/* ────────────────────────── today ────────────────────────── */

/**
 * The day's target, and — on the live week — how much of it is left, as a
 * ring, with protein, carbs and fat as bars under it. Keeps `.today.top .n`
 * holding the target: goals.mjs and review.mjs read the number from there.
 */
function todayCard({ store, wk, todayIndex, target, tdee, protein, targets }) {
  const gap =
    target === tdee
      ? 'بدون عجز ولا زيادة'
      : target < tdee
        ? `العجز ${fmt(tdee - target)} سعرة`
        : `الزيادة ${fmt(target - tdee)} سعرة`;
  const head = [
    el('div', { class: 'lbl', text: 'هدفك اليومي' }),
    el('h2', {}, el('span', { class: 'n', text: fmt(target) }), ' سعرة'),
  ];

  if (todayIndex < 0) {
    return el(
      'div',
      { class: 'today top' },
      head,
      el('p', {
        text: `بروتين ${protein} · دهون ${targets.fat} · كارب ${targets.carbs} جرام · احتياجك للثبات ${fmt(tdee)} · ${gap}`,
      })
    );
  }

  const week = store.week(wk);
  const eaten = week.cal?.d?.[todayIndex] || 0;
  const proteinEaten = week.cal?.p?.[todayIndex] || 0;
  const fromMeals = mealTotals(week.meals?.[todayIndex] || []);
  const left = target - eaten;

  const bar = (label, value, goal, kind) =>
    el(
      'div',
      { class: ['tbar', kind] },
      el('div', { class: 'tbl' }, el('span', { text: label }), el('span', { class: 'tbn', text: `${fmt(value)} / ${fmt(goal)} جم` })),
      el('span', { class: 'tbt' }, el('i', { style: { width: `${Math.min(100, goal ? Math.round((value / goal) * 100) : 0)}%` } }))
    );

  return el(
    'div',
    { class: 'today top live' },
    el(
      'div',
      { class: 'tring-row' },
      ring(eaten / Math.max(1, target), left),
      el(
        'div',
        { class: 'tbars' },
        head,
        bar('بروتين', proteinEaten, protein, 'p'),
        bar('كارب', fromMeals?.carbs || 0, targets.carbs, 'c'),
        bar('دهون', fromMeals?.fat || 0, targets.fat, 'f')
      )
    ),
    el('p', { class: 'tgap', text: `احتياجك للثبات ${fmt(tdee)} · ${gap}` })
  );
}

/** The calorie ring: filled by what was eaten, the number in it is what is left. */
function ring(ratio, left) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  // No fill at all for an empty day: a zero-length stroke with round caps
  // still paints a dot.
  for (const cls of ratio > 0 ? ['rtrack', 'rfill'] : ['rtrack']) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', cls);
    c.setAttribute('cx', '60');
    c.setAttribute('cy', '60');
    c.setAttribute('r', '52');
    c.setAttribute('pathLength', '100');
    if (cls === 'rfill') c.style.setProperty('stroke-dashoffset', String(100 - Math.min(1, Math.max(0, ratio)) * 100));
    svg.appendChild(c);
  }
  const over = left < 0;
  return el(
    'div',
    {
      class: ['tring', over ? 'over' : ''],
      attrs: { role: 'img', 'aria-label': over ? `زدت ${fmt(-left)} سعرة` : `باقي ${fmt(left)} سعرة` },
    },
    svg,
    el('div', { class: 'tc' }, el('b', { text: fmt(Math.abs(left)) }), el('span', { text: over ? 'زيادة' : 'باقي' }))
  );
}

/* ────────────────────────── summary ────────────────────────── */

/**
 * The original file carried this block twice — once in the page and once in a
 * "summary" helper — and the two copies had already drifted. One copy now.
 */
/**
 * Maintenance, target and protein for today. Maintenance starts at the formula
 * and is re-learned from the whole log on every call, so a new week of data
 * moves it without anyone pressing a button.
 */
export function numbers(store, bodyWeight, goalKey) {
  const nut = store.doc.nutrition;
  const restDays = store.restDays;
  const formula = formulaTdee(nut, bodyWeight, goalKey, restDays);
  const learned = measuredTDEE(store.calHist(), store.bodyHist(), formula);
  return {
    formula,
    learned,
    parts: energyBreakdown(nut, bodyWeight, goalKey, restDays),
    tdee: effectiveTdee(nut, bodyWeight, learned?.val, goalKey, restDays),
    target: dailyTarget(nut, bodyWeight, goalKey, learned?.val, restDays),
    protein: proteinTarget(bodyWeight, goalKey),
  };
}

function summaryCard(store, wk, bodyWeight, goalKey) {
  const { tdee, target, protein, formula, learned: measured } = numbers(store, bodyWeight, goalKey);
  const cal = store.week(wk).cal || { d: [], p: [] };
  const avg = avgCal(cal);
  const pro = avgPro(cal);

  const logged = (cal.d || []).filter((x) => x > 0);
  const max = Math.max(target * 1.35, ...logged, target);

  const bars = DAY_NAMES.map((name, i) => {
    const value = cal.d?.[i] || 0;
    const height = value ? Math.max(4, Math.round((value / max) * 100)) : 0;
    const color = !value
      ? 'transparent'
      : value < target * 0.7
        ? 'var(--coral)'
        : value > target * 1.15
          ? 'var(--orange)'
          : 'var(--mint)';

    const bar = el(
      'div',
      { class: 'cbar', style: { '--tl': `${((target / max) * 100).toFixed(1)}%` } },
      el('i', { style: { height: `${height}%`, background: color } })
    );
    return el(
      'div',
      { class: 'cb', attrs: { title: value ? `${name}: ${fmt(value)}` : name } },
      bar,
      // The customary one-letter forms. Cutting the word instead printed
      // fragments like "الس" and "الأ" — three letters of "ال" plus one.
      el('span', { text: DAY_LETTERS[i] })
    );
  });

  const chart = el(
    'div',
    { class: 'card' },
    el('div', { class: 'cchart' }, bars),
    el('div', { class: 'tline' }, el('span', { text: `الخط الأخضر = هدفك (${fmt(target)})` })),
    el(
      'div',
      { class: 'deltas' },
      el('span', {}, 'متوسط اليوم', el('b', { class: 'n', text: avg ? fmt(avg.avg) : '—' })),
      el('span', {}, 'أيام مسجّلة', el('b', { class: 'n', text: `${avg ? avg.days : 0}/7` })),
      el('span', {}, 'متوسط البروتين', el('b', { class: 'n', text: pro ? String(pro) : '—' }))
    )
  );

  const parts = [chart];

  /* warnings */
  if (avg && avg.days >= 3) {
    if (avg.avg < Math.max(1700, tdee * 0.7)) {
      parts.push(
        el(
          'div',
          { class: 'verdict warn' },
          el('h4', { text: 'أكلك أقل من اللازم' }),
          el(
            'p',
            {},
            'متوسطك ',
            el('b', { class: 'n', text: fmt(avg.avg) }),
            ' سعرة وهذا تحت الحد الآمن لك. هالمستوى ينزل وزنك بسرعة بس أغلبه عضل وماء، وبيخليك تعبان بالنادي وأوزانك تثبت. ',
            el('b', { text: 'ارفع أكلك' }),
            ` — الهدف ${fmt(target)} مو أقل.`
          )
        )
      );
    } else if (pro && pro < protein * 0.75) {
      parts.push(
        el(
          'div',
          { class: 'verdict hold' },
          el('h4', { text: 'بروتينك ناقص' }),
          el(
            'p',
            {},
            'متوسطك ',
            el('b', { class: 'n', text: String(pro) }),
            ` جرام والهدف ${protein}. السعرات مضبوطة بس بدون بروتين كافي بتنقص عضل مع الدهون.`
          )
        )
      );
    }
  }

  /* habits: what keeps happening, from the last four weeks of meals */
  const habits = mealHabits(store.doc.weeks, store.currentWeek, macroTargets(target, bodyWeight, goalKey));
  if (habits.length) {
    parts.push(
      el(
        'div',
        { class: 'verdict hold habits' },
        el('h4', { text: 'لاحظت من أكلك' }),
        habits.map((h) => el('p', { text: h.text }))
      )
    );
  }

  /* learned maintenance */
  if (measured) {
    const diff = measured.val - formula;
    const close = Math.abs(diff) < 150;
    const explanation = close
      ? 'قريب من تقدير المعادلة، يعني المعادلة مضبوطة عليك.'
      : diff < 0
        ? `أقل من المعادلة بـ ${fmt(Math.abs(diff))} سعرة — جسمك يحرق أقل مما توقعنا.`
        : `أعلى من المعادلة بـ ${fmt(diff)} سعرة — جسمك يحرق أكثر مما توقعنا.`;

    parts.push(
      el(
        'div',
        { class: ['verdict', close ? 'go' : 'hold'] },
        el('h4', {}, 'سعراتك الحقيقية: ', el('span', { class: 'n', text: fmt(measured.val) })),
        el(
          'p',
          {},
          ...richText([
            `بدأنا من المعادلة (${fmt(formula)}) وكل أسبوع نقارن `,
            { b: 'أكلك الفعلي مقابل اتجاه وزنك' },
            ` ونعدّل خطوة صغيرة — ${measured.weeks} أسبوع لين الحين. ${explanation} هدفك يتحدّث تلقائياً.`,
          ])
        ),
        ...measured.samples.map((s) =>
          el('div', {
            class: 'mut',
            text: `أسبوع ${s.week}: أكلك ${fmt(s.avg)} · وزنك ${s.trendKg > 0 ? '+' : ''}${s.trendKg} كجم → ${fmt(s.est)}`,
          })
        )
      )
    );
  }

  const box = document.createDocumentFragment();
  for (const part of parts) box.appendChild(part);
  return box;
}

export function lastKnownWeight(store) {
  const weeks = Object.keys(store.doc.weeks)
    .map(Number)
    .sort((a, b) => b - a);
  for (const n of weeks) {
    const body = store.doc.weeks[String(n)]?.body;
    if (body?.weight) return body.weight;
  }
  return null;
}

/**
 * Today's same-day alerts, for the home screen. Empty when nutrition is not
 * set up, outside the current week, or nothing is logged today.
 */
export function todayMealAlerts(store) {
  if (!store.doc.nutrition?.age || store.viewWeek !== store.currentWeek) return [];
  const day = [1, 2, 3, 4, 5, 6, 0][new Date().getDay()];
  const week = store.week(store.currentWeek);
  const totals = mealTotals(week.meals?.[day]);
  if (!totals) return [];
  const bodyWeight = week.body?.weight || lastKnownWeight(store) || 80;
  const { target } = numbers(store, bodyWeight, store.goal);
  return mealAlerts(totals, macroTargets(target, bodyWeight, store.goal), {
    isToday: true,
    hour: new Date().getHours(),
  });
}
