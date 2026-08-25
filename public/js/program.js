/**
 * البرنامج التدريبي — مصدر الحقيقة الوحيد.
 * The training program — single source of truth, imported by BOTH the browser
 * app and the server (for validating what a client is allowed to store).
 * Keep it free of DOM/Node APIs so both sides can import it as-is.
 *
 * Two layers:
 *   EXERCISES — the catalogue. Everything about a movement that does not change
 *               with the trainee's goal: names, coaching cue, video, weight
 *               step, starting load, and the sets/reps/rest that serve as
 *               defaults.
 *
 * A movement carries TWO increments, because they answer different questions.
 * `step` is how much the lift climbs in a week. `fine` is the smallest change
 * the equipment can actually make: half a kilo on a dumbbell rack, 2.5 kg on a
 * barbell (a pair of 1.25 plates), the pin's own jump on a stack. The +/− in
 * gym mode moves by `fine`; weekly progression moves by `step`. Only movements
 * where the two differ carry `fine` at all — `fineStep()` falls back to `step`.
 *   GOALS     — five programmes. Each one picks exercises from the catalogue,
 *               may override sets/reps/rest, and carries its own cardio week,
 *               nutrition direction and rules for reading the weekly weigh-in.
 *
 * The catalogue defaults are the fat-loss numbers, so `cut` needs no overrides
 * and anyone already using the app sees exactly what they saw before.
 *
 * Cue text is stored as an array of parts instead of an HTML string:
 *   "plain text"      → rendered as a text node
 *   { b: "text" }     → rendered as <b>text</b>
 * That removes the last reason to ever call innerHTML with program data.
 *
 * `v` (video link) is optional. Exercises added without a verified link simply
 * have none, and the UI omits the button rather than pointing at a guess.
 */

/* ══════════════════════════════════════════════════════════════════
   EXERCISE CATALOGUE
   ══════════════════════════════════════════════════════════════════ */

