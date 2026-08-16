/**
 * البرنامج التدريبي — مصدر الحقيقة الوحيد.
 * The training program — single source of truth, imported by BOTH the browser
 * app and the server (for validating what a client is allowed to store).
 * Keep it free of DOM/Node APIs so both sides can import it as-is.
 *
 * Cue text is stored as an array of parts instead of an HTML string:
 *   "plain text"      → rendered as a text node
 *   { b: "text" }     → rendered as <b>text</b>
 * That removes the last reason to ever call innerHTML with program data.
 */

export const PLAN = {
  sat: {
    day: 'السبت',
    title: 'علوي — دفع',
    focus: 'صدر وكتف وظهر. هذا يومك الأهم، لأن ضعفك بالعلوي.',
    ex: [
      {
        id: 'chest_db',
        n: 'ضغط صدر دمبل مستوي',
        en: 'Flat Dumbbell Bench Press',
        sets: 3,
        reps: '8–12',
        repsN: 10,
        base: 10,
        step: 2,
        hand: 1,
        rest: 90,
        cue: [
          'نزّل الدمبل لين يوصل مستوى صدرك بالضبط. ',
          { b: 'لا تقفل كوعك بعنف فوق' },
          '، وخلّ لوح كتفك مضغوط للخلف طول التمرين.',
        ],
        v: 'https://www.youtube.com/watch?v=D4wTbsN_7lI',
        vlbl: 'مقطع يوتيوب (عربي)',
      },
      {
        id: 'sh_press',
        n: 'ضغط كتف دمبل جالس',
        en: 'Seated Dumbbell Shoulder Press',
        sets: 3,
        reps: '8–12',
        repsN: 10,
        base: 8,
        step: 2,
        hand: 1,
        rest: 90,
        cue: [
          'ظهرك ملتصق بالكرسي و',
          { b: 'لا تقوّس ظهرك أبداً' },
          '. خلّ كوعك شوي للقدام مو مفتوح 90 درجة كامل، أرحم لكتفك.',
        ],
        v: 'https://www.youtube.com/watch?v=lfb3ffbrd4Q',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'lat_pull',
        n: 'سحب أمامي (لات بولداون)',
        en: 'Lat Pulldown',
        sets: 3,
        reps: '10–12',
        repsN: 11,
        base: 35,
        step: 2.5,
        rest: 75,
        cue: [
          'اسحب البار لأعلى صدرك، ',
          { b: 'مو خلف رقبتك' },
          '. وفكّر إن كوعك ينزل لتحت، لا تفكر إن يدك تسحب — الفرق كبير بالإحساس.',
        ],
        v: 'https://www.youtube.com/watch?v=CAwf7n6Luuc',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'cable_row',
        n: 'تجديف كيبل جالس',
        en: 'Seated Cable Row',
        sets: 3,
        reps: '10–12',
        repsN: 11,
        base: 35,
        step: 2.5,
        rest: 75,
        cue: [
          'ظهرك مستقيم و',
          { b: 'لا ترجع بجسمك للخلف' },
          ' عشان تسحب وزن أثقل. اسحب لجهة سرّتك واعصر لوح كتفك ثانية وحدة.',
        ],
        v: 'https://www.youtube.com/watch?v=7o2oolbmzeI',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'lat_raise',
        n: 'رفرفة جانبي دمبل',
        en: 'Dumbbell Lateral Raise',
        sets: 3,
        reps: '12–15',
        repsN: 13,
        base: 5,
        step: 2,
        hand: 1,
        rest: 60,
        cue: [
          'وزن خفيف صدق، هذا تمرين عزل. ارفع لين مستوى كتفك بس، ',
          { b: 'وبدون أي رجّة بالجسم' },
          '.',
        ],
        v: 'https://www.youtube.com/watch?v=pgrWjBfaFe8',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'tri_push',
        n: 'ترايسبس بوش داون حبل',
        en: 'Rope Triceps Pushdown',
        sets: 3,
        reps: '12–15',
        repsN: 13,
        base: 15,
        step: 2.5,
        rest: 60,
        cue: ['كوعك ملزوق بجنبك وما يتحرك من مكانه. افتح الحبل بنهاية الحركة واعصر.'],
        v: 'https://www.youtube.com/watch?v=RhkRr9eyOzQ',
        vlbl: 'مقطع يوتيوب (نسخة يد وحدة)',
      },
      {
        id: 'plank',
        n: 'بلانك',
        en: 'Plank',
        sets: 3,
        reps: 'ثواني',
        base: 30,
        step: 5,
        time: 1,
        rest: 45,
        cue: [
          '1) انزل على مرفقك وأطراف قدمك، والمرفق تحت كتفك بالضبط. 2) جسمك خط مستقيم من كعبك لرأسك. 3) ',
          { b: 'شد بطنك ومؤخرتك مع بعض' },
          ' وكأن أحد بيضربك ببطنك. 4) خلّ حوضك مدحور شوي لتحت عشان ظهرك ما يتقوّس. 5) رقبتك امتداد لظهرك — عينك على الأرض قدامك مو للأمام. ',
          { b: 'أول ما ينزل خصرك أو يطلع مؤخرتك، وقف' },
          ' — الوقت الصحيح أهم من الوقت الطويل.',
        ],
        v: 'https://www.muscleandstrength.com/exercises/hover.html',
        vlbl: 'صفحة فيها مقطع',
      },
    ],
  },

  mon: {
    day: 'الاثنين',
    title: 'سفلي + وسط',
    focus: 'رجلك قوية أصلاً — نحافظ عليها ونزيدها بدون ما تسرق وقت العلوي.',
    ex: [
      {
        id: 'leg_press',
        n: 'لبج بريس',
        en: 'Leg Press',
        sets: 3,
        reps: '10–12',
        repsN: 11,
        base: 60,
        step: 5,
        rest: 120,
        cue: [
          'نزّل لين تقارب 90 درجة بالركبة. ',
          { b: 'لا ترفع ظهرك أو مؤخرتك عن الكرسي' },
          '، ولا تقفل ركبتك فوق.',
        ],
        v: 'https://www.youtube.com/watch?v=K5n2vg3oZa4',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'rdl',
        n: 'رومانيان ديدليفت دمبل',
        en: 'Dumbbell Romanian Deadlift',
        sets: 3,
        reps: '10',
        repsN: 10,
        base: 12,
        step: 2,
        hand: 1,
        rest: 120,
        cue: [
          'ركبتك شبه مستقيمة، ارجع بحوضك للخلف والدمبل يمشي قريب من رجلك. ',
          { b: 'ظهرك مستقيم دايم' },
          ' ولازم تحس بشد خلف فخذك.',
        ],
        v: 'https://www.youtube.com/watch?v=hQgFixeXdZo',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'leg_ext',
        n: 'تمديد الأرجل',
        en: 'Leg Extension',
        sets: 3,
        reps: '12',
        repsN: 12,
        base: 25,
        step: 2.5,
        rest: 60,
        cue: ['اعصر فوق ثانية وحدة ونزّل ببطء. لا ترمي الوزن بالنزول.'],
        v: 'https://www.muscleandstrength.com/exercises/leg-extension.html',
        vlbl: 'صفحة فيها مقطع',
      },
      {
        id: 'leg_curl',
        n: 'ثني الأرجل',
        en: 'Leg Curl',
        sets: 3,
        reps: '12',
        repsN: 12,
        base: 25,
        step: 2.5,
        rest: 60,
        cue: [
          'حوضك ملزوق بالجهاز و',
          { b: 'لا ترفعه' },
          ' وقت السحب — لو رفعته، الوزن ثقيل.',
        ],
        v: 'https://www.muscleandstrength.com/exercises/leg-curl.html',
        vlbl: 'صفحة فيها مقطع',
      },
      {
        id: 'calf',
        n: 'رفع السمانة واقف',
        en: 'Standing Calf Raise',
        sets: 3,
        reps: '15',
        repsN: 15,
        base: 30,
        step: 5,
        rest: 45,
        cue: ['مدى كامل: نزّل كعبك تحت مستوى الدرجة، ثم اطلع لأقصى نقطة وثبّت ثانية.'],
        v: 'https://www.youtube.com/watch?v=H6WptvjXkgw',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'deadbug',
        n: 'ديد بق',
        en: 'Dead Bug',
        sets: 3,
        reps: '10 لكل جهة',
        repsN: 10,
        base: 0,
        step: 0,
        body: 1,
        rest: 45,
        cue: [
          '1) نم على ظهرك، ارفع يديك عمودي فوق صدرك، وارفع رجولك وركبتك مثنية 90 درجة. 2) الزق أسفل ظهرك بالأرض ولا تخليه يرتفع أبداً. 3) نزّل يدك اليمنى فوق رأسك ورجلك اليسرى للأمام ',
          { b: 'مع بعض وببطء' },
          '. 4) رجّعهم لمكانهم وبدّل الجهة. 5) ',
          { b: 'لو ارتفع ظهرك عن الأرض، صغّر المدى' },
          ' — لا تنزّل رجلك كثير.',
        ],
        v: 'https://www.youtube.com/watch?v=JrcoGEZn6L4',
        vlbl: 'مقطع يوتيوب',
      },
    ],
  },

  wed: {
    day: 'الأربعاء',
    title: 'علوي — سحب',
    focus: 'ظهر وذراع. زاوية ثانية للعلوي عشان يقوى أسرع.',
    ex: [
      {
        id: 'incline_db',
        n: 'ضغط صدر مائل دمبل',
        en: 'Incline Dumbbell Press',
        sets: 3,
        reps: '8–12',
        repsN: 10,
        base: 8,
        step: 2,
        hand: 1,
        rest: 90,
        cue: [
          'ميلان البنش 30 درجة بس. ',
          { b: 'أكثر من كذا يتحول التمرين لكتف مو صدر' },
          '.',
        ],
        v: 'https://www.youtube.com/watch?v=hChjZQhX1Ls',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'pullup',
        n: 'عقلة بمساعدة الجهاز',
        en: 'Assisted Pull-Up',
        sets: 3,
        reps: '6–10',
        repsN: 8,
        base: 40,
        step: 5,
        inverse: 1,
        rest: 90,
        cue: [
          'الرقم هنا ',
          { b: 'وزن المساعدة' },
          ' — كل ما نزل الرقم يعني إنك صرت أقوى. لو ما فيه جهاز مساعدة، بدّلها لات بولداون قبضة ضيقة.',
        ],
        v: 'https://www.youtube.com/watch?v=CAwf7n6Luuc',
        vlbl: 'مقطع اللات بولداون (البديل)',
      },
      {
        id: 'row_1arm',
        n: 'تجديف دمبل بيد وحدة',
        en: 'One-Arm Dumbbell Row',
        sets: 3,
        reps: '10 لكل يد',
        repsN: 10,
        base: 14,
        step: 2,
        hand: 1,
        rest: 75,
        cue: [
          'ظهرك موازي للأرض، اسحب الدمبل لجنب خصرك مو لجنب صدرك. ',
          { b: 'لا تلف جسمك' },
          ' مع السحبة.',
        ],
        v: 'https://www.youtube.com/watch?v=PgpQ4-jHiq4',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'face_pull',
        n: 'فيس بول كيبل',
        en: 'Cable Face Pull',
        sets: 3,
        reps: '15',
        repsN: 15,
        base: 15,
        step: 2.5,
        rest: 60,
        cue: [
          'اسحب الحبل لجهة وجهك وكوعك عالي. هذا التمرين يحمي كتفك على المدى الطويل — لا تتجاهله ولا تثقّله.',
        ],
        v: 'https://www.youtube.com/watch?v=GJn1gzxS5bw',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'curl',
        n: 'بايسبس مطرقة بالدمبل',
        en: 'Dumbbell Hammer Curl',
        sets: 3,
        reps: '12',
        repsN: 12,
        base: 8,
        step: 2,
        hand: 1,
        rest: 60,
        cue: [
          'كوعك ثابت بجنبك، ',
          { b: 'وبدون رجّة بالظهر' },
          '. لو رجّيت، الوزن أثقل من مستواك.',
        ],
        v: 'https://www.youtube.com/watch?v=BRVDS6HVR9Q',
        vlbl: 'مقطع يوتيوب',
      },
      {
        id: 'tri_oh',
        n: 'ترايسبس خلف الرأس بالدمبل',
        en: 'Overhead Dumbbell Triceps Extension',
        sets: 3,
        reps: '12',
        repsN: 12,
        base: 10,
        step: 2,
        rest: 60,
        cue: [
          'دمبل واحد بيدينك الثنتين فوق راسك. ',
          { b: 'كوعك عالي وثابت ولا يفتح للجناب' },
          '، ونزّل خلف راسك للمدى الكامل. لو حسيت ضغط بكتفك، خفّف الوزن.',
        ],
        v: 'https://www.youtube.com/watch?v=X-iV-cG8cYs',
        vlbl: 'مقطع يوتيوب',
      },
    ],
  },
};

