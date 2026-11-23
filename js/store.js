// Данные приложения и операции над ними. Все изменения сохраняются в зашифрованном виде.
import * as vault from './vault.js';
import { uid, round2, round8, roundAmt, dayKey, isCrypto, CRYPTO, registerCryptos } from './util.js';
import { fetchMarket, setExtraNames } from './market.js';

const BASE_CRYPTO = Object.keys(CRYPTO);
setExtraNames(Object.fromEntries(Object.entries(CRYPTO).map(([k, v]) => [k, { name: v.name, id: v.cg }])));

export const COLORS = ['#ff8a7a', '#f2a65a', '#e8c66a', '#7fe0c2', '#5cc8d6', '#7aa7ff', '#a78bfa', '#e58fd0', '#c2a27c', '#9aa39a', '#ff5f8f', '#8e8a9c'];

export const CURRENCIES = ['RUB', 'USD', 'EUR', 'UAH', 'KZT', 'BYN', 'GEL', 'AMD', 'UZS', 'KGS', 'TRY', 'AED', 'THB', 'CNY', 'GBP', 'PLN'];
export const CRYPTOS = Object.keys(CRYPTO);

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
  ['Крипто', '₿', 'both', '#e8c66a'],
  ['Комиссии', '%', 'expense', '#9aa39a'],
  ['Кредиты', '🏦', 'expense', '#7aa7ff'],
  ['Доход от вложений', '💹', 'income', '#7fe0c2'],
  ['Подарки', '🎁', 'both', '#ff453a'],
  ['Другое', '•', 'both', '#8e8e93'],
];
const EXTRA_V2 = ['Крипто', 'Комиссии'];
const EXTRA_V3 = ['Кредиты'];
const EXTRA_V5 = ['Доход от вложений'];
const PLANNER_KEYS = ['recurring', 'debts', 'tasks', 'notes', 'goals', 'accounts', 'templates', 'invest'];

export function initialState(base = 'RUB') {
  return {
    v: 1,
    settings: {
      base,
      currencies: [base],
      rates: { [base]: 1 },
      lastCurrency: base,
      lockAfter: 0, // секунд в фоне до блокировки
      livePrices: true, // онлайн-курсы (в запросе только коды валют); можно выключить в настройках
      pricesAt: 0,
      manualRates: {},
    },
    categories: DEFAULT_CATEGORIES.map(([name, icon, type, color]) => ({ id: uid(), name, icon, type, color, limit: 0 })),
    txns: [],
    dismissed: [],
    recurring: [], // регулярные платежи
    debts: [],     // обязательства
    tasks: [],     // задачи по дням
    notes: [],     // заметки, планы, идеи
    goals: [],     // финансовые цели
    accounts: [],  // счета и кошельки
    templates: [], // шаблоны быстрых операций
    focus: {},     // минуты фокуса по дням
    deleted: {},   // журнал удалений (для синхронизации между устройствами)
    invest: [],    // инвестиции, вклады, стейкинг
    schema: 5,
  };
}

function addCategories(st, names) {
  for (const name of names) {
    if (st.categories.some((c) => c.name === name)) continue;
    const def = DEFAULT_CATEGORIES.find((d) => d[0] === name);
    st.categories.splice(Math.max(0, st.categories.length - 2), 0, { id: uid(), name, icon: def[1], type: def[2], color: def[3], limit: 0 });
  }
}

/** Обновление данных, созданных прошлой версией приложения. */
export function migrate() {
  const st = state();
  const v = st.schema || 1;
  if (v >= 5) return;
  if (v < 2) {
    addCategories(st, EXTRA_V2);
    st.settings.livePrices = true;
    st.settings.pricesAt ??= 0;
    st.settings.manualRates ||= {};
  }
  addCategories(st, EXTRA_V3);
  for (const k of PLANNER_KEYS) st[k] ||= [];
  st.focus ||= {};
  st.deleted ||= {};
  st.settings.theme ||= 'auto';
  addCategories(st, EXTRA_V5);
  st.schema = 5;
  return vault.save();
}

