import { el, append } from '../dom.js';
import { toast, bulletList, qrSvg } from '../ui.js';
import { api, ApiError, NetworkError } from '../api.js';
import { SYNC } from '../store.js';
import { goalOf, levelOf } from '../program.js';

const SYNC_TEXT = {
  [SYNC.OFF]: 'ما سجّلت دخول — بياناتك محفوظة على هذا الجهاز بس.',
  [SYNC.SYNCED]: 'كل شي متزامن. تقدر تفتح من أي جهاز وتلقى نفس البيانات.',
  [SYNC.PENDING]: 'فيه تعديلات لسا ما انرفعت… بترتفع خلال ثواني.',
  [SYNC.SYNCING]: 'يتزامن الحين…',
  [SYNC.OFFLINE]: 'ما فيه نت. بياناتك محفوظة محلياً وبترتفع أول ما يرجع الاتصال.',
  [SYNC.ERROR]: 'صار خطأ بالمزامنة. بياناتك محفوظة محلياً.',
};

// ApiError and NetworkError both carry a message written for the person
// reading it; anything else is a bug on our side, not something they can act on.
const errorText = (err, fallback) =>
  err instanceof ApiError || err instanceof NetworkError
    ? err.message
    : fallback || 'صار خطأ غير متوقع. حدّث الصفحة وجرّب مرة ثانية.';

/**
 * The programme card. Shown whether or not there is an account: the app is
 * usable signed out, and the goal is the single most important setting in it.
 */
function programmeCard(ctx) {
  const { store } = ctx;
  return el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'acctrow' },
      el('span', { class: 'a', text: 'هدفك' }),
      el('span', { class: 'b', text: goalOf(store.goal).n })
    ),
    el(
      'div',
      { class: 'acctrow' },
      el('span', { class: 'a', text: 'مستواك' }),
      el('span', { class: 'b', text: levelOf(store.level).n })
    ),
    el('button', {
      class: 'cta ghost',
      text: 'عدّل هدفك ومستواك',
      on: { click: () => ctx.editProfile() },
    })
  );
}

