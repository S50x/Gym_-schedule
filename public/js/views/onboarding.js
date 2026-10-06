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
import { JOBS, jobOf, jobFromAct, energyBreakdown, dailyTarget } from '../engine.js';
import { calcRows } from './nutri.js';
import {
  GOALS,
  GOAL_KEYS,
  LEVELS,
  LEVEL_KEYS,
  GROUPS,
  groupCount,
  DAY_NAMES,
  arrangeWeek,
  normalizeRestDays,
  maxRestDays,
  planOf,
} from '../program.js';

const SEXES = [
  { k: 'm', n: 'ذكر' },
  { k: 'f', n: 'أنثى' },
];

export function renderOnboarding(ctx) {
  const { store } = ctx;
  const editing = store.hasProfile;
  const nut = store.doc.nutrition || {};
  const currentBody = store.week(store.currentWeek).body;

  let goal = editing ? store.goal : null;
  let level = editing ? store.level : null;
  // A profile from before the job question opens on the job nearest its old
  // activity factor; a new one on nothing, so the choice is made, not inherited.
  let job = jobOf(nut.job)?.k || (nut.act ? jobFromAct(nut.act) : null);
  let sex = nut.sex === 'f' ? 'f' : 'm';
  // Weekdays off. Starts on what the trainee already has (or the goal's own
  // week), and is re-checked against the goal whenever the goal changes.
  let restDays = editing ? normalizeRestDays(store.goal, store.restDays) : null;
  // Per-group overrides, keyed by group. A group left out follows `level`.
  const groupLevels = { ...(editing ? store.levels || {} : {}) };

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
            // A new goal can have more lifting days than the old one had room for.
            restDays = normalizeRestDays(goal, restDays);
            paintRest();
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
            // A group that was matching the old level was following it, not
            // pinned to it, so the "· مستواي" tag and the pressed chip both move.
            paintGroups();
          },
        },
      },
      el('div', { class: 'ltitle' }, l.n, el('small', { class: 'en', text: l.en })),
      el('div', { class: 'gdesc', text: l.d })
    );
  });

  /* ── step 2b: per-group detail (optional) ── */

  /**
   * One row per muscle group. The chip matching the overall level is the one
   * selected by default and carries a "· مستواي" tag, so the default reads as a
   * real value the trainee recognises rather than an abstraction — and choosing
   * it stores nothing, which is what keeps the group following the overall
   * level if that level later changes.
   */
  const groupRows = GROUPS.map((group) => {
    const chips = LEVEL_KEYS.map((key) =>
      el('button', {
        class: 'mchip',
        data: { level: key, group: group.k },
        attrs: { 'aria-pressed': 'false' },
        on: {
          click: (event) => {
            if (key === level) delete groupLevels[group.k];
            else groupLevels[group.k] = key;
            paintGroupRow(event.currentTarget.parentElement, group.k);
          },
        },
      })
    );
    const row = el(
      'div',
      { class: 'grow' },
      el(
        'div',
        { class: 'glabel' },
        el('span', { class: 'gn', text: group.n }),
        el('span', { class: 'gsub', text: group.sub }),
        el('span', { class: 'cnt n', text: String(groupCount(group.k)) })
      ),
      el('div', { class: 'mchips', data: { group: group.k } }, chips)
    );
    return row;
  });

  /**
   * Repaint one row: label every chip, mark the inherited one, and press
   * whichever level actually governs the group right now.
   */
  function paintGroupRow(container, groupKey) {
    const active = groupLevels[groupKey] || level;
    for (const chip of container.children) {
      const key = chip.dataset.level;
      const on = key === active;
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
      chip.replaceChildren(document.createTextNode(LEVELS[key].n));
      if (key === level) {
        chip.appendChild(el('span', { class: 'tag', text: '· مستواي' }));
      }
    }
  }

  /** Every row, e.g. after the overall level changed underneath them. */
  function paintGroups() {
    for (const row of groupRows) {
      paintGroupRow(row.querySelector('.mchips'), row.querySelector('.mchips').dataset.group);
    }
  }

  const groupBox = el(
    'div',
    { class: 'gdetail' },
    el('div', {
      class: 'why',
      text: 'بعض الناس فوقهم أقوى من تحتهم أو العكس. الزر المعلّم «· مستواي» هو اللي اخترته فوق ومختار لك جاهز — غيّر بس المجموعة اللي تختلف عندك.',
    }),
    groupRows
  );

  // A <details> element: the browser owns the open/closed state, so there is no
  // toggle handler to keep in sync, and it collapses by default without any CSS
  // that could hide it for good if the script fails.
  const groupDetails = el(
    'details',
    { class: 'gdet' },
    el(
      'summary',
      {},
      el('span', { text: 'فصّل حسب جسمك' }),
      el('span', { class: 'opt', text: 'اختياري' })
    ),
    groupBox
  );

  /* ── step 4: rest days ── */
  const restChips = DAY_NAMES.map((name, i) =>
    el('button', {
      class: 'mchip',
      text: name,
      data: { day: String(i) },
      attrs: { 'aria-pressed': 'false' },
      on: {
        click: () => {
          if (!goal) return toast('اختر هدفك أول');
          const current = normalizeRestDays(goal, restDays);
          const next = current.includes(i) ? current.filter((d) => d !== i) : [...current, i];
          if (next.length > maxRestDays(goal)) {
            return toast(`هدفك يحتاج ${DAY_NAMES.length - maxRestDays(goal)} أيام حديد — أقصى راحة ${maxRestDays(goal)}`);
          }
          restDays = next.sort((a, b) => a - b);
          paintRest();
        },
      },
    })
  );
  const restPreview = el('div', { class: 'wprev' });

  /** Press the chosen days and show the week they produce. */
  function paintRest() {
    // The calorie preview follows the week: a goal or a rest day changes it.
    paintCalc();
    const chosen = goal ? normalizeRestDays(goal, restDays) : [];
    for (const chip of restChips) {
      const on = chosen.includes(Number(chip.dataset.day));
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', String(on));
    }
    if (!goal) {
      restPreview.replaceChildren(el('div', { class: 'mut', text: 'اختر هدفك فوق وبيطلع أسبوعك هنا.' }));
      return;
    }
    const { lift, cardio } = arrangeWeek(goal, chosen);
    const plan = planOf(goal, chosen);
    restPreview.replaceChildren(
      ...DAY_NAMES.map((name, i) => {
        const what = lift[i]
          ? `حديد — ${plan[lift[i]].title}`
          : cardio[i]?.rest
            ? 'راحة'
            : `كارديو ${cardio[i].min} د`;
        return el(
          'div',
          { class: ['wprow', lift[i] ? 'lift' : cardio[i]?.rest ? 'off' : ''] },
          el('span', { class: 'wd', text: name }),
          el('span', { text: what })
        );
      })
    );
  }

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

  /** A row of single-choice chips; `pick` gets the chosen key. */
  const chipRow = (options, current, pick) =>
    options.map((option) =>
      el(
        'button',
        {
          class: ['mchip', option.k === current ? 'on' : ''],
          data: { k: option.k },
          attrs: { type: 'button', 'aria-pressed': String(option.k === current) },
          on: {
            click: (event) => {
              pick(option.k);
              for (const chip of event.currentTarget.parentElement.children) {
                const on = chip === event.currentTarget;
                chip.classList.toggle('on', on);
                chip.setAttribute('aria-pressed', String(on));
              }
              paintCalc();
            },
          },
        },
        option.hint ? [el('b', { text: option.n }), el('small', { text: option.hint })] : option.n
      )
    );
  const sexChips = chipRow(SEXES, sex, (k) => (sex = k));
  const jobChips = chipRow(JOBS, job, (k) => (job = k));

  /* The target, worked out live from whatever is filled in so far — the same
     rows the nutrition page shows, so what is promised here is what appears. */
  const calcBox = el('div', { class: 'kprev', attrs: { 'aria-live': 'polite' } });
  function paintCalc() {
    const weight = Number.parseFloat(weightInput.value);
    const height = Number.parseInt(heightInput.value, 10);
    const age = Number.parseInt(ageInput.value, 10);
    const ready =
      goal &&
      job &&
      weight >= 20 &&
      weight <= 400 &&
      height >= 120 &&
      height <= 230 &&
      age >= 14 &&
      age <= 90;
    if (!ready) {
      calcBox.replaceChildren(
        el('div', {
          class: 'mut',
          text: 'عبّ وزنك وطولك وعمرك واختر شغلك، ونحسب سعراتك هنا على طول.',
        })
      );
      return;
    }
    const n = { age, height, sex, job };
    const days = normalizeRestDays(goal, restDays);
    const parts = energyBreakdown(n, weight, goal, days);
    const target = dailyTarget(n, weight, goal, null, days);
    calcBox.replaceChildren(calcRows({ parts, goalKey: goal, target }));
  }
  for (const input of [weightInput, heightInput, ageInput]) input.addEventListener('input', paintCalc);

  // First paint: labels and the inherited tag depend on `level`, which may
  // already be set when an existing trainee reopens this to edit.
  paintGroups();
  paintRest();

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
    if (!job) return toast('اختر طبيعة شغلك');

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
      // Only groups that genuinely differ are stored; the rest keep following
      // the overall level, so nothing is written for someone who never opened
      // the section.
      const overrides = {};
      for (const [group, key] of Object.entries(groupLevels)) {
        if (key && key !== level) overrides[group] = key;
      }
      p.levels = Object.keys(overrides).length ? overrides : null;
      p.restDays = normalizeRestDays(goal, restDays);
    });

    // Only the inputs are stored. Calories and protein are derived from these
    // plus the latest weight every time they are shown, so they never go stale.
    store.updateNutrition((n) => {
      n.age = age;
      n.height = height;
      n.sex = sex;
      n.job = job;
      // Still written for a device on an older version, which reads only this.
      // It now means the day without the gym, so that copy will undercount.
      n.act = jobOf(job).f;
    });

    toast(editing ? 'انحدّث برنامجك' : `جاهز — برنامج ${GOALS[goal].n}`);
    ctx.navigate('home');
  };

  /* ── the four sections ── */
  const sections = [
    [el('h3', { class: 'first', text: 'وش هدفك؟' }), el('div', { class: 'gcards' }, goalCards)],
    [
      el('h3', { class: 'first', text: 'مستواك بالحديد' }),
      el('div', { class: 'lcards' }, levelCards),
      el('div', {
        class: 'hint-lg',
        text: 'هذا يضبط أوزان البداية بس — تقدر تعدّل أي وزن بنفسك داخل النادي.',
      }),
      groupDetails,
    ],
    [
      el('h3', { class: 'first', text: 'أيام راحتك' }),
      el(
        'div',
        { class: 'card' },
        el('div', {
          class: 'mut',
          text: 'اختر الأيام اللي ما تبي تتمرن فيها، والبرنامج يرتّب أيام الحديد والكارديو على الباقي.',
        }),
        el('div', { class: 'mchips' }, restChips),
        restPreview
      ),
    ],
    [
      el('h3', { class: 'first', text: 'بياناتك' }),
      el(
        'div',
        { class: 'card' },
        el('label', { class: 'inp' }, el('span', { text: 'وزنك بالكيلو' }), weightInput),
        el('label', { class: 'inp' }, el('span', { text: 'طولك بالسنتيمتر' }), heightInput),
        el('label', { class: 'inp' }, el('span', { text: 'عمرك' }), ageInput),
        el('div', { class: 'inp' }, el('span', { text: 'الجنس' }), el('div', { class: 'mchips' }, sexChips)),
        el(
          'div',
          { class: 'inp' },
          el('span', { text: 'طبيعة شغلك ويومك (بدون النادي)' }),
          el('div', { class: 'mchips jobs' }, jobChips)
        ),
        el('div', {
          class: 'mut',
          text: 'التمارين نحسبها من برنامجك نفسه — أيام الحديد ودقايق الكارديو — فلا تحسب النادي هنا.',
        }),
        calcBox
      ),
    ],
  ];

  const saveButton = el('button', {
    class: 'cta big-cta',
    text: editing ? 'احفظ التعديل' : 'ابدأ برنامجي',
    on: { click: save },
  });

  /* Editing from the account page: one page, every section at once — the
     person is changing one thing and should not page through four to find it. */
  if (editing) {
    return el(
      'div',
      { class: 'wrap onb' },
      el(
        'div',
        { class: 'onbhead' },
        el('div', { class: 'logo', text: 'حديد' }),
        el('p', {
          text: 'عدّل هدفك ومستواك وأيام راحتك. برنامجك بيتغير، وكل اللي سجّلته محفوظ ويرجع لو رجعت لهدفك الأول.',
        })
      ),
      sections.map((parts, i) => {
        const [heading, ...rest] = parts;
        // Only the first heading sits flush; the rest keep their spacing.
        if (i) heading.classList.remove('first');
        return [heading, ...rest];
      }),
      saveButton,
      el('button', {
        class: 'cta ghost',
        text: 'رجوع بدون تعديل',
        on: { click: () => ctx.navigate('account') },
      })
    );
  }

  /* First run: one step at a time. The sections are built once and only shown
     or hidden, never rebuilt — what was chosen or typed stays where it was. */
  let current = 0;
  const steps = sections.map((parts) => el('section', { class: 'ostep' }, parts));
  const marks = steps.map(() => el('li', {}));
  const counter = el('span', { class: 'ocount' });
  const back = el('button', { class: 'cta ghost oback', text: 'رجوع', on: { click: () => go(current - 1) } });
  const next = el('button', { class: 'cta onext', text: 'التالي', on: { click: () => advance() } });
  // Someone who already has an account on another phone must not be made to
  // invent a goal before they can even reach the login form — their real goal
  // is about to arrive with their data.
  const login = el('button', {
    class: 'cta ghost',
    text: 'عندي حساب — سجّل دخول',
    on: { click: () => ctx.goToLogin() },
  });

  function go(index) {
    current = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((node, i) => (node.hidden = i !== current));
    marks.forEach((mark, i) => (mark.className = i < current ? 'done' : i === current ? 'now' : ''));
    counter.textContent = `خطوة ${current + 1} من ${steps.length}`;
    const last = current === steps.length - 1;
    next.hidden = last;
    saveButton.hidden = !last;
    back.hidden = current === 0;
    login.hidden = current !== 0;
    window.scrollTo(0, 0);
  }

  function advance() {
    if (current === 0 && !goal) return toast('اختر هدفك أول');
    if (current === 1 && !level) return toast('اختر مستواك');
    go(current + 1);
  }

  go(0);

  return el(
    'div',
    { class: 'wrap onb wizard' },
    el(
      'div',
      { class: 'onbhead' },
      el('div', { class: 'logo', text: 'حديد' }),
      el('ol', { class: 'omarks', attrs: { 'aria-hidden': 'true' } }, marks),
      counter
    ),
    steps,
    el('div', { class: 'onav' }, back, next, saveButton),
    login
  );
}
