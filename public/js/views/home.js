import { el } from '../dom.js';
import { fmtN, sparkline } from '../ui.js';
import {
  planOf,
  weekOf,
  cardioOf,
  dayHasLoads,
  goalHasLoads,
  goalOf,
  setsKey,
  todayLift,
  DAY_NAMES,
  exById,
  machName,
  machinesOfDay,
} from '../program.js';
import { MAX_WEEK, goalReview } from '../engine.js';
import { SYNC } from '../store.js';

/** How many lifts the progress cards show, most-used first. */
const RAIL_LIMIT = 6;

const SYNC_LABEL = {
  [SYNC.OFF]: 'محلي فقط',
  [SYNC.SYNCED]: 'متزامن',
  [SYNC.PENDING]: 'بينحفظ…',
  [SYNC.SYNCING]: 'يتزامن…',
  [SYNC.OFFLINE]: 'بدون نت',
  [SYNC.ERROR]: 'خطأ مزامنة',
};

export function renderHome(ctx) {
  const { store, navigate, openGym } = ctx;
  const wk = store.viewWeek;
  const week = store.week(wk);
  const goalKey = store.goal;
  const PLAN = planOf(goalKey);
  const WEEK = weekOf(goalKey);
  const CARDIO = cardioOf(goalKey);
  const hasLoads = goalHasLoads(goalKey);
  // Naming the iron on a goal that has none reads like the app lost track of
  // which programme the trainee is on.
  const restLine = hasLoads ? 'لا حديد ولا كارديو' : 'لا كارديو ولا تمارين';

  // Keyed by day as well as by exercise: this goal stretches the hamstrings on
  // five days, and finishing Tuesday must not tick Sunday and Thursday too.
  const doneCount = (dayKey) =>
    PLAN[dayKey].ex.filter((e) => {
      const sets = week.sets[setsKey(dayKey, e.id)] || [];
      return sets.length >= e.sets && sets.slice(0, e.sets).every(Boolean);
    }).length;

  /* ── header ── */
  const syncPill = el(
    'button',
    {
      class: ['sync', store.syncState],
      on: { click: () => navigate('account') },
      attrs: { 'aria-label': 'الحساب والمزامنة' },
    },
    el('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }),
    el('span', { text: SYNC_LABEL[store.syncState] || '' })
  );

  const prevBtn = el('button', {
    text: '‹',
    attrs: { 'aria-label': 'الأسبوع السابق' },
    disabled: wk <= 1,
    on: { click: () => ctx.setWeek(wk - 1) },
  });
  // Browsing forward stops at the current training week. Opening a new week is
  // an explicit action further down, which is what stops the week counter from
  // running away when the arrow is tapped repeatedly.
  const nextBtn = el('button', {
    text: '›',
    attrs: { 'aria-label': 'الأسبوع التالي' },
    disabled: wk >= store.currentWeek || wk >= MAX_WEEK,
    on: { click: () => ctx.setWeek(wk + 1) },
  });

  const header = el(
    'div',
    { class: 'hd' },
    el(
      'div',
      { class: 'logo' },
      'حديد',
      // The goal is what shapes everything below, so it is named up front.
      el('small', { text: `${goalOf(goalKey).n} · ${store.user ? store.user.email : 'محلي'}` })
    ),
    el(
      'div',
      { class: 'hdr-right' },
      syncPill,
      el(
        'div',
        { class: 'wk' },
        prevBtn,
        el('span', { class: 'v', text: `WEEK ${wk}` }),
        nextBtn
      )
    )
  );

  /* ── today ── */
  const tk = todayLift(goalKey);
  const todayIndex = [1, 2, 3, 4, 5, 6, 0][new Date().getDay()];
  const todayName = DAY_NAMES[todayIndex];
  let hero;
  if (wk !== store.currentWeek) {
    hero = el(
      'div',
      { class: 'today rest' },
      el('div', { class: 'lbl', text: `WEEK ${wk}` }),
      el('h2', { text: 'أسبوع سابق' }),
      el('p', { text: 'تتصفح أسبوع قديم. تقدر تعدّل عليه وبيتحدّث حساب الأسابيع اللي بعده.' }),
      el('button', {
        class: 'go',
        text: `ارجع لأسبوع ${store.currentWeek} ←`,
        on: { click: () => ctx.setWeek(store.currentWeek) },
      })
    );
  } else if (tk === 'rest') {
    hero = el(
      'div',
      { class: 'today rest' },
      el('div', { class: 'lbl', text: `TODAY · ${todayName}` }),
      el('h2', { text: 'راحة كاملة' }),
      el('p', {
        text: `${restLine}. الراحة جزء من البرنامج، وجسمك يبني فيها مو بالنادي.`,
      }),
      el('button', { class: 'go', text: 'سجّل قياس الأسبوع', on: { click: () => navigate('week') } })
    );
  } else if (tk === 'cardio') {
    hero = el(
      'div',
      { class: 'today rest' },
      el('div', { class: 'lbl', text: `TODAY · ${todayName}` }),
      el('h2', { text: 'يوم كارديو' }),
      el('p', { text: CARDIO[todayIndex]?.detail || 'كارديو خفيف اليوم.' }),
      el('button', {
        class: 'go',
        text: 'شوف تفاصيل الكارديو',
        on: { click: () => navigate('cardio') },
      })
    );
  } else {
    const plan = PLAN[tk];
    const done = doneCount(tk);
    hero = el(
      'div',
      { class: 'today' },
      el('div', { class: 'lbl', text: `TODAY · ${todayName}` }),
      el('h2', { text: plan.title }),
      el('p', { text: `${plan.ex.length} تمارين${done ? ` · خلّصت ${done} منها` : ''}` }),
      el('button', {
        class: 'go',
        text: `${done ? 'كمّل التمرين' : 'ابدأ التمرين'} ←`,
        on: { click: () => openGym(tk) },
      })
    );
  }

  /* ── goal review ── */
  // A goal is a phase. Once the body has moved far enough, or enough time has
  // passed, the app says so instead of leaving someone on a cut forever.
  const review = goalReview({
    profile: store.doc.profile,
    weight: store.latestWeight(),
    goalKey,
  });
  const reviewCard = review
    ? el(
        'div',
        { class: 'review' },
        el('h4', { text: review.t }),
        el('p', { text: review.p }),
        el(
          'div',
          { class: 'rbtns' },
          el('button', {
            class: 'cta',
            text: 'راجع هدفي',
            on: { click: () => ctx.editProfile() },
          }),
          el('button', {
            class: 'cta ghost',
            text: 'كمّل على هدفي',
            on: {
              click: () => {
                store.reaffirmGoal();
                ctx.refresh();
              },
            },
          })
        )
      )
    : null;

  /* ── progression cards ── */
  // The lifts shown come from the goal's own programme, in the order it runs
  // them, skipping bodyweight and timed holds — a "+0 كجم" card says nothing.
  const railIds = [];
  for (const dayKey of Object.keys(PLAN)) {
    for (const e of PLAN[dayKey].ex) {
      if (e.body || e.time || railIds.includes(e.id)) continue;
      railIds.push(e.id);
      if (railIds.length >= RAIL_LIMIT) break;
    }
    if (railIds.length >= RAIL_LIMIT) break;
  }

  const history = store.weightHistory(wk);
  const cards = [];
  for (const id of railIds) {
    const e = exById(id);
    const values = history[id];
    if (!e || !values?.length) continue;

    const now = values[values.length - 1];
    const first = values[0];
    const delta = Math.round((now - first) * 10) / 10;
    // On an assisted lift the number falls as you get stronger, so the badge
    // has to read the direction rather than the sign.
    const improved = e.inverse ? delta < 0 : delta > 0;

    cards.push(
      el(
        'div',
        { class: 'pcard' },
        delta === 0
          ? el('span', { class: 'pbadge flat', text: '—' })
          : el('span', {
              class: ['pbadge', improved ? '' : 'down'],
              text: `${delta > 0 ? '+' : ''}${delta}`,
            }),
        el(
          'div',
          { class: 'pname' },
          e.n,
          e.en ? el('small', { class: 'en', text: e.en }) : null
        ),
        el(
          'div',
          { class: 'pbig n' },
          fmtN(now),
          el('span', { class: 'unit', text: e.time ? ' ث' : ' كجم' })
        ),
        sparkline(values, { fill: true, stretch: true })
      )
    );
  }

  const rail = cards.length
    ? el('div', { class: 'pgrid' }, cards)
    : el('div', { class: 'card' }, el('div', {
        class: 'mut',
        // A goal with nothing to load has no weights to plot — ever. Saying
        // "wait for next week" there would be a promise the app cannot keep.
        text: hasLoads
          ? 'أول أسبوع — بعد ما تخلّصه بيبان لك تقدّمك هنا.'
          : 'ما فيه أوزان بهالبرنامج — تقدّمك يبان بدقائق الكارديو وبقياس وزنك آخر الأسبوع.',
      }));

  /* ── week strip ── */
  const jsToday = new Date().getDay();
  const strip = WEEK.map((day) => {
    const isToday = day.js === jsToday && wk === store.currentWeek;
    const cardioDone = !!week.cardio[String(day.c)];

    let right = null;
    let sub;
    if (day.lift) {
      const done = doneCount(day.lift);
      const total = PLAN[day.lift].ex.length;
      // A day of planks and stretches is not "حديد". And on a goal built around
      // cardio the minutes are the day, so they belong on the line too.
      const kind = dayHasLoads(PLAN[day.lift].ex) ? 'حديد' : 'تمارين جسم';
      const slot = CARDIO[day.c];
      const alsoCardio = !hasLoads && slot && !slot.rest ? ` · ${slot.detail}` : '';
      sub = `${kind} — ${PLAN[day.lift].title}${alsoCardio}`;
      right = el('button', {
        class: ['wlift', done === total ? 'full' : ''],
        on: { click: () => openGym(day.lift) },
        attrs: { 'aria-label': `${PLAN[day.lift].title} — ${done} من ${total}` },
      });
      right.appendChild(el('span', { class: 'n', text: `${done}/${total}` }));
    } else if (day.rest) {
      sub = `راحة كاملة — ${restLine}`;
      right = el('button', {
        class: 'wlift ghost',
        text: 'قياس',
        on: { click: () => navigate('week') },
      });
    } else {
      // A day split across machines reads "…· سيكل 20د + غزالة 20د".
      const slot = CARDIO[day.c] || { detail: '', min: 0 };
      const picked = machinesOfDay(week.cmach[String(day.c)], slot.min);
      const label = picked
        .map((p) => (picked.length > 1 ? `${machName(p.k)} ${p.m}د` : machName(p.k)))
        .join(' + ');
      sub = slot.detail + (label ? ' · ' + label : '');
    }

    // A goal may have days with neither lifting nor cardio; those get no tick.
    const noCardio = day.rest || !!CARDIO[day.c]?.rest;
    const checkbox = noCardio
      ? null
      : el('button', {
          class: ['ck', cardioDone ? 'on' : ''],
          text: cardioDone ? '✓' : '',
          attrs: {
            'aria-pressed': String(cardioDone),
            'aria-label': `كارديو ${day.d}`,
          },
          on: { click: () => ctx.toggleCardio(day.c) },
        });

    return el(
      'div',
      { class: ['wrow', isToday ? 'now' : '', day.rest ? 'dim' : ''] },
      el('div', { class: 'wl' }, el('b', { text: day.d }), el('span', { text: sub, attrs: { title: sub } })),
      el('div', { class: 'wr' }, right, checkbox)
    );
  });

  return el(
    'div',
    { class: 'wrap' },
    header,
    hero,
    reviewCard,
    el('h3', { text: hasLoads ? 'أوزانك وهي تطلع' : 'تقدّمك' }),
    rail,
    el('h3', { text: 'الأسبوع كامل' }),
    el('div', { class: 'card tight' }, strip),
    el('div', {
      class: 'hint',
      text: 'الدائرة = علّم الكارديو لما تخلّصه · الرقم = تمارين الحديد المكتملة',
    })
  );
}