export function renderAccount(ctx) {
  const { store } = ctx;

  if (!store.user) {
    // Reached from onboarding's "I already have an account": there is no
    // programme to show yet, and the goal will arrive with their synced data.
    if (store.needsOnboarding) {
      return el(
        'div',
        { class: 'wrap' },
        el('h3', { class: 'first', text: 'سجّل دخولك' }),
        el('div', {
          class: 'hint-lg',
          text: 'ادخل بحسابك وبيجيك برنامجك وكل بياناتك من أجهزتك الثانية.',
        }),
        authForms(ctx),
        el('button', {
          class: 'cta ghost',
          text: 'ما عندي حساب — أبي أسوي برنامج جديد',
          on: { click: () => ctx.editProfile() },
        })
      );
    }
    return el(
      'div',
      { class: 'wrap' },
      el('h3', { class: 'first', text: 'برنامجك' }),
      programmeCard(ctx),
      el('h3', { text: 'حسابك' }),
      authForms(ctx)
    );
  }

  return el(
    'div',
    { class: 'wrap' },
    el('h3', { class: 'first', text: 'برنامجك' }),
    programmeCard(ctx),
    el('h3', { text: 'حسابك' }),
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
    twoFactorCard(ctx),
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

/* ────────────────────────── two-factor ────────────────────────── */

function twoFactorCard(ctx) {
  const { store } = ctx;
  const enabled = !!store.user.totpEnabled;
  const box = el('div', { class: 'card' });

  const heading = el(
    'div',
    { class: 'acctrow' },
    el('span', { class: 'a', text: 'التحقق بخطوتين' }),
    el('span', {
      class: ['pill', enabled ? 'on' : 'off'],
      text: enabled ? 'مفعّل' : 'مو مفعّل',
    })
  );
  box.appendChild(heading);

  const body = el('div', {});
  box.appendChild(body);

  if (!enabled) {
    body.append(
      el('div', {
        class: 'mut',
        text: 'يضيف طبقة ثانية عند الدخول: كلمة السر + رمز متغيّر من تطبيق على جوالك. يعني لو أحد عرف كلمة سرك، ما يقدر يدخل.',
      }),
      el('button', {
        class: 'cta',
        text: 'فعّل التحقق بخطوتين',
        on: { click: () => startSetup(ctx, body) },
      })
    );
    return box;
  }

  const left = store.user.recoveryCodesLeft ?? 0;
  // The helper, not the native append: the warning below is conditional, and
  // Element.append() renders a null child as the literal text "null".
  append(body, [
    el('div', {
      class: 'mut',
      text: `عند الدخول من جهاز جديد بيطلب منك رمز من تطبيق المصادقة. باقي عندك ${left} رمز استرجاع.`,
    }),
    left <= 3
      ? el('div', {
          class: 'formerr',
          text: 'رموز الاسترجاع قاربت تخلص. ولّد رموز جديدة واحفظها.',
        })
      : null,
    el('button', {
      class: 'cta ghost',
      text: 'ولّد رموز استرجاع جديدة',
      on: { click: () => regenerateCodes(ctx, body) },
    }),
    el('button', {
      class: 'cta danger',
      text: 'أوقف التحقق بخطوتين',
      on: { click: () => startDisable(ctx, body) },
    }),
  ]);
  return box;
}

/** Step 1: confirm the password, then show the QR and the manual secret. */
function startSetup(ctx, container) {
  const password = passwordField('كلمة السر الحالية');
  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'كمّل' });

  button.addEventListener('click', async () => {
    message.replaceChildren();
    if (!password.value) {
      return message.replaceChildren(el('div', { class: 'formerr', text: 'اكتب كلمة السر.' }));
    }
    button.disabled = true;
    button.textContent = 'لحظة…';
    try {
      const res = await api.setup2fa(password.value);
      password.value = '';
      showQrStep(ctx, container, res.data);
    } catch (err) {
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      button.disabled = false;
      button.textContent = 'كمّل';
    }
  });

  container.replaceChildren(
    el('div', { class: 'mut', text: 'أكّد كلمة السر عشان نبدأ الإعداد.' }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر' }), password),
    button,
    message,
    cancelButton(ctx)
  );
  password.focus();
}

/** Step 2: scan or type the secret, then prove it with a code. */
function showQrStep(ctx, container, setup) {
  const code = codeField();
  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'تأكيد وتفعيل' });

  const submit = async () => {
    message.replaceChildren();
    if (!/^\d{6}$/.test(code.value.replace(/\s/g, ''))) {
      return message.replaceChildren(
        el('div', { class: 'formerr', text: 'اكتب الرمز المكوّن من 6 أرقام.' })
      );
    }
    button.disabled = true;
    button.textContent = 'لحظة…';
    try {
      const res = await api.enable2fa(code.value);
      showRecoveryCodes(ctx, container, res.data.recoveryCodes, true);
    } catch (err) {
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      button.disabled = false;
      button.textContent = 'تأكيد وتفعيل';
    }
  };
  button.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  container.replaceChildren(
    el('ol', { class: 't steps' },
      el('li', {}, 'نزّل تطبيق مصادقة مثل ', el('b', { text: 'Google Authenticator' }), ' أو Authy.'),
      el('li', {}, 'افتحه واختر إضافة حساب، وامسح هذا الرمز.'),
      el('li', {}, 'اكتب الرمز اللي يطلع لك تحت.')
    ),
    el('div', { class: 'qrbox' }, qrSvg(setup.qr)),
    el('details', { class: 'manual' },
      el('summary', { text: 'ما قدرت تمسح الرمز؟ اكتب المفتاح يدوياً' }),
      el('div', { class: 'secret n', text: groupSecret(setup.secret) }),
      el('div', {
        class: 'mut',
        text: 'اختر «إدخال مفتاح الإعداد» بالتطبيق، والنوع «حسب الوقت» (Time based).',
      })
    ),
    el('label', { class: 'inp ltr' }, el('span', { text: 'الرمز من التطبيق' }), code),
    button,
    message,
    cancelButton(ctx)
  );
  code.focus();
}

function showRecoveryCodes(ctx, container, codes, justEnabled) {
  const list = el(
    'div',
    { class: 'codes' },
    codes.map((c) => el('code', { text: c }))
  );

  const copy = el('button', {
    class: 'cta ghost',
    text: 'انسخ الرموز',
    on: {
      click: async () => {
        try {
          await navigator.clipboard.writeText(codes.join('\n'));
          toast('اننسخت — احفظها بمكان آمن');
        } catch {
          toast('ما قدرنا ننسخ. حددها بيدك وانسخها.');
        }
      },
    },
  });

  container.replaceChildren(
    el('div', {
      class: 'formok',
      text: justEnabled ? 'تم التفعيل ✓' : 'انولدت رموز جديدة — القديمة ما عادت تشتغل.',
    }),
    el('div', {
      class: 'mut',
      text: 'هذي رموز الاسترجاع. لو ضاع جوالك، كل رمز يدخّلك مرة وحدة بس. ما راح تشوفها مرة ثانية — احفظها الحين.',
    }),
    list,
    copy,
    el('button', {
      class: 'cta',
      text: 'حفظتها، كمّل',
      on: {
        click: async () => {
          await ctx.store.refreshUser();
          ctx.refresh();
        },
      },
    })
  );
}

