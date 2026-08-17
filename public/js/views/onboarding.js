/**
 * شاشة الترحيب: الهدف والمستوى وبيانات الجسم.
 *
 * Runs once, before the app proper, and is the only place the programme is
 * chosen. Selections toggle classes in place rather than re-rendering the view:
 * a repaint mid-flow would swap the DOM out from under the form and lose what
 * the user had already typed.
 */

import { el } from '../dom.js';
import { toast } from '../ui.js';
import { GOALS, GOAL_KEYS, LEVELS, LEVEL_KEYS } from '../program.js';
import { tdeeFormula, safeTarget, proteinTarget } from '../engine.js';

const ACTIVITY = [
  { a: 1.375, label: 'مكتبي — أجلس أغلب اليوم' },
  { a: 1.55, label: 'متوسط — أتحرك عادي' },
  { a: 1.725, label: 'عالي — شغلي حركة' },
];

export function renderOnboarding(ctx) {
  const { store } = ctx;
  const editing = store.hasProfile;
  const nut = store.doc.nutrition || {};
  const currentBody = store.week(store.currentWeek).body;

  let goal = editing ? store.goal : null;
  let level = editing ? store.level : null;
  let activity = nut.act || 1.55;

  /* ── step 1: goal ── */
  const goalCards = GOAL_KEYS.map((key) => {
    const g = GOALS[key];
    return el(
      'button',
      {
        class: ['gcard', key === goal ? 'on' : ''],
        data: { goal: key },
        attrs: { 'aria-pressed': String(key === goal) },
        on: {
          click: (event) => {
            goal = key;
            for (const card of event.currentTarget.parentElement.children) {
              const on = card.dataset.goal === key;
              card.classList.toggle('on', on);
              card.setAttribute('aria-pressed', String(on));
            }
          },
        },
      },
      el('div', { class: 'gtitle' }, g.n, el('small', { class: 'en', text: g.en })),
      el('div', { class: 'gdesc', text: g.desc }),
      el(
        'div',
        { class: 'gsum' },
        g.summary.map((s) => el('span', { text: s }))
      )
    );
  });

  /* ── step 2: level ── */
  const levelCards = LEVEL_KEYS.map((key) => {
    const l = LEVELS[key];
    return el(
      'button',
      {
        class: ['lcard', key === level ? 'on' : ''],
        data: { level: key },
        attrs: { 'aria-pressed': String(key === level) },
        on: {
          click: (event) => {
            level = key;
            for (const card of event.currentTarget.parentElement.children) {
              const on = card.dataset.level === key;
              card.classList.toggle('on', on);
              card.setAttribute('aria-pressed', String(on));
            }
          },
        },
      },
      el('div', { class: 'ltitle' }, l.n, el('small', { class: 'en', text: l.en })),
      el('div', { class: 'gdesc', text: l.d })
    );
  });

  /* ── step 3: body ── */
  const weightInput = el('input', {
    type: 'number',
    inputmode: 'decimal',
    step: '0.1',
    min: '20',
    max: '400',
    placeholder: 'مثال 85.5',
    value: currentBody?.weight != null ? String(currentBody.weight) : '',
  });
  const heightInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '120',
    max: '230',
    placeholder: 'مثال 175',
    value: nut.height != null ? String(nut.height) : '',
  });
  const ageInput = el('input', {
    type: 'number',
    inputmode: 'numeric',
    min: '14',
    max: '90',
    placeholder: 'مثال 28',
    value: nut.age != null ? String(nut.age) : '',
  });

  const actChips = ACTIVITY.map((option) =>
    el('button', {
      class: ['mchip', option.a === activity ? 'on' : ''],
      text: option.label,
      attrs: { 'aria-pressed': String(option.a === activity) },
      on: {
        click: (event) => {
          activity = option.a;
          for (const chip of event.currentTarget.parentElement.children) {
            const on = chip === event.currentTarget;
            chip.classList.toggle('on', on);
            chip.setAttribute('aria-pressed', String(on));
          }
        },
      },
    })
  );

  const save = () => {
    if (!goal) return toast('اختر هدفك أول');
    if (!level) return toast('اختر مستواك');

    const weight = Number.parseFloat(weightInput.value);
    if (!Number.isFinite(weight) || weight < 20 || weight > 400) {
      return toast('اكتب وزنك بالكيلو (20–400)');
    }
    const height = Number.parseInt(heightInput.value, 10);
    if (!Number.isFinite(height) || height < 120 || height > 230) {
      return toast('اكتب طولك بالسنتيمتر (120–230)');
    }
    const age = Number.parseInt(ageInput.value, 10);
    if (!Number.isFinite(age) || age < 14 || age > 90) return toast('اكتب عمرك (14–90)');

    const rounded = Math.round(weight * 10) / 10;
    // The weight doubles as the baseline measurement, so the first weekly
    // check-in has something to compare against.
    if (currentBody?.weight !== rounded) {
      store.update(store.currentWeek, (w) => {
        w.body = { weight: rounded, muscle: currentBody?.muscle ?? null };
      });
    }

    store.updateProfile((p) => {
      p.goal = goal;
      p.level = level;
    });

    const tdee = tdeeFormula(rounded, age, activity, height);
    store.updateNutrition((n) => {
      n.age = age;
      n.height = height;
      n.act = activity;
      n.tdee = tdee;
      n.target = safeTarget(tdee, goal);
      n.protein = proteinTarget(rounded, goal);
    });

    toast(editing ? 'انحدّث برنامجك' : `جاهز — برنامج ${GOALS[goal].n}`);
    ctx.navigate('home');
  };

  return el(
    'div',
    { class: 'wrap onb' },
    el(
      'div',
      { class: 'onbhead' },
      el('div', { class: 'logo', text: 'حديد' }),
      el('p', {
        text: editing
          ? 'عدّل هدفك ومستواك. برنامجك بيتغير، وكل اللي سجّلته محفوظ ويرجع لو رجعت لهدفك الأول.'
          : 'ثلاث خطوات بس، وبعدها برنامجك جاهز ومضبوط عليك.',
      })
    ),

    el('h3', { class: 'first', text: '١ · وش هدفك؟' }),
    el('div', { class: 'gcards' }, goalCards),

    el('h3', { text: '٢ · مستواك بالحديد' }),
    el('div', { class: 'lcards' }, levelCards),
    el('div', {
      class: 'hint-lg',
      text: 'هذا يضبط أوزان البداية بس — تقدر تعدّل أي وزن بنفسك داخل النادي.',
    }),

    el('h3', { text: '٣ · بياناتك' }),
    el(
      'div',
      { class: 'card' },
      el('label', { class: 'inp' }, el('span', { text: 'وزنك بالكيلو' }), weightInput),
      el('label', { class: 'inp' }, el('span', { text: 'طولك بالسنتيمتر' }), heightInput),
      el('label', { class: 'inp' }, el('span', { text: 'عمرك' }), ageInput),
      el(
        'div',
        { class: 'inp' },
        el('span', { text: 'نشاطك خارج النادي' }),
        el('div', { class: 'mchips' }, actChips)
      ),
      el('div', {
        class: 'mut',
        text: 'النادي محسوب أصلاً بالمعادلة — لا تحسبه مرتين.',
      })
    ),

    el('button', {
      class: 'cta big-cta',
      text: editing ? 'احفظ التعديل' : 'ابدأ برنامجي',
      on: { click: save },
    }),

    editing
      ? el('button', {
          class: 'cta ghost',
          text: 'رجوع بدون تعديل',
          on: { click: () => ctx.navigate('account') },
        })
      : null
  );
}
