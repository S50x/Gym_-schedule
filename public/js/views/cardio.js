import { el } from '../dom.js';
import { bulletList } from '../ui.js';
import { CARDIO, MACH } from '../program.js';

export function renderCardio(ctx) {
  const { store, navigate } = ctx;
  const week = store.week();

  const rows = CARDIO.map((entry, i) => {
    const [name, detail, isRest] = entry;
    if (isRest) {
      return el(
        'div',
        { class: 'row dim' },
        el('span', { class: 'a', text: name }),
        el('span', { class: 'b', text: detail })
      );
    }

    const done = !!week.cardio[String(i)];
    const selected = week.cmach[String(i)];

    return el(
      'div',
      { class: 'crow' },
      el(
        'div',
        { class: 'chead' },
        el('div', {}, el('b', { text: name }), el('span', { text: detail })),
        el('button', {
          class: ['ck', done ? 'on' : ''],
          text: done ? '✓' : '',
          attrs: { 'aria-pressed': String(done), 'aria-label': `كارديو ${name}` },
          on: { click: () => ctx.toggleCardio(i) },
        })
      ),
      el(
        'div',
        { class: 'mchips' },
        MACH.map((m) =>
          el('button', {
            class: ['mchip', selected === m.k ? 'on' : ''],
            text: m.n,
            attrs: { 'aria-pressed': String(selected === m.k) },
            on: { click: () => ctx.toggleMachine(i, m.k) },
          })
        )
      )
    );
  });

  return el(
    'div',
    { class: 'wrap' },
    el('button', { class: 'back', text: '‹ رجوع', on: { click: () => navigate('home') } }),
    el('h3', { class: 'first', text: 'الكارديو — 6 أيام' }),
    el('div', {
      class: 'hint-lg',
      text: 'اختر جهازك لكل يوم. كلها تسوي نفس الشي للحرق — الفرق في مفاصلك وفي تعارضها مع الحديد.',
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
          el('span', { class: 'a', text: m.n }),
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
