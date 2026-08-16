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
import { CARDIO, MAX_MACHINES_PER_DAY, machinesOfDay, splitMinutes } from './program.js';

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

  /**
   * Add or remove a machine for one cardio day.
   *
   * The day's minutes are re-split evenly on every change, so picking a second
   * machine immediately halves the session instead of leaving it at zero.
   * Minutes the user set by hand are replaced — that is the intent of adding
   * or dropping a machine.
   */
  toggleMachine(index, key) {
    const total = CARDIO[index]?.[3] || 0;
    store.update(store.viewWeek, (w) => {
      const machines = { ...w.cmach };
      const current = machinesOfDay(machines[String(index)], total);
      const without = current.filter((m) => m.k !== key);

      let next;
      if (without.length !== current.length) next = without; // was on → drop it
      else if (current.length >= MAX_MACHINES_PER_DAY) next = current;
      else next = [...current, { k: key, m: 0 }];

      if (!next.length) {
        delete machines[String(index)];
      } else {
        const share = splitMinutes(total, next.length);
        machines[String(index)] = next.map((m, i) => ({ k: m.k, m: share[i] }));
      }
      w.cmach = machines;
    });
    buzz(20);
    render();
  },

  setMachineMinutes(index, key, minutes) {
    const value = Math.max(0, Math.min(300, Math.round(minutes)));
    const total = CARDIO[index]?.[3] || 0;
    store.update(store.viewWeek, (w) => {
      const machines = { ...w.cmach };
      const current = machinesOfDay(machines[String(index)], total);
      if (!current.some((m) => m.k === key)) return;
      machines[String(index)] = current.map((m) => (m.k === key ? { ...m, m: value } : m));
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
