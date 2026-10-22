/**
 * يبقي السيرفر صاحي على الاستضافة المجانية.
 *
 * A free Render web service is stopped after about fifteen minutes with no
 * inbound request, and the next visitor waits the best part of a minute — or,
 * now and then, the wake fails and they sit on Render's loading page. Asking
 * our own public URL for /api/health every ten minutes counts as inbound
 * traffic, so the instance never goes idle long enough to be stopped.
 *
 * It goes through the public URL on purpose: a request to localhost never
 * reaches Render's proxy, and the proxy is what decides the service is idle.
 *
 * Off unless KEEP_AWAKE=1. A month of one always-on instance is ~744 hours,
 * inside the free plan's 750 — but only with one free service on the account,
 * which is a decision for whoever owns it, not a default.
 */

export const KEEP_AWAKE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Where to ping, or null when keep-awake is off or there is nowhere valid to
 * send it. RENDER_EXTERNAL_URL is set by Render itself; ORIGIN is the fallback.
 */
export function keepAwakeUrl(env = process.env) {
  if (env.KEEP_AWAKE !== '1') return null;
  const base = env.KEEP_AWAKE_URL || env.RENDER_EXTERNAL_URL || env.ORIGIN || '';
  let url;
  try {
    url = new URL('/api/health', base);
  } catch {
    return null;
  }
  return url.protocol === 'https:' ? url.href : null;
}

/**
 * Pings `url` every `intervalMs`. Returns the timer so shutdown can clear it.
 * A failed ping is logged once, then quietly until one succeeds again — a
 * flaky minute must not fill the log with the same line every ten minutes.
 */
export function startKeepAwake(
  url,
  { intervalMs = KEEP_AWAKE_INTERVAL_MS, fetchImpl = fetch, log = console } = {}
) {
  let failing = false;
  const ping = async () => {
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': 'hadeed-keep-awake' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (failing) log.log('keep-awake: back to normal');
      failing = false;
    } catch (err) {
      if (!failing) log.warn(`keep-awake: ping failed (${err.message})`);
      failing = true;
    }
  };
  const timer = setInterval(ping, intervalMs);
  // Never the thing keeping the process alive on its own.
  timer.unref?.();
  return timer;
}
