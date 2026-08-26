/** وضع النادي: شاشة تمرين واحدة في كل مرة + مؤقّت الراحة. */

import { el, clear, append, richText, safeUrl } from './dom.js';
import { fmt, fmtN, toast, buzz, beep, primeAudio } from './ui.js';
import { planOf, fineStep, setsKey, setsOfDay, MAX_LOAD } from './program.js';
import { dayVolume, formatRest } from './engine.js';

const FEEDBACK = [
  { v: 'light', label: 'كان خفيف', toast: 'بنزيده قفزتين الأسبوع الجاي' },
  { v: 'ok', label: 'مضبوط', toast: 'بنزيده قفزة الأسبوع الجاي' },
  { v: 'heavy', label: 'ثقيل عليّ', toast: 'بيثبت الأسبوع الجاي' },
];

export class GymMode {
  constructor(ctx) {
    this.ctx = ctx;
    this.store = ctx.store;
    this.state = null; // { day, index }
    this.cueOpen = false;
    this.sessionStart = 0;
    this.wakeLock = null;
    // Module-level, not rebuilt on every repaint. The original guard lived in
    // the handler closure and was recreated by the redraw it triggered, so it
    // never actually blocked a double tap.
    this.busyUntil = 0;

    this.rest = { end: 0, total: 0, timer: null };
    // Countdown for timed holds (plank). Kept here rather than in the draw
    // closure, which is rebuilt on every repaint.
    this.hold = { end: 0, total: 0, timer: null, exId: null, node: null };

    this.nodes = {
      gym: document.getElementById('gym'),
      count: document.getElementById('gcount'),
      dots: document.getElementById('gdots'),
      body: document.getElementById('gbody'),
      foot: document.getElementById('gfoot'),
      rest: document.getElementById('rest'),
      restBar: document.getElementById('restbar'),
      restTime: document.getElementById('rtm'),
      restNext: document.getElementById('rnx'),
      fin: document.getElementById('fin'),
      finP: document.getElementById('finp'),
      finStats: document.getElementById('finstats'),
    };

    document.getElementById('gx').addEventListener('click', () => this.close());
    document.getElementById('finx').addEventListener('click', () => {
      this.hide(this.nodes.fin);
      this.close();
    });
    document.getElementById('rskip').addEventListener('click', () => this.stopRest());
    document.getElementById('radd').addEventListener('click', () => {
      this.rest.end += 30000;
      this.rest.total += 30;
      this.tickRest();
    });

    this.bindSwipe();
    this.bindKeys();

    // A screen wake lock is dropped whenever the tab is hidden (screen off,
    // app switch). Without re-requesting it the phone starts sleeping again
    // halfway through a workout.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state) this.requestWakeLock();
    });
  }

  /* ── open / close ───────────────────────────────────────── */

  /** The day templates of whichever goal the trainee is on right now. */
  plan() {
    return planOf(this.store.goal);
  }

  async open(day) {
    const plan = this.plan();
    if (!plan[day]) return;
    const week = this.store.week();
    const index = Math.max(
      0,
      plan[day].ex.findIndex((e) => !isDone(e, week, day))
    );
    this.state = { day, index: index === -1 ? 0 : index, editWeight: false };
    this.cueOpen = false;
    // Reset per session. The original kept the previous session's start time,
    // so the "minutes" stat kept growing across days.
    this.sessionStart = Date.now();
    this.show(this.nodes.gym);
    primeAudio();
    this.draw();
    this.requestWakeLock();
  }

  close() {
    this.stopHold({ redraw: false });
    this.state = null;
    this.stopRest();
    this.hide(this.nodes.gym);
    this.releaseWakeLock();
    this.ctx.refresh();
  }

  show(node) {
    node.hidden = false;
    node.classList.add('on');
  }

  hide(node) {
    node.classList.remove('on');
    node.hidden = true;
  }

  async requestWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      this.wakeLock = null;
    }
  }

  releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch {
      /* already released */
    }
    this.wakeLock = null;
  }

  /* ── drawing ────────────────────────────────────────────── */

  current() {
    const plan = this.plan()[this.state.day];
    return { plan, exercise: plan.ex[this.state.index] };
  }

  draw() {
    if (!this.state) return;
    const { plan, exercise } = this.current();
    const week = this.store.week();
    const weights = this.store.weightsFor();
    const sets = week.sets[setsKey(this.state.day, exercise.id)] || [];
    const nextSet = nextSetIndex(sets, exercise.sets);
    const weight = weights[exercise.id];

    this.nodes.count.textContent = `${this.state.index + 1} / ${plan.ex.length} · ${plan.day}`;

    clear(this.nodes.dots);
    plan.ex.forEach((x, i) => {
      this.nodes.dots.appendChild(
        el('i', { class: isDone(x, week, this.state.day) ? 'd' : i === this.state.index ? 'c' : '' })
      );
    });

    /* body */
    const unit = exercise.time ? 'ثانية' : 'كجم';
    const bigValue = exercise.body
      ? el('span', { class: 'wnum sm', text: 'وزن الجسم' })
      : [
          this.state.editWeight
            ? this.weightField(exercise, weight)
            : el('button', {
                class: 'wnum n',
                text: fmtN(weight),
                attrs: { 'aria-label': `الوزن ${fmtN(weight)} ${unit} — اضغط عشان تكتبه بالضبط` },
                on: {
                  click: () => {
                    this.state.editWeight = true;
                    this.draw();
                  },
                },
              }),
          el('span', { class: 'wunit', text: unit }),
        ];

    const adjust = exercise.body
      ? null
      : el(
          'div',
          { class: 'adj' },
          el('button', {
            text: '+',
            attrs: { 'aria-label': 'زد الوزن' },
            on: { click: () => this.adjust(1) },
          }),
          el('button', {
            text: '−',
            attrs: { 'aria-label': 'قلّل الوزن' },
            on: { click: () => this.adjust(-1) },
          })
        );

    const chips = el('div', { class: 'chips' });
    if (exercise.hand) chips.appendChild(el('span', { class: 'chip', text: 'لكل يد' }));
    if (exercise.inverse) {
      chips.appendChild(
        el('span', { class: 'chip', text: 'وزن المساعدة — كل ما قلّ صرت أقوى' })
      );
    }
    if (!exercise.body) {
      // Two numbers, and they are not the same question: what one tap does, and
      // what the programme adds on its own each week.
      const fine = fineStep(exercise);
      const weekly = !exercise.inverse && fine !== exercise.step;
      chips.appendChild(
        el('span', {
          class: 'chip g',
          text: weekly
            ? `الزر ± ${fine} · الأسبوع + ${exercise.step} ${unit}`
            : `الزر ± ${fine} ${unit}`,
        })
      );
    }
    if (!exercise.body) {
      chips.appendChild(
        el('span', {
          class: 'chip g',
          text: exercise.time ? 'اضغط الرقم واكتب ثوانيك' : 'اضغط الرقم واكتب وزنك بالضبط',
        })
      );
    }

    const setButtons = Array.from({ length: exercise.sets }, (_, k) =>
      el('button', {
        class: ['sdot', sets[k] ? 'done' : k === nextSet ? 'now' : ''],
        text: sets[k] ? '✓' : `SET ${k + 1}`,
        attrs: { 'aria-pressed': String(!!sets[k]), 'aria-label': `مجموعة ${k + 1}` },
        on: { click: () => this.toggleSet(k) },
      })
    );

    clear(this.nodes.body);
    // Through the dom.js helper, not the native append: a conditional child that
    // evaluates to null must vanish, and Element.append() would stringify it into
    // a literal "null" on screen.
    append(this.nodes.body, [
      el(
        'div',
        { class: 'gname' },
        exercise.n,
        exercise.en ? el('small', { class: 'en', text: exercise.en }) : null
      ),
      el('div', {
        class: 'gsub',
        text: `${exercise.sets} مجموعات × ${exercise.reps} · راحة ${formatRest(exercise.rest)}`,
      }),
      el('div', { class: 'wbox' }, el('div', { class: 'val' }, bigValue), adjust),
      chips,
      // A timed hold counts itself down here, so nobody has to leave the app,
      // open a stopwatch and come back mid-plank.
      exercise.time ? this.holdControl(exercise, weight) : null,
      el('div', { class: 'sets' }, setButtons),
    ]);

    if (this.state.editWeight) {
      const field = this.nodes.body.querySelector('.wedit');
      field?.focus();
      field?.select();
    }

    /* foot */
    const allDone = isDone(exercise, week, this.state.day);
    const feedback = week.fb[exercise.id];
    clear(this.nodes.foot);

    if (allDone) {
      this.nodes.foot.appendChild(
        el(
          'div',
          { class: 'fbwrap' },
          el('div', { class: 'fblbl', text: 'كيف حسيت الوزن؟ (يحدد زيادة الأسبوع الجاي)' }),
          el(
            'div',
            { class: 'fb' },
            FEEDBACK.map((option) =>
              el('button', {
                text: option.label,
                data: { v: option.v },
                // Only the actual stored choice reads as pressed. The original
                // marked "مضبوط" pressed even when nothing had been chosen.
                attrs: { 'aria-pressed': String(feedback === option.v) },
                on: {
                  click: () => {
                    this.store.update(this.store.viewWeek, (w) => {
                      w.fb = { ...w.fb, [exercise.id]: option.v };
                    });
                    toast(option.toast);
                    this.draw();
                  },
                },
              })
            )
          )
        )
      );
      this.nodes.foot.appendChild(
        el('button', {
          class: 'big mint',
          text: this.state.index < plan.ex.length - 1 ? 'التمرين الجاي ←' : 'خلّصت التمرين 🎉',
          on: { click: () => this.advance() },
        })
      );
    } else {
      this.nodes.foot.appendChild(
        el('button', {
          class: 'big',
          text: `خلّصت المجموعة ${nextSet + 1}`,
          on: { click: () => this.advance() },
        })
      );
    }

    this.nodes.foot.append(
      el(
        'div',
        { class: 'glinks' },
        // Not every exercise ships with a verified link; those show no button
        // rather than one that goes nowhere.
        exercise.v
          ? el(
              'a',
              {
                class: 'glink',
                href: safeUrl(exercise.v),
                target: '_blank',
                rel: 'noopener noreferrer',
              },
              el('b', { text: '▶' }),
              ` ${exercise.vlbl || 'شرح'}`
            )
          : null,
        el('button', {
          class: 'glink',
          text: `الشرح ${this.cueOpen ? '▴' : '▾'}`,
          attrs: { 'aria-expanded': String(this.cueOpen) },
          on: {
            click: () => {
              this.cueOpen = !this.cueOpen;
              this.draw();
            },
          },
        })
      ),
      el(
        'div',
        { class: ['cue', this.cueOpen ? 'open' : ''] },
        el('div', {}, ...richText(exercise.cue))
      ),
      el(
        'div',
        { class: 'arrows' },
        el('button', {
          text: '← السابق',
          disabled: this.state.index === 0,
          on: { click: () => this.step(-1) },
        }),
        el('button', {
          text: 'التالي →',
          disabled: this.state.index === plan.ex.length - 1,
          on: { click: () => this.step(1) },
        })
      )
    );
  }

  /* ── timed hold (plank) ─────────────────────────────────── */

  /** Big start/stop control that counts a hold down in place. */
  holdControl(exercise, seconds) {
    const running = this.hold.timer !== null && this.hold.exId === exercise.id;
    const left = running ? Math.max(0, Math.ceil((this.hold.end - Date.now()) / 1000)) : seconds;

    const time = el('span', { class: 'htime n', text: clockText(left) });
    this.hold.node = running ? time : null;

    const button = el(
      'button',
      {
        class: ['hold', running ? 'run' : ''],
        attrs: { 'aria-label': running ? 'وقف العد' : 'ابدأ العد' },
        on: { click: () => (running ? this.stopHold() : this.startHold(exercise, seconds)) },
      },
      el('span', { class: 'hlbl', text: running ? 'جارٍ العد — اضغط توقف' : 'ابدأ العد' }),
      time
    );

    const bar = el('div', { class: 'hbar' }, el('i', { class: 'hfill' }));
    this.hold.bar = running ? bar.firstChild : null;
    if (running) this.paintHold();

    return el('div', { class: 'holdwrap' }, button, bar);
  }

  startHold(exercise, seconds) {
    const total = Math.max(1, Math.round(Number(seconds) || 0));
    clearInterval(this.hold.timer);
    this.hold = {
      ...this.hold,
      end: Date.now() + total * 1000,
      total,
      exId: exercise.id,
      timer: setInterval(() => this.tickHold(), 200),
    };
    primeAudio();
    buzz(25);
    this.draw();
  }

  tickHold() {
    if (Date.now() >= this.hold.end) {
      const exId = this.hold.exId;
      this.stopHold();
      beep();
      buzz([200, 90, 200]);
      // The hold *is* the set, so finishing it completes one and starts rest.
      if (this.state && this.current().exercise.id === exId) this.advance();
      return;
    }
    this.paintHold();
  }

  paintHold() {
    const remaining = Math.max(0, this.hold.end - Date.now());
    if (this.hold.node?.isConnected) {
      this.hold.node.textContent = clockText(Math.ceil(remaining / 1000));
    }
    if (this.hold.bar?.isConnected) {
      const ratio = this.hold.total > 0 ? remaining / (this.hold.total * 1000) : 0;
      this.hold.bar.style.width = `${(Math.min(1, ratio) * 100).toFixed(1)}%`;
    }
  }

  stopHold({ redraw = true } = {}) {
    if (this.hold.timer === null) return;
    clearInterval(this.hold.timer);
    this.hold = { end: 0, total: 0, timer: null, exId: null, node: null, bar: null };
    if (redraw && this.state) this.draw();
  }

  /* ── actions ────────────────────────────────────────────── */

  step(direction) {
    const { plan } = this.current();
    const next = this.state.index + direction;
    if (next < 0 || next >= plan.ex.length) return;
    this.stopHold({ redraw: false });
    this.state.index = next;
    this.state.editWeight = false;
    this.cueOpen = false;
    this.draw();
  }

  /**
   * Type the load instead of stepping to it.
   *
   * `step` is how much the lift climbs in a week, not what the rack is made of.
   * The +/− buttons move by that same step, so every load the app could reach
   * sat on one lattice: from 6 kg with a 2 kg step you get 6 · 8 · 10 and never
   * the 7.5 or 9.5 dumbbell sitting on the rack. Nothing else in the app minded
   * the halves — `fmtN` prints them and the server stores one decimal — there
   * was simply no control that could produce one. Progression still runs in
   * whole steps from wherever this lands: 7.5 → 9.5 → 11.5.
   */
  weightField(exercise, weight) {
    const seconds = !!exercise.time;
    const field = el('input', {
      class: 'wnum n wedit',
      type: 'number',
      inputmode: 'decimal',
      step: String(fineStep(exercise) || (seconds ? 1 : 0.5)),
      min: '0',
      max: String(MAX_LOAD),
      value: String(weight ?? 0),
      attrs: { 'aria-label': seconds ? 'الوقت بالثواني' : 'الوزن بالكيلو' },
    });

    // `close()` on this class means leaving gym mode, so this one is `cancel`.
    const cancel = () => {
      // Tearing the field out fires its own blur, which lands back here. The
      // flag is already down by then, so the second pass is a no-op.
      if (!this.state) return;
      this.state.editWeight = false;
      this.draw();
    };

    const commit = () => {
      if (!this.state?.editWeight) return;
      const value = Number.parseFloat(field.value);
      if (!Number.isFinite(value) || value < 0 || value > MAX_LOAD) {
        toast(seconds ? `اكتب ثواني بين 0 و ${MAX_LOAD}` : `اكتب وزن بين 0 و ${MAX_LOAD} كجم`);
        cancel();
        return;
      }
      this.state.editWeight = false;
      // One decimal is what the server keeps, so what shows is what syncs.
      this.setWeight(exercise.id, seconds ? Math.round(value) : Math.round(value * 10) / 10);
    };

    field.addEventListener('blur', commit);
    field.addEventListener('keydown', (event) => {
      // Gym mode listens on the document for Escape and the arrows. While this
      // field has the focus those keys are its own.
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        commit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    return field;
  }

  /** Stored as a manual override for this week; later weeks progress from it. */
  setWeight(id, value) {
    this.store.update(this.store.viewWeek, (w) => {
      w.weights = { ...w.weights, [id]: value };
    });
    this.draw();
  }

  /**
   * The buttons move by what the equipment can actually do, not by the weekly
   * jump. Those used to be the same number, which is why no amount of tapping
   * ever reached the 7.5 kg dumbbell on the rack.
   */
  adjust(direction) {
    const { exercise } = this.current();
    const step = fineStep(exercise) || 1;
    const weights = this.store.weightsFor();
    const value = Math.max(0, Math.round(((weights[exercise.id] || 0) + direction * step) * 10) / 10);
    this.setWeight(exercise.id, value);
  }

  toggleSet(index) {
    const { exercise } = this.current();
    this.store.update(this.store.viewWeek, (w) => {
      const key = setsKey(this.state.day, exercise.id);
      const sets = [...(w.sets[key] || [])];
      while (sets.length < exercise.sets) sets.push(false);
      sets[index] = !sets[index];
      w.sets = { ...w.sets, [key]: sets };
    });
    this.draw();
  }

  advance() {
    const now = Date.now();
    if (now < this.busyUntil) return;
    this.busyUntil = now + 400;

    const { plan, exercise } = this.current();
    const week = this.store.week();

    if (isDone(exercise, week, this.state.day)) {
      if (this.state.index < plan.ex.length - 1) this.step(1);
      else this.finish();
      return;
    }

    let completedIndex = -1;
    this.store.update(this.store.viewWeek, (w) => {
      const key = setsKey(this.state.day, exercise.id);
      const sets = [...(w.sets[key] || [])];
      while (sets.length < exercise.sets) sets.push(false);
      completedIndex = sets.findIndex((x) => !x);
      if (completedIndex === -1) return;
      sets[completedIndex] = true;
      w.sets = { ...w.sets, [key]: sets };
    });

    buzz(35);
    this.draw();

    const nowDone = isDone(exercise, this.store.week(), this.state.day);
    const next = plan.ex[this.state.index + 1];
    this.startRest(
      exercise.rest,
      nowDone
        ? `خلّصت ${exercise.n} — الجاي: ${next ? next.n : 'نهاية التمرين'}`
        : `الجاي: مجموعة ${completedIndex + 2} من ${exercise.n}`
    );
  }

  finish() {
    const { plan } = this.current();
    const week = this.store.week();
    const daySets = setsOfDay(week, this.state.day);
    const minutes = Math.max(1, Math.round((Date.now() - this.sessionStart) / 60000));
    const setCount = plan.ex.reduce(
      (acc, e) => acc + (daySets[e.id] || []).filter(Boolean).length,
      0
    );
    const volume = dayVolume(plan.ex, this.store.weightsFor(), daySets);

    this.nodes.finP.textContent = `${plan.day} — ${plan.title}`;
    clear(this.nodes.finStats);
    const stat = (value, label) =>
      el('div', { class: 'stat' }, el('b', { class: 'n', text: value }), el('span', { text: label }));
    // A day of planks and stretches carries no load, so the volume stat would
    // read a flat 0 every single time. Drop it rather than print a zero.
    // Through the dom.js helper, not the native append: the volume stat is now
    // conditional, and Element.append() would stringify a null into the word
    // "null" on screen — the exact bug the rest of this file already avoids.
    append(this.nodes.finStats, [
      stat(String(plan.ex.length), 'تمارين'),
      stat(String(setCount), 'مجموعات'),
      volume > 0 ? stat(fmt(volume), 'كجم حمل') : null,
      stat(String(minutes), 'دقيقة'),
    ]);

    this.stopRest();
    this.show(this.nodes.fin);
    buzz([60, 60, 60, 60, 180]);
    this.sessionStart = Date.now();
  }

  /* ── rest timer ─────────────────────────────────────────── */

  startRest(seconds, nextText) {
    this.rest.total = seconds;
    this.rest.end = Date.now() + seconds * 1000;
    this.nodes.restNext.textContent = nextText || '';
    this.show(this.nodes.rest);
    this.nodes.restBar.style.display = 'block';
    this.tickRest();
    clearInterval(this.rest.timer);
    this.rest.timer = setInterval(() => this.tickRest(), 200);
  }

  tickRest() {
    const left = Math.max(0, this.rest.end - Date.now());
    const seconds = Math.ceil(left / 1000);
    this.nodes.restTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    // Clamp: adding +30s past the original total used to push the bar over 100%.
    const ratio = this.rest.total > 0 ? Math.min(1, left / (this.rest.total * 1000)) : 0;
    this.nodes.restBar.style.width = `${(ratio * 100).toFixed(1)}%`;
    if (left <= 0) {
      beep();
      buzz([220, 110, 220]);
      this.stopRest();
    }
  }

  stopRest() {
    clearInterval(this.rest.timer);
    this.rest.timer = null;
    this.hide(this.nodes.rest);
    this.nodes.restBar.style.display = 'none';
  }

  /* ── input ──────────────────────────────────────────────── */

  bindSwipe() {
    let x0 = null;
    let y0 = null;
    const node = this.nodes.gym;
    node.addEventListener(
      'touchstart',
      (event) => {
        x0 = event.touches[0].clientX;
        y0 = event.touches[0].clientY;
      },
      { passive: true }
    );
    node.addEventListener(
      'touchend',
      (event) => {
        if (x0 === null || !this.state) return;
        const dx = event.changedTouches[0].clientX - x0;
        const dy = event.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) < 70 || Math.abs(dy) > 60) return;
        this.step(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );
  }

  bindKeys() {
    document.addEventListener('keydown', (event) => {
      if (!this.state) return;
      // A field being typed into keeps its own keys: the arrows nudge its
      // number and Escape cancels the edit, neither flips the exercise.
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'Escape') {
        if (!this.nodes.rest.hidden) this.stopRest();
        else this.close();
      }
      // RTL: ArrowLeft moves forward on screen.
      if (event.key === 'ArrowLeft') this.step(1);
      if (event.key === 'ArrowRight') this.step(-1);
    });
  }
}

/* ── helpers ─────────────────────────────────────────────── */

/**
 * A lift is done when the sets this goal asks for are ticked.
 *
 * Deliberately not a length equality: switching from a five-set goal to a
 * three-set one leaves a longer array behind, and that should read as finished,
 * not as permanently incomplete.
 */
export function isDone(exercise, week, dayKey) {
  const sets = week.sets?.[setsKey(dayKey, exercise.id)] || [];
  return sets.length >= exercise.sets && sets.slice(0, exercise.sets).every(Boolean);
}

function clockText(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function nextSetIndex(sets, total) {
  const firstUnchecked = sets.findIndex((x) => !x);
  if (firstUnchecked >= 0) return firstUnchecked;
  return sets.length < total ? sets.length : -1;
}