function startDisable(ctx, container) {
  const password = passwordField('كلمة السر');
  const code = codeField();
  const message = el('div', {});
  const button = el('button', { class: 'cta danger', text: 'أوقف التحقق بخطوتين' });

  button.addEventListener('click', async () => {
    message.replaceChildren();
    if (!password.value || !code.value) {
      return message.replaceChildren(el('div', { class: 'formerr', text: 'عبّي الخانتين.' }));
    }
    button.disabled = true;
    try {
      await api.disable2fa(password.value, code.value);
      await ctx.store.refreshUser();
      toast('انوقف التحقق بخطوتين');
      ctx.refresh();
    } catch (err) {
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      button.disabled = false;
    }
  });

  container.replaceChildren(
    el('div', {
      class: 'mut',
      text: 'نحتاج كلمة السر ورمز من التطبيق مع بعض — عشان لو أحد عرف كلمة سرك ما يقدر يوقف الحماية.',
    }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر' }), password),
    el('label', { class: 'inp ltr' }, el('span', { text: 'الرمز أو رمز استرجاع' }), code),
    button,
    message,
    cancelButton(ctx)
  );
}

function regenerateCodes(ctx, container) {
  const password = passwordField('كلمة السر');
  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'ولّد رموز جديدة' });

  button.addEventListener('click', async () => {
    message.replaceChildren();
    if (!password.value) {
      return message.replaceChildren(el('div', { class: 'formerr', text: 'اكتب كلمة السر.' }));
    }
    button.disabled = true;
    try {
      const res = await api.newRecoveryCodes(password.value);
      showRecoveryCodes(ctx, container, res.data.recoveryCodes, false);
    } catch (err) {
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      button.disabled = false;
    }
  });

  container.replaceChildren(
    el('div', { class: 'mut', text: 'الرموز القديمة بتتلغى فوراً.' }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر' }), password),
    button,
    message,
    cancelButton(ctx)
  );
}

const cancelButton = (ctx) =>
  el('button', { class: 'cta ghost', text: 'إلغاء', on: { click: () => ctx.refresh() } });

const passwordField = (placeholder) =>
  el('input', { type: 'password', autocomplete: 'current-password', placeholder });

const codeField = () =>
  el('input', {
    type: 'text',
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    placeholder: '123456',
    maxlength: '14',
    attrs: { autocapitalize: 'characters', spellcheck: 'false' },
  });

/** 32 characters in one run is unreadable; authenticator apps group by four. */
const groupSecret = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

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
  const formCard = el('div', { class: 'card' });

  // Only meaningful when signing in; hidden while registering.
  const forgotLink = el('button', {
    class: 'linkbtn',
    text: 'نسيت كلمة السر؟',
    on: { click: () => showForgotForm(ctx, formCard, emailInput.value.trim()) },
  });

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
          forgotLink.hidden = mode !== 'login';
          message.replaceChildren();
        },
      },
    })
  );

  const setError = (text) => message.replaceChildren(el('div', { class: 'formerr', text }));

  const finish = async (email) => {
    await store.signedIn({ email });
    toast(mode === 'login' ? 'أهلاً بك' : 'انسوّى حسابك');
    navigate('home');
  };

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
      const res =
        mode === 'login' ? await api.login(email, password) : await api.register(email, password);
      passwordInput.value = '';

      // The account has a second factor: swap the whole card for the code step.
      if (res.data?.mfaRequired) {
        showMfaStep(ctx, formCard, finish);
        return;
      }
      await finish(res.data.email);
    } catch (err) {
      setError(errorText(err));
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

  formCard.append(
    el('div', { class: 'authtabs', attrs: { role: 'tablist' } }, tabs),
    el('label', { class: 'inp ltr' }, el('span', { text: 'البريد الإلكتروني' }), emailInput),
    el('label', { class: 'inp ltr' }, el('span', { text: 'كلمة السر (10 خانات فأكثر)' }), passwordInput),
    submitBtn,
    forgotLink,
    message
  );

  return el(
    'div',
    { class: 'authbox' },
    el('h3', { class: 'first', text: 'خلّ بياناتك معك بأي جهاز' }),
    el('div', {
      class: 'hint-lg',
      text: 'سجّل حساب مرة وحدة، وبعدها افتح التطبيق من أي جوال أو كمبيوتر وبتلقى نفس الأوزان ونفس التقدم.',
    }),
    formCard,
    el(
      'div',
      { class: 'card' },
      bulletList([
        [
          { b: 'كلمة السر ما تنحفظ أبداً كنص.' },
          ' تنحفظ مشفّرة بـ scrypt، وحتى لو أحد سرق قاعدة البيانات ما يقدر يرجعها.',
        ],
        [
          { b: 'تقدر تفعّل التحقق بخطوتين' },
          ' بعد ما تسوي حسابك، من نفس هذي الصفحة.',
        ],
        [
          { b: 'تقدر تستخدم التطبيق بدون حساب' },
          ' — بس بياناتك بتبقى على هذا الجهاز لحاله.',
        ],
      ])
    )
  );
}

