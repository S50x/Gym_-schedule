/**
 * البريد — إرسال بريد المعاملات عبر Resend (HTTP API، بدون مكتبات).
 *
 * Transactional email through Resend's HTTP API. One integration point, like
 * the database: set RESEND_API_KEY and a from-address and it sends; leave the
 * key unset and every call is a no-op that says so, so the app boots and the
 * reset endpoints still answer without ever crashing on a missing provider.
 *
 * No dependency: the whole client is one `fetch`. Resend was chosen for exactly
 * this — a single POST with a bearer token, no SMTP handshake to hand-roll.
 */

import { config } from './config.js';

/**
 * Outside production only, keep the last few messages that were built so the
 * test suite and local dev can read what *would* have been sent without a live
 * provider. Never populated when NODE_ENV=production, so a real reset link never
 * lingers in process memory in prod.
 */
const OUTBOX_MAX = 20;
const outbox = [];

export function peekOutbox() {
  return outbox.slice();
}
export function drainOutbox() {
  return outbox.splice(0);
}
export function mailConfigured() {
  return !!config.mail.resendApiKey;
}

/** Build and send the password-reset message. */
export async function sendPasswordReset(to, link) {
  const subject = 'إعادة تعيين كلمة السر — حديد';
  const text = [
    'وصلنا طلب لإعادة تعيين كلمة السر لحسابك في حديد.',
    '',
    'افتح هذا الرابط لاختيار كلمة سر جديدة (صالح لمدة ساعة وحدة):',
    link,
    '',
    'لو ما طلبت هذا، تجاهل الرسالة — كلمة سرك ما تغيّرت.',
  ].join('\n');

  // The link is the only variable, and it is our own origin + an opaque token,
  // so there is no user-supplied text to escape into this HTML.
  const html = [
    '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;direction:rtl;text-align:right;max-width:520px;margin:auto;color:#111">',
    '<h2 style="margin:0 0 12px">إعادة تعيين كلمة السر</h2>',
    '<p style="margin:0 0 16px;line-height:1.7">وصلنا طلب لإعادة تعيين كلمة السر لحسابك في <b>حديد</b>. اضغط الزر لاختيار كلمة سر جديدة. الرابط صالح لمدة ساعة وحدة.</p>',
    `<p style="margin:0 0 20px"><a href="${link}" style="display:inline-block;background:#b6ff2e;color:#111;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700">اختر كلمة سر جديدة</a></p>`,
    '<p style="margin:0 0 8px;color:#555;font-size:13px;line-height:1.7">لو ما اشتغل الزر، انسخ هذا الرابط والصقه في المتصفح:</p>',
    `<p style="margin:0 0 20px;word-break:break-all;font-size:13px"><a href="${link}" style="color:#2563eb">${link}</a></p>`,
    '<p style="margin:0;color:#888;font-size:12px;line-height:1.7">لو ما طلبت هذا، تجاهل الرسالة — كلمة سرك ما تغيّرت.</p>',
    '</div>',
  ].join('');

  return send({ to, subject, text, html });
}

async function send({ to, subject, text, html }) {
  if (!config.isProd) {
    outbox.push({ to, subject, text, html, at: Date.now() });
    if (outbox.length > OUTBOX_MAX) outbox.shift();
  }

  if (!config.mail.resendApiKey) {
    // No provider wired up. In dev the outbox above holds the link; in prod this
    // is a misconfiguration to log loudly rather than an error that should take
    // the reset endpoint down.
    if (config.isProd) {
      console.warn('[mail] RESEND_API_KEY unset — a password reset email was dropped');
    }
    return { sent: false, reason: 'not_configured' };
  }

  try {
    const res = await fetch(config.mail.resendApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.mail.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout?.(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[mail] Resend responded ${res.status}: ${body.slice(0, 300)}`);
      return { sent: false, reason: 'provider_error', status: res.status };
    }
    return { sent: true };
  } catch (err) {
    console.error('[mail] send failed:', err?.message);
    return { sent: false, reason: 'network' };
  }
}
