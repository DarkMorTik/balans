// Данные приложения и операции над ними. Все изменения сохраняются в зашифрованном виде.
import * as vault from './vault.js';
import { uid, round2, dayKey } from './util.js';

export const COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#63e6e2', '#40c8e0', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ac8e68', '#8e8e93'];

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'UAH', 'KZT', 'BYN', 'GEL', 'AMD', 'UZS', 'KGS', 'TRY', 'AED', 'THB', 'CNY', 'GBP', 'PLN', 'USDT'];

const DEFAULT_CATEGORIES = [
  ['Продукты', '🛒', 'expense', '#30d158'],
  ['Кафе', '☕', 'expense', '#ff9f0a'],
  ['Такси', '🚕', 'expense', '#ffd60a'],
  ['Транспорт', '🚇', 'expense', '#40c8e0'],
  ['Покупки', '🛍️', 'expense', '#bf5af2'],
  ['Дом', '🏠', 'expense', '#ac8e68'],
  ['Связь', '📱', 'expense', '#0a84ff'],
  ['Здоровье', '💊', 'expense', '#ff375f'],
  ['Развлечения', '🎬', 'expense', '#5e5ce6'],
  ['Подписки', '🔁', 'expense', '#63e6e2'],
  ['Зарплата', '💼', 'income', '#30d158'],
  ['Подработка', '🧰', 'income', '#0a84ff'],
  ['Торговля', '📈', 'both', '#ff9f0a'],
  ['Обмен валюты', '💱', 'both', '#40c8e0'],
  ['Подарки', '🎁', 'both', '#ff453a'],
  ['Другое', '•', 'both', '#8e8e93'],
];

export function initialState(base = 'RUB') {
  return {
    v: 1,
    settings: {
      base,
      currencies: [base],
      rates: { [base]: 1 },
      lastCurrency: base,
      lockAfter: 0, // секунд в фоне до блокировки
    },
    categories: DEFAULT_CATEGORIES.map(([name, icon, type, color]) => ({ id: uid(), name, icon, type, color, limit: 0 })),
    txns: [],
    dismissed: [],
  };
}

// ---------- события ----------
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() {
  const p = vault.save();
  listeners.forEach((fn) => fn());
  return p;
}

export const state = () => vault.getState();
export const settings = () => state().settings;
export const base = () => settings().base;

export function category(id) {
  return state().categories.find((c) => c.id === id) || { id: '', name: 'Без ярлыка', icon: '•', color: '#8e8e93', type: 'both' };
}
export function categoriesFor(type) {
  return state().categories.filter((c) => c.type === 'both' || c.type === type);
}

export function rate(cur) {
  return cur === base() ? 1 : settings().rates[cur] || 0;
}

/** Сумма операции в основной валюте. */
export const inBase = (t) => round2(t.amount * (t.currency === base() ? 1 : t.rate || 0));

// ---------- операции ----------
export function saveTxn(data) {
  const st = state();
  const t = {
    id: data.id || uid(),
    type: data.type,
    amount: round2(data.amount),
    currency: data.currency,
    rate: data.currency === st.settings.base ? 1 : Number(data.rate) || 0,
    categoryId: data.categoryId,
    note: (data.note || '').trim().slice(0, 200),
    date: data.date || dayKey(),
    createdAt: data.createdAt || Date.now(),
  };
  const i = st.txns.findIndex((x) => x.id === t.id);
  if (i >= 0) st.txns[i] = t;
  else st.txns.push(t);
  st.settings.lastCurrency = t.currency;
  if (t.currency !== st.settings.base && t.rate > 0) st.settings.rates[t.currency] = t.rate;
  return changed();
}

export function deleteTxn(id) {
  const st = state();
  st.txns = st.txns.filter((t) => t.id !== id);
  return changed();
}

export function sortedTxns() {
  return [...state().txns].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

// ---------- ярлыки ----------
export function saveCategory(cat) {
  const st = state();
  const c = { id: cat.id || uid(), name: cat.name.trim().slice(0, 30), icon: cat.icon || '•', type: cat.type, color: cat.color, limit: Number(cat.limit) || 0 };
  const i = st.categories.findIndex((x) => x.id === c.id);
  if (i >= 0) st.categories[i] = c;
  else st.categories.push(c);
  changed();
  return c;
}

export function deleteCategory(id) {
  const st = state();
  let other = st.categories.find((c) => c.name === 'Другое' && c.id !== id);
  if (!other) {
    other = { id: uid(), name: 'Другое', icon: '•', type: 'both', color: '#8e8e93', limit: 0 };
    st.categories.push(other);
  }
  st.txns.forEach((t) => { if (t.categoryId === id) t.categoryId = other.id; });
  st.categories = st.categories.filter((c) => c.id !== id);
  return changed();
}

export function moveCategory(id, dir) {
  const arr = state().categories;
  const i = arr.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return changed();
}

export const usageCount = (id) => state().txns.filter((t) => t.categoryId === id).length;

// ---------- валюты ----------
export function addCurrency(code, r) {
  const st = state().settings;
  code = code.toUpperCase().trim();
  if (!st.currencies.includes(code)) st.currencies.push(code);
  if (code !== st.base) st.rates[code] = Number(r) || st.rates[code] || 0;
  return changed();
}

export function setRate(code, r) {
  state().settings.rates[code] = Number(r) || 0;
  return changed();
}

export function removeCurrency(code) {
  const st = state().settings;
  if (code === st.base) return;
  st.currencies = st.currencies.filter((c) => c !== code);
  if (st.lastCurrency === code) st.lastCurrency = st.base;
  return changed();
}

/** Смена основной валюты с пересчётом курсов всех операций. */
export function changeBase(newBase) {
  const st = state();
  const s = st.settings;
  if (newBase === s.base) return;
  const R = s.rates[newBase]; // сколько старой основной за 1 новую
  if (!(R > 0)) throw new Error('Сначала укажите курс этой валюты');
  const old = s.base;
  st.txns.forEach((t) => {
    if (t.currency === newBase) t.rate = 1;
    else if (t.currency === old) t.rate = round6(1 / R);
    else t.rate = round6((t.rate || 0) / R);
  });
  const rates = { [newBase]: 1 };
  for (const [c, r] of Object.entries(s.rates)) if (c !== newBase && c !== old) rates[c] = round6(r / R);
  rates[old] = round6(1 / R);
  s.rates = rates;
  s.base = newBase;
  if (!s.currencies.includes(newBase)) s.currencies.unshift(newBase);
  return changed();
}
const round6 = (n) => Math.round(n * 1e6) / 1e6;

// ---------- прочее ----------
export function setSetting(key, value) {
  settings()[key] = value;
  return changed();
}

export function dismissInsight(key) {
  const st = state();
  st.dismissed = [...(st.dismissed || []), key].slice(-500);
  return changed();
}

export function replaceAll(newState) {
  return vault.replaceState(newState).then(() => listeners.forEach((fn) => fn()));
}

/** Проверка структуры импортируемых данных. */
export function validateState(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.txns) || !Array.isArray(s.categories) || !s.settings?.base) {
    throw new Error('Файл не содержит данных «Баланса»');
  }
  s.dismissed ||= [];
  return s;
}