/** Forgot-password: ask for the email, get a generic "sent if it exists" reply. */
function showForgotForm(ctx, card, prefill) {
  const emailInput = el('input', {
    type: 'email',
    autocomplete: 'username',
    inputmode: 'email',
    placeholder: 'you@example.com',
    attrs: { autocapitalize: 'none', spellcheck: 'false' },
  });
  if (prefill) emailInput.value = prefill;

  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'أرسل رابط إعادة التعيين' });

  const submit = async () => {
    message.replaceChildren();
    const email = emailInput.value.trim();
    if (!email) {
      return message.replaceChildren(el('div', { class: 'formerr', text: 'اكتب بريدك.' }));
    }
    button.disabled = true;
    button.textContent = 'لحظة…';
    try {
      const res = await api.forgotPassword(email);
      // The server answers the same whether or not the email is registered, so
      // just show its message and stop — no retry loop that could leak anything.
      card.replaceChildren(
        el('div', { class: 'formok', text: 'تم ✓' }),
        el('div', {
          class: 'mut',
          text:
            res.data?.message ||
            'لو البريد مسجّل عندنا، بيوصلك رابط لإعادة تعيين كلمة السر خلال دقائق. تأكد من صندوق الوارد ومجلد المهملات (Spam).',
        }),
        el('button', {
          class: 'cta ghost',
          text: 'رجوع لتسجيل الدخول',
          on: { click: () => ctx.refresh() },
        })
      );
    } catch (err) {
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      button.disabled = false;
      button.textContent = 'أرسل رابط إعادة التعيين';
    }
  };

  button.addEventListener('click', submit);
  emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  card.replaceChildren(
    el('div', { class: 'mfahead' }, el('b', { text: 'نسيت كلمة السر؟' })),
    el('div', {
      class: 'mut',
      text: 'اكتب بريدك المسجّل ونرسل لك رابط تختار منه كلمة سر جديدة. الرابط صالح لمدة ساعة.',
    }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'البريد الإلكتروني' }), emailInput),
    button,
    message,
    el('button', { class: 'cta ghost', text: 'إلغاء', on: { click: () => ctx.refresh() } })
  );
  setTimeout(() => emailInput.focus(), 0);
}

/** Second login step: the code from the authenticator, or a recovery code. */
function showMfaStep(ctx, card, finish) {
  const code = codeField();
  const message = el('div', {});
  const button = el('button', { class: 'cta', text: 'تأكيد' });

  const submit = async () => {
    message.replaceChildren();
    if (!code.value.trim()) {
      return message.replaceChildren(el('div', { class: 'formerr', text: 'اكتب الرمز.' }));
    }
    button.disabled = true;
    button.textContent = 'لحظة…';
    try {
      const res = await api.verifyMfa(code.value);
      if (res.data.usedRecovery) {
        toast(`استخدمت رمز استرجاع — باقي ${res.data.recoveryCodesLeft}`);
      }
      await finish(res.data.email);
    } catch (err) {
      const expired = err instanceof ApiError && err.code === 'challenge_expired';
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
      if (expired) {
        // The challenge is gone; the only way forward is to start over.
        button.textContent = 'ارجع لتسجيل الدخول';
        button.disabled = false;
        button.replaceWith(
          el('button', { class: 'cta', text: 'ارجع لتسجيل الدخول', on: { click: () => ctx.refresh() } })
        );
        return;
      }
      code.value = '';
      button.disabled = false;
      button.textContent = 'تأكيد';
      code.focus();
    }
  };

  button.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  card.replaceChildren(
    el('div', { class: 'mfahead' }, el('b', { text: 'خطوة أخيرة' })),
    el('div', {
      class: 'mut',
      text: 'افتح تطبيق المصادقة واكتب الرمز. لو ما معك جوالك، اكتب رمز استرجاع.',
    }),
    el('label', { class: 'inp ltr' }, el('span', { text: 'الرمز' }), code),
    button,
    message,
    el('button', { class: 'cta ghost', text: 'إلغاء', on: { click: () => ctx.refresh() } })
  );
  code.focus();
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
      message.replaceChildren(el('div', { class: 'formerr', text: errorText(err) }));
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