export const DAYS = ['sat', 'mon', 'wed'];

/** c = index into CARDIO, js = JavaScript Date#getDay() value for that weekday. */
export const WEEK = [
  { d: 'السبت', lift: 'sat', c: 0, js: 6 },
  { d: 'الأحد', c: 1, js: 0 },
  { d: 'الاثنين', lift: 'mon', c: 2, js: 1 },
  { d: 'الثلاثاء', c: 3, js: 2 },
  { d: 'الأربعاء', lift: 'wed', c: 4, js: 3 },
  { d: 'الخميس', c: 5, js: 4 },
  { d: 'الجمعة', rest: 1, c: 6, js: 5 },
];

/**
 * [name, detail, isRest, totalMinutes]
 * `totalMinutes` is the budget the day's machines share, so picking two machines
 * can split one session (e.g. 20 min bike + 20 min elliptical).
 */
export const CARDIO = [
  ['السبت', 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', 0, 25],
  ['الأحد', '40 دقيقة شدة متوسطة — تلهث بس تقدر تتكلم', 0, 40],
  ['الاثنين', 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', 0, 25],
  ['الثلاثاء', '40 دقيقة شدة متوسطة', 0, 40],
  ['الأربعاء', 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', 0, 25],
  ['الخميس', '45 دقيقة — أطول يوم كارديو', 0, 45],
  ['الجمعة', 'راحة كاملة. الراحة جزء من البرنامج مو كسل', 1, 0],
];

/** Most machines a single cardio day may be split across. */
export const MAX_MACHINES_PER_DAY = 3;

export const MACH = [
  { k: 'walk', n: 'سير مائل', en: 'Incline Treadmill', d: 'أعلى حرق بأقل ضرر للركبة. ميلان 8–12% وسرعة 5–5.5' },
  { k: 'bike', n: 'سيكل', en: 'Stationary Bike', d: 'أرحم شي على المفاصل. أفضل خيار بعد يوم الرجل' },
  { k: 'ellip', n: 'غزالة', en: 'Elliptical', d: 'صفر صدمة على الركبة، ويشغّل يدك بعد. مريح لو ركبتك تعبانة' },
  { k: 'stair', n: 'درج', en: 'Stair Climber', d: 'أعلى حرق بالكل، وأقساها على ركبتك وفخذك. لا تسويه قبل أو بعد يوم الرجل' },
  { k: 'row', n: 'تجديف', en: 'Rowing Machine', d: 'جسم كامل، بس يشتغل ظهرك — لا تسويه ثقيل يوم الأربعاء' },
];

export const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/* ── derived lookups ───────────────────────────────────────────── */

export const ALL_EXERCISES = DAYS.flatMap((d) => PLAN[d].ex);
export const EXERCISE_IDS = ALL_EXERCISES.map((e) => e.id);
export const MACHINE_KEYS = MACH.map((m) => m.k);
export const FEEDBACK_VALUES = ['light', 'ok', 'heavy'];

const BY_ID = new Map(ALL_EXERCISES.map((e) => [e.id, e]));
export const exById = (id) => BY_ID.get(id);
export const dayOf = (id) => DAYS.find((d) => PLAN[d].ex.some((x) => x.id === id));
export const machName = (k) => MACH.find((x) => x.k === k)?.n || '';

/**
 * A day's machines, always as an array of { k, m }.
 *
 * The field used to hold a single machine key, so a stored string is read as a
 * one-machine day taking the whole budget. Anything unrecognised is dropped
 * rather than guessed at.
 */
export function machinesOfDay(stored, totalMinutes = 0) {
  if (!stored) return [];
  const raw = typeof stored === 'string' ? [{ k: stored, m: totalMinutes }] : stored;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const k = typeof item === 'string' ? item : item?.k;
    if (!MACHINE_KEYS.includes(k) || seen.has(k)) continue;
    seen.add(k);
    const m = Number(typeof item === 'string' ? totalMinutes : item?.m);
    out.push({ k, m: Number.isFinite(m) && m >= 0 ? Math.round(m) : 0 });
    if (out.length >= MAX_MACHINES_PER_DAY) break;
  }
  return out;
}

/** Split `total` minutes as evenly as possible across `count` machines. */
export function splitMinutes(total, count) {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const extra = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Starting weights for week 1. */
export function baseWeights() {
  const out = {};
  for (const e of ALL_EXERCISES) out[e.id] = e.base;
  return out;
}

/** Highest `sets` value in the program — used to bound what a client may store. */
export const MAX_SETS = Math.max(...ALL_EXERCISES.map((e) => e.sets));
