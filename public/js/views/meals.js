/**
 * وجبات اليوم: القائمة، الإضافة، والأشرطة مقابل الهدف.
 *
 * Every meal is optional. Nothing here asks for breakfast, lunch or dinner:
 * the trainee adds what they ate, as many times as they ate, and the tag
 * (فطور/غدا/عشا/سناك) is a label they can change or leave off. A day with no
 * meals is "not logged", never "zero".
 */

import { el, append } from '../dom.js';
import { fmt, toast } from '../ui.js';
import { mealTotals, mealAlerts, MEAL_SLOTS, slotForHour } from '../engine.js';

const FIELDS = [
  { key: 'k', label: 'سعرات', max: 10000, unit: '' },
  { key: 'p', label: 'بروتين', max: 1000, unit: 'g' },
  { key: 'f', label: 'دهون', max: 1000, unit: 'g' },
  { key: 'c', label: 'كارب', max: 1500, unit: 'g' },
];

const BARS = [
  { key: 'kcal', label: 'السعرات', unit: '' },
  { key: 'protein', label: 'بروتين', unit: 'g' },
  { key: 'fat', label: 'دهون', unit: 'g' },
  { key: 'carbs', label: 'كارب', unit: 'g' },
];

/** Short, unique enough within one person's week; matches the server's id rule. */
const newId = () =>
  (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16);

/** "42" → 42, "" → 0, junk → 0, clamped to the field's ceiling, one decimal. */
function readNumber(raw, max) {
  const n = Number.parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, max) * 10) / 10;
}

/**
 * The four bars of a day against its targets. Colour says where you are:
 * mint on track, orange past the target, coral well past it.
 */
export function macroBars(totals, targets) {
  return el(
    'div',
    { class: 'mbars' },
    BARS.map(({ key, label, unit }) => {
      const have = totals?.[key] || 0;
      const want = targets[key] || 0;
      const ratio = want > 0 ? have / want : 0;
      const state = ratio > 1.2 ? 'hi' : ratio > 1.05 ? 'over' : 'ok';
      return el(
        'div',
        { class: 'mbar' },
        el(
          'div',
          { class: 'mhead' },
          el('span', { text: label }),
          el('span', { class: 'n', text: `${fmt(have)}${unit} / ${fmt(want)}${unit}` })
        ),
        el(
          'div',
          { class: 'mtrack' },
          el('i', { class: state, style: { width: `${Math.min(100, Math.round(ratio * 100))}%` } })
        )
      );
    })
  );
}

/**
 * The open day: its bars, alerts, meals and the add form.
 *
 * @param {object} o
 * @param {object} o.store
 * @param {number} o.wk       week number
 * @param {number} o.day      weekday index, Sat=0 … Fri=6
 * @param {{kcal,protein,fat,carbs}} o.targets
 * @param {boolean} o.isToday
 * @param {() => void} o.onChange  called after every saved change
 * @param {(form: object) => HTMLElement|null} [o.extraActions]  e.g. the photo reader
 */
