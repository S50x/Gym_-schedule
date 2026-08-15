import { el } from '../dom.js';
import { toast, bulletList } from '../ui.js';
import { api, ApiError } from '../api.js';
import { SYNC } from '../store.js';

const SYNC_TEXT = {
  [SYNC.OFF]: 'ما سجّلت دخول — بياناتك محفوظة على هذا الجهاز بس.',
  [SYNC.SYNCED]: 'كل شي متزامن. تقدر تفتح من أي جهاز وتلقى نفس البيانات.',
  [SYNC.PENDING]: 'فيه تعديلات لسا ما انرفعت… بترتفع خلال ثواني.',
  [SYNC.SYNCING]: 'يتزامن الحين…',
  [SYNC.OFFLINE]: 'ما فيه نت. بياناتك محفوظة محلياً وبترتفع أول ما يرجع الاتصال.',
  [SYNC.ERROR]: 'صار خطأ بالمزامنة. بياناتك محفوظة محلياً.',
};

export function renderAccount(ctx) {
  const { store, navigate } = ctx;
  const back = el('button', { class: 'back', text: '‹ رجوع', on: { click: () => navigate('home') } });

  if (!store.user) {
    return el('div', { class: 'wrap' }, back, authForms(ctx));
  }

  return el(
    'div',
    { class: 'wrap' },
    back,
    el('h3', { class: 'first', text: 'حسابك' }),
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'acctrow' },
        el('span', { class: 'a', text: 'البريد' }),
        el('span', { class: 'b', text: store.user.email })
      ),
      el(
        'div',
        { class: 'acctrow' },
        el('span', { class: 'a', text: 'أجهزة مسجّل دخول منها' }),
        el('span', { class: 'b n', text: String(store.user.devices ?? 1) })
      ),
      el(
        'div',
        { class: 'acctrow' },
        el('span', { class: 'a', text: 'حالة المزامنة' }),
        el('span', { class: 'b', text: SYNC_TEXT[store.syncState] })
      )
    ),
    changePasswordCard(ctx),
    el(
      'div',
      { class: 'card' },
      el('button', {
        class: 'cta ghost',
        text: 'سجّل خروج من هذا الجهاز',
        on: {
          click: async () => {
            await safe(() => api.logout());
            await store.signOut({ wipeLocal: true });
            toast('طلعت من الحساب');
            navigate('home');
          },
        },
      }),
      el('button', {
        class: 'cta danger',
        text: 'سجّل خروج من كل الأجهزة',
        on: {
          click: async () => {
            if (!confirm('بتطلع من كل الأجهزة. متأكد؟')) return;
            await safe(() => api.logoutAll());
            await store.signOut({ wipeLocal: true });
            toast('طلعت من كل الأجهزة');
            navigate('home');
          },
        },
      })
    ),
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'بياناتك تنحفظ على جهازك أول' },
          '، وبعدين ترتفع للسيرفر. يعني التطبيق يشتغل عادي داخل النادي حتى لو ما فيه شبكة.',
        ],
        [
          { b: 'لو دخلت من جوالك وجهازك بنفس الوقت' },
          '، كل يوم تمرين ينحفظ عند اللي عدّله آخر مرة — ما بينحذف شي.',
        ],
      ])
    )
  );
}

/* ────────────────────────── sign in / sign up ────────────────────────── */

