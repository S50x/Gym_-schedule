/**
 * رسوم متحركة تعليمية — شخص خطّي داخل SVG.
 *
 * A looping stick figure for a movement, built the same way `sparkline()` and
 * `qrSvg()` are built: real SVG nodes through `createElementNS`, never an SVG
 * string. Nothing is fetched, so the strict CSP is untouched and the figure
 * works with no network at all — the whole set costs less than one photograph.
 *
 * A pose is the body as ONE open chain, because the skeleton happens to be one:
 *
 *     wrist → elbow → shoulder → hip → knee → ankle
 *
 * so a movement is two arrays of six points plus where the head sits, and the
 * browser tweens between them. Anything the chain cannot express — the ground,
 * a bench, a wall, the limbs that stay still — is a static path in `props`.
 *
 * These are schematics, not form references. They show the shape of a rep at a
 * glance while you are standing in the gym; the written cue and the clip remain
 * the authority on how to do it safely.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ground level in the 120×80 box every pose is drawn in. */
const FLOOR = 'M2 67.5 H118';

/**
 * `a` and `b` are the two ends of the rep, `head` is the head centre for each,
 * `dur` its tempo in seconds, `props` whatever is nailed down.
 */
const FIGURES = {
  pushup: {
    dur: 2.4,
    muscle: [{ seg: 0, from: 0.55, to: 0.95 }, { seg: 3, from: 0.15, to: 0.85 }],
    props: [FLOOR],
    a: { p: [[88, 67], [88, 56], [88, 44], [58, 54], [38, 60], [18, 67]], head: [98, 41] },
    b: { p: [[88, 67], [80, 64], [86, 57], [58, 61], [38, 64], [18, 67]], head: [96, 54] },
  },
  pushup_inc: {
    dur: 2.4,
    muscle: [{ seg: 0, from: 0.55, to: 0.95 }, { seg: 3, from: 0.15, to: 0.85 }],
    // The bench: the whole point of this variation is the raised hands.
    props: [FLOOR, 'M82 48 H118 M86 48 V67 M114 48 V67'],
    a: { p: [[96, 48], [93, 41], [90, 38], [56, 51], [36, 58], [14, 67]], head: [99, 33] },
    b: { p: [[96, 48], [82, 50], [88, 47], [56, 56], [36, 61], [14, 67]], head: [97, 43] },
  },
  crunch: {
    dur: 2.6,
    muscle: [{ seg: 0, from: 0.15, to: 0.7 }],
    props: [FLOOR],
    a: { p: [[22, 55], [27, 60], [30, 64], [58, 64], [80, 46], [96, 65]], head: [18, 58] },
    b: { p: [[27, 40], [32, 47], [38, 52], [58, 64], [80, 46], [96, 65]], head: [28, 44] },
  },
  plank: {
    dur: 4,
    muscle: [{ seg: 0, from: 0.12, to: 0.72 }],
    props: [FLOOR],
    // A hold, so the two poses are almost the same — just enough motion to read
    // as alive rather than as a frozen drawing.
    a: { p: [[97, 67], [86, 67], [86, 50], [58, 57], [38, 62], [18, 67]], head: [95, 45] },
    b: { p: [[97, 67], [86, 67], [86, 49], [58, 55], [38, 61], [18, 67]], head: [95, 44] },
  },
  side_plank: {
    dur: 4,
    muscle: [{ seg: 0, from: 0.1, to: 0.7 }],
    // The raised arm and the stacked top leg cannot live on one chain.
    props: [FLOOR, 'M84 42 V21'],
    a: { p: [[84, 66], [84, 54], [84, 42], [52, 54], [33, 60], [14, 66]], head: [93, 36] },
    b: { p: [[84, 66], [84, 55], [84, 44], [52, 59], [33, 63], [14, 66]], head: [93, 38] },
  },
  glute_bridge: {
    dur: 2.6,
    muscle: [{ seg: 1, from: 0, to: 0.4 }, { seg: 0, from: 0, to: 0.22 }],
    props: [FLOOR],
    a: { p: [[40, 66], [31, 66], [24, 64], [52, 64], [76, 48], [92, 66]], head: [15, 61] },
    b: { p: [[40, 66], [31, 66], [24, 64], [52, 50], [76, 44], [92, 66]], head: [15, 61] },
  },
  superman: {
    dur: 3,
    muscle: [{ seg: 0, from: 0, to: 0.55 }],
    props: [FLOOR],
    a: { p: [[16, 65], [30, 66], [44, 65], [72, 65], [86, 66], [100, 65]], head: [36, 60] },
    b: { p: [[13, 53], [29, 58], [44, 63], [72, 64], [87, 58], [102, 51]], head: [35, 55] },
  },
  deadbug: {
    dur: 3,
    muscle: [{ seg: 0, from: 0.15, to: 0.75 }],
    // The opposite arm and leg hold their start position while these two move.
    props: [FLOOR],
    a: { p: [[33, 33], [37, 47], [38, 61], [70, 61], [73, 42], [91, 46]], head: [27, 58] },
    b: { p: [[12, 42], [25, 50], [38, 61], [70, 61], [88, 51], [106, 56]], head: [27, 58] },
  },
  birddog: {
    dur: 3,
    muscle: [{ seg: 0, from: 0.08, to: 0.8 }],
    // The arm and leg holding the body up.
    props: [FLOOR, 'M36 42 L41 67', 'M74 42 L70 67'],
    a: { p: [[42, 58], [37, 50], [36, 42], [74, 42], [72, 54], [64, 59]], head: [27, 39] },
    b: { p: [[10, 31], [23, 37], [36, 42], [74, 42], [90, 46], [108, 50]], head: [27, 41] },
  },
  str_ham: {
    dur: 5,
    muscle: [{ seg: 1, from: 0.12, to: 0.92 }],
    // Bench under the raised heel, and the leg still standing on the floor.
    props: [FLOOR, 'M74 42 H112 M78 42 V67 M108 42 V67', 'M38 46 L58 44 L78 42'],
    a: { p: [[60, 37], [50, 32], [40, 29], [38, 46], [36, 57], [34, 67]], head: [41, 21] },
    b: { p: [[72, 40], [59, 37], [46, 35], [38, 46], [36, 57], [34, 67]], head: [52, 28] },
  },
  str_hipflex: {
    dur: 5,
    muscle: [{ seg: 1, from: 0, to: 0.45 }],
    props: [FLOOR, 'M46 48 L70 53 L70 67'],
    // Driving the hips forward IS the stretch, so the travel has to be visible.
    a: { p: [[42, 58], [42, 52], [43, 36], [44, 49], [26, 65], [13, 67]], head: [43, 28] },
    b: { p: [[56, 55], [56, 49], [57, 32], [58, 45], [27, 65], [13, 67]], head: [57, 24] },
  },
  str_calf: {
    dur: 5,
    muscle: [{ seg: 2, from: 0.08, to: 0.78 }],
    props: [FLOOR, 'M104 16 V67'],
    // Leaning into the wall with the heel pinned is the whole movement; a
    // couple of pixels of lean teaches nobody anything.
    a: { p: [[102, 40], [86, 39], [70, 39], [50, 46], [34, 56], [18, 66]], head: [76, 31] },
    b: { p: [[102, 47], [90, 48], [80, 50], [58, 53], [38, 59], [18, 66]], head: [88, 43] },
  },
  str_chest: {
    dur: 5,
    muscle: [{ seg: 0, from: 0.6, to: 1 }, { seg: 3, from: 0, to: 0.5 }],
    // The door frame the forearm presses against.
    props: [FLOOR, 'M96 14 V67'],
    a: { p: [[92, 25], [92, 40], [80, 43], [77, 54], [77, 61], [77, 67]], head: [77, 34] },
    b: { p: [[92, 25], [92, 42], [64, 47], [58, 56], [56, 62], [54, 67]], head: [61, 38] },
  },
  str_back: {
    dur: 5,
    muscle: [{ seg: 0, from: 0, to: 0.6 }],
    props: [FLOOR],
    a: { p: [[40, 52], [46, 48], [52, 44], [56, 60], [56, 66], [72, 67]], head: [52, 36] },
    b: { p: [[14, 64], [28, 62], [44, 60], [58, 60], [58, 66], [74, 67]], head: [38, 55] },
  },
};

