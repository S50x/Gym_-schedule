import { el } from '../dom.js';
import { fmt, fmtN, sparkline } from '../ui.js';
import { PLAN, WEEK, CARDIO, DAY_NAMES, exById, machName } from '../program.js';
import { todayKey, verdict, MAX_WEEK } from '../engine.js';
import { SYNC } from '../store.js';

const RAIL_IDS = ['chest_db', 'sh_press', 'lat_pull', 'cable_row', 'leg_press', 'row_1arm'];

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

  const doneCount = (dayKey) =>
    PLAN[dayKey].ex.filter((e) => {
      const sets = week.sets[e.id] || [];
      return sets.length === e.sets && sets.every(Boolean);
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
      el('small', { text: store.user ? store.user.email : 'سجل تمرين محلي' })
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
  const tk = todayKey();
  const todayName = DAY_NAMES[[1, 2, 3, 4, 5, 6, 0][new Date().getDay()]];
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
      el('p', { text: 'لا حديد ولا كارديو. الراحة جزء من البرنامج، وجسمك يبني فيها مو بالنادي.' }),
      el('button', { class: 'go', text: 'سجّل قياس الأسبوع', on: { click: () => navigate('week') } })
    );
  } else if (tk === 'cardio') {
    hero = el(
      'div',
      { class: 'today rest' },
      el('div', { class: 'lbl', text: `TODAY · ${todayName}` }),
      el('h2', { text: 'يوم كارديو' }),
      el('p', { text: '40 دقيقة مشي مائل أو دراجة. تلهث بس تقدر تتكلم.' }),
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

  /* ── progression rail ── */
  const history = store.weightHistory(wk);
  const railRows = [];
  for (const id of RAIL_IDS) {
    const e = exById(id);
    const values = history[id];
    if (!e || !values?.length) continue;

    const now = values[values.length - 1];
    const first = values[0];
    const delta = Math.round((now - first) * 10) / 10;
    const improved = e.inverse ? delta < 0 : delta > 0;

    railRows.push(
      el(
        'div',
        { class: 'prow' },
        el('span', { class: 'pname', text: e.n, attrs: { title: e.n } }),
        sparkline(values),
        el(
          'span',
          { class: 'pnow n' },
          fmtN(now),
          el('span', { class: 'unit', text: e.time ? ' ث' : ' كجم' })
        ),
        el('span', {
          class: ['pdel', delta === 0 ? 'flat' : improved ? '' : 'down'],
          text: delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${delta}`,
        })
      )
    );
  }

  const rail = el(
    'div',
    { class: 'card prog' },
    railRows.length
      ? railRows
      : el('div', { class: 'mut', text: 'أول أسبوع — بعد ما تخلّصه بيبان لك خط التقدم هنا.' })
  );

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
      sub = `حديد — ${PLAN[day.lift].title}`;
      right = el('button', {
        class: ['wlift', done === total ? 'full' : ''],
        on: { click: () => openGym(day.lift) },
        attrs: { 'aria-label': `${PLAN[day.lift].title} — ${done} من ${total}` },
      });
      right.appendChild(el('span', { class: 'n', text: `${done}/${total}` }));
    } else if (day.rest) {
      sub = 'راحة كاملة — لا حديد ولا كارديو';
      right = el('button', {
        class: 'wlift ghost',
        text: 'قياس',
        on: { click: () => navigate('week') },
      });
    } else {
      const machine = week.cmach[String(day.c)];
      sub = CARDIO[day.c][1] + (machine ? ' · ' + machName(machine) : '');
    }

    const checkbox = day.rest
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

  /* ── tiles ── */
  const v = verdict(week.body, store.week(wk - 1).body);
  const nutrition = store.doc.nutrition;

  const tiles = el(
    'div',
    { class: 'grid' },
    el(
      'button',
      { class: 'tile', on: { click: () => navigate('nutri') } },
      el('b', { text: 'السعرات' }),
      el('span', {
        text: nutrition ? `${fmt(nutrition.target)} سعرة · هدفك اليومي` : 'ما ضبطته بعد',
      })
    ),
    el(
      'button',
      { class: 'tile', on: { click: () => navigate('cardio') } },
      el('b', { text: 'تفاصيل الكارديو' }),
      el('span', { text: 'كم دقيقة وكم شدة' })
    ),
    el(
      'button',
      { class: 'tile', on: { click: () => navigate('week') } },
      el('b', { text: 'قياس الأسبوع' }),
      el('span', { text: week.body ? v.t : 'ما سجّلت بعد' })
    )
  );

  return el(
    'div',
    { class: 'wrap' },
    header,
    hero,
    el('h3', { text: 'أوزانك وهي تطلع' }),
    rail,
    el('h3', { text: 'الأسبوع كامل' }),
    el('div', { class: 'card tight' }, strip),
    el('div', {
      class: 'hint',
      text: 'الدائرة = علّم الكارديو لما تخلّصه · الرقم = تمارين الحديد المكتملة',
    }),
    tiles
  );
}
