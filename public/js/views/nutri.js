import { el, richText } from '../dom.js';
import { fmt, bulletList, toast } from '../ui.js';
import { DAY_NAMES, goalOf } from '../program.js';
import { safeTarget, avgCal, avgPro, measuredTDEE, proteinTarget } from '../engine.js';

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

  const nut = store.doc.nutrition;
  const target = nut.target;
  const protein = proteinTarget(bodyWeight, goalKey);

  /* ── day rows ── */
  const summaryBox = el('div', {});
  const paint = () =>
    summaryBox.replaceChildren(summaryCard(store, wk, bodyWeight, ctx, goalKey));

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

    return el('div', { class: 'nrow' }, el('span', { class: 'nd', text: name }), calInput, proInput);
  });

  paint();

  return el(
    'div',
    { class: 'wrap' },
    el(
      'div',
      { class: 'today top' },
      el('div', { class: 'lbl', text: 'DAILY TARGET' }),
      el('h2', {}, el('span', { class: 'n', text: fmt(target) }), ' سعرة'),
      el('p', {
        // The gap is a deficit when cutting and a surplus when building, so it
        // is named for whichever it actually is.
        text:
          `بروتين ${protein} جرام · احتياجك للثبات ${fmt(nut.tdee)}` +
          (target === nut.tdee
            ? ' · بدون عجز ولا زيادة'
            : target < nut.tdee
              ? ` · العجز ${fmt(nut.tdee - target)} سعرة`
              : ` · الزيادة ${fmt(target - nut.tdee)} سعرة`),
      })
    ),
    el('h3', { text: `سجّل يومك — أسبوع ${wk}` }),
    el('div', { class: 'card rows' }, rows),
    summaryBox,
    el('h3', { text: 'ليش هالصفحة أهم من الحديد' }),
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'الحديد يقرر شكل جسمك. السعرات تقرر حجمه.' },
          ' واحد بدون الثاني ما يوصلك لهدفك.',
        ],
        [
          { b: `هدفك الحالي مبني على ${goal.n}` },
          ` — عشان كذا الرقم ${fmt(target)} مو رقم عام، هو محسوب من وزنك وطولك وعمرك ونشاطك.`,
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

/* ────────────────────────── summary ────────────────────────── */

/**
 * The original file carried this block twice — once in the page and once in a
 * "summary" helper — and the two copies had already drifted. One copy now.
 */
function summaryCard(store, wk, bodyWeight, ctx, goalKey) {
  const nut = store.doc.nutrition;
  const target = nut.target;
  const protein = proteinTarget(bodyWeight, goalKey);
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
      el('span', { text: name.slice(0, 3) })
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
    if (avg.avg < Math.max(1700, nut.tdee * 0.7)) {
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

  /* measured maintenance */
  const measured = measuredTDEE(store.calHist(), store.bodyHist());
  if (measured) {
    const diff = measured.val - nut.tdee;
    const close = Math.abs(diff) < 150;
    const explanation = close
      ? 'قريب من التقدير، يعني المعادلة كانت مضبوطة عليك.'
      : diff < 0
        ? `أقل من التقدير بـ ${fmt(Math.abs(diff))} سعرة. جسمك يحرق أقل مما توقعنا، فهدفك لازم يتعدّل.`
        : `أعلى من التقدير بـ ${fmt(diff)} سعرة. جسمك يحرق أكثر مما توقعنا.`;

    const card = el(
      'div',
      { class: ['verdict', close ? 'go' : 'hold'] },
      el('h4', {}, 'سعراتك الحقيقية: ', el('span', { class: 'n', text: fmt(measured.val) })),
      el(
        'p',
        {},
        ...richText([
          'هذا محسوب من ',
          { b: 'أكلك الفعلي مقابل تغير وزنك' },
          ` عبر ${measured.weeks} أسبوع — مو من معادلة. ${explanation}`,
        ])
      )
    );

    if (!close) {
      card.appendChild(
        el('button', {
          class: 'cta',
          text: `حدّث هدفي إلى ${fmt(safeTarget(measured.val, goalKey))}`,
          on: {
            click: () => {
              store.updateNutrition((n) => {
                n.tdee = measured.val;
                n.target = safeTarget(measured.val, goalKey);
              });
              toast('انحدّث هدفك');
              ctx.refresh();
            },
          },
        })
      );
    }
    parts.push(card);
  }

  const box = document.createDocumentFragment();
  for (const part of parts) box.appendChild(part);
  return box;
}

function lastKnownWeight(store) {
  const weeks = Object.keys(store.doc.weeks)
    .map(Number)
    .sort((a, b) => b - a);
  for (const n of weeks) {
    const body = store.doc.weeks[String(n)]?.body;
    if (body?.weight) return body.weight;
  }
  return null;
}
