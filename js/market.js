// Рыночные курсы: фиат (open.er-api.com) и топ-100 криптовалют (CoinGecko), резерв — currency-api (jsDelivr).
// В запросах уходят только коды валют. Никаких данных о пользователе или его операциях.
// Результат: { at, usd: { CODE: цена 1 единицы в USD }, coins: [{ s, n, id, rank }] }

const OPTS = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors' };
const FIAT_CODES = /^[A-Z]{3}$/;
let extraNames = {}, extraIds = {};
/** map: { CODE: { name, id } } — известные монеты (для тех, что вне топ-100). */
export function setExtraNames(map) {
  for (const [k, v] of Object.entries(map)) { extraNames[k] = v.name; if (v.id) extraIds[k] = v.id; }
}

async function getJSON(url, ms = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...OPTS, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fiatFromErApi() {
  const j = await getJSON('https://open.er-api.com/v6/latest/USD');
  if (j.result !== 'success' || !j.rates) throw new Error('fx');
  const usd = {};
  for (const [k, v] of Object.entries(j.rates)) if (v > 0 && FIAT_CODES.test(k)) usd[k] = 1 / v;
  return usd;
}

async function topCoinsFromCoinGecko() {
  const list = await getJSON('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false');
  if (!Array.isArray(list)) throw new Error('cg');
  const usd = {}, coins = [];
  list.forEach((c, i) => {
    const s = String(c.symbol || '').toUpperCase();
    if (!s || !(c.current_price > 0) || usd[s]) return; // при совпадении тикеров берём более крупную монету
    usd[s] = c.current_price;
    coins.push({ s, n: c.name, id: c.id, rank: i + 1 });
  });
  return { usd, coins };
}

async function fromCurrencyApi() {
  const urls = [
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
  ];
  let j = null;
  for (const u of urls) {
    try { j = await getJSON(u); break; } catch { /* следующий */ }
  }
  if (!j?.usd) throw new Error('fallback');
  const usd = {};
  for (const [k, v] of Object.entries(j.usd)) if (v > 0) usd[k.toUpperCase()] = 1 / v;
  return usd;
}

/**
 * Загрузить актуальные курсы. prevCoins — прошлый список монет (если CoinGecko недоступен).
 */
export async function fetchMarket(prevCoins = [], extra = []) {
  const [fx, cg] = await Promise.allSettled([fiatFromErApi(), topCoinsFromCoinGecko()]);
  const usd = {};
  let coins = prevCoins;
  let fallback = null;

  if (fx.status === 'fulfilled') Object.assign(usd, fx.value);
  if (cg.status === 'fulfilled') {
    // монета с тикером, совпадающим с фиатом (редко), не должна затирать курс валюты
    const fiat = fx.status === 'fulfilled' ? fx.value : {};
    coins = cg.value.coins.filter((c) => !fiat[c.s]);
    for (const c of coins) usd[c.s] = cg.value.usd[c.s];
  }

  if (fx.status !== 'fulfilled' || cg.status !== 'fulfilled') {
    try { fallback = await fromCurrencyApi(); } catch { /* нет резерва */ }
    if (fallback) {
      if (fx.status !== 'fulfilled') for (const [k, v] of Object.entries(fallback)) if (FIAT_CODES.test(k) && !usd[k]) usd[k] = v;
      if (cg.status !== 'fulfilled') for (const c of coins) if (fallback[c.s]) usd[c.s] = fallback[c.s];
    }
  }
  // монеты вне топ-100, которые есть у пользователя или в базовом списке
  let missing = extra.filter((c) => !usd[c]);
  const ids = missing.map((c) => extraIds[c]).filter(Boolean);
  if (ids.length) {
    try {
      const p = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`);
      for (const c of missing) {
        const v = p?.[extraIds[c]]?.usd;
        if (v > 0) { usd[c] = v; if (!coins.some((x) => x.s === c)) coins = [...coins, { s: c, n: extraNames[c] || c, id: extraIds[c] }]; }
      }
    } catch { /* попробуем резерв */ }
    missing = missing.filter((c) => !usd[c]);
  }
  if (missing.length) {
    if (!fallback) { try { fallback = await fromCurrencyApi(); } catch { /* нет резерва */ } }
    for (const c of missing) {
      if (!fallback?.[c]) continue;
      usd[c] = fallback[c];
      if (!coins.some((x) => x.s === c)) coins = [...coins, { s: c, n: extraNames[c] || c, id: '' }];
    }
  }
  usd.USD = 1;
  if (Object.keys(usd).length < 5) throw new Error('Нет связи с сервисами курсов');
  return { at: Date.now(), usd, coins };
}
