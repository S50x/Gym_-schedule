import { el } from '../dom.js';
import { bulletList } from '../ui.js';
import { cardioOf, clashesOf, goalOf, MACH, machName, MAX_MACHINES_PER_DAY, machinesOfDay } from '../program.js';

export function renderCardio(ctx) {
  const { store } = ctx;
  const week = store.week();
  const goalKey = store.goal;
  const goal = goalOf(goalKey);
  const CARDIO = cardioOf(goalKey);
  const cardioDays = CARDIO.filter((c) => !c.rest).length;

  const rows = CARDIO.map((entry, i) => {
    const { d: name, detail, rest: isRest, min: totalMinutes } = entry;
    if (isRest) {
      return el(
        'div',
        { class: 'row dim' },
        el('span', { class: 'a', text: name }),
        el('span', { class: 'b', text: detail })
      );
    }

    const done = !!week.cardio[String(i)];
    const picked = machinesOfDay(week.cmach[String(i)], totalMinutes);
    const pickedKeys = new Set(picked.map((p) => p.k));
    const spent = picked.reduce((sum, p) => sum + p.m, 0);

    /* A day may pair two machines that fight each other. That is worth saying
       out loud, but it is the trainee's knee and the trainee's call, so the
       chip stays live — it just says why it is flagged. */
    const clashes = clashesOf([...pickedKeys]);
    const flagged = new Set(clashes.flatMap((c) => [c.a, c.b]));

    /* One chip per machine. Tapping toggles it in or out of the day. */
    const chips = MACH.map((m) => {
      const on = pickedKeys.has(m.k);
      const full = !on && picked.length >= MAX_MACHINES_PER_DAY;
      const warn = flagged.has(m.k);
      return el('button', {
        class: ['mchip', on ? 'on' : '', full ? 'full' : '', warn ? 'warn' : ''],
        text: m.n,
        disabled: full,
        attrs: {
          'aria-pressed': String(on),
          'aria-label': `${m.n} — ${m.en}${warn ? ' — فيه تعارض' : ''}`,
          title: full ? `أقصى ${MAX_MACHINES_PER_DAY} أجهزة باليوم` : m.en,
        },
        on: { click: () => ctx.toggleMachine(i, m.k) },
      });
    });

    const warnings = clashes.map((c) =>
      el(
        'div',
        { class: 'mwarn' },
        el('b', { text: `${machName(c.a)} + ${machName(c.b)}` }),
        ` — ${c.why}`
      )
    );

    /* Minute steppers appear only once the day is actually shared. */
    let split = null;
    if (picked.length > 1) {
      split = el(
        'div',
        { class: 'split' },
        picked.map((p) => {
          const mach = MACH.find((x) => x.k === p.k);
          return el(
            'div',
            { class: 'srow' },
            el('span', { class: 'sname', text: mach?.n || p.k }),
            el(
              'div',
              { class: 'sadj' },
              el('button', {
                text: '−',
                attrs: { 'aria-label': `قلّل دقائق ${mach?.n || ''}` },
                disabled: p.m <= 0,
                on: { click: () => ctx.setMachineMinutes(i, p.k, p.m - 5) },
              }),
              el('span', { class: 'smin n' }, String(p.m), el('span', { class: 'u', text: ' د' })),
              el('button', {
                text: '+',
                attrs: { 'aria-label': `زد دقائق ${mach?.n || ''}` },
                on: { click: () => ctx.setMachineMinutes(i, p.k, p.m + 5) },
              })
            )
          );
        }),
        el('div', {
          class: ['stotal', spent === totalMinutes ? 'ok' : ''],
          text:
            spent === totalMinutes
              ? `المجموع ${spent} دقيقة ✓`
              : `المجموع ${spent} من ${totalMinutes} دقيقة`,
        })
      );
    }

    return el(
      'div',
      { class: 'crow' },
      el(
        'div',
        { class: 'chead' },
        el(
          'div',
          {},
          el('b', { text: name }),
          el('span', { text: detail })
        ),
        el('button', {
          class: ['ck', done ? 'on' : ''],
          text: done ? '✓' : '',
          attrs: { 'aria-pressed': String(done), 'aria-label': `كارديو ${name}` },
          on: { click: () => ctx.toggleCardio(i) },
        })
      ),
      el('div', { class: 'mchips' }, chips),
      warnings,
      split
    );
  });

  return el(
    'div',
    { class: 'wrap' },
    el('h3', { class: 'first', text: `الكارديو — ${cardioDays} أيام · ${goal.n}` }),
    el('div', {
      class: 'hint-lg',
      text: `اختر جهازك لكل يوم — وتقدر تختار لين ${MAX_MACHINES_PER_DAY} أجهزة وتقسّم الدقائق بينهم. كلها تسوي نفس الشي للحرق، الفرق في مفاصلك. لو جمعت جهازين متعارضين بتشوف تنبيه — تنبيه مو منع، القرار قرارك.`,
    }),
    el('div', { class: 'card tight-sm' }, rows),
    el('h3', { text: 'وش الفرق بين الأجهزة' }),
    el(
      'div',
      { class: 'card' },
      MACH.map((m) =>
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'a' }, m.n, el('small', { class: 'en', text: m.en })),
          el('span', { class: 'b', text: m.d })
        )
      )
    ),
    el('h3', { text: 'قواعد تخصك أنت' }),
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'يوم الاثنين (رجل): سيكل أو غزالة بس.' },
          ' الدرج والسير المائل يضربون نفس العضلات اللي دمّرتها بالحديد، وبتجي الأسبوع الجاي ما تقدر تزيد وزن.',
        ],
        [
          { b: 'الدرج أقوى جهاز حرق، بس هو أقسى شي على ركبتك.' },
          ' لو تبيه، خله يوم واحد بالأسبوع (الخميس) وابدأ 20 دقيقة.',
        ],
        [
          { b: 'نوّع بين جهازين على الأقل.' },
          ' نفس الجهاز 6 أيام = إجهاد متكرر بنفس المفصل، وملل يخليك تترك.',
        ],
        [{ b: 'لا تركض ركض عنيف حالياً.' }, ' بعد ما تنزل تحت 90 كجم نتكلم عن الركض.'],
        [
          { b: 'أفضل جهاز هو اللي بتلتزم فيه 6 أيام.' },
          ' الفرق بينهم بالحرق أصغر بكثير من الفرق بين إنك تروح وإنك ما تروح.',
        ],
      ])
    )
  );
}
