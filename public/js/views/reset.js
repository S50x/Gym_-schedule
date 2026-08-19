import { el } from '../dom.js';
import { api, ApiError, NetworkError } from '../api.js';

// ApiError and NetworkError carry a message written for the reader; anything
// else is a bug on our side, not something they can act on.
const errorText = (err, fallback) =>
  err instanceof ApiError || err instanceof NetworkError
    ? err.message
    : fallback || 'صار خطأ غير متوقع. حدّث الصفحة وجرّب مرة ثانية.';

/**
 * The screen the reset link lands on (/reset?token=…). Owns the whole view: no
 * tabs, no programme — just "choose a new password", reachable signed out.
 */
export function renderReset(ctx) {
  const token = ctx.resetToken;

  const nextInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: '••••••••••',
  });
  const confirmInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: '••••••••••',
  });
  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'احفظ كلمة السر الجديدة' });

  const setError = (text) => message.replaceChildren(el('div', { class: 'formerr', text }));

  const card = el(
    'div',
    { class: 'card' },
    el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر الجديدة (10 خانات فأكثر)' }), nextInput),
    el('label', { class: 'inp ltr' }, el('span', { text: 'أعد كتابتها' }), confirmInput),
    button,
    message
  );

  const submit = async () => {
    message.replaceChildren();
    const next = nextInput.value;
    const confirm = confirmInput.value;
    if (!next || !confirm) return setError('عبّي الخانتين.');
    if (next.length < 10) return setError('كلمة السر لازم 10 خانات على الأقل.');
    if (next !== confirm) return setError('الكلمتين مو متطابقتين.');

    button.disabled = true;
    button.textContent = 'لحظة…';
    try {
      await api.resetPassword(token, next);
      showDone(ctx, card);
    } catch (err) {
      // An expired or already-used link cannot be salvaged from here; point the
      // way to asking for a fresh one.
      const dead = err instanceof ApiError && err.code === 'invalid_token';
      setError(errorText(err));
      if (dead) {
        button.replaceWith(
          el('button', {
            class: 'cta',
            text: 'اطلب رابط جديد',
            on: { click: () => ctx.finishReset() },
          })
        );
        return;
      }
      button.disabled = false;
      button.textContent = 'احفظ كلمة السر الجديدة';
    }
  };

  button.addEventListener('click', submit);
  for (const input of [nextInput, confirmInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }

  const view = el(
    'div',
    { class: 'wrap' },
    el('h3', { class: 'first', text: 'اختر كلمة سر جديدة' }),
    el('div', {
      class: 'hint-lg',
      text: 'اكتب كلمة السر الجديدة لحسابك. بعدها بنطلّعك من كل الأجهزة وتسجّل دخول بالكلمة الجديدة.',
    }),
    card,
    el('button', {
      class: 'cta ghost',
      text: 'رجوع لتسجيل الدخول',
      on: { click: () => ctx.finishReset() },
    })
  );
  setTimeout(() => nextInput.focus(), 0);
  return view;
}

function showDone(ctx, card) {
  card.replaceChildren(
    el('div', { class: 'formok', text: 'انتغيّرت كلمة السر ✓' }),
    el('div', {
      class: 'mut',
      text: 'طلّعناك من كل الأجهزة للأمان. سجّل دخول بكلمة السر الجديدة.',
    }),
    el('button', {
      class: 'cta',
      text: 'روح لتسجيل الدخول',
      on: { click: () => ctx.finishReset() },
    })
  );
}