/**
 * Movements with a photographed pair in `public/img/ex/` — a real person in the
 * start and the end of the rep, from the public-domain free-exercise-db set.
 *
 * A photograph beats a drawing at showing what a movement looks like and loses
 * to it at showing where the work lands, so the drawing stays the fallback for
 * anything unphotographed rather than being replaced outright. `birddog` is the
 * one movement in this programme that set does not carry.
 */
const PHOTOGRAPHED = new Set([
  'pushup',
  'pushup_inc',
  'crunch',
  'plank',
  'side_plank',
  'glute_bridge',
  'superman',
  'deadbug',
  'str_ham',
  'str_hipflex',
  'str_calf',
  'str_chest',
  'str_back',
]);

export const PHOTO_IDS = [...PHOTOGRAPHED];
export const hasPhoto = (exId) => PHOTOGRAPHED.has(exId);
export const photoFrame = (exId, frame) => `/img/ex/${exId}-${frame}.webp`;

export const FIGURE_IDS = Object.keys(FIGURES);
export const hasFigure = (exId) => Object.hasOwn(FIGURES, exId);

/**
 * The raw poses. Every number here was placed by hand, so the geometry is
 * worth asserting: a chain of the wrong length or a joint outside the box
 * draws a figure that is subtly wrong in a way nobody reviews twice.
 */
