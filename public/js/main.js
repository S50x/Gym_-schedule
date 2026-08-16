import { clear } from './dom.js';
import { toast, primeAudio, buzz } from './ui.js';
import { store, SYNC } from './store.js';
import { GymMode } from './gym.js';
import { renderHome } from './views/home.js';
import { renderCardio } from './views/cardio.js';
import { renderWeek } from './views/week.js';
import { renderNutri } from './views/nutri.js';
import { renderAccount } from './views/account.js';
import { MAX_WEEK } from './engine.js';

const VIEWS = {
  home: renderHome,
  cardio: renderCardio,
  week: renderWeek,
  nutri: renderNutri,
  account: renderAccount,
};

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');
let view = 'home';
let gym = null;
let painting = false;

function paintTabs() {
  if (!tabbar) return;
  for (const tab of tabbar.querySelectorAll('.tab')) {
    const on = tab.dataset.view === view;
    tab.classList.toggle('on', on);
    tab.setAttribute('aria-current', on ? 'page' : 'false');
  }
}

const ctx = {
  store,

  navigate(next) {
    view = VIEWS[next] ? next : 'home';
    render();
    window.scrollTo(0, 0);
  },

  setWeek(n) {
    const target = Math.min(MAX_WEEK, Math.max(1, Math.floor(n)));
    // Browsing does NOT move the training week. The original persisted every
    // arrow tap, so peeking at week 1 left you stuck there on the next launch.
    store.viewWeek = target;
    render();
  },

  refresh: () => render(),

  toggleCardio(index) {
    store.update(store.viewWeek, (w) => {
      const cardio = { ...w.cardio };
      if (cardio[String(index)]) delete cardio[String(index)];
      else cardio[String(index)] = true;
      w.cardio = cardio;
    });
    buzz(25);
    render();
  },

  toggleMachine(index, key) {
    store.update(store.viewWeek, (w) => {
      const machines = { ...w.cmach };
      if (machines[String(index)] === key) delete machines[String(index)];
      else machines[String(index)] = key;
      w.cmach = machines;
    });
    render();
  },

  openGym(day) {
    if (store.viewWeek !== store.currentWeek) {
      toast(`تسجّل على أسبوع ${store.viewWeek}`);
    }
    gym?.open(day);
  },
};

function render() {
  if (painting) return;
  painting = true;
  try {
    const node = VIEWS[view](ctx);
    clear(app);
    app.appendChild(node);
    paintTabs();
  } catch (err) {
    console.error(err);
    clear(app);
    const fallback = document.createElement('div');
    fallback.className = 'wrap';
    fallback.textContent = 'صار خطأ بعرض الصفحة. حدّث الصفحة.';
    app.appendChild(fallback);
  } finally {
    painting = false;
  }
}

/* ── boot ────────────────────────────────────────────────── */

async function boot() {
  gym = new GymMode(ctx);

  tabbar?.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (tab) ctx.navigate(tab.dataset.view);
  });

  store.addEventListener('change', () => {
    if (!gym?.state) render();
  });
  store.addEventListener('storage-error', () => {
    toast('⚠ ما انحفظ — ذاكرة المتصفح ممتلئة أو مقفلة');
  });
  store.addEventListener('sync', () => {
    if (view === 'home' || view === 'account') {
      if (!gym?.state) render();
    }
  });

  // Any tap counts as the user gesture that lets iOS play the rest-timer beep.
  document.addEventListener('pointerdown', () => primeAudio(), { once: true });

  render();
  await store.init();
  render();

  if (store.syncState === SYNC.ERROR) toast('ما قدرنا نتزامن مع السيرفر — بياناتك محفوظة محلياً.');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline caching is a bonus, not a requirement */
    });
  }
}

boot();
