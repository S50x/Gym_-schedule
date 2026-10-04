/**
 * قراءة الأكل من صورة: شاشة المفتاح وزر الصورة داخل الوجبة.
 *
 * The scan runs on the trainee's own free Gemini key, so the first thing
 * anyone without one sees is how to get one — written for someone who has
 * never heard the words "API key", with a button straight to Google's page.
 */

import { el } from '../dom.js';
import { toast } from '../ui.js';
import { api, ApiError, NetworkError } from '../api.js';
import { knownFood } from '../engine.js';

const GOOGLE_KEY_PAGE = 'https://aistudio.google.com/api-keys';

/** What the server said about the key, fetched once and refreshed on change. */
let keyState = null;
async function loadKeyState(force = false) {
  if (keyState && !force) return keyState;
  const { data } = await api.foodKey();
  keyState = data;
  return keyState;
}

const message = (err) =>
  err instanceof NetworkError || err instanceof ApiError ? err.message : 'صار خطأ. جرّب مرة ثانية.';

/** The four steps, plus the button that opens Google's key page. */
export function keyGuide() {
  return el(
    'div',
    { class: 'kguide' },
    el('a', {
      class: 'cta',
      href: GOOGLE_KEY_PAGE,
      target: '_blank',
      rel: 'noopener noreferrer',
      text: 'افتح صفحة Google لإنشاء المفتاح ↗',
    }),
    el(
      'ol',
      { class: 'ksteps' },
      el('li', { text: 'سجّل دخول بحساب Gmail حقك.' }),
      el('li', {}, 'اضغط الزر الأزرق ', el('b', { text: 'Create API key' }), '.'),
      el('li', { text: 'انسخ المفتاح اللي يطلع لك (يبدأ غالباً بـ AIza).' }),
      el('li', { text: 'ارجع هنا، اضغط «لصق»، وبعدين «حفظ».' })
    ),
    el('div', {
      class: 'mut',
      text: 'المفتاح مجاني من Google. ينحفظ عندنا مشفّر وما يظهر لأحد، وتقدر تحذفه متى ما بغيت. ملاحظة: بالخطة المجانية Google ممكن تستخدم الصور اللي ترسلها لتحسين خدماتها.',
    })
  );
}

/** Account → "قراءة الأكل بالصور": status, paste, save, delete. */
export function geminiKeyCard() {
  const card = el('div', { class: 'card' });

  const paint = (state, note) => {
    if (state?.saved) {
      card.replaceChildren(
        el('b', { text: 'قراءة الأكل بالصور' }),
        el('div', { class: 'formok', text: `تم ✓ المفتاح شغّال  •••• ${state.last4}` }),
        el('div', {
          class: 'mut',
          text: 'صوّر ملصق القيم الغذائية، أو سكرين شوت من تطبيق ثاني، أو الأكل نفسه — من صفحة الأكل.',
        }),
        el('button', {
          class: 'cta ghost',
          text: 'احذف المفتاح',
          on: {
            click: async () => {
              if (!confirm('تحذف مفتاح Gemini؟ قراءة الصور بتوقف لين تحط مفتاح جديد.')) return;
              try {
                const { data } = await api.deleteFoodKey();
                keyState = data;
                paint(data);
              } catch (err) {
                toast(message(err));
              }
            },
          },
        })
      );
      return;
    }

    const input = el('input', {
      type: 'password',
      placeholder: 'الصق المفتاح هنا',
      autocomplete: 'off',
      attrs: { 'aria-label': 'مفتاح Gemini', spellcheck: 'false', autocapitalize: 'off' },
    });
    const status = el('div', {});
    if (note) status.replaceChildren(el('div', { class: 'formerr', text: note }));

    const pasteBtn = el('button', {
      class: 'cta ghost',
      text: 'لصق',
      on: {
        click: async () => {
          try {
            input.value = (await navigator.clipboard.readText()).trim();
          } catch {
            // Clipboard reading needs permission some browsers never grant;
            // a long-press paste into the box still works.
            input.focus();
            toast('اضغط مطوّل على الخانة واختر لصق');
          }
        },
      },
    });
    const saveBtn = el('button', { class: 'cta', text: 'حفظ' });
    saveBtn.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) return toast('الصق المفتاح أول');
      saveBtn.disabled = true;
      status.replaceChildren(el('div', { class: 'mut', text: 'أتأكد من المفتاح مع Google…' }));
      try {
        const { data } = await api.saveFoodKey(key);
        keyState = data;
        toast('تم ✓ المفتاح شغّال');
        paint(data);
      } catch (err) {
        status.replaceChildren(el('div', { class: 'formerr', text: message(err) }));
      } finally {
        saveBtn.disabled = false;
      }
    });

    card.replaceChildren(
      el('b', { text: 'قراءة الأكل بالصور' }),
      el('div', {
        class: 'mut',
        text: 'بدل ما تكتب السعرات بيدك: صوّر الملصق أو الأكل، والتطبيق يعبّي الاسم والأرقام. تحتاج مفتاح Google Gemini مجاني — خطوات بسيطة:',
      }),
      keyGuide(),
      el('label', { class: 'inp ltr' }, el('span', { text: 'مفتاح Gemini' }), input),
      el('div', { class: 'krow' }, pasteBtn, saveBtn),
      status
    );
  };

  card.replaceChildren(el('div', { class: 'mut', text: '…' }));
  loadKeyState(true)
    .then((state) => paint(state))
    .catch(() => paint(null, 'ما قدرت أتأكد من حالة المفتاح — تأكد من الاتصال.'));
  return card;
}