export const figureOf = (exId) => FIGURES[exId] || null;

const svg = (tag, attrs) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/**
 * A body is not five identical sticks. Drawing every segment at one width is
 * what makes a figure read as a child's drawing rather than as a pictogram, so
 * each limb gets the weight it actually has — thigh heaviest, forearm lightest,
 * torso widest of all — and every joint is a round cap, which turns the seams
 * between segments into knees and elbows instead of corners.
 *
 * Indices into the six-joint chain: 0 wrist · 1 elbow · 2 shoulder · 3 hip ·
 * 4 knee · 5 ankle.
 */
const SEGMENTS = [
  { from: 3, to: 2, w: 8.4 }, // 0 torso
  { from: 3, to: 4, w: 6 }, //   1 thigh
  { from: 4, to: 5, w: 4.6 }, // 2 shin
  { from: 2, to: 1, w: 4.4 }, // 3 upper arm
  { from: 1, to: 0, w: 3.4 }, // 4 forearm
];

/** The limbs that have a twin on the far side of the body. */
const FAR_LIMBS = [1, 2, 3, 4];

/**
 * How far the far-side arm and leg sit behind the near ones.
 *
 * This is the whole depth cue. A side view with one arm and one leg reads flat
 * however well it is shaded; the moment a dimmer second pair appears behind the
 * body, the eye reads a person standing in space rather than a decal. It is a
 * cheat — there is no third dimension here — but it is the same cheat every
 * flat exercise pictogram uses.
 */
const FAR = { dx: -4.5, dy: 1.5 };

const at = (pose, i) => pose.p[i];
const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
const shift = ([x, y]) => [x + FAR.dx, y + FAR.dy];

/** `values` for a there-and-back loop, so the rep reverses instead of jumping. */
const loop = (from, to) => `${from};${to};${from}`;

function animate(attr, from, to, dur) {
  return svg('animate', {
    attributeName: attr,
    values: loop(from, to),
    dur: `${dur}s`,
    repeatCount: 'indefinite',
    // Ease at both ends: a rep slows at the top and the bottom, it does not
    // travel at one speed and stop dead.
    calcMode: 'spline',
    keyTimes: '0;0.5;1',
    keySplines: '0.45 0 0.25 1;0.45 0 0.25 1',
  });
}

/** A line that travels from its pose-A ends to its pose-B ends and back. */
function movingLine(cls, w, aFrom, aTo, bFrom, bTo, dur, still, stroke) {
  const line = svg('line', {
    class: cls,
    'stroke-width': w,
    x1: aFrom[0],
    y1: aFrom[1],
    x2: aTo[0],
    y2: aTo[1],
    ...(stroke ? { stroke } : {}),
  });
  if (still) return line;
  for (const [attr, one, two] of [
    ['x1', aFrom[0], bFrom[0]],
    ['y1', aFrom[1], bFrom[1]],
    ['x2', aTo[0], bTo[0]],
    ['y2', aTo[1], bTo[1]],
  ]) {
    line.appendChild(animate(attr, one, two, dur));
  }
  return line;
}

/** The neck, so the head is attached to the body instead of floating beside it. */
function neck(fig, still, paint) {
  const mid = (pose) => lerp(at(pose, 2), pose.head, 0.5);
  return movingLine('flimb', 5, at(fig.a, 2), mid(fig.a), at(fig.b, 2), mid(fig.b), fig.dur, still, paint);
}

/** Gradient ids have to be unique: two figures on one page must not collide. */
let idSeed = 0;

