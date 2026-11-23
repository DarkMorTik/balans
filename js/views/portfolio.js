// Портфель: остатки по валютам и криптовалютам, прибыль/убыток, рынок топ-100.
import { h, clear, money, isCrypto, CRYPTO, currencySymbol, parseAmount } from '../util.js';
import * as store from '../store.js';
import { openSheet, toast } from '../sheet.js';
import { openExchangeEditor, pickCurrency } from './editor.js';
import { txnListSheet } from './home.js';
import { guilloche } from '../guilloche.js';
import * as P from '../planner.js';
import { openDebtEditor, debtSheet } from './planner-sheets.js';
import { openAccountEditor, accountSheet, openTransferSheet } from './money-sheets.js';
import { investSection } from './invest.js';

const ui = { marketAll: false, marketQ: '' };

function ago(ts) {
  if (!ts) return 'ещё не обновлялись';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

const nameOf = (c) => {
  if (isCrypto(c)) return CRYPTO[c].name;
  try { return new Intl.DisplayNames(['ru'], { type: 'currency' }).of(c); } catch { return c; }
};

const pct = (pnl, cost) => (cost > 0 ? (pnl / cost) * 100 : 0);

function badge(code) {
  return h('span', { class: ['cur-badge', isCrypto(code) && 'crypto'] }, currencySymbol(code).slice(0, 2));
}

export function openAdjustSheet(cur) {
  const b = store.base();
  let code = cur || b;
  let val = '';
  const curBtn = h('button', { class: 'cur-btn', onclick: () => pickCurrency({ current: code, onPick: (c) => { code = c; render(); } }) });
  const now = h('div', { class: 'muted small mono' });
  const render = () => {
    curBtn.textContent = code;
    now.textContent = `Сейчас в портфеле: ${money(store.portfolioHoldings()[code]?.qty || 0, code)}`;
  };
  const sh = openSheet({
    title: 'Фактический остаток', className: 'sheet-compact',
    content: h('div', { class: 'editor' },
      h('p', { class: 'muted small' }, 'Укажите, сколько у вас есть на самом деле. Разница запишется корректировкой и не попадёт в доходы и расходы.'),
      h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono', inputmode: 'decimal', placeholder: '0', oninput: (e) => { val = e.target.value; } }), curBtn),
      now,
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const a = parseAmount(val);
        if (!(a >= 0) || val === '') return toast('Введите остаток');
        await store.adjustBalance(code, a, store.rate(code));
        sh.close();
        toast('Остаток обновлён');
      } }, 'Сохранить остаток')),
  });
  render();
}

function assetSheet(code) {
  const b = store.base();
  const s = store.settings();
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const e = store.portfolioHoldings()[code] || { qty: 0, cost: 0, value: 0, pnl: 0 };
    const market = store.marketRate(code);
    const manual = s.manualRates?.[code];
    const r = store.rate(code);
    body.append(
      h('div', { class: 'asset-hero' },
        badge(code),
        h('div', {}, h('div', { class: 'asset-qty mono' }, money(e.qty, code)), h('div', { class: 'muted small' }, nameOf(code)))),
      h('div', { class: 'kv-grid' },
        kv('Стоимость', money(e.value, b)),
        code !== b && kv('Цена', r > 0 ? money(r, b) : '—', manual ? 'вручную' : market ? 'рынок' : ''),
        isCrypto(code) && kv('Вложено', money(e.cost, b)),
        isCrypto(code) && kv('Прибыль', money(e.pnl, b, { sign: true }), e.cost > 0 ? `${pct(e.pnl, e.cost).toFixed(1)}%` : '', e.pnl >= 0 ? 'good' : 'bad')),
      code !== b && h('div', { class: 'rate-row' },
        h('span', { class: 'micro' }, 'Свой курс'),
        h('input', { class: 'rate-input mono', inputmode: 'decimal', placeholder: market ? 'авто' : 'курс', value: manual ? String(manual).replace('.', ',') : '',
          onchange: async (ev) => { await store.setManualRate(code, parseAmount(ev.target.value) || 0); render(); } }),
        h('span', { class: 'micro' }, b)),
      h('button', { class: 'btn btn-primary', onclick: () => { openAdjustSheet(code); } }, 'Указать фактический остаток'),
      h('button', { class: 'btn btn-plain', onclick: () => txnListSheet(`${code}: операции`, store.state().txns.filter((t) => t.currency === code || t.toCurrency === code)) }, 'Операции с этой валютой'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: code, content: body, onClose: unsub });
}