export function mealPanel({ store, wk, day, targets, isToday, onChange, extraActions }) {
  const box = el('div', { class: 'mpanel' });

  const paint = () => {
    const meals = store.week(wk).meals?.[day] || [];
    const totals = mealTotals(meals);
    const alerts = mealAlerts(totals, targets, { isToday, hour: new Date().getHours() });

    const list = meals.length
      ? el(
          'div',
          { class: 'mlist' },
          meals.map((m) =>
            el(
              'div',
              { class: 'meal' },
              el(
                'div',
                { class: 'mname' },
                el('b', { text: m.n || 'وجبة' }),
                m.s === null || m.s === undefined ? null : el('span', { class: 'mtag', text: MEAL_SLOTS[m.s] })
              ),
              el('div', {
                class: 'mmac n',
                text: `${fmt(m.k)} سعرة · ب ${fmt(m.p)} · د ${fmt(m.f)} · ك ${fmt(m.c)}`,
              }),
              el('button', {
                class: 'mdel',
                text: '×',
                attrs: { 'aria-label': `احذف ${m.n || 'الوجبة'}` },
                on: {
                  click: () => {
                    store.updateMeals(wk, day, (list) => list.filter((x) => x.id !== m.id));
                    paint();
                    onChange();
                  },
                },
              })
            )
          )
        )
      : el('div', { class: 'mut', text: 'ما سجّلت أكل لهاليوم. أضف اللي أكلته بس — كل الوجبات اختيارية.' });

    // replaceChildren would print a null as the text "null"; append() skips it.
    box.replaceChildren();
    append(box, [
      macroBars(totals, targets),
      alerts.length
        ? el(
            'div',
            { class: 'malerts' },
            alerts.map((a) => el('div', { class: ['malert', a.level], text: a.text }))
          )
        : null,
      list,
      addForm(),
    ]);
  };

  /** Name, optional tag, four numbers. Only a name or one number is needed. */
  function addForm() {
    let slot = isToday ? slotForHour(new Date().getHours()) : null;

    const name = el('input', {
      class: 'mi mn',
      type: 'text',
      maxlength: '80',
      placeholder: 'اسم الأكل (اختياري)',
      attrs: { 'aria-label': 'اسم الأكل', autocomplete: 'off' },
    });
    const inputs = Object.fromEntries(
      FIELDS.map((f) => [
        f.key,
        el('input', {
          class: 'mi',
          type: 'number',
          inputmode: 'decimal',
          min: '0',
          max: String(f.max),
          step: '0.1',
          placeholder: f.label,
          attrs: { 'aria-label': f.label },
        }),
      ])
    );

    const chips = MEAL_SLOTS.map((label, i) =>
      el('button', {
        class: ['mchip', i === slot ? 'on' : ''],
        text: label,
        attrs: { 'aria-pressed': String(i === slot), type: 'button' },
        on: {
          click: (event) => {
            // Tapping the pressed tag clears it: a meal does not need one.
            slot = slot === i ? null : i;
            for (const [j, chip] of [...event.currentTarget.parentElement.children].entries()) {
              chip.classList.toggle('on', j === slot);
              chip.setAttribute('aria-pressed', String(j === slot));
            }
          },
        },
      })
    );

    const form = {
      name,
      inputs,
      /** Fill the form from outside (the photo reader); empty fields stay empty. */
      fill(meal) {
        if (meal.n) name.value = meal.n;
        for (const f of FIELDS) {
          const v = meal[f.key];
          inputs[f.key].value = Number.isFinite(v) ? String(v) : '';
          inputs[f.key].classList.toggle('missing', !Number.isFinite(v));
        }
        name.classList.toggle('missing', !meal.n);
        form.source = meal.src || 'manual';
      },
      source: 'manual',
    };

    const save = () => {
      const meal = {
        id: newId(),
        n: name.value.replace(/\s+/g, ' ').trim().slice(0, 80),
        s: slot,
        src: form.source,
        t: Date.now(),
      };
      for (const f of FIELDS) meal[f.key] = readNumber(inputs[f.key].value, f.max);
      if (!meal.n && !FIELDS.some((f) => meal[f.key] > 0)) {
        return toast('اكتب اسم الأكل أو رقم واحد على الأقل');
      }
      const count = store.week(wk).meals?.[day]?.length || 0;
      if (count >= 20) return toast('وصلت حد ٢٠ وجبة لهاليوم');
      store.updateMeals(wk, day, (list) => [...list, meal]);
      toast('انحفظت الوجبة');
      paint();
      onChange();
    };

    return el(
      'div',
      { class: 'madd' },
      el('div', { class: 'mut', text: 'أضف وجبة' }),
      extraActions ? extraActions(form) : null,
      name,
      el('div', { class: 'mchips' }, chips),
      el('div', { class: 'mgrid' }, FIELDS.map((f) => inputs[f.key])),
      el('button', { class: 'cta', text: 'حفظ الوجبة', on: { click: save } })
    );
  }

  paint();
  return box;
}