/**
 * The two photographed ends of the rep, stacked and cross-faded by CSS.
 *
 * Two frames is not a film — it is the start and the end of the rep. Fading
 * between them reads as the movement; cutting between them reads as a glitch,
 * which is why this is a fade and not a swap. No timer and no script: the
 * animation lives in the stylesheet, so nothing has to be torn down when the
 * panel closes.
 */
function photoPair(exId, alt) {
  const box = document.createElement('div');
  box.className = 'fphoto';
  for (const frame of [0, 1]) {
    const img = document.createElement('img');
    img.className = `fframe f${frame}`;
    img.src = photoFrame(exId, frame);
    // Only one of the pair is described: they are two moments of one movement,
    // and a screen reader announcing the name twice is noise.
    img.alt = frame === 0 ? alt : '';
    img.loading = 'lazy';
    img.decoding = 'async';
    // A missing or unreachable file must not leave a torn half-image on screen.
    img.addEventListener('error', () => box.remove(), { once: true });
    box.appendChild(img);
  }
  return box;
}

/**
 * What to show for a movement: the photographed pair when there is one, the
 * drawn figure otherwise, or null when there is neither — the caller renders
 * nothing rather than an empty box.
 */
export function exerciseFigure(exId, alt = '') {
  if (PHOTOGRAPHED.has(exId)) return photoPair(exId, alt);
  const fig = FIGURES[exId];
  if (!fig) return null;

  const root = svg('svg', {
    class: 'fig',
    viewBox: '0 0 120 80',
    // Decorative: the written cue beside it carries the same information, and a
    // screen reader announcing a list of coordinates helps nobody.
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const gid = `fg${(idSeed += 1)}`;
  const defs = svg('defs', {});
  const grad = svg('linearGradient', {
    id: gid,
    gradientUnits: 'userSpaceOnUse',
    // Light from above, down the box rather than across it: a sideways ramp
    // left every figure on the right-hand side of its frame sitting entirely
    // in the shadow half.
    x1: 0,
    y1: 14,
    x2: 0,
    y2: 72,
  });
  // Three stops, so a limb has a turn to it instead of one flat tone.
  for (const [offset, cls] of [['0%', 'flit'], ['55%', 'fmid'], ['100%', 'fdim']]) {
    grad.appendChild(svg('stop', { offset, class: cls }));
  }
  defs.appendChild(grad);
  root.appendChild(defs);

  for (const d of fig.props) root.appendChild(svg('path', { class: 'fprop', d }));

  // Someone who asked the system to stop animating gets the start of the rep,
  // held still, instead of a loop they cannot switch off.
  const still = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const paint = `url(#${gid})`;

  // The far side first — it has to sit behind everything else.
  for (const i of FAR_LIMBS) {
    const seg = SEGMENTS[i];
    root.appendChild(
      movingLine(
        'ffar',
        seg.w * 0.92,
        shift(at(fig.a, seg.from)),
        shift(at(fig.a, seg.to)),
        shift(at(fig.b, seg.from)),
        shift(at(fig.b, seg.to)),
        fig.dur,
        still
      )
    );
  }

  root.appendChild(neck(fig, still, paint));
  for (const seg of SEGMENTS) {
    root.appendChild(
      movingLine(
        'flimb',
        seg.w,
        at(fig.a, seg.from),
        at(fig.a, seg.to),
        at(fig.b, seg.from),
        at(fig.b, seg.to),
        fig.dur,
        still,
        paint
      )
    );
  }

  // The muscle the movement is actually for, laid over the limb that carries
  // it. This is the one thing a photograph of a stranger cannot tell you.
  for (const m of fig.muscle || []) {
    const seg = SEGMENTS[m.seg];
    const ends = (pose) => [
      lerp(at(pose, seg.from), at(pose, seg.to), m.from),
      lerp(at(pose, seg.from), at(pose, seg.to), m.to),
    ];
    const [a1, a2] = ends(fig.a);
    const [b1, b2] = ends(fig.b);
    root.appendChild(movingLine('fmuscle', seg.w * 0.62, a1, a2, b1, b2, fig.dur, still));
  }

  const head = svg('circle', { class: 'fhead', cx: fig.a.head[0], cy: fig.a.head[1], r: 5.2 });
  head.setAttribute('fill', paint);
  if (!still) {
    head.appendChild(animate('cx', fig.a.head[0], fig.b.head[0], fig.dur));
    head.appendChild(animate('cy', fig.a.head[1], fig.b.head[1], fig.dur));
  }
  root.appendChild(head);
  return root;
}
