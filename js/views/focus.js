// Фокус-таймер (помодоро). Время считается от момента окончания, поэтому таймер
// переживает сворачивание и блокировку приложения.
import { h, clear, dayKey, addDays, WEEKDAYS_SHORT, weekday, haptic } from '../util.js';
import * as store from '../store.js';
import { toast } from '../sheet.js';

const KEY = 'balans-focus';
const PRESETS = [[25, 5], [50, 10], [15, 3]];

// В localStorage (без шифрования) хранится только время таймера.
// Название задачи — личные данные, поэтому оно живёт только в памяти.
function load() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY));
    return t ? { ...t, label: '' } : null;
  } catch { return null; }
}
function persist(t) {
  try {
    if (!t) { localStorage.removeItem(KEY); return; }
    const { label, ...safe } = t;
    localStorage.setItem(KEY, JSON.stringify(safe));
  } catch { /* нет доступа */ }
}

// состояние: { mode: 'focus'|'break', minutes, breakMin, endAt|null, left (сек, на паузе), label }
let T = load() || { mode: 'focus', minutes: 25, breakMin: 5, endAt: null, left: 25 * 60, label: '' };
let tick = null;

const secsLeft = () => (T.endAt ? Math.max(0, Math.round((T.endAt - Date.now()) / 1000)) : T.left);
const total = () => (T.mode === 'focus' ? T.minutes : T.breakMin) * 60;

function finish() {
  const wasFocus = T.mode === 'focus';
  if (wasFocus) store.logFocus(T.minutes);
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* iOS */ }
  T = { ...T, mode: wasFocus ? 'break' : 'focus', endAt: null, left: (wasFocus ? T.breakMin : T.minutes) * 60 };
  persist(T);
  toast(wasFocus ? `Фокус ${T.minutes} мин завершён — перерыв ${T.breakMin} мин` : 'Перерыв окончен — снова в фокус');
}

export function renderFocus(body) {
  clear(body);
  const st = store.state();
  const ringBox = h('div', { class: 'focus-ring' });
  const timeEl = h('div', { class: 'focus-time mono' });
  const modeEl = h('div', { class: 'micro focus-mode' });
  const startBtn = h('button', { class: 'btn btn-primary focus-start' });
  const size = 230, r = 104, C = 2 * Math.PI * r;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'focus-svg');
  const mk = (cls) => { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', size / 2); c.setAttribute('cy', size / 2); c.setAttribute('r', r); c.setAttribute('class', cls); svg.append(c); return c; };
  mk('ring-bg focus-bg');
  const fg = mk('ring-fg focus-fg');
  fg.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  ringBox.append(svg, h('div', { class: 'focus-center' }, modeEl, timeEl));

  function paint() {
    if (T.endAt && secsLeft() <= 0) finish();
    const left = secsLeft();
    const m = Math.floor(left / 60), sec = left % 60;
    timeEl.textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    modeEl.textContent = T.mode === 'focus' ? (T.label ? `фокус · ${T.label}` : 'фокус') : 'перерыв';
    fg.setAttribute('stroke-dasharray', `${C * (1 - left / total())} ${C}`);
    ringBox.classList.toggle('is-break', T.mode === 'break');
    startBtn.textContent = T.endAt ? 'Пауза' : left < total() ? 'Продолжить' : T.mode === 'focus' ? 'Начать фокус' : 'Начать перерыв';
    if (!body.isConnected) { clearInterval(tick); tick = null; }
  }
  startBtn.addEventListener('click', () => {
    haptic();
    if (T.endAt) T = { ...T, left: secsLeft(), endAt: null };
    else T = { ...T, endAt: Date.now() + secsLeft() * 1000 };
    persist(T);
    paint();
  });

  const presets = h('div', { class: 'kind-row focus-presets' }, PRESETS.map(([f, b]) => h('button', {
    class: ['chip', T.minutes === f && 'active'],
    onclick: () => { T = { mode: 'focus', minutes: f, breakMin: b, endAt: null, left: f * 60, label: T.label }; persist(T); renderFocus(body); },
  }, `${f} / ${b}`)));

  // на что фокус: сегодняшние задачи
  const today = dayKey();
  const tasks = (st.tasks || []).filter((t) => (t.repeat || 'none') === 'none' ? t.date === today && !t.done : false).slice(0, 6);
  const labels = tasks.length ? h('div', { class: 'kind-row' }, tasks.map((t) => h('button', {
    class: ['chip', 'small', T.label === t.title && 'active'], onclick: () => { T.label = T.label === t.title ? '' : t.title; persist(T); renderFocus(body); },
  }, t.title))) : null;

  // статистика за неделю
  const focus = st.focus || {};
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const max = Math.max(25, ...days.map((d) => focus[d] || 0));
  const week = days.reduce((a, d) => a + (focus[d] || 0), 0);
  const stats = h('div', { class: 'card pad' },
    h('div', { class: 'section-head' }, h('span', { class: 'micro' }, 'Фокус за неделю'), h('span', { class: 'mono' }, `${Math.floor(week / 60)} ч ${week % 60} мин`)),
    h('div', { class: 'focus-bars' }, days.map((d) => h('div', { class: 'fb' },
      h('span', { class: 'fb-val mono' }, focus[d] ? focus[d] : ''),
      h('span', { class: 'fb-track' }, h('i', { style: { '--h': `${Math.round(((focus[d] || 0) / max) * 100)}%` }, class: d === today ? 'today' : '' })),
      h('span', { class: 'micro' }, WEEKDAYS_SHORT[weekday(d)])))),
    h('p', { class: 'muted small' }, `Сегодня: ${focus[today] || 0} мин. Засчитываются только завершённые сессии.`));

  body.append(ringBox, startBtn,
    h('button', { class: 'btn btn-plain', onclick: () => { T = { ...T, mode: 'focus', endAt: null, left: T.minutes * 60 }; persist(T); paint(); } }, 'Сбросить'),
    h('div', { class: 'section-label micro' }, 'Фокус / перерыв, минут'), presets,
    labels ? h('div', { class: 'section-label micro' }, 'На чём фокус') : null, labels,
    stats);
  paint();
  clearInterval(tick);
  tick = setInterval(paint, 1000);
}