export const EXERCISES = {
  /* ── push ── */
  chest_db: {
    n: 'ضغط صدر دمبل مستوي',
    en: 'Flat Dumbbell Bench Press',
    g: 'push',
    sets: 3,
    reps: '8–12',
    repsN: 10,
    base: 10,
    step: 2,
    fine: 0.5,
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
  incline_db: {
    n: 'ضغط صدر مائل دمبل',
    en: 'Incline Dumbbell Press',
    g: 'push',
    sets: 3,
    reps: '8–12',
    repsN: 10,
    base: 8,
    step: 2,
    fine: 0.5,
    hand: 1,
    rest: 90,
    cue: ['ميلان البنش 30 درجة بس. ', { b: 'أكثر من كذا يتحول التمرين لكتف مو صدر' }, '.'],
    v: 'https://www.youtube.com/watch?v=hChjZQhX1Ls',
    vlbl: 'مقطع يوتيوب',
  },
  bench_bb: {
    n: 'بنش بريس بار',
    en: 'Barbell Bench Press',
    g: 'push',
    sets: 4,
    reps: '6–8',
    repsN: 7,
    base: 30,
    step: 2.5,
    rest: 150,
    cue: [
      'قبضتك أوسع من كتفك شوي، ونزّل البار لمنتصف صدرك مو لرقبتك. ',
      { b: 'لوح كتفك مضغوط للخلف وقدمك ثابتة بالأرض' },
      '. ولا تقفل كوعك بعنف فوق.',
    ],
  },
  sh_press: {
    n: 'ضغط كتف دمبل جالس',
    en: 'Seated Dumbbell Shoulder Press',
    g: 'push',
    sets: 3,
    reps: '8–12',
    repsN: 10,
    base: 8,
    step: 2,
    fine: 0.5,
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
  ohp_bb: {
    n: 'ضغط كتف بار واقف',
    en: 'Standing Barbell Overhead Press',
    g: 'push',
    sets: 4,
    reps: '5–8',
    repsN: 6,
    base: 25,
    step: 2.5,
    rest: 150,
    cue: [
      'واقف ورجلك بعرض كتفك وبطنك مشدود. اطلع البار فوق راسك بخط مستقيم، و',
      { b: 'لا ترجع بظهرك للخلف' },
      ' عشان تكمّل الحركة — لو رجعت، الوزن ثقيل عليك.',
    ],
  },
  lat_raise: {
    n: 'رفرفة جانبي دمبل',
    en: 'Dumbbell Lateral Raise',
    g: 'push',
    sets: 3,
    reps: '12–15',
    repsN: 13,
    base: 5,
    step: 2,
    fine: 0.5,
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
  fly_cable: {
    n: 'تفتيح كيبل',
    en: 'Cable Chest Fly',
    g: 'push',
    sets: 3,
    reps: '12–15',
    repsN: 13,
    base: 10,
    step: 2.5,
    rest: 60,
    cue: [
      'مرفقك ثابت بانحناء خفيف. اجمع يدينك قدام صدرك واعصر ثانية، ',
      { b: 'والحركة من كتفك مو من كوعك' },
      '. وزن خفيف — هذا عزل.',
    ],
  },
  pushup: {
    n: 'ضغط أرضي',
    en: 'Push-Up',
    g: 'push',
    sets: 3,
    reps: '10–20',
    repsN: 14,
    base: 0,
    step: 0,
    body: 1,
    rest: 60,
    cue: [
      'يدك بعرض كتفك وجسمك خط مستقيم من كعبك لراسك. ',
      { b: 'شد بطنك ومؤخرتك' },
      ' وانزل لين صدرك يقارب الأرض. لو صعب عليك، سوّه على ركبتك أو على سطح مرتفع.',
    ],
    v: 'https://www.youtube.com/watch?v=la1o8milb8c',
    vlbl: 'مقطع يوتيوب (عربي)',
  },
  pushup_inc: {
    n: 'ضغط مائل على مصطبة',
    en: 'Incline Push-Up',
    g: 'push',
    sets: 3,
    reps: '8–12',
    repsN: 10,
    base: 0,
    step: 0,
    body: 1,
    rest: 60,
    cue: [
      'يدك على مصطبة أو حافة ثابتة بعرض كتفك، ورجلك ورا على الأرض. ',
      { b: 'كل ما علا السطح صار التمرين أسهل' },
      ' — ابدأ عالي وانزل مستواه كل أسبوعين. جسمك خط مستقيم، وصدرك يلمس الحافة.',
    ],
    v: 'https://www.youtube.com/watch?v=WnfBiOZQT1Q',
    vlbl: 'مقطع يوتيوب — تدرّج الضغط للمبتدئ',
  },
  tri_push: {
    n: 'ترايسبس بوش داون حبل',
    en: 'Rope Triceps Pushdown',
    g: 'push',
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
  tri_oh: {
    n: 'ترايسبس خلف الرأس بالدمبل',
    en: 'Overhead Dumbbell Triceps Extension',
    g: 'push',
    sets: 3,
    reps: '12',
    repsN: 12,
    base: 10,
    step: 2,
    fine: 0.5,
    rest: 60,
    cue: [
      'دمبل واحد بيدينك الثنتين فوق راسك. ',
      { b: 'كوعك عالي وثابت ولا يفتح للجناب' },
      '، ونزّل خلف راسك للمدى الكامل. لو حسيت ضغط بكتفك، خفّف الوزن.',
    ],
    v: 'https://www.youtube.com/watch?v=X-iV-cG8cYs',
    vlbl: 'مقطع يوتيوب',
  },

  /* ── pull ── */
  lat_pull: {
    n: 'سحب أمامي (لات بولداون)',
    en: 'Lat Pulldown',
    g: 'pull',
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
  cable_row: {
    n: 'تجديف كيبل جالس',
    en: 'Seated Cable Row',
    g: 'pull',
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
  row_bb: {
    n: 'تجديف بار',
    en: 'Barbell Bent-Over Row',
    g: 'pull',
    sets: 4,
    reps: '6–10',
    repsN: 8,
    base: 30,
    step: 2.5,
    rest: 120,
    cue: [
      'ميّل جسمك لين يقارب 45 درجة وظهرك مستقيم. اسحب البار لجهة سرّتك واعصر لوح كتفك، ',
      { b: 'وبدون رجّة بالجسم' },
      '.',
    ],
  },
  row_1arm: {
    n: 'تجديف دمبل بيد وحدة',
    en: 'One-Arm Dumbbell Row',
    g: 'pull',
    sets: 3,
    reps: '10 لكل يد',
    repsN: 10,
    base: 14,
    step: 2,
    fine: 0.5,
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
  pullup: {
    n: 'عقلة بمساعدة الجهاز',
    en: 'Assisted Pull-Up',
    g: 'pull',
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
  face_pull: {
    n: 'فيس بول كيبل',
    en: 'Cable Face Pull',
    g: 'pull',
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
  curl: {
    n: 'بايسبس مطرقة بالدمبل',
    en: 'Dumbbell Hammer Curl',
    g: 'pull',
    sets: 3,
    reps: '12',
    repsN: 12,
    base: 8,
    step: 2,
    fine: 0.5,
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

  /* ── legs & hips ── */
  leg_press: {
    n: 'لبج بريس',
    en: 'Leg Press',
    g: 'legs',
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
  squat_bb: {
    n: 'سكوات بار خلفي',
    en: 'Barbell Back Squat',
    g: 'legs',
    sets: 4,
    reps: '5–8',
    repsN: 6,
    base: 40,
    step: 5,
    fine: 2.5,
    rest: 180,
    cue: [
      'البار على أعلى ظهرك مو على رقبتك. انزل لين فخذك يوازي الأرض أو أقرب، ',
      { b: 'وركبتك تمشي باتجاه أصابع قدمك' },
      '. صدرك مرفوع وظهرك مشدود طول الحركة — أول ما يتقوّس ظهرك، وقف.',
    ],
  },
  goblet: {
    n: 'جوبلت سكوات',
    en: 'Goblet Squat',
    g: 'legs',
    sets: 3,
    reps: '12–15',
    repsN: 13,
    base: 12,
    step: 2,
    fine: 0.5,
    rest: 75,
    cue: [
      'دمبل واحد أو كيتل بل قريب من صدرك. انزل بين رجلك وكوعك يمر داخل ركبتك، ',
      { b: 'وظهرك مستقيم وصدرك مرفوع' },
      '. أسهل سكوات على ظهرك وأفضل بداية.',
    ],
  },
  dead_bb: {
    n: 'ديدليفت بار',
    en: 'Barbell Deadlift',
    g: 'legs',
    sets: 4,
    reps: '3–5',
    repsN: 4,
    base: 50,
    step: 5,
    fine: 2.5,
    rest: 180,
    cue: [
      'البار ملزوق بساقك من البداية. ارفع بدفع الأرض برجلك مو بسحب ظهرك، و',
      { b: 'ظهرك مستقيم من أول الحركة لآخرها' },
      '. لو تقوّس ظهرك خفّف الوزن فورًا — هذا أخطر تمرين على ظهرك لو سويته غلط.',
    ],
  },
  rdl: {
    n: 'رومانيان ديدليفت دمبل',
    en: 'Dumbbell Romanian Deadlift',
    g: 'legs',
    sets: 3,
    reps: '10',
    repsN: 10,
    base: 12,
    step: 2,
    fine: 0.5,
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
  hip_thrust: {
    n: 'هيب ثرست بار',
    en: 'Barbell Hip Thrust',
    g: 'legs',
    sets: 3,
    reps: '10–12',
    repsN: 11,
    base: 40,
    step: 5,
    fine: 2.5,
    rest: 90,
    cue: [
      'ظهرك العلوي على البنش والبار على حوضك (حط فوطة تحته). ادفع بكعبك وارفع حوضك لين جسمك يصير خط مستقيم، ',
      { b: 'واعصر مؤخرتك ثانية كاملة فوق' },
      '. لا ترفع بظهرك.',
    ],
  },
  lunge_db: {
    n: 'لانجز دمبل',
    en: 'Dumbbell Lunge',
    g: 'legs',
    sets: 3,
    reps: '10 لكل رجل',
    repsN: 10,
    base: 8,
    step: 2,
    fine: 0.5,
    hand: 1,
    rest: 75,
    cue: [
      'خطوة واسعة للأمام وانزل لين ركبتك الخلفية تقارب الأرض. ',
      { b: 'ركبة رجلك الأمامية ما تتعدى أصابع قدمك' },
      '، وجسمك مستقيم مو مايل للأمام.',
    ],
  },
  stepup: {
    n: 'ستيب أب دمبل',
    en: 'Dumbbell Step-Up',
    g: 'legs',
    sets: 3,
    reps: '10 لكل رجل',
    repsN: 10,
    base: 8,
    step: 2,
    fine: 0.5,
    hand: 1,
    rest: 60,
    cue: [
      'اطلع على الدرجة بدفع رجلك اللي فوق، ',
      { b: 'ولا تدفع برجلك اللي تحت' },
      '. ارتفاع الدرجة يخلي فخذك يوازي الأرض تقريبًا. وانزل ببطء.',
    ],
  },
  leg_ext: {
    n: 'تمديد الأرجل',
    en: 'Leg Extension',
    g: 'legs',
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
  leg_curl: {
    n: 'ثني الأرجل',
    en: 'Leg Curl',
    g: 'legs',
    sets: 3,
    reps: '12',
    repsN: 12,
    base: 25,
    step: 2.5,
    rest: 60,
    cue: ['حوضك ملزوق بالجهاز و', { b: 'لا ترفعه' }, ' وقت السحب — لو رفعته، الوزن ثقيل.'],
    v: 'https://www.muscleandstrength.com/exercises/leg-curl.html',
    vlbl: 'صفحة فيها مقطع',
  },
  calf: {
    n: 'رفع السمانة واقف',
    en: 'Standing Calf Raise',
    g: 'legs',
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
  kb_swing: {
    n: 'سوينج كيتل بل',
    en: 'Kettlebell Swing',
    g: 'legs',
    sets: 4,
    reps: '15',
    repsN: 15,
    base: 12,
    step: 4,
    rest: 60,
    cue: [
      'الحركة من حوضك مو من يدك — ارجع بحوضك للخلف وادفع للأمام بقوة. ',
      { b: 'الكيتل بل يوصل مستوى صدرك بس، ولا ترفعه بكتفك' },
      '. وظهرك مستقيم طول الوقت.',
    ],
  },

  /* ── core ── */
  plank: {
    n: 'بلانك',
    en: 'Plank',
    g: 'core',
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
    v: 'https://www.youtube.com/watch?v=0CwaHTr-ilY',
    vlbl: 'مقطع يوتيوب — الأداء الصحيح والأخطاء',
  },
  side_plank: {
    n: 'بلانك جانبي',
    en: 'Side Plank',
    g: 'core',
    sets: 3,
    reps: 'ثواني لكل جهة',
    base: 20,
    step: 5,
    time: 1,
    rest: 45,
    cue: [
      'على مرفقك وجنب قدمك، وجسمك خط مستقيم من كعبك لراسك. ',
      { b: 'ارفع حوضك ولا تخليه ينزل' },
      '، وراسك امتداد لظهرك. أول ما ينزل حوضك، وقف.',
    ],
    v: 'https://www.youtube.com/watch?v=6w4cP4HKzA8',
    vlbl: 'مقطع يوتيوب',
  },
  deadbug: {
    n: 'ديد بق',
    en: 'Dead Bug',
    g: 'core',
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
  birddog: {
    n: 'بيرد دوق',
    en: 'Bird Dog',
    g: 'core',
    sets: 3,
    reps: '10 لكل جهة',
    repsN: 10,
    base: 0,
    step: 0,
    body: 1,
    rest: 45,
    cue: [
      'على أربع، ومد يدك اليمنى ورجلك اليسرى مع بعض ببطء. ',
      { b: 'ظهرك ثابت تمامًا ولا يلتف' },
      ' — تخيّل كوب ماء على ظهرك ما ينكب. رجّعهم وبدّل الجهة.',
    ],
    v: 'https://www.youtube.com/watch?v=954Pa0Q7yak',
    vlbl: 'مقطع يوتيوب',
  },
  crunch: {
    n: 'تمرين البطن (كرنش)',
    en: 'Crunch',
    g: 'core',
    sets: 3,
    reps: '15–20',
    repsN: 17,
    base: 0,
    step: 0,
    body: 1,
    rest: 45,
    cue: [
      'نم على ظهرك وارفع ركبتك مثنية والقدم ثابتة على الأرض. يدك على صدرك أو خفيفة جنب رأسك — ',
      { b: 'لا تشد رقبتك بيدينك' },
      '. ارفع كتفك عن الأرض ناحية ركبتك بشد بطنك، وأسفل ظهرك يبقى ملتصق بالأرض. ',
      { b: 'اللي يرتفع الكتف مو الظهر كله' },
      ' — نص الحركة بشكل صح أفضل من حركة كاملة برقبتك.',
    ],
    v: 'https://www.youtube.com/watch?v=dWz8v9Vza_A',
    vlbl: 'مقطع يوتيوب',
  },
  glute_bridge: {
    n: 'جسر المؤخرة',
    en: 'Glute Bridge',
    g: 'legs',
    sets: 3,
    reps: '12–15',
    repsN: 13,
    base: 0,
    step: 0,
    body: 1,
    rest: 45,
    cue: [
      'نم على ظهرك، ركبتك مثنية وكعبك قريب من مؤخرتك. ادفع من كعبك وارفع حوضك لين جسمك يصير خط مستقيم من ركبتك لكتفك. ',
      { b: 'اعصر مؤخرتك فوق ثانية كاملة' },
      ' ولا تقوّس ظهرك عشان ترتفع أكثر. أرحم تمرين على ركبتك بالكامل.',
    ],
    v: 'https://www.youtube.com/watch?v=IW-T7sfdiFQ',
    vlbl: 'مقطع يوتيوب',
  },
  superman: {
    n: 'سوبرمان',
    en: 'Superman',
    g: 'pull',
    sets: 3,
    reps: '12',
    repsN: 12,
    base: 0,
    step: 0,
    body: 1,
    rest: 45,
    cue: [
      'نم على بطنك ويدك ممدودة قدام. ارفع يدك وصدرك ورجلك عن الأرض شوي مع بعض، ',
      { b: 'وعينك على الأرض مو للأمام' },
      ' عشان رقبتك تبقى امتداد لظهرك. ارتفاع بسيط يكفي — هذا تمرين تحمّل مو قوة.',
    ],
    v: 'https://www.youtube.com/watch?v=aVzSwIgOhtI',
    vlbl: 'مقطع يوتيوب',
  },

  /* ── إطالة ──
   * `time: 1` عشان تاخذ العدّاد التنازلي وأزرار الثواني زي البلانك.
   * `step: 0` مقصود: الإطالة ما تتدرّج أسبوعياً — 30 ثانية تبقى 30 ثانية،
   * و `fine: 5` يخلي الأزرار تعدّلها بخمس ثواني لو حبّيت تطوّلها بنفسك.
   */
  str_ham: {
    n: 'إطالة أوتار الركبة',
    en: 'Hamstring Stretch',
    g: 'legs',
    sets: 2,
    reps: 'ثواني لكل رجل',
    base: 30,
    step: 0,
    fine: 5,
    time: 1,
    rest: 15,
    cue: [
      'حط كعبك على كرسي أو مصطبة واقفة، ورجلك مستقيمة وأصابعك لفوق. ميل من ',
      { b: 'حوضك مو من ظهرك' },
      ' لين تحس بشد خلف فخذك. شد مريح مو مؤلم، وتنفّس عادي ولا تنطّ.',
    ],
    v: 'https://www.youtube.com/watch?v=KzVtfjwjRG4',
    vlbl: 'مقطع يوتيوب',
  },
  str_hipflex: {
    n: 'إطالة مثنية الورك',
    en: 'Hip Flexor Stretch',
    g: 'legs',
    sets: 2,
    reps: 'ثواني لكل جهة',
    base: 30,
    step: 0,
    fine: 5,
    time: 1,
    rest: 15,
    cue: [
      'انزل على ركبة وحدة والثانية قدامك بزاوية 90. ',
      { b: 'ادحر حوضك لتحت وقدّم جسمك كله' },
      ' — لا تقوّس ظهرك. الشد لازم يجيك قدام فخذ الرجل اللي على الأرض. مهمة لك خصوصاً لو تجلس كثير.',
    ],
    v: 'https://www.youtube.com/watch?v=-X19PvzVg48',
    vlbl: 'مقطع يوتيوب',
  },
  str_calf: {
    n: 'إطالة السمانة',
    en: 'Calf Stretch',
    g: 'legs',
    sets: 2,
    reps: 'ثواني لكل رجل',
    base: 30,
    step: 0,
    fine: 5,
    time: 1,
    rest: 15,
    cue: [
      'يدك على الجدار، رجل ورا مستقيمة و ',
      { b: 'كعبها ملتصق بالأرض' },
      '، والرجل الثانية قدام مثنية. ميل للجدار لين تحس بشد خلف ساقك. أهم إطالة لك مع السير المائل.',
    ],
    v: 'https://www.youtube.com/watch?v=DhytPxVq6jg',
    vlbl: 'مقطع يوتيوب',
  },
  str_chest: {
    n: 'إطالة الصدر والكتف',
    en: 'Chest & Shoulder Stretch',
    g: 'push',
    sets: 2,
    reps: 'ثواني',
    base: 30,
    step: 0,
    fine: 5,
    time: 1,
    rest: 15,
    cue: [
      'وقف بمدخل باب وحط ساعدك على الإطار وكوعك بمستوى كتفك، وخطي خطوة قدام. ',
      { b: 'صدرك للأمام وكتفك للخلف' },
      ' — الشد قدام صدرك وكتفك. تصلّح انحناء الكتف اللي يجي من الجلوس.',
    ],
    v: 'https://www.youtube.com/watch?v=8vH_3-nFHIk',
    vlbl: 'مقطع يوتيوب',
  },
  str_back: {
    n: 'إطالة أسفل الظهر',
    en: "Child's Pose",
    g: 'core',
    sets: 2,
    reps: 'ثواني',
    base: 30,
    step: 0,
    fine: 5,
    time: 1,
    rest: 15,
    cue: [
      'اجلس على كعبك ومدّ يدك قدام على الأرض ونزّل صدرك بينهم — نفس وضعية السجود. ',
      { b: 'تنفّس عميق وخلّ ظهرك يسترخي' },
      ' مع كل زفير. أفضل شي تختم فيه يومك.',
    ],
    v: 'https://www.youtube.com/watch?v=joVTUsxizzk',
    vlbl: 'مقطع يوتيوب',
  },
};

/* ══════════════════════════════════════════════════════════════════
   LEVELS — scale the catalogue's starting loads
   ══════════════════════════════════════════════════════════════════ */

/**
 * The catalogue's `base` values are calibrated for "متوسط", so an existing user
 * lands on exactly the numbers they already had.
 */
export const LEVELS = {
  beg: { n: 'مبتدئ', en: 'Beginner', d: 'أول ٦ أشهر بالنادي، أو رجعت بعد انقطاع طويل', mult: 0.65 },
  int: { n: 'متوسط', en: 'Intermediate', d: 'تتمرن بانتظام من ٦ أشهر لسنتين', mult: 1 },
  adv: { n: 'متقدم', en: 'Advanced', d: 'أكثر من سنتين تمرين منتظم وتعرف أوزانك', mult: 1.35 },
};

export const LEVEL_KEYS = Object.keys(LEVELS);
export const DEFAULT_LEVEL = 'int';
export const DEFAULT_GOAL = 'cut';

/* ══════════════════════════════════════════════════════════════════
   GOALS
   ══════════════════════════════════════════════════════════════════ */

const REST_DAY = { d: 'الجمعة', detail: 'راحة كاملة. الراحة جزء من البرنامج مو كسل', rest: 1, min: 0 };
const NO_CARDIO = (d) => ({ d, detail: 'ما فيه كارديو — يوم حديد', rest: 1, min: 0 });

/**
 * `days[].ex` accepts either a bare catalogue id (use its defaults) or
 * `{ id, sets, reps, repsN, rest }` to override for this goal.
 *
 * `verdict` thresholds are percent of body weight per week, except
 * `muscleDropKg` which is kilograms of lean mass.
 */
export const GOALS = {
  cut: {
    n: 'تنشيف',
    en: 'Fat Loss',
    desc: 'تنزل دهون وتحافظ على عضلك',
    summary: ['−٥٠٠ سعرة', '٣ أيام حديد', '٦ أيام كارديو', 'تكرارات ٨–١٢'],
    nutrition: { delta: -500, floorPct: 0.75, floorKcal: 1700, proteinPerKg: 2.0 },
    verdict: {
      ideal: [-1.0, -0.3],
      holdLossBelow: -1.2,
      muscleDropKg: -0.5,
      warnGainAbove: 0.6,
      stallBelow: null,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'علوي — دفع',
        focus: 'صدر وكتف وظهر. هذا يومك الأهم، لأن ضعفك بالعلوي.',
        ex: ['chest_db', 'sh_press', 'lat_pull', 'cable_row', 'lat_raise', 'tri_push', 'plank'],
      },
      {
        key: 'mon',
        day: 'الاثنين',
        title: 'سفلي + وسط',
        focus: 'رجلك قوية أصلاً — نحافظ عليها ونزيدها بدون ما تسرق وقت العلوي.',
        ex: ['leg_press', 'rdl', 'leg_ext', 'leg_curl', 'calf', 'deadbug'],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'علوي — سحب',
        focus: 'ظهر وذراع. زاوية ثانية للعلوي عشان يقوى أسرع.',
        ex: ['incline_db', 'pullup', 'row_1arm', 'face_pull', 'curl', 'tri_oh'],
      },
    ],
    cardio: [
      { d: 'السبت', detail: 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', min: 25 },
      { d: 'الأحد', detail: '40 دقيقة شدة متوسطة — تلهث بس تقدر تتكلم', min: 40 },
      { d: 'الاثنين', detail: 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', min: 25 },
      { d: 'الثلاثاء', detail: '40 دقيقة شدة متوسطة', min: 40 },
      { d: 'الأربعاء', detail: 'تسخين 10 دقائق قبل الحديد + 15 دقيقة بعده', min: 25 },
      { d: 'الخميس', detail: '45 دقيقة — أطول يوم كارديو', min: 45 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'نزول أكثر من 1.2% من وزنك بأسبوع = خطر.' },
        ' بهالسرعة تخسر عضل مع الدهون وجسمك ما يتحمل زيادة الأوزان.',
      ],
      [
        { b: 'البروتين هو الفرق' },
        ' بين إنك تنقص دهون وإنك تنقص عضل وأنت بعجز سعرات.',
      ],
    ],
  },

  muscle: {
    n: 'بناء عضل',
    en: 'Build Muscle',
    desc: 'تكبّر عضلك وتزيد أوزانك',
    summary: ['+٣٠٠ سعرة', '٤ أيام حديد', '٢ أيام كارديو', 'تكرارات ٦–١٢'],
    nutrition: { delta: 300, capPct: 1.15, proteinPerKg: 1.8 },
    verdict: {
      ideal: [0.15, 0.5],
      holdLossBelow: -0.5,
      muscleDropKg: null,
      warnGainAbove: 0.75,
      stallBelow: 0.1,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'علوي — دفع',
        focus: 'صدر وكتف وترايسبس بأوزان أثقل ومجموعات أكثر.',
        ex: [
          'bench_bb',
          { id: 'incline_db', sets: 4, reps: '8–10', repsN: 9, rest: 120 },
          'ohp_bb',
          { id: 'lat_raise', sets: 4, reps: '12–15', repsN: 13, rest: 75 },
          { id: 'tri_push', sets: 4, reps: '10–12', repsN: 11, rest: 75 },
        ],
      },
      {
        key: 'sun',
        day: 'الأحد',
        title: 'سفلي',
        focus: 'السكوات والرومانيان هما اللي يبنون رجلك.',
        ex: [
          'squat_bb',
          { id: 'rdl', sets: 4, reps: '8–10', repsN: 9, rest: 120 },
          { id: 'leg_curl', sets: 4, reps: '10–12', repsN: 11, rest: 90 },
          { id: 'calf', sets: 4, reps: '12–15', repsN: 13, rest: 60 },
        ],
      },
      {
        key: 'tue',
        day: 'الثلاثاء',
        title: 'علوي — سحب',
        focus: 'ظهر وبايسبس. التجديف بالبار أساس اليوم.',
        ex: [
          'row_bb',
          { id: 'lat_pull', sets: 4, reps: '8–10', repsN: 9, rest: 105 },
          { id: 'face_pull', sets: 3, reps: '15', repsN: 15, rest: 60 },
          { id: 'curl', sets: 4, reps: '10–12', repsN: 11, rest: 75 },
          { id: 'tri_oh', sets: 3, reps: '10–12', repsN: 11, rest: 75 },
        ],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'سفلي + وسط',
        focus: 'زاوية ثانية للرجل، والديدليفت يشغّل ظهرك كامل.',
        ex: [
          { id: 'dead_bb', sets: 4, reps: '5', repsN: 5, rest: 180 },
          { id: 'leg_press', sets: 4, reps: '10–12', repsN: 11, rest: 120 },
          { id: 'lunge_db', sets: 3, reps: '10 لكل رجل', repsN: 10, rest: 90 },
          { id: 'plank', sets: 3, reps: 'ثواني', rest: 60 },
        ],
      },
    ],
    cardio: [
      NO_CARDIO('السبت'),
      NO_CARDIO('الأحد'),
      { d: 'الاثنين', detail: '20 دقيقة خفيف — للقلب مو للحرق', min: 20 },
      NO_CARDIO('الثلاثاء'),
      NO_CARDIO('الأربعاء'),
      { d: 'الخميس', detail: '25 دقيقة خفيف إلى متوسط', min: 25 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'زيادة وزنك هنا هدف مو مشكلة.' },
        ' المعدل الصحي ٠.١٥–٠.٥٪ من وزنك بالأسبوع — أسرع من كذا أغلبه دهون.',
      ],
      [
        { b: 'لو وزنك ثابت أسبوعين، أكلك قليل.' },
        ' ما تكبر عضلة بدون سعرات زايدة، حتى لو تمرينك ممتاز.',
      ],
      [{ b: 'الكارديو يومين بس' }, ' — عشان القلب، ولا يسرق تعافيك من الحديد.'],
    ],
  },

  recomp: {
    n: 'شد الجسم',
    en: 'Recomp / Tone',
    desc: 'تشد جسمك — دهون تنزل وعضل يثبت أو يزيد شوي',
    summary: ['−١٥٠ سعرة', '٣ أيام حديد', '٤ أيام كارديو', 'تكرارات ١٠–١٥'],
    nutrition: { delta: -150, floorPct: 0.85, floorKcal: 1700, proteinPerKg: 2.0 },
    verdict: {
      ideal: [-0.25, 0.25],
      holdLossBelow: -1.0,
      muscleDropKg: -0.5,
      warnGainAbove: 0.5,
      stallBelow: null,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'علوي',
        focus: 'تكرارات أعلى وراحة أقصر — شد وتحمّل مع الحفاظ على العضل.',
        ex: [
          { id: 'chest_db', sets: 3, reps: '12–15', repsN: 13, rest: 75 },
          { id: 'lat_pull', sets: 3, reps: '12–15', repsN: 13, rest: 75 },
          { id: 'sh_press', sets: 3, reps: '12–15', repsN: 13, rest: 75 },
          'face_pull',
          { id: 'curl', sets: 3, reps: '15', repsN: 15, rest: 60 },
          { id: 'tri_push', sets: 3, reps: '15', repsN: 15, rest: 60 },
        ],
      },
      {
        key: 'mon',
        day: 'الاثنين',
        title: 'سفلي + مؤخرة',
        focus: 'الجوبلت والهيب ثرست يشدّون بدون حمل ثقيل على ظهرك.',
        ex: ['goblet', { id: 'rdl', sets: 3, reps: '12', repsN: 12, rest: 90 }, 'hip_thrust', { id: 'leg_curl', sets: 3, reps: '15', repsN: 15, rest: 60 }, 'calf'],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'كامل الجسم',
        focus: 'يوم يجمع كل شي بتكرارات عالية.',
        ex: [
          { id: 'incline_db', sets: 3, reps: '12–15', repsN: 13, rest: 75 },
          { id: 'cable_row', sets: 3, reps: '12–15', repsN: 13, rest: 75 },
          { id: 'lunge_db', sets: 3, reps: '12 لكل رجل', repsN: 12, rest: 75 },
          'lat_raise',
          'side_plank',
        ],
      },
    ],
    cardio: [
      { d: 'السبت', detail: '15 دقيقة بعد الحديد', min: 15 },
      { d: 'الأحد', detail: '35 دقيقة شدة متوسطة', min: 35 },
      NO_CARDIO('الاثنين'),
      { d: 'الثلاثاء', detail: '30 دقيقة شدة متوسطة', min: 30 },
      NO_CARDIO('الأربعاء'),
      { d: 'الخميس', detail: '35 دقيقة شدة متوسطة', min: 35 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'وزنك شبه ثابت هو النجاح هنا.' },
        ' تنزل دهون وتبني عضل بنفس الوقت، فالميزان يتحرك ببطء — القياس الحقيقي هو المرايا وأوزانك بالنادي.',
      ],
      [{ b: 'البروتين عالي (٢ جرام/كجم)' }, ' لأنه هو اللي يخلي العضل يثبت وأنت بعجز خفيف.'],
    ],
  },

  fitness: {
    n: 'لياقة وصحة',
    en: 'Fitness & Health',
    desc: 'لياقة ونفس أطول وصحة عامة بدون تركيز على الوزن',
    summary: ['سعرات ثبات', '٢ أيام حديد', '٥ أيام كارديو', 'تكرارات ١٢–١٥'],
    nutrition: { delta: 0, floorPct: 0.9, floorKcal: 1700, proteinPerKg: 1.5 },
    verdict: {
      ideal: [-0.5, 0.5],
      holdLossBelow: -1.2,
      muscleDropKg: -0.5,
      warnGainAbove: null,
      stallBelow: null,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'كامل الجسم أ',
        focus: 'حركات أساسية بوزن معقول — هدفها تقوّيك مو تكبّرك.',
        ex: [
          'goblet',
          'pushup',
          { id: 'cable_row', sets: 3, reps: '15', repsN: 15, rest: 60 },
          { id: 'sh_press', sets: 2, reps: '15', repsN: 15, rest: 60 },
          'plank',
        ],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'كامل الجسم ب',
        focus: 'زاوية ثانية، والسوينج يرفع نبضك مع الحديد.',
        ex: [
          { id: 'lunge_db', sets: 3, reps: '12 لكل رجل', repsN: 12, rest: 60 },
          { id: 'lat_pull', sets: 3, reps: '15', repsN: 15, rest: 60 },
          { id: 'chest_db', sets: 2, reps: '15', repsN: 15, rest: 60 },
          'kb_swing',
          'birddog',
        ],
      },
    ],
    cardio: [
      { d: 'السبت', detail: '15 دقيقة بعد الحديد', min: 15 },
      { d: 'الأحد', detail: '35 دقيقة — تلهث بس تقدر تتكلم', min: 35 },
      { d: 'الاثنين', detail: '30 دقيقة شدة متوسطة', min: 30 },
      { d: 'الثلاثاء', detail: '35 دقيقة شدة متوسطة', min: 35 },
      NO_CARDIO('الأربعاء'),
      { d: 'الخميس', detail: '40 دقيقة — أطول يوم', min: 40 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'الميزان مو مقياسك الأساسي هنا.' },
        ' مقياسك إنك تصعد الدرج بدون نفس مقطوع، وإن نبضك يرجع أسرع بعد المجهود.',
      ],
      [{ b: 'الانتظام أهم من الشدة.' }, ' خمسة أيام معقولة أنفع من يومين تقتل نفسك فيهم.'],
    ],
  },

  strength: {
    n: 'قوة',
    en: 'Strength',
    desc: 'تركيز على رفع أوزان أثقل بتكرارات قليلة',
    summary: ['+١٥٠ سعرة', '٤ أيام حديد', 'تكرارات ٤–٦', 'راحة طويلة'],
    nutrition: { delta: 150, capPct: 1.1, proteinPerKg: 1.8 },
    verdict: {
      ideal: [0, 0.4],
      holdLossBelow: -0.5,
      muscleDropKg: null,
      warnGainAbove: 0.8,
      stallBelow: null,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'سكوات',
        focus: 'الحركة الأساسية أول وبأقصى تركيز، والباقي مساند.',
        ex: [
          { id: 'squat_bb', sets: 5, reps: '5', repsN: 5, rest: 180 },
          { id: 'leg_press', sets: 3, reps: '8', repsN: 8, rest: 120 },
          { id: 'calf', sets: 3, reps: '12', repsN: 12, rest: 60 },
        ],
      },
      {
        key: 'sun',
        day: 'الأحد',
        title: 'بنش',
        focus: 'ضغط الصدر بالبار هو مقياس قوتك العلوية.',
        ex: [
          { id: 'bench_bb', sets: 5, reps: '5', repsN: 5, rest: 180 },
          { id: 'incline_db', sets: 3, reps: '8', repsN: 8, rest: 120 },
          { id: 'tri_oh', sets: 3, reps: '10', repsN: 10, rest: 90 },
        ],
      },
      {
        key: 'tue',
        day: 'الثلاثاء',
        title: 'ديدليفت',
        focus: 'تكرارات قليلة جداً وراحة طويلة — الشكل أهم من الرقم.',
        ex: [
          { id: 'dead_bb', sets: 5, reps: '3', repsN: 3, rest: 210 },
          { id: 'row_bb', sets: 4, reps: '6', repsN: 6, rest: 150 },
          { id: 'curl', sets: 3, reps: '10', repsN: 10, rest: 90 },
        ],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'ضغط كتف',
        focus: 'الضغط الواقف يبني كتفك وثبات وسطك مع بعض.',
        ex: [
          { id: 'ohp_bb', sets: 5, reps: '5', repsN: 5, rest: 180 },
          { id: 'pullup', sets: 4, reps: '6', repsN: 6, rest: 150 },
          { id: 'face_pull', sets: 3, reps: '12', repsN: 12, rest: 60 },
        ],
      },
    ],
    cardio: [
      NO_CARDIO('السبت'),
      NO_CARDIO('الأحد'),
      { d: 'الاثنين', detail: '20 دقيقة خفيف — تعافي مو حرق', min: 20 },
      NO_CARDIO('الثلاثاء'),
      NO_CARDIO('الأربعاء'),
      { d: 'الخميس', detail: '20 دقيقة خفيف', min: 20 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'الشكل قبل الوزن، دائمًا.' },
        ' تكرار واحد بشكل غلط بالديدليفت يقعدك شهر — الرقم ما يستاهل.',
      ],
      [
        { b: 'الراحة الطويلة جزء من التمرين.' },
        ' ٣ دقائق بين المجموعات مو ضياع وقت، هي اللي تخليك ترفع ثقيل بالمجموعة الجاية.',
      ],
      [{ b: 'وزنك ثابت أو طالع شوي = ممتاز.' }, ' ما تقوى وأنت تنزل وزن بسرعة.'],
    ],
  },

  /**
   * صفر حديد. الأهداف الخمسة فوق كلها تفترض مقاومة؛ هذا لواحد يبي ينزل وزن
   * بالكارديو وحده. كل تمرين فيه `body` أو `time` — ما فيه ولا حمل واحد،
   * وهذا اللي يخلي `goalHasLoads()` ترجع false ويخلي الواجهة تبطل تقول «حديد».
   */
  cardio: {
    n: 'كارديو فقط',
    en: 'Cardio Only',
    desc: 'تنزل وزن بدون أي حديد',
    summary: ['−٨٥٠ سعرة', '٠ حديد', '٦ أيام كارديو', 'وزن الجسم فقط'],
    // البروتين أعلى من التنشيف عمداً: بدون مقاومة، البروتين هو الشي الوحيد
    // الباقي اللي يحمي العضل من عجز بهالحجم.
    nutrition: { delta: -850, floorPct: 0.7, floorKcal: 1800, proteinPerKg: 2.2 },
    verdict: {
      ideal: [-1.2, -0.4],
      holdLossBelow: -1.5,
      muscleDropKg: -0.5,
      warnGainAbove: 0.3,
      stallBelow: null,
    },
    days: [
      {
        key: 'sat',
        day: 'السبت',
        title: 'بلوك جسم أ',
        focus: 'بعد الكارديو. هذا اللي يخلي النازل دهون مو عضل.',
        ex: [
          { id: 'pushup_inc', sets: 3, reps: '8–12', repsN: 10, rest: 60 },
          { id: 'crunch', sets: 3, reps: '15–20', repsN: 17, rest: 45 },
          { id: 'plank', sets: 3, reps: 'ثواني', rest: 45 },
          { id: 'glute_bridge', sets: 3, reps: '12–15', repsN: 13, rest: 45 },
          { id: 'deadbug', sets: 3, reps: '10 لكل جهة', repsN: 10, rest: 45 },
          { id: 'str_ham', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_chest', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
      {
        key: 'sun',
        day: 'الأحد',
        title: 'إطالة ومرونة',
        focus: 'يوم كارديو طويل، وبعده إطالة تفك اللي شدّه المشي والسيكل.',
        ex: [
          { id: 'str_ham', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_hipflex', sets: 2, reps: 'ثواني لكل جهة', rest: 15 },
          { id: 'str_calf', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_back', sets: 2, reps: 'ثواني', rest: 15 },
          { id: 'str_chest', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
      {
        key: 'mon',
        day: 'الاثنين',
        title: 'بلوك جسم ب',
        focus: 'زوايا ثانية للبطن والظهر — ما تكرر نفس بلوك السبت.',
        ex: [
          { id: 'pushup', sets: 3, reps: '8–15', repsN: 11, rest: 60 },
          { id: 'crunch', sets: 3, reps: '15–20', repsN: 17, rest: 45 },
          { id: 'side_plank', sets: 3, reps: 'ثواني لكل جهة', rest: 45 },
          { id: 'superman', sets: 3, reps: '12', repsN: 12, rest: 45 },
          { id: 'birddog', sets: 3, reps: '10 لكل جهة', repsN: 10, rest: 45 },
          { id: 'str_hipflex', sets: 2, reps: 'ثواني لكل جهة', rest: 15 },
          { id: 'str_back', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
      {
        key: 'tue',
        day: 'الثلاثاء',
        title: 'إطالة ومرونة',
        focus: 'راحة من البلوكات، وشغل على المرونة بس.',
        ex: [
          { id: 'str_ham', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_hipflex', sets: 2, reps: 'ثواني لكل جهة', rest: 15 },
          { id: 'str_calf', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_back', sets: 2, reps: 'ثواني', rest: 15 },
          { id: 'str_chest', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
      {
        key: 'wed',
        day: 'الأربعاء',
        title: 'بلوك جسم أ',
        focus: 'نفس بلوك السبت. التكرار هو اللي يبني — مو التنويع.',
        ex: [
          { id: 'pushup_inc', sets: 3, reps: '8–12', repsN: 10, rest: 60 },
          { id: 'crunch', sets: 3, reps: '15–20', repsN: 17, rest: 45 },
          { id: 'plank', sets: 3, reps: 'ثواني', rest: 45 },
          { id: 'glute_bridge', sets: 3, reps: '12–15', repsN: 13, rest: 45 },
          { id: 'deadbug', sets: 3, reps: '10 لكل جهة', repsN: 10, rest: 45 },
          { id: 'str_ham', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_chest', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
      {
        key: 'thu',
        day: 'الخميس',
        title: 'إطالة ومرونة',
        focus: 'أطول يوم كارديو، فالإطالة بعده مو رفاهية.',
        ex: [
          { id: 'str_ham', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_hipflex', sets: 2, reps: 'ثواني لكل جهة', rest: 15 },
          { id: 'str_calf', sets: 2, reps: 'ثواني لكل رجل', rest: 15 },
          { id: 'str_back', sets: 2, reps: 'ثواني', rest: 15 },
          { id: 'str_chest', sets: 2, reps: 'ثواني', rest: 15 },
        ],
      },
    ],
    cardio: [
      { d: 'السبت', detail: '55 دقيقة — شدة متوسطة، تلهث بس تقدر تتكلم', min: 55 },
      { d: 'الأحد', detail: '60 دقيقة — أطول شوي وأهدى', min: 60 },
      { d: 'الاثنين', detail: '55 دقيقة شدة متوسطة', min: 55 },
      { d: 'الثلاثاء', detail: '60 دقيقة — نوّع الجهاز عن أمس', min: 60 },
      { d: 'الأربعاء', detail: '55 دقيقة شدة متوسطة', min: 55 },
      { d: 'الخميس', detail: '70 دقيقة — أطول يوم بالأسبوع', min: 70 },
      REST_DAY,
    ],
    notes: [
      [
        { b: 'بدون حديد، البروتين هو حاميك الوحيد.' },
        ' العجز هنا كبير، واللي يقرر إن النازل دهون مو عضل هو بروتينك وبلوك الجسم — مو الدقائق.',
      ],
      [
        { b: 'نزول أكثر من 1.5% من وزنك بأسبوع مو إنجاز.' },
        ' بهالسرعة وأنت ما ترفع شي، جزء كبير من اللي راح عضل، والميزان يكذب عليك.',
      ],
      [
        { b: 'الالتزام ٦ أيام أهم من اختيار الجهاز.' },
        ' الفرق بالحرق بين السير والسيكل والغزالة أصغر بكثير من الفرق بين إنك تروح وما تروح.',
      ],
    ],
  },
};

export const GOAL_KEYS = Object.keys(GOALS);

/* ══════════════════════════════════════════════════════════════════
   CARDIO MACHINES
   ══════════════════════════════════════════════════════════════════ */

/** Most machines a single cardio day may be split across. */
export const MAX_MACHINES_PER_DAY = 3;

export const MACH = [
  { k: 'walk', n: 'سير مائل', en: 'Incline Treadmill', d: 'أعلى حرق بأقل ضرر للركبة. ميلان 8–12% وسرعة 5–5.5' },
  { k: 'bike', n: 'سيكل', en: 'Stationary Bike', d: 'أرحم شي على المفاصل. أفضل خيار بعد يوم الرجل' },
  { k: 'ellip', n: 'غزالة', en: 'Elliptical', d: 'صفر صدمة على الركبة، ويشغّل يدك بعد. مريح لو ركبتك تعبانة' },
  { k: 'stair', n: 'درج', en: 'Stair Climber', d: 'أعلى حرق بالكل، وأقساها على ركبتك وفخذك. لا تسويه قبل أو بعد يوم الرجل' },
  { k: 'row', n: 'تجديف', en: 'Rowing Machine', d: 'جسم كامل، بس يشتغل ظهرك — لا تسويه ثقيل يوم الأربعاء' },
];

/**
 * جهازين ما يتجمّعون في يوم واحد، وليش.
 *
 * حقيقة عن الأجهزة نفسها مو عن الهدف، فتنطبق على كل الأهداف. وهي **تحذير**:
 * الواجهة تلوّن الشريحتين وتقول السبب، وتخليك تختار — القرار قرارك، والركبة
 * ركبتك. الأزواج متماثلة، فتنكتب مرة وحدة هنا وتنقرأ بالاتجاهين.
 */
const CLASH_PAIRS = [
  { pair: ['ellip', 'stair'], why: 'الاثنين يحمّلون نفس الركبة والفخذ — اجمعهم بيوم واحد وركبتك تدفع الحساب.' },
  { pair: ['bike', 'row'], why: 'الاثنين جالس وخفيف على المفاصل — اليوم يطلع سهل وحرقه أقل من اللي تظن.' },
];

/** الأجهزة اللي تتعارض مع جهاز معيّن. */
export const clashesWith = (key) =>
  CLASH_PAIRS.filter((c) => c.pair.includes(key)).map((c) => c.pair.find((k) => k !== key));

/**
 * التعارضات داخل اختيار يوم واحد.
 * @param {string[]} keys مفاتيح الأجهزة المختارة لهذا اليوم
 * @returns {{a:string, b:string, why:string}[]}
 */
export function clashesOf(keys) {
  const picked = new Set(Array.isArray(keys) ? keys : []);
  return CLASH_PAIRS.filter((c) => c.pair.every((k) => picked.has(k))).map((c) => ({
    a: c.pair[0],
    b: c.pair[1],
    why: c.why,
  }));
}

export const DAY_NAMES = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/** JavaScript Date#getDay() for each entry in DAY_NAMES order. */
const JS_DAY = [6, 0, 1, 2, 3, 4, 5];

/* ══════════════════════════════════════════════════════════════════
   DERIVED LOOKUPS
   ══════════════════════════════════════════════════════════════════ */

export const ALL_EXERCISES = Object.entries(EXERCISES).map(([id, e]) => ({ id, ...e }));
export const EXERCISE_IDS = Object.keys(EXERCISES);
export const MACHINE_KEYS = MACH.map((m) => m.k);
export const FEEDBACK_VALUES = ['light', 'ok', 'heavy'];

const BY_ID = new Map(ALL_EXERCISES.map((e) => [e.id, e]));
export const exById = (id) => BY_ID.get(id);

/**
 * The smallest change the equipment can make, which is what the +/− buttons
 * move by. Falls back to the weekly step for anything whose rack, stack or
 * clock has no finer notch than that.
 */
export const fineStep = (e) => (Number.isFinite(e?.fine) ? e.fine : e?.step || 0);

/**
 * Ceiling on any stored load, in kilograms or in seconds for a timed hold.
 * The client validates a typed value against it and the server re-checks the
 * same number, so the two can never drift apart.
 */
export const MAX_LOAD = 1000;

/**
 * Highest `sets` anywhere in the program — catalogue defaults and every goal's
 * overrides. Used to bound what a client may store; it must cover all goals,
 * because switching goal must never make an already-saved document invalid.
 */
export const MAX_SETS = (() => {
  let max = Math.max(...ALL_EXERCISES.map((e) => e.sets || 0));
  for (const goal of Object.values(GOALS)) {
    for (const day of goal.days) {
      for (const item of day.ex) {
        if (typeof item !== 'string' && Number.isFinite(item.sets)) max = Math.max(max, item.sets);
      }
    }
  }
  return max;
})();

/* ── goal resolution ──────────────────────────────────────────── */

export const goalOf = (key) => GOALS[key] || GOALS[DEFAULT_GOAL];
export const levelOf = (key) => LEVELS[key] || LEVELS[DEFAULT_LEVEL];

/** Merge a day entry with its catalogue record. */
function resolveExercise(item) {
  const id = typeof item === 'string' ? item : item.id;
  const base = EXERCISES[id];
  if (!base) return null;
  return typeof item === 'string' ? { id, ...base } : { id, ...base, ...item };
}

/** `{ sat: { day, title, focus, ex: [...] }, … }` for one goal. */
export function planOf(goalKey) {
  const out = {};
  for (const day of goalOf(goalKey).days) {
    out[day.key] = {
      day: day.day,
      title: day.title,
      focus: day.focus,
      ex: day.ex.map(resolveExercise).filter(Boolean),
    };
  }
  return out;
}

/** Day keys of a goal's lifting days, in week order. */
export const daysOf = (goalKey) => goalOf(goalKey).days.map((d) => d.key);

/** يوم كل تمارينه بوزن الجسم أو محسوبة بالوقت — ما فيه حديد يتحمّل. */
export const dayHasLoads = (exercises) => (exercises || []).some((e) => !e.body && !e.time);

/**
 * هل الهدف يحمّل أي وزن أصلاً؟
 *
 * هدف الكارديو ما فيه ولا تمرين محمّل، فكل كلام الواجهة عن «الحديد» وعن
 * «الأوزان اللي تزيد» ما ينطبق عليه. تنحسب من البرنامج نفسه مو من قائمة
 * أهداف مكتوبة بالإيد، عشان أي هدف جديد يشتغل صح بدون ما أحد يفتكر يحدّثها.
 */
export const goalHasLoads = (goalKey) =>
  goalOf(goalKey).days.some((d) => dayHasLoads(d.ex.map(resolveExercise).filter(Boolean)));

/** The goal's cardio week — seven entries in DAY_NAMES order. */
export const cardioOf = (goalKey) => goalOf(goalKey).cardio;

/**
 * Seven-entry week: which weekday lifts, which cardio slot it maps to, and the
 * JS weekday number. `c` doubles as the storage key for cardio, so it stays the
 * index into the cardio array.
 */
export function weekOf(goalKey) {
  const goal = goalOf(goalKey);
  const liftByDayName = new Map(goal.days.map((d) => [d.day, d.key]));
  return DAY_NAMES.map((name, i) => {
    const entry = { d: name, c: i, js: JS_DAY[i] };
    const lift = liftByDayName.get(name);
    if (lift) entry.lift = lift;
    else if (goal.cardio[i]?.rest && i === DAY_NAMES.length - 1) entry.rest = 1;
    return entry;
  });
}

/** The lifting day key for today, or 'cardio' / 'rest'. */
export function todayLift(goalKey, date = new Date()) {
  const week = weekOf(goalKey);
  const entry = week.find((w) => w.js === date.getDay());
  if (!entry) return 'rest';
  if (entry.lift) return entry.lift;
  return entry.rest || cardioOf(goalKey)[entry.c]?.rest ? 'rest' : 'cardio';
}

/* ── muscle groups ────────────────────────────────────────────── */

/**
 * Every exercise carries `g`, and a trainee may set a level per group instead
 * of one level for the whole body — someone whose legs lag their bench should
 * not be handed both at the same fraction of their strength.
 *
 * Only the groups listed here are offered in the UI. `core` is deliberately
 * absent: two of its four movements are bodyweight or fixed-load, which
 * `baseWeights` never scales, so a control for it would move almost nothing.
 * It still carries the tag, and follows the overall level like everything
 * unset, so exposing it later is a one-line change.
 */
export const GROUPS = [
  { k: 'push', n: 'دفع', sub: 'صدر · كتف · ترايسبس' },
  { k: 'pull', n: 'سحب', sub: 'ظهر · بايسبس' },
  { k: 'legs', n: 'أرجل', sub: 'أرجل · مؤخرة' },
];

export const GROUP_KEYS = GROUPS.map((g) => g.k);

/** How many catalogue movements each group holds — shown next to its name. */
export const groupCount = (key) => ALL_EXERCISES.filter((e) => e.g === key).length;

/**
 * The level that governs one group: its own override when set, otherwise the
 * trainee's overall level. Unknown keys and unknown groups fall back rather
 * than throwing, so a document written by a newer version stays readable.
 */
export function levelForGroup(group, levelKey = DEFAULT_LEVEL, levels = null) {
  const override = levels && typeof levels === 'object' ? levels[group] : null;
  if (override && LEVELS[override]) return override;
  return LEVELS[levelKey] ? levelKey : DEFAULT_LEVEL;
}

/* ── starting weights ─────────────────────────────────────────── */

/** Round to the nearest multiple of `step`, never below one step. */
function toStep(value, step) {
  if (!step) return 0;
  const snapped = Math.round(value / step) * step;
  return Math.max(step, Math.round(snapped * 10) / 10);
}

/**
 * Starting weights for week 1 of a goal, scaled per muscle group.
 * Only the goal's own exercises are seeded; a movement from another goal keeps
 * whatever the user had stored, so switching goal and back loses nothing.
 */
export function baseWeights(goalKey = DEFAULT_GOAL, levelKey = DEFAULT_LEVEL, levels = null) {
  const out = {};
  for (const day of goalOf(goalKey).days) {
    for (const item of day.ex) {
      const e = resolveExercise(item);
      if (!e) continue;
      if (e.body || !e.base) {
        out[e.id] = e.base || 0;
        continue;
      }
      // Each movement is scaled by the level of its own group, which is the
      // overall level unless that group was given one of its own.
      const mult = levelOf(levelForGroup(e.g, levelKey, levels)).mult;
      out[e.id] = mult === 1 ? e.base : toStep(e.base * mult, e.step);
    }
  }
  return out;
}

/* ── cardio machines ──────────────────────────────────────────── */

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

/* ── legacy aliases ───────────────────────────────────────────── */
/* The fat-loss programme is the historical default, so these keep older call
   sites and tests working unchanged. */

export const PLAN = planOf(DEFAULT_GOAL);
export const DAYS = daysOf(DEFAULT_GOAL);
export const WEEK = weekOf(DEFAULT_GOAL);
export const CARDIO = cardioOf(DEFAULT_GOAL);
