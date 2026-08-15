import { el, richText } from '../dom.js';
import { bulletList, toast } from '../ui.js';
import { PLAN, DAYS, exById } from '../program.js';
import { verdict, progress, MAX_WEEK } from '../engine.js';

export function renderWeek(ctx) {
  const { store, navigate } = ctx;
  const wk = store.viewWeek;
  const week = store.week(wk);
  const prevBody = store.week(wk - 1).body;
  const v = verdict(week.body, prevBody);

  /* how many lifts go up next week */
  const ups = [];
  if (week.body) {
    const current = store.weightsFor(wk);
    const next = progress(current, week, v);
    for (const [id, value] of Object.entries(next)) {
      const e = exById(id);
      if (!e || e.body) continue;
      if (value !== current[id]) ups.push(e.n);
    }
  }

  const doneTotal = DAYS.reduce(
    (acc, d) =>
      acc +
      PLAN[d].ex.filter((e) => {
        const sets = week.sets[e.id] || [];
        return sets.length === e.sets && sets.every(Boolean);
      }).length,
    0
  );
  const total = DAYS.reduce((acc, d) => acc + PLAN[d].ex.length, 0);

  /* ── measurement form ── */
  const weightInput = el('input', {
    id: 'bw',
    type: 'number',
    inputmode: 'decimal',
    step: '0.1',
    min: '20',
    max: '400',
    placeholder: '102.0',
    value: week.body?.weight != null ? String(week.body.weight) : '',
  });
  const muscleInput = el('input', {
    id: 'bm',
    type: 'number',
    inputmode: 'decimal',
    step: '0.1',
    min: '5',
    max: '300',
    placeholder: 'لو ميزانك يعطيها',
    value: week.body?.muscle != null ? String(week.body.muscle) : '',
  });

  const saveBody = () => {
    const weight = Number.parseFloat(weightInput.value);
    if (!Number.isFinite(weight)) return toast('اكتب وزنك أول');
    if (weight < 20 || weight > 400) return toast('الوزن لازم بين 20 و 400 كجم');

    const muscleRaw = muscleInput.value.trim();
    let muscle = null;
    if (muscleRaw !== '') {
      muscle = Number.parseFloat(muscleRaw);
      if (!Number.isFinite(muscle) || muscle < 5 || muscle > 300) {
        return toast('الكتلة العضلية لازم بين 5 و 300 كجم');
      }
      if (muscle >= weight) return toast('الكتلة العضلية لازم أقل من وزنك');
    }

    store.update(wk, (w) => {
      w.body = { weight: Math.round(weight * 10) / 10, muscle: muscle === null ? null : Math.round(muscle * 10) / 10 };
    });
    toast('انحفظ — شوف القرار تحت');
    ctx.refresh();
  };

  const form = el(
    'div',
    { class: 'card' },
    el('div', { class: 'mut', text: 'سجّلها الجمعة الصبح على الريق، قبل ما تاكل أو تشرب.' }),
    el('label', { class: 'inp' }, el('span', { text: 'وزنك بالكيلو' }), weightInput),
    el(
      'label',
      { class: 'inp' },
      el('span', { text: 'الكتلة العضلية بالكيلو (اختياري)' }),
      muscleInput
    ),
    el('button', { class: 'cta', text: 'احسب قرار الأسبوع', on: { click: saveBody } })
  );

  /* ── verdict card ── */
  const deltas = el('div', { class: 'deltas' });
  if (v.dW !== undefined) {
    deltas.appendChild(
      el('span', {}, 'فرق الوزن', el('b', { text: `${v.dW > 0 ? '+' : ''}${v.dW} kg` }))
    );
  }
  if (v.dM !== null && v.dM !== undefined) {
    deltas.appendChild(
      el('span', {}, 'فرق الكتلة العضلية', el('b', { text: `${v.dM > 0 ? '+' : ''}${v.dM} kg` }))
    );
  }
  deltas.appendChild(el('span', {}, 'تمارين مكتملة', el('b', { text: `${doneTotal}/${total}` })));

  const verdictCard = el(
    'div',
    { class: ['verdict', v.kind] },
    el('h4', { text: v.t }),
    el('p', {}, ...richText(v.p)),
    deltas
  );

  /* ── next week ── */
  let nextCard = null;
  if (week.body && wk < MAX_WEEK) {
    const alreadyOpen = store.currentWeek > wk;
    nextCard = el(
      'div',
      { class: 'card' },
      el('b', { class: 'nexth', text: `اللي بيصير بأسبوع ${wk + 1}` }),
      el('div', {
        class: 'mut',
        text: ups.length ? `${ups.length} تمرين بيزيد وزنه` : 'ما فيه زيادة — كل الأوزان تثبت',
      }),
      ups.length ? el('ul', { class: 't' }, ups.map((name) => el('li', { text: name }))) : null,
      el('button', {
        class: 'cta',
        text: alreadyOpen ? `افتح أسبوع ${wk + 1}` : `ابدأ أسبوع ${wk + 1}`,
        on: {
          click: () => {
            store.advanceTo(Math.max(store.currentWeek, wk + 1));
            ctx.setWeek(wk + 1);
            navigate('home');
            toast(`أسبوع ${wk + 1} جاهز`);
          },
        },
      })
    );
  }

  return el(
    'div',
    { class: 'wrap' },
    el('button', { class: 'back', text: '‹ رجوع', on: { click: () => navigate('home') } }),
    el('h3', { class: 'first', text: `قياس نهاية الأسبوع ${wk}` }),
    form,
    verdictCard,
    nextCard,
    el('h3', { text: 'ليش القرار بهالطريقة' }),
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'نزول أكثر من 1.2% من وزنك بأسبوع = خطر.' },
          ' بهالسرعة تخسر عضل مع الدهون وجسمك ما يتحمل زيادة الأوزان.',
        ],
        [
          { b: 'الكتلة العضلية من الميزان الذكي رقم تقريبي.' },
          ' يتأثر بالماء والملح والنوم — اللي يهم اتجاهها بعد 3–4 أسابيع مو قراءة أسبوع.',
        ],
        [
          { b: '"كان خفيف" = قفزتين، "مضبوط" = قفزة، "ثقيل" = ثبات.' },
          ' ولو ما ضغطت شي بيحسبها مضبوط.',
        ],
        [{ b: 'التمرين اللي ما كمّلت مجموعاته ما يزيد وزنه.' }],
        [
          { b: 'لو عدّلت الوزن بنفسك داخل النادي، التطبيق يعتمد رقمك الجديد' },
          ' ويبني عليه الأسابيع اللي بعده.',
        ],
      ])
    ),
    el('h3', { text: 'الشي اللي يحدد النتيجة كلها' }),
    el(
      'div',
      { class: 'card' },
      el(
        'p',
        { class: 'lead' },
        'وأنت بعجز سعرات، ',
        el('b', { text: 'البروتين' }),
        ' هو الفرق بين إنك تنقص دهون وإنك تنقص عضل. هدفك ',
        el('b', { text: `${Math.round((week.body?.weight || 102) * 1.6)} جرام باليوم` }),
        '. لو ما وصلته، بتشوف الأوزان تثبت أسبوع ورا أسبوع وأنت ما تدري ليش.'
      )
    )
  );
}