/* ────────────────────────── the image ────────────────────────── */

const MAX_SIDE = [1280, 1024, 800];
const MAX_BASE64 = 540_000;

/** Shrink a photo to a JPEG small enough to send; labels stay legible at 1280px. */
async function toJpegBase64(file) {
  const bitmap = await createImageBitmap(file);
  try {
    for (const side of MAX_SIDE) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      if (data.length <= MAX_BASE64) return data;
    }
  } finally {
    bitmap.close?.();
  }
  throw new Error('too big');
}

const SOURCE = { label: 'label', screenshot: 'screen', food: 'photo' };

/**
 * The "اقرأ من صورة" control above a meal form. Fills the form with whatever
 * was read; anything not found stays empty and highlighted for the user.
 */
export function scanActions(ctx, form) {
  const { store } = ctx;
  const box = el('div', { class: 'scan' });

  if (!store.user) {
    box.replaceChildren(
      el('div', { class: 'mut', text: 'سجّل دخول (من صفحة الحساب) عشان تقدر تعبّي الوجبة من صورة.' })
    );
    return box;
  }

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/*',
    class: 'vh',
    attrs: { 'aria-label': 'اختر صورة' },
  });
  const info = el('div', {});
  const button = el('button', {
    class: 'cta ghost scanbtn',
    text: '📷 عبّي من صورة (ملصق، سكرين شوت، أو الأكل)',
    attrs: { type: 'button' },
  });

  const showGuide = () =>
    info.replaceChildren(
      el('div', { class: 'mut', text: 'تحتاج مفتاح Gemini مجاني أول مرة بس:' }),
      keyGuide(),
      el('button', {
        class: 'cta ghost',
        text: 'حط المفتاح في صفحة الحساب ←',
        on: { click: () => ctx.navigate('account') },
      })
    );

  button.addEventListener('click', async () => {
    try {
      const state = await loadKeyState();
      if (!state?.saved) return showGuide();
    } catch (err) {
      return toast(message(err));
    }
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    button.disabled = true;
    info.replaceChildren(el('div', { class: 'mut', text: 'أقرأ الصورة…' }));
    try {
      const image = await toJpegBase64(file);
      const { data: r } = await api.scanFood(image);
      const lines = [];
      // A food the trainee has saved before fills with their own numbers —
      // the ones they corrected last time — rather than this scan's guess.
      const known = knownFood(store.doc.foods, r.name);
      if (known) {
        form.fill({ n: known.n, k: known.k, p: known.p, f: known.f, c: known.c, src: SOURCE[r.kind] || 'photo' });
        lines.push('هذي أكلة سجّلتها قبل — عبّيتها بأرقامك المحفوظة.');
        info.replaceChildren(...lines.map((text) => el('div', { class: 'mut', text })));
        return;
      }
      form.fill({ n: r.name, k: r.kcal, p: r.protein, f: r.fat, c: r.carbs, src: SOURCE[r.kind] || 'photo' });
      if (r.kind === 'unknown') lines.push('ما لقيت أكل واضح بالصورة — عبّي الأرقام بيدك.');
      if (r.per === '100g') lines.push('الأرقام لكل 100 جرام — عدّلها حسب اللي أكلته.');
      if (r.serving) lines.push(`الحصة: ${r.serving}`);
      if (r.kind === 'food') lines.push('تقدير من شكل الأكل — راجع الأرقام قبل الحفظ.');
      if ([r.name, r.kcal, r.protein, r.fat, r.carbs].some((v) => v === null)) {
        lines.push('الخانات الملوّنة ما قدرت أقراها — عبّيها أنت.');
      }
      if (r.note) lines.push(r.note);
      info.replaceChildren(...lines.map((text) => el('div', { class: 'mut', text })));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'no_key') {
        keyState = null;
        return showGuide();
      }
      info.replaceChildren(
        el('div', { class: 'formerr', text: err.message === 'too big' ? 'الصورة كبيرة زيادة. جرّب صورة ثانية.' : message(err) })
      );
    } finally {
      button.disabled = false;
    }
  });

  box.replaceChildren(button, fileInput, info);
  return box;
}