/** Вызывается после разблокировки. */
export function onUnlock() {
  migrate();
  registerCryptos(state().market?.coins);
}

export function categoryByName(name) {
  return state().categories.find((c) => c.name === name);
}

// ---------- события ----------
const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() {
  const p = vault.save();
  p.catch(() => {}); // вызывающие без await (upsert и др.) не должны давать «необработанную» ошибку
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

/** Рыночный курс: сколько основной валюты за 1 единицу cur (0 — нет данных). */
export function marketRate(cur) {
  const m = state().market;
  const b = base();
  if (cur === b) return 1;
  const a = m?.usd?.[cur], bb = m?.usd?.[b];
  return a > 0 && bb > 0 ? a / bb : 0;
}

/** Курс по приоритету: заданный вручную → рыночный → последний известный из операций. */
export function rate(cur) {
  if (cur === base()) return 1;
  const s = settings();
  return s.manualRates?.[cur] || marketRate(cur) || s.rates[cur] || 0;
}

/** Курс между любыми двумя валютами: сколько `to` за 1 `from`. */
export function pairRate(from, to) {
  const a = rate(from), b = rate(to);
  return a > 0 && b > 0 ? a / b : 0;
}

let marketLoading = null;
/** Обновить рыночные курсы (если включено). force — без кэша; maxAge — возраст кэша, мс (по умолчанию 15 мин). */
export function refreshMarket(force = false, maxAge = 15 * 60 * 1000) {
  const st = state();
  if (!st?.settings.livePrices) return Promise.resolve(false);
  if (!force && Date.now() - (st.market?.at || 0) < maxAge) return Promise.resolve(false);
  if (marketLoading) return marketLoading;
  const prevCoins = st.market?.coins?.length ? st.market.coins : Object.entries(CRYPTO).map(([s, c]) => ({ s, n: c.name, id: c.cg }));
  setExtraNames(Object.fromEntries(prevCoins.filter((c) => c.id).map((c) => [c.s, { name: c.n, id: c.id }])));
  const extra = [...new Set([...BASE_CRYPTO, ...st.settings.currencies.filter(isCrypto)])];
  marketLoading = fetchMarket(prevCoins, extra, force ? null : st.market)
    .then(async (m) => {
      if (!vault.isUnlocked()) return false;
      const cur = state();
      cur.market = m;
      registerCryptos(m.coins);
      cur.settings.pricesAt = m.at;
      await changed();
      return true;
    })
    .finally(() => { marketLoading = null; });
  return marketLoading;
}

export function setManualRate(cur, r) {
  const s = settings();
  s.manualRates ||= {};
  if (r > 0) s.manualRates[cur] = r; else delete s.manualRates[cur];
  return changed();
}

/** Список топ-монет для выбора. */
export function coinList() {
  const m = state().market?.coins;
  if (m?.length) return m;
  return Object.entries(CRYPTO).map(([s, c]) => ({ s, n: c.name, id: c.cg }));
}

/** Сумма операции в основной валюте. */
export const inBase = (t) => round2(t.amount * (t.currency === base() ? 1 : t.rate || 0));

// ---------- операции ----------
function buildTxn(data) {
  const st = state();
  const b = st.settings.base;
  const t = {
    id: data.id || uid(),
    type: data.type, // expense | income | exchange | adjust
    amount: roundAmt(data.amount, data.currency),
    currency: data.currency,
    rate: data.currency === b ? 1 : Number(data.rate) || 0,
    categoryId: data.categoryId || '',
    note: (data.note || '').trim().slice(0, 200),
    date: data.date || dayKey(),
    createdAt: data.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (data.accountId) t.accountId = data.accountId;
  if (data.templateId) t.templateId = data.templateId;
  if (t.type === 'exchange') {
    if (data.toAccountId) t.toAccountId = data.toAccountId;
    t.toAmount = roundAmt(data.toAmount, data.toCurrency);
    t.toCurrency = data.toCurrency;
    t.toRate = data.toCurrency === b ? 1 : Number(data.toRate) || 0;
    // курс выводится из самой сделки, если одна сторона — основная валюта или её курс известен
    if (t.currency === b && t.toAmount > 0) t.toRate = round8(t.amount / t.toAmount);
    else if (t.toCurrency === b && t.amount > 0) t.rate = round8(t.toAmount / t.amount);
    else if (t.rate > 0 && t.toAmount > 0) t.toRate = round8((t.amount * t.rate) / t.toAmount);
    else if (t.toRate > 0 && t.amount > 0) t.rate = round8((t.toAmount * t.toRate) / t.amount);
    if (t.currency !== t.toCurrency || !t.accountId) {
      t.categoryId = t.categoryId || categoryByName(isCrypto(t.currency) || isCrypto(t.toCurrency) ? 'Крипто' : 'Обмен валюты')?.id || '';
    }
  }
  return t;
}

function learnRates(t) {
  const s = state().settings;
  const isLatest = (cur) => !state().txns.some((x) => x.id !== t.id && x.date > t.date && (x.currency === cur || x.toCurrency === cur));
  const learn = (cur, r) => {
    if (cur === s.base || !(r > 0)) return;
    if (!s.currencies.includes(cur)) s.currencies.push(cur);
    if (isLatest(cur)) s.rates[cur] = r;
  };
  learn(t.currency, t.rate);
  if (t.type === 'exchange') learn(t.toCurrency, t.toRate);
}

export function saveTxn(data) {
  const st = state();
  const t = buildTxn(data);
  const i = st.txns.findIndex((x) => x.id === t.id);
  if (i >= 0) st.txns[i] = t;
  else st.txns.push(t);
  if (t.type === 'income' || t.type === 'expense') st.settings.lastCurrency = t.currency;
  learnRates(t);
  return changed();
}

/** Обмен + необязательная комиссия (отдельной тратой в основной валюте). */
export function saveExchange(data, fee = 0) {
  const st = state();
  const t = buildTxn({ ...data, type: 'exchange' });
  const i = st.txns.findIndex((x) => x.id === t.id);
  if (i >= 0) st.txns[i] = t;
  else st.txns.push(t);
  learnRates(t);
  if (fee > 0) {
    st.txns.push(buildTxn({
      type: 'expense', amount: fee, currency: st.settings.base, rate: 1, date: t.date,
      categoryId: categoryByName('Комиссии')?.id || categoryByName('Другое')?.id,
      note: `Комиссия: ${t.currency} → ${t.toCurrency}`,
    }));
  }
  return changed();
}

/** Корректировка остатка: приводит количество валюты к фактическому, не влияя на доходы/расходы. */
export function adjustBalance(cur, actual, rateValue) {
  const h = portfolioHoldings()[cur]?.qty || 0;
  const diff = roundAmt(actual - h, cur);
  if (!diff) return Promise.resolve();
  state().txns.push(buildTxn({ type: 'adjust', amount: diff, currency: cur, rate: rateValue || rate(cur), note: 'Корректировка остатка' }));
  if (!state().settings.currencies.includes(cur)) state().settings.currencies.push(cur);
  return changed();
}

/**
 * Остатки по валютам и средняя себестоимость (в основной валюте).
 * { CUR: { qty, cost, value, pnl } }
 * portfolio: true — только активы портфеля «вне счетов»: обмены и корректировки остатка.
 *   Траты и доходы с главной сюда не попадают (они ведутся отдельно), а стороны операций,
 *   привязанные к счёту (в т.ч. к удалённому), не считаются — они живут в балансе счёта.
 */
export function holdings(filter = null, { portfolio = false } = {}) {
  const st = state();
  const out = {};
  const get = (c) => (out[c] ||= { qty: 0, cost: 0 });
  const add = (c, q, valueBase) => {
    const e = get(c);
    if (q > 0) { e.cost += valueBase; e.qty += q; }
    else if (q < 0) {
      const avg = e.qty > 0 ? e.cost / e.qty : 0;
      e.cost = Math.max(0, e.cost + avg * q);
      e.qty += q;
    }
  };
  const txns = (filter ? st.txns.filter(filter) : [...st.txns]).sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
  const r = (c, rr) => (c === st.settings.base ? 1 : rr || 0);
  for (const t of txns) {
    if (portfolio && (t.type === 'income' || t.type === 'expense')) continue;
    const sign = t.type === 'expense' ? -1 : 1;
    if (t.type === 'exchange') {
      const v = t.amount * r(t.currency, t.rate);
      if (!portfolio || !t.accountId) add(t.currency, -t.amount, 0);
      if (!portfolio || !t.toAccountId) add(t.toCurrency, t.toAmount, v || t.toAmount * r(t.toCurrency, t.toRate));
    } else {
      if (portfolio && t.accountId) continue;
      add(t.currency, sign * t.amount, Math.abs(t.amount) * r(t.currency, t.rate));
    }
  }
  for (const [c, e] of Object.entries(out)) {
    e.qty = roundAmt(e.qty, c);
    e.value = round2(e.qty * rate(c));
    e.cost = round2(e.cost);
    e.pnl = round2(e.value - e.cost);
  }
  return out;
}

/** Активы портфеля вне счетов (без трат и доходов с главной). */
export const portfolioHoldings = () => holdings(null, { portfolio: true });

function tomb(id) {
  const st = state();
  st.deleted ||= {};
  st.deleted[id] = Date.now();
}
const touch = (x) => { if (x) x.updatedAt = Date.now(); return x; };

export function deleteTxn(id) {
  const st = state();
  st.txns = st.txns.filter((t) => t.id !== id);
  tomb(id);
  // снять отметку «оплачено» у регулярного платежа и убрать платёж по долгу, связанные с этой операцией
  for (const r of st.recurring || []) {
    for (const [d, tid] of Object.entries(r.paid || {})) if (tid === id) { delete r.paid[d]; touch(r); }
  }
  for (const d of st.debts || []) {
    if (d.payments?.some((p) => p.txnId === id)) { d.payments = d.payments.filter((p) => p.txnId !== id); touch(d); }
  }
  return changed();
}

export function sortedTxns() {
  return [...state().txns].sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

// ---------- ярлыки ----------
export function saveCategory(cat) {
  const st = state();
  const c = { id: cat.id || uid(), name: cat.name.trim().slice(0, 30), icon: cat.icon || '•', type: cat.type, color: cat.color, limit: Number(cat.limit) || 0, updatedAt: Date.now() };
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
  tomb(id);
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
  if (!code) return Promise.resolve();
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
  const R = rate(newBase); // сколько старой основной за 1 новую
  if (!(R > 0)) throw new Error('Сначала укажите курс этой валюты');
  const old = s.base;
  const conv = (cur, r) => (cur === newBase ? 1 : cur === old ? round6(1 / R) : round6((r || 0) / R));
  st.txns.forEach((t) => {
    t.rate = conv(t.currency, t.rate);
    if (t.type === 'exchange') t.toRate = conv(t.toCurrency, t.toRate);
  });
  const rates = { [newBase]: 1 };
  for (const [c, r] of Object.entries(s.rates)) if (c !== newBase && c !== old) rates[c] = round6(r / R);
  rates[old] = round6(1 / R);
  s.rates = rates;
  const manual = {};
  for (const [c, r] of Object.entries(s.manualRates || {})) if (c !== newBase) manual[c] = round6(r / R);
  s.manualRates = manual;
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
  for (const k of PLANNER_KEYS) s[k] ||= [];
  s.focus ||= {};
  s.deleted ||= {};
  return s;
}

// ---------- планировщик: общий CRUD ----------
/** Сохранить элемент коллекции (recurring | debts | tasks | notes | goals). */
export function upsert(coll, item) {
  const st = state();
  st[coll] ||= [];
  const it = { ...item, id: item.id || uid(), createdAt: item.createdAt || Date.now(), updatedAt: Date.now() };
  const i = st[coll].findIndex((x) => x.id === it.id);
  if (i >= 0) st[coll][i] = it; else st[coll].push(it);
  changed();
  return it;
}
export function removeItem(coll, id) {
  const st = state();
  st[coll] = (st[coll] || []).filter((x) => x.id !== id);
  tomb(id);
  return changed();
}
export const items = (coll) => state()[coll] || [];
export const findItem = (coll, id) => items(coll).find((x) => x.id === id);

// ---------- регулярные платежи ----------
/** Отметить списание оплаченным: создаёт трату и связывает её с датой. */
export function payRecurring(r, date) {
  const st = state();
  const rr = findItem('recurring', r.id);
  if (!rr || rr.paid?.[date]) return Promise.resolve();
  const income = rr.type === 'income';
  const t = buildTxn({
    type: income ? 'income' : 'expense', amount: rr.amount, currency: rr.currency, rate: rate(rr.currency),
    categoryId: rr.categoryId || categoryByName(income ? 'Зарплата' : 'Подписки')?.id, note: rr.name, date, accountId: rr.accountId,
  });
  st.txns.push(t);
  rr.paid = { ...(rr.paid || {}), [date]: t.id };
  touch(rr);
  return changed();
}
export function unpayRecurring(r, date) {
  const st = state();
  const rr = findItem('recurring', r.id);
  const id = rr?.paid?.[date];
  if (!id) return Promise.resolve();
  st.txns = st.txns.filter((t) => t.id !== id);
  tomb(id);
  delete rr.paid[date];
  touch(rr);
  return changed();
}

// ---------- обязательства ----------
/** Платёж по обязательству. record — записать ли в траты/доходы. */
export function payDebt(d, amount, date = dayKey(), record = true) {
  const st = state();
  const dd = findItem('debts', d.id);
  if (!dd || !(amount > 0)) return Promise.resolve();
  let txnId = null;
  if (record) {
    const t = buildTxn({
      type: dd.kind === 'lent' ? 'income' : 'expense', amount, currency: dd.currency, rate: rate(dd.currency),
      categoryId: dd.kind === 'lent' ? categoryByName('Другое')?.id : categoryByName('Кредиты')?.id || categoryByName('Другое')?.id,
      note: `${dd.kind === 'lent' ? 'Возврат долга' : 'Платёж'}: ${dd.name}`, date, accountId: dd.accountId,
    });
    st.txns.push(t);
    txnId = t.id;
  }
  dd.payments = [...(dd.payments || []), { id: uid(), date, amount: roundAmt(amount, dd.currency), txnId }];
  touch(dd);
  return changed();
}
export function removeDebtPayment(d, pid) {
  const st = state();
  const dd = findItem('debts', d.id);
  const p = dd?.payments?.find((x) => x.id === pid);
  if (!p) return Promise.resolve();
  if (p.txnId) { st.txns = st.txns.filter((t) => t.id !== p.txnId); tomb(p.txnId); }
  dd.payments = dd.payments.filter((x) => x.id !== pid);
  touch(dd);
  return changed();
}

// ---------- задачи ----------
export function toggleTask(t, date) {
  const tt = findItem('tasks', t.id);
  if (!tt) return Promise.resolve();
  if ((tt.repeat || 'none') === 'none') tt.done = !tt.done;
  else {
    const set = new Set(tt.doneDates || []);
    if (set.has(date)) set.delete(date); else set.add(date);
    tt.doneDates = [...set].sort().slice(-400);
  }
  touch(tt);
  return changed();
}

// ---------- цели ----------
export function contributeGoal(g, amount, date = dayKey()) {
  const gg = findItem('goals', g.id);
  if (!gg || !amount) return Promise.resolve();
  gg.contributions = [...(gg.contributions || []), { id: uid(), date, amount: round2(amount) }];
  touch(gg);
  return changed();
}

// ---------- счета и кошельки ----------
export const ACCOUNT_KINDS = {
  card: { label: 'Карта', icon: '💳' },
  cash: { label: 'Наличные', icon: '💵' },
  bank: { label: 'Счёт в банке', icon: '🏦' },
  deposit: { label: 'Вклад', icon: '🐷' },
  exchange: { label: 'Биржа / кошелёк', icon: '◈' },
  other: { label: 'Другое', icon: '▫' },
};

/** Балансы счетов в их валютах. { id: { balance, inBase } } */
export function accountBalances() {
  const st = state();
  const out = {};
  const accs = st.accounts || [];
  for (const a of accs) out[a.id] = { balance: a.initial || 0 };
  const add = (id, cur, v) => {
    const e = out[id];
    if (!e) return;
    const acc = accs.find((x) => x.id === id);
    // сумма в другой валюте пересчитывается в валюту счёта по текущему курсу
    e.balance += cur === acc.currency ? v : v * pairRate(cur, acc.currency);
  };
  for (const t of st.txns) {
    if (t.type === 'income' || t.type === 'adjust') add(t.accountId, t.currency, t.amount);
    else if (t.type === 'expense') add(t.accountId, t.currency, -t.amount);
    else if (t.type === 'exchange') {
      add(t.accountId, t.currency, -t.amount);
      add(t.toAccountId, t.toCurrency, t.toAmount);
    }
  }
  for (const a of accs) {
    const e = out[a.id];
    e.balance = roundAmt(e.balance, a.currency);
    e.inBase = round2(e.balance * rate(a.currency));
  }
  return out;
}

/** Удалить счёт: операции остаются в истории трат и доходов, ссылки на счёт снимаются. */
export function deleteAccount(id) {
  const st = state();
  for (const coll of ['invest', 'recurring', 'templates']) {
    for (const x of st[coll] || []) {
      if (x.fromAccountId === id) { x.fromAccountId = ''; touch(x); }
      if (x.accountId === id) { x.accountId = ''; touch(x); }
    }
  }
  return removeItem('accounts', id);
}

export const activeAccounts = () => (state().accounts || []).filter((a) => !a.archived);
export const account = (id) => (state().accounts || []).find((a) => a.id === id);

/** Перевод между счетами (в т.ч. с конвертацией валют). */
export function saveTransfer({ id, fromId, toId, amount, toAmount, date, note }) {
  const from = account(fromId), to = account(toId);
  if (!from || !to) return Promise.reject(new Error('Выберите счета'));
  return saveExchange({
    id, amount, currency: from.currency, rate: rate(from.currency), accountId: from.id,
    toAmount: from.currency === to.currency ? amount : toAmount, toCurrency: to.currency, toRate: rate(to.currency), toAccountId: to.id,
    note: note || `${from.name} → ${to.name}`, date, categoryId: '',
  });
}

/** Привести баланс счёта к фактическому (корректировка, не доход и не расход). */
export function setAccountBalance(acc, actual) {
  const cur = accountBalances()[acc.id]?.balance || 0;
  const diff = roundAmt(actual - cur, acc.currency);
  if (!diff) return Promise.resolve();
  state().txns.push(buildTxn({ type: 'adjust', amount: diff, currency: acc.currency, rate: rate(acc.currency), accountId: acc.id, note: `Остаток: ${acc.name}` }));
  return changed();
}

// ---------- шаблоны ----------
export function applyTemplate(tpl, date = dayKey()) {
  const t = buildTxn({
    type: tpl.type, amount: tpl.amount, currency: tpl.currency, rate: rate(tpl.currency),
    categoryId: tpl.categoryId, note: tpl.note || tpl.name, date, accountId: tpl.accountId, templateId: tpl.id,
  });
  state().txns.push(t);
  return changed().then(() => t);
}

// ---------- массовое добавление (импорт выписки) ----------
export function bulkAddTxns(list) {
  const st = state();
  const created = list.map((d) => buildTxn(d));
  st.txns.push(...created);
  created.forEach((t) => { if (!st.settings.currencies.includes(t.currency)) st.settings.currencies.push(t.currency); });
  return changed().then(() => created.length);
}

// ---------- фокус ----------
export function logFocus(minutes, date = dayKey()) {
  const st = state();
  st.focus ||= {};
  st.focus[date] = (st.focus[date] || 0) + minutes;
  return changed();
}

// ---------- синхронизация ----------
export function applyMerged(merged) {
  return vault.replaceState(merged).then(() => listeners.forEach((fn) => fn()));
}

/**
 * Фильтр «деньги вне счетов»: операции без счёта, добавленные после создания первого счёта.
 * Более ранняя история уже отражена в начальных остатках счетов.
 */
export function unassignedFilter() {
  const accs = state().accounts || [];
  const first = accs.length ? Math.min(...accs.map((a) => a.createdAt || 0)) : 0;
  return (t) => !t.accountId && !t.toAccountId && (t.createdAt || 0) >= first;
}

// ---------- инвестиции и стейкинг ----------
/** Создать вложение; при указании счёта сумма списывается с него (корректировкой, не тратой). */
export function addInvestment(data, fromAccountId = '') {
  const st = state();
  const inv = upsert('invest', { ...data, fromAccountId: fromAccountId || '', closed: false });
  if (fromAccountId && !data.id) {
    st.txns.push(buildTxn({ type: 'adjust', amount: -inv.amount, currency: inv.currency, rate: rate(inv.currency), accountId: fromAccountId, note: `В вложение: ${inv.name}`, date: inv.start }));
    changed();
  }
  return inv;
}

/**
 * Закрыть вложение: доход записывается как доход (ярлык «Доход от вложений»),
 * тело при желании возвращается на счёт.
 */
export function closeInvestment(inv, { profit = 0, toAccountId = '', returnPrincipal = true, date = dayKey() } = {}) {
  const st = state();
  const v = findItem('invest', inv.id);
  if (!v) return Promise.resolve();
  let profitTxn = null;
  const acc = toAccountId && account(toAccountId) ? toAccountId : '';
  if (profit > 0) {
    const t = buildTxn({ type: 'income', amount: profit, currency: v.currency, rate: rate(v.currency), categoryId: categoryByName('Доход от вложений')?.id || categoryByName('Другое')?.id, note: `Доход: ${v.name}`, date, accountId: acc });
    st.txns.push(t);
    profitTxn = t.id;
  }
  // без счёта деньги возвращаются в портфель «вне счетов» (доход там не виден — он ведётся на главной)
  const back = (returnPrincipal ? v.amount : 0) + (acc ? 0 : Math.max(0, profit));
  if (back > 0) {
    st.txns.push(buildTxn({ type: 'adjust', amount: back, currency: v.currency, rate: rate(v.currency), accountId: acc, note: `Возврат из вложения: ${v.name}`, date }));
  }
  Object.assign(v, { closed: true, closedAt: date, profit: roundAmt(profit, v.currency), profitTxn, updatedAt: Date.now() });
  return changed();
}

/** Продлить: новое вложение с теми же условиями от даты окончания старого. */
export function renewInvestment(inv, amount) {
  const days = Math.max(1, Math.round((new Date(inv.end) - new Date(inv.start)) / 864e5));
  const start = inv.end > dayKey() ? inv.end : dayKey();
  const d = new Date(start); d.setDate(d.getDate() + days);
  const end = d.toISOString().slice(0, 10);
  return upsert('invest', { name: inv.name, kind: inv.kind, amount: amount || inv.amount, currency: inv.currency, apr: inv.apr, compound: inv.compound, start, end, note: inv.note, closed: false });
}
