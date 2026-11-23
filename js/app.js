// Точка входа: запуск, навигация, автоблокировка.
import { h, clear } from './util.js';
import * as vault from './vault.js';
import * as store from './store.js';
import { closeAllSheets } from './sheet.js';
import { renderLock, renderOnboarding } from './views/lock.js';
import { renderHome } from './views/home.js';
import { renderStats } from './views/stats.js';
import { renderSettings } from './views/settings.js';
import { renderPortfolio } from './views/portfolio.js';
import { renderCalendar } from './views/calendar.js';
import { renderPlans } from './views/plans.js';
import { initTheme, applyTheme } from './theme.js';

initTheme();

const app = document.getElementById('app');
const shield = document.getElementById('shield');

const TABS = [
  { id: 'home', label: 'Главная', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', render: renderHome },
  { id: 'calendar', label: 'Календарь', icon: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M12 14h2M16 14h0M8 17h2M12 17h2', render: renderCalendar },
  { id: 'plans', label: 'Дела', icon: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', render: renderPlans },
  { id: 'stats', label: 'Аналитика', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', render: renderStats },
  { id: 'portfolio', label: 'Портфель', icon: 'M3 7h18v13H3zM3 7l2-3h14l2 3M8 12h8M8 16h5', render: renderPortfolio },
  { id: 'settings', label: 'Настройки', wideOnly: true, icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.8 1.7 1l.4 2.5h4l.4-2.5c.6-.2 1.2-.6 1.7-1l2.4 1 2-3.4z', render: (root) => renderSettings(root, { lockNow }) },
];

let current = 'home';
let view = null;
let unsub = null;

function icon(d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tab-ico');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}

function renderView() {
  if (!view) return;
  const tab = TABS.find((t) => t.id === current);
  tab.render(view);
}

function go(id) {
  if (id === current) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  current = id;
  app.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
  window.scrollTo(0, 0);
  renderView();
}

function renderShell() {
  clear(app);
  view = h('main', { class: 'view' });
  const nav = h('nav', { class: 'tabbar', 'aria-label': 'Разделы' },
    TABS.map((t) => h('button', { class: ['tab', t.id === current && 'on', t.wideOnly && 'wide-only'], dataset: { id: t.id }, onclick: () => go(t.id) }, icon(t.icon), h('span', {}, t.label))));
  app.append(h('div', { class: 'shell' }, nav, view));
  renderView();
  unsub?.();
  unsub = store.subscribe(() => requestAnimationFrame(renderView));
}

function onUnlocked() {
  store.onUnlock();
  applyTheme(store.settings().theme || 'auto');
  renderShell();
  store.refreshMarket().catch(() => {});
}

// автообновление курсов, пока открыт портфель: крипта (BTC и т.п.) без фиксированного курса
const LIVE_MS = 60 * 1000;
setInterval(() => {
  if (!vault.isUnlocked() || document.hidden || current !== 'portfolio') return;
  if (!store.settings()?.livePrices) return;
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return; // не сбивать ввод перерисовкой
  store.refreshMarket(false, LIVE_MS - 5000).catch(() => {});
}, LIVE_MS);

function lockNow() {
  closeAllSheets();
  unsub?.();
  unsub = null;
  view = null;
  vault.lock();
  renderLock(app, onUnlocked);
}

window.addEventListener('nav', (e) => { if (view) go(e.detail); });

// ---------- автоблокировка и защита от подглядывания в переключателе приложений ----------
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    shield.classList.add('on');
    hiddenAt = Date.now();
    if (vault.isUnlocked() && (store.settings()?.lockAfter ?? 0) === 0) lockNow();
  } else {
    if (vault.isUnlocked()) {
      const after = store.settings()?.lockAfter ?? 0;
      if (Date.now() - hiddenAt > after * 1000) lockNow();
    }
    setTimeout(() => shield.classList.remove('on'), 60);
  }
});
window.addEventListener('pagehide', () => { if (vault.isUnlocked()) lockNow(); });

// перерисовка графиков при изменении ширины
let rt;
let lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    if (Math.abs(window.innerWidth - lastW) > 40 && current === 'stats') renderView();
    lastW = window.innerWidth;
  }, 200);
});

// ---------- запуск ----------
async function boot() {
  if (!window.crypto?.subtle || !window.indexedDB) {
    app.append(h('div', { class: 'empty' }, 'Браузер не поддерживает шифрование. Откройте приложение в Safari через HTTPS.'));
    return;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (await vault.isSetUp()) renderLock(app, onUnlocked);
  else renderOnboarding(app, onUnlocked);
}

boot();