function kv(label, value, sub, tone) {
  return h('div', { class: 'kv' }, h('span', { class: 'micro' }, label), h('span', { class: ['mono', 'kv-val', tone] }, value), sub ? h('span', { class: ['kv-sub', tone] }, sub) : null);
}

function assetRow(code, e, b) {
  const crypto = isCrypto(code);
  return h('button', { class: 'row asset', onclick: () => assetSheet(code) },
    badge(code),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, code, h('span', { class: 'row-sub inline' }, ` ${nameOf(code)}`)),
      h('span', { class: 'row-sub mono' }, money(e.qty, code))),
    h('span', { class: 'row-end' },
      h('span', { class: 'amount' }, money(e.value, b)),
      crypto && e.cost > 0 ? h('span', { class: ['row-sub', 'mono', e.pnl >= 0 ? 'inc' : 'neg'] }, `${e.pnl >= 0 ? '+' : ''}${pct(e.pnl, e.cost).toFixed(1)}%`) : null));
}

export function renderPortfolio(root) {
  clear(root);
  const st = store.state();
  const s = st.settings;
  const b = s.base;
  const hasAccounts = (st.accounts || []).some((a) => !a.archived);
  // только активы: обмены и остатки вне счетов; траты и доходы с главной сюда не попадают
  const hold = store.portfolioHoldings();
  const entries = Object.entries(hold).filter(([, e]) => Math.abs(e.qty) > 1e-9);
  const crypto = entries.filter(([c]) => isCrypto(c)).sort((x, y) => y[1].value - x[1].value);
  const fiat = entries.filter(([c]) => !isCrypto(c)).sort((x, y) => (x[0] === b ? -1 : y[0] === b ? 1 : y[1].value - x[1].value));
  const accBal0 = store.accountBalances();
  const investTotal = (st.invest || []).filter((v) => !v.closed).reduce((a, v) => a + (v.amount + P.investStats(v).accrued) * store.rate(v.currency), 0);
  const total = entries.reduce((a, [, e]) => a + e.value, 0) + (st.accounts || []).filter((a) => !a.archived).reduce((a, x) => a + (accBal0[x.id]?.inBase || 0), 0) + investTotal;
  const cTotal = crypto.reduce((a, [, e]) => a + e.value, 0);
  const cCost = crypto.reduce((a, [, e]) => a + e.cost, 0);
  const cPnl = cTotal - cCost;

  root.append(h('h1', { class: 'page-title' }, 'Портфель'));

  const debts = st.debts || [];
  const owe = debts.filter((d) => d.kind !== 'lent').reduce((a, d) => a + P.debtRemaining(d) * store.rate(d.currency), 0);
  const lent = debts.filter((d) => d.kind === 'lent').reduce((a, d) => a + P.debtRemaining(d) * store.rate(d.currency), 0);
  const net = total + lent - owe;

  root.append(h('section', { class: ['note', 'brass', net < 0 && 'neg'] },
    guilloche({ w: 360, h: 190, seed: `pf${crypto.length}${fiat.length}${debts.length}`, health: total > 0 ? Math.max(-1, Math.min(1, net / total)) : 0.2 }),
    h('div', { class: 'note-top' }, h('span', { class: 'micro' }, 'Чистый капитал · активы − долги')),
    h('div', { class: 'note-sum' }, money(net, b)),
    h('div', { class: 'note-foot' },
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'активы'), h('span', { class: 'mono' }, money(total + lent, b))),
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'долги'), h('span', { class: ['mono', owe > 0 && 'neg'] }, owe > 0 ? money(-owe, b) : '0')),
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'крипто'), h('span', { class: ['mono', cPnl >= 0 ? 'inc' : 'neg'] }, cCost > 0 ? `${pct(cPnl, cCost) >= 0 ? '+' : ''}${pct(cPnl, cCost).toFixed(1)}%` : money(cTotal, b))))));

  // --- счета ---
  const accs = (st.accounts || []).filter((a) => !a.archived);
  const bals = store.accountBalances();
  const accTotal = accs.reduce((a, x) => a + (bals[x.id]?.inBase || 0), 0);
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Счета и кошельки'), accs.length ? h('span', { class: 'mono' }, money(accTotal, b)) : null));
  const accList = h('div', { class: 'acc-grid' });
  accs.forEach((a) => {
    const e = bals[a.id] || { balance: 0, inBase: 0 };
    accList.append(h('button', { class: 'acc-card', onclick: () => accountSheet(a) },
      h('span', { class: 'acc-top' }, h('span', { class: 'acc-ico' }, a.icon || '▫'), h('span', { class: 'micro' }, store.ACCOUNT_KINDS[a.kind]?.label || '')),
      h('span', { class: 'acc-name' }, a.name),
      h('span', { class: ['acc-bal', 'mono', e.balance < 0 && 'neg'] }, money(e.balance, a.currency)),
      a.currency !== b ? h('span', { class: 'acc-sub mono' }, `≈ ${money(e.inBase, b)}`) : null));
  });
  accList.append(h('button', { class: 'acc-card add', onclick: () => openAccountEditor({}) }, h('span', { class: 'acc-plus' }, '+'), h('span', { class: 'acc-name' }, accs.length ? 'Счёт' : 'Добавить счёт'), h('span', { class: 'acc-sub' }, 'карта, наличные, биржа')));
  root.append(accList);
  if (accs.length >= 2) root.append(h('button', { class: 'btn btn-plain transfer-btn', onclick: () => openTransferSheet({}) }, '⇄ Перевод между счетами'));
  investSection(root, b);

  const status = h('span', { class: 'micro' }, s.livePrices ? `Курсы ${ago(s.pricesAt)}` : 'Онлайн-курсы выключены в настройках');
  const refreshBtn = h('button', { class: 'chip small', disabled: !s.livePrices, onclick: async () => {
    refreshBtn.disabled = true; status.textContent = 'Обновляем…';
    try { await store.refreshMarket(true); toast('Курсы обновлены'); } catch (e) { toast(e.message || 'Нет связи'); status.textContent = `Курсы ${ago(s.pricesAt)}`; refreshBtn.disabled = false; }
  } }, '⟳ Обновить');
  root.append(h('div', { class: 'status-row' }, status, refreshBtn));

  root.append(h('div', { class: 'dock-actions two' },
    h('button', { class: 'act act-swap', onclick: () => openExchangeEditor({}) }, h('span', { class: 'act-sign' }, '⇄'), 'Купить / обменять'),
    h('button', { class: 'act', onclick: () => openAdjustSheet() }, h('span', { class: 'act-sign' }, '±'), 'Остаток')));

  // --- обязательства ---
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Обязательства'), owe > 0 ? h('span', { class: 'mono' }, `долг ${money(owe, b)}`) : null));
  const dl = h('div', { class: 'card list' });
  [...debts].sort((x, y) => (P.debtRemaining(y) > 0) - (P.debtRemaining(x) > 0) || y.principal - x.principal).forEach((d) => {
    const rem = P.debtRemaining(d);
    const prog = P.debtProgress(d);
    const isLent = d.kind === 'lent';
    const po = P.payoff(d);
    dl.append(h('button', { class: ['row', 'debt-row', rem === 0 && 'is-paid'], onclick: () => debtSheet(d) },
      h('span', { class: 'cat-ico swap' }, P.DEBT_KINDS[d.kind]?.icon || '🏦'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, d.name),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { '--c': isLent ? 'var(--mint)' : 'var(--violet)', '--w': `${Math.max(2, Math.round(prog * 100))}%` } })),
        h('span', { class: 'row-sub' }, rem === 0 ? 'погашено ✓' : [P.DEBT_KINDS[d.kind]?.label, d.payment ? `${money(d.payment, d.currency)}${d.day ? ` · ${d.day} числа` : ''}` : null, po?.date ? `до ${po.date.slice(5, 7)}.${po.date.slice(2, 4)}` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'row-end' }, h('span', { class: ['amount', isLent && 'inc'] }, money(isLent ? rem : -rem, d.currency)),
        h('span', { class: 'row-sub mono' }, d.currency !== b && rem > 0 ? `≈ ${money((isLent ? rem : -rem) * store.rate(d.currency), b)} · ${Math.round(prog * 100)}%` : `${Math.round(prog * 100)}%`))));
  });
  dl.append(h('button', { class: 'row', onclick: () => openDebtEditor({}) },
    h('span', { class: 'cat-ico add-ico' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Добавить обязательство'), h('span', { class: 'row-sub' }, 'Кредит, рассрочка, ипотека, долг или «мне должны»'))));
  root.append(dl);

  if (!entries.length && !accs.length && !(st.invest || []).length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, '₿'), 'В портфеле пока пусто',
      h('div', { class: 'muted small' }, 'Запишите покупку криптовалюты через «Купить / обменять» или укажите текущий остаток.')));
  }
  if (crypto.length) {
    root.append(h('div', { class: 'set-title micro' }, hasAccounts ? 'Вне счетов · криптовалюта' : 'Криптовалюта'), h('div', { class: 'card list' }, crypto.map(([c, e]) => assetRow(c, e, b))));
  }
  if (fiat.length) {
    root.append(h('div', { class: 'set-title micro' }, hasAccounts ? 'Вне счетов · валюты' : 'Валюты'), h('div', { class: 'card list' }, fiat.map(([c, e]) => assetRow(c, e, b))));
  }

  // --- рынок ---
  const coins = store.coinList();
  const marketList = h('div', { class: 'card list' });
  const renderMarket = () => {
    clear(marketList);
    const q = ui.marketQ.toLowerCase();
    const filtered = coins.filter((c) => !q || c.s.toLowerCase().includes(q) || (c.n || '').toLowerCase().includes(q));
    const shown = ui.marketAll || q ? filtered : filtered.slice(0, 10);
    if (!shown.length) marketList.append(h('div', { class: 'empty small' }, s.livePrices ? 'Нет данных. Нажмите «Обновить».' : 'Включите онлайн-курсы в настройках.'));
    shown.forEach((c) => {
      const r = store.rate(c.s);
      marketList.append(h('button', { class: 'row asset', onclick: () => assetSheet(c.s) },
        h('span', { class: 'rank mono' }, c.rank || ''),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.s, h('span', { class: 'row-sub inline' }, ` ${c.n}`))),
        h('span', { class: 'amount' }, r > 0 ? money(r, b) : '—')));
    });
    if (!ui.marketAll && !q && filtered.length > 10) {
      marketList.append(h('button', { class: 'row more', onclick: () => { ui.marketAll = true; renderMarket(); } }, h('span', { class: 'row-main link' }, `Показать все ${filtered.length}`)));
    }
  };
  root.append(
    h('div', { class: 'set-title micro' }, 'Рынок · топ-100'),
    h('input', { class: 'field market-search', type: 'search', placeholder: 'Найти монету', value: ui.marketQ, oninput: (e) => { ui.marketQ = e.target.value.trim(); renderMarket(); } }),
    marketList);
  renderMarket();

  // курсы в портфеле держим свежими: не старше минуты (дальше — автообновление в app.js)
  if (s.livePrices) store.refreshMarket(false, 60 * 1000).catch(() => {});
}