function authForms(ctx) {
  const { store, navigate } = ctx;
  let mode = 'login';

  const emailInput = el('input', {
    type: 'email',
    autocomplete: 'username',
    inputmode: 'email',
    placeholder: 'you@example.com',
    attrs: { autocapitalize: 'none', spellcheck: 'false' },
  });
  const passwordInput = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '••••••••••',
  });

  const message = el('div', {});
  const submitBtn = el('button', { class: 'cta', text: 'دخول' });

  const tabs = ['login', 'register'].map((value) =>
    el('button', {
      text: value === 'login' ? 'تسجيل دخول' : 'حساب جديد',
      attrs: { role: 'tab', 'aria-selected': String(value === mode) },
      on: {
        click: (event) => {
          mode = value;
          for (const tab of event.currentTarget.parentElement.children) {
            tab.setAttribute('aria-selected', String(tab === event.currentTarget));
          }
          submitBtn.textContent = mode === 'login' ? 'دخول' : 'سوّ الحساب';
          passwordInput.setAttribute(
            'autocomplete',
            mode === 'login' ? 'current-password' : 'new-password'
          );
          message.replaceChildren();
        },
      },
    })
  );

  const setError = (text) =>
    message.replaceChildren(el('div', { class: 'formerr', text }));

  const submit = async () => {
    message.replaceChildren();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) return setError('اكتب بريدك وكلمة السر.');
    if (mode === 'register' && password.length < 10) {
      return setError('كلمة السر لازم 10 خانات على الأقل.');
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'لحظة…';
    try {
      const res = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      passwordInput.value = '';
      await store.signedIn({ email: res.data.email, devices: 1 });
      toast(mode === 'login' ? 'أهلاً بك' : 'انسوّى حسابك');
      navigate('home');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'ما قدرنا نوصل للسيرفر. تأكد من الاتصال.');
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'دخول' : 'سوّ الحساب';
    }
  };

  submitBtn.addEventListener('click', submit);
  for (const input of [emailInput, passwordInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }

  return el(
    'div',
    { class: 'authbox' },
    el('h3', { class: 'first', text: 'خلّ بياناتك معك بأي جهاز' }),
    el('div', {
      class: 'hint-lg',
      text: 'سجّل حساب مرة وحدة، وبعدها افتح التطبيق من أي جوال أو كمبيوتر وبتلقى نفس الأوزان ونفس التقدم.',
    }),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'authtabs', attrs: { role: 'tablist' } }, tabs),
      el('label', { class: 'inp ltr' }, el('span', { text: 'البريد الإلكتروني' }), emailInput),
      el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر (10 خانات فأكثر)' }), passwordInput),
      submitBtn,
      message
    ),
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'كلمة السر ما تنحفظ أبداً كنص.' },
          ' تنحفظ مشفّرة بـ scrypt، وحتى لو أحد سرق قاعدة البيانات ما يقدر يرجعها.',
        ],
        [{ b: 'ما نطلب أي معلومة ثانية.' }, ' بريد وكلمة سر بس.'],
        [
          { b: 'تقدر تستخدم التطبيق بدون حساب' },
          ' — بس بياناتك بتبقى على هذا الجهاز لحاله.',
        ],
      ])
    )
  );
}

/* ────────────────────────── change password ────────────────────────── */

function changePasswordCard(ctx) {
  const currentInput = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'كلمة السر الحالية',
  });
  const nextInput = el('input', {
    type: 'password',
    autocomplete: 'new-password',
    placeholder: 'كلمة السر الجديدة',
  });
  const message = el('div', {});
  const button = el('button', { class: 'cta ghost', text: 'غيّر كلمة السر' });

  button.addEventListener('click', async () => {
    message.replaceChildren();
    if (!currentInput.value || !nextInput.value) {
      message.replaceChildren(el('div', { class: 'formerr', text: 'عبّي الخانتين.' }));
      return;
    }
    button.disabled = true;
    try {
      await api.changePassword(currentInput.value, nextInput.value);
      currentInput.value = '';
      nextInput.value = '';
      message.replaceChildren(
        el('div', {
          class: 'formok',
          text: 'انتغيّرت. طلّعنا كل الأجهزة الثانية — سجّل دخول فيها من جديد.',
        })
      );
      ctx.refresh();
    } catch (err) {
      message.replaceChildren(
        el('div', {
          class: 'formerr',
          text: err instanceof ApiError ? err.message : 'ما قدرنا نغيّرها الحين.',
        })
      );
    } finally {
      button.disabled = false;
    }
  });

  return el(
    'div',
    { class: 'card' },
    el('b', { text: 'غيّر كلمة السر' }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'الحالية' }), currentInput),
    el('label', { class: 'inp ltr' }, el('span', { text: 'الجديدة (10 خانات فأكثر)' }), nextInput),
    button,
    message
  );
}

async function safe(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
