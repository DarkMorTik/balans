// Общие утилиты: создание DOM без innerHTML (защита от XSS), форматирование, даты.

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style') {
      for (const [sk, sv] of Object.entries(v)) if (sv != null) el.style.setProperty(sk, String(sv));
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    else if (k === 'ref' && typeof v === 'function') v(el);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Создать HTML-элемент. Текст всегда вставляется как textNode. */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

/** Создать SVG-элемент. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props);
  appendChildren(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function uid() {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- Деньги ----------
const nfCache = new Map();
function nf(cur, maxFrac) {
  const key = cur + maxFrac;
  if (!nfCache.has(key)) {
    let f;
    try {
      f = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
    } catch {
      const n = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: maxFrac });
      f = { format: (v) => `${n.format(v)} ${cur}` };
    }
    nfCache.set(key, f);
  }
  return nfCache.get(key);
}

export function money(v, cur, { sign = false, frac } = {}) {
  const abs = Math.abs(v);
  const maxFrac = frac ?? (abs >= 10000 ? 0 : 2);
  const str = nf(cur, maxFrac).format(abs);
  if (sign) return (v < 0 ? '−' : v > 0 ? '+' : '') + str;
  return (v < 0 ? '−' : '') + str;
}

const compactNf = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (v) => compactNf.format(v);

export function currencySymbol(cur) {
  try {
    const parts = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: cur }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || cur;
  } catch {
    return cur;
  }
}

/** Разобрать ввод суммы: «1 200,50» → 1200.5. Поддерживает простые выражения 120+45. */
export function parseAmount(str) {
  if (!str) return NaN;
  const clean = String(str).replace(/\s/g, '').replace(/,/g, '.').replace(/[^\d.+\-*/]/g, '');
  if (!clean) return NaN;
  if (/^[\d.]+$/.test(clean)) return Number(clean);
  // безопасный разбор суммы/разности/умножения без eval
  const tokens = clean.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!tokens) return NaN;
  let terms = [];
  let cur = null, op = '+', mulOp = null;
  const pushTerm = (v) => terms.push(op === '-' ? -v : v);
  for (const t of tokens) {
    if (/[+\-]/.test(t)) {
      if (cur == null) return NaN;
      pushTerm(cur); cur = null; op = t; mulOp = null;
    } else if (/[*/]/.test(t)) {
      if (cur == null) return NaN;
      mulOp = t;
    } else {
      const n = Number(t);
      if (cur != null && mulOp) { cur = mulOp === '*' ? cur * n : cur / n; mulOp = null; }
      else cur = n;
    }
  }
  if (cur == null) return NaN;
  pushTerm(cur);
  return terms.reduce((a, b) => a + b, 0);
}

// ---------- Даты (локальные, ключ YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}
export function diffDays(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}
export function monthStart(key) { return key.slice(0, 8) + '01'; }
export function addMonths(key, n) {
  const d = parseDay(monthStart(key));
  d.setMonth(d.getMonth() + n);
  return dayKey(d);
}
export function daysInMonth(key) {
  const d = parseDay(key);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
export function weekStart(key) {
  const d = parseDay(key);
  const wd = (d.getDay() + 6) % 7; // понедельник = 0
  d.setDate(d.getDate() - wd);
  return dayKey(d);
}
export const weekday = (key) => (parseDay(key).getDay() + 6) % 7;

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
export const WEEKDAYS_PLURAL = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const monthName = (key) => MONTHS[parseDay(key).getMonth()];
export const monthShort = (key) => MONTHS_SHORT[parseDay(key).getMonth()];

export function dayTitle(key, today = dayKey()) {
  if (key === today) return 'Сегодня';
  if (key === addDays(today, -1)) return 'Вчера';
  const d = parseDay(key);
  const t = parseDay(today);
  const wd = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.getDay()];
  const base = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
  return d.getFullYear() === t.getFullYear() ? `${base}, ${wd}` : `${base} ${d.getFullYear()}`;
}
export function shortDate(key) {
  const d = parseDay(key);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** Склонение: plural(5, 'операция', 'операции', 'операций') */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function haptic() {
  try { navigator.vibrate?.(8); } catch { /* iOS не поддерживает — ок */ }
}

export function firstGrapheme(str) {
  if (!str) return '';
  try {
    const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
    const it = seg.segment(str.trim())[Symbol.iterator]().next();
    return it.done ? '' : it.value.segment;
  } catch {
    return Array.from(str.trim())[0] || '';
  }
}
