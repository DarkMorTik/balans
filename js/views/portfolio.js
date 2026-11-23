// Портфель — баланс капитала. Отдельно от дневника трат:
// капитал = счета (остатки, которые вы сверяете) + вложения и стейкинг + «мне должны» − долги.
import { h, clear, money, isCrypto, CRYPTO, currencySymbol, parseAmount, shortDate } from '../util.js';
import * as store from '../store.js';
import { openSheet, toast } from '../sheet.js';
import { guilloche } from '../guilloche.js';
import * as P from '../planner.js';
import { openDebtEditor, debtSheet } from './planner-sheets.js';
import { openAccountEditor, accountSheet, openTransferSheet, openReconcileSheet } from './money-sheets.js';
import { investSection } from './invest.js';

const ui = { marketAll: false, marketQ: '' };

function agoMin(ts) {
  if (!ts) return 'ещё не обновлялись';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const hrs = Math.round(m / 60);
  return hrs < 24 ? `${hrs} ч назад` : new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Лист монеты из рынка: цена и свой курс. */
function coinSheet(code) {
  const b = store.base();
  const s = store.settings();
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const market = store.marketRate(code);
    const manual = s.manualRates?.[code];
    body.append(
      h('div', { class: 'asset-hero' },
        h('span', { class: ['cur-badge', isCrypto(code) && 'crypto'] }, currencySymbol(code).slice(0, 2)),
        h('div', {}, h('div', { class: 'asset-qty mono' }, store.rate(code) > 0 ? money(store.rate(code), b) : '—'), h('div', { class: 'muted small' }, isCrypto(code) ? CRYPTO[code].name : code))),
      h('div', { class: 'rate-row' },
        h('span', { class: 'micro' }, 'Свой курс'),
        h('input', { class: 'rate-input mono', inputmode: 'decimal', placeholder: market ? 'рынок' : 'курс', value: manual ? String(manual).replace('.', ',') : '',
          onchange: async (ev) => { await store.setManualRate(code, parseAmount(ev.target.value) || 0); render(); } }),
        h('span', { class: 'micro' }, b)),
      h('p', { class: 'muted small' }, manual ? 'Используется ваш курс. Очистите поле, чтобы вернуть рыночный.' : 'Курс подставляется в операции и пересчёт счетов автоматически.'));
  };
  render();
  openSheet({ title: code, content: body, className: 'sheet-compact' });
}

/** Мини-график истории капитала. */
function capitalChart(hist, base) {
  if (hist.length < 2) return null;
  const W = 320, H = 70, pad = 4;
  const vals = hist.map((x) => x.net);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const pts = hist.map((x, i) => `${pad + (i * (W - pad * 2)) / (hist.length - 1)},${H - pad - ((x.net - min) / span) * (H - pad * 2)}`).join(' ');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'cap-chart');
  svg.setAttribute('preserveAspectRatio', 'none');
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', pts);
  line.setAttribute('class', 'cap-line');
  svg.append(line);
  const first = hist[0], last = hist[hist.length - 1];
  const diff = last.net - first.net;
  return h('div', { class: 'card pad cap-card' },
    h('div', { class: 'section-head' }, h('span', { class: 'micro' }, `Капитал с ${shortDate(first.date)}`),
      h('span', { class: ['mono', diff >= 0 ? 'inc' : 'neg'] }, money(diff, base, { sign: true }))),
    svg);
}

export function renderPortfolio(root) {
  clear(root);
  const st = store.state();
  const s = st.settings;
  const b = s.base;
  const cap = store.capitalNow();

  root.append(h('h1', { class: 'page-title' }, 'Портфель'));

  // --- капитал ---
  root.append(h('section', { class: ['note', 'brass', cap.net < 0 && 'neg'] },
    guilloche({ w: 360, h: 190, seed: `cap${(st.accounts || []).length}${(st.invest || []).length}`, health: cap.accounts + cap.invest > 0 ? Math.max(-1, Math.min(1, cap.net / (cap.accounts + cap.invest + cap.lent))) : 0.2 }),
    h('div', { class: 'note-top' }, h('span', { class: 'micro' }, 'Чистый капитал'),
      h('button', { class: 'micro link-micro', onclick: openReconcileSheet }, 'Подвести баланс ›')),
    h('div', { class: 'note-sum' }, money(cap.net, b)),
    cap.locked > 0 || cap.lockedExcluded > 0 ? h('div', { class: 'note-locked mono' },
      `доступно ${money(cap.accounts, b)} · 🔒 ${money(cap.locked + cap.lockedExcluded, b)}${cap.lockedExcluded > 0 ? ` (${money(cap.lockedExcluded, b)} вне капитала)` : ''}`) : null,
    h('div', { class: 'note-foot' },
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'счета'), h('span', { class: 'mono' }, money(cap.accounts, b))),
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'вложения'), h('span', { class: 'mono' }, money(cap.invest, b))),
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'долги'), h('span', { class: ['mono', cap.owe > 0 && 'neg'] }, cap.owe > 0 ? money(-cap.owe, b) : '0')))));
  root.append(h('p', { class: 'cap-hint muted small' }, 'Капитал считается только из этой вкладки. Траты и доходы с главной — это дневник, на капитал они не влияют.'));
  root.append(capitalChart(st.capitalHistory || [], b));

  // --- счета ---
  const allAccs = store.activeAccounts();
  const accs = allAccs.filter((a) => !a.locked);
  const lockedAccs = allAccs.filter((a) => a.locked);
  const bals = store.accountBalances();
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Счета и кошельки'), accs.length ? h('span', { class: 'mono' }, money(cap.accounts, b)) : null));
  const accList = h('div', { class: 'acc-grid' });
  accs.forEach((a) => {
    const e = bals[a.id] || { balance: 0, inBase: 0 };
    accList.append(h('button', { class: 'acc-card', onclick: () => accountSheet(a) },
      h('span', { class: 'acc-top' }, h('span', { class: 'acc-ico' }, a.icon || '▫'), h('span', { class: 'micro' }, store.ACCOUNT_KINDS[a.kind]?.label || '')),
      h('span', { class: 'acc-name' }, a.name),
      h('span', { class: ['acc-bal', 'mono', e.balance < 0 && 'neg'] }, money(e.balance, a.currency)),
      a.currency !== b ? h('span', { class: 'acc-sub mono' }, `≈ ${money(e.inBase, b)}`) : null));
  });
  accList.append(h('button', { class: 'acc-card add', onclick: () => openAccountEditor({}) }, h('span', { class: 'acc-plus' }, '+'), h('span', { class: 'acc-name' }, accs.length ? 'Счёт' : 'Добавить счёт'), h('span', { class: 'acc-sub' }, 'карта, наличные, биржа, кошелёк')));
  root.append(accList);
  if (allAccs.length >= 2) root.append(h('button', { class: 'btn btn-plain transfer-btn', onclick: () => openTransferSheet({}) }, '⇄ Перевод между счетами'));

  // --- недоступно сейчас ---
  const lockedTotal = cap.locked + cap.lockedExcluded;
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Недоступно сейчас'), lockedAccs.length ? h('span', { class: 'mono' }, `🔒 ${money(lockedTotal, b)}`) : null));
  const lk = h('div', { class: 'card list' });
  const today = new Date().toISOString().slice(0, 10);
  [...lockedAccs].sort((x, y) => (x.unlockDate || '9') < (y.unlockDate || '9') ? -1 : 1).forEach((a) => {
    const e = bals[a.id] || { balance: 0, inBase: 0 };
    const days = a.unlockDate ? Math.ceil((new Date(a.unlockDate) - new Date(today)) / 864e5) : null;
    lk.append(h('button', { class: ['row', 'locked-row', a.countInCapital === false && 'excluded'], onclick: () => accountSheet(a) },
      h('span', { class: 'cat-ico swap' }, a.icon || '🔒'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, a.name),
        h('span', { class: ['row-sub', days != null && days <= 0 && 'inc'] }, [
          a.lockReason || store.ACCOUNT_KINDS[a.kind]?.label,
          days == null ? 'срок не известен' : days <= 0 ? 'срок наступил' : `через ${days} дн. · ${shortDate(a.unlockDate)}`,
          a.countInCapital === false ? 'вне капитала' : null,
        ].filter(Boolean).join(' · '))),
      h('span', { class: 'row-end' }, h('span', { class: 'amount' }, money(e.balance, a.currency)), a.currency !== b ? h('span', { class: 'row-sub mono' }, `≈ ${money(e.inBase, b)}`) : null)));
  });
  lk.append(h('button', { class: 'row', onclick: () => openAccountEditor({ preset: 'pledge' }) },
    h('span', { class: 'cat-ico add-ico' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Добавить недоступные деньги'), h('span', { class: 'row-sub' }, 'Залог, заблокированный аккаунт, спор, удержание'))));
  root.append(lk);

  // --- вложения ---
  investSection(root, b);

  // --- обязательства ---
  const debts = st.debts || [];
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Обязательства'), cap.owe > 0 ? h('span', { class: 'mono' }, `долг ${money(cap.owe, b)}`) : null));
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
        h('span', { class: 'row-sub' }, rem === 0 ? 'погашено ✓' : [P.DEBT_KINDS[d.kind]?.label, d.payment ? `${money(d.payment, d.currency)}${d.day ? ` · ${d.day} числа` : ''}` : null, po?.date ? `до ${shortDate(po.date)}` : null].filter(Boolean).join(' · '))),
      h('span', { class: 'row-end' }, h('span', { class: ['amount', isLent && 'inc'] }, money(isLent ? rem : -rem, d.currency)),
        d.currency !== b ? h('span', { class: 'row-sub mono' }, `≈ ${money((isLent ? rem : -rem) * store.rate(d.currency), b)}`) : h('span', { class: 'row-sub mono' }, `${Math.round(prog * 100)}%`))));
  });
  dl.append(h('button', { class: 'row', onclick: () => openDebtEditor({}) },
    h('span', { class: 'cat-ico add-ico' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Добавить обязательство'), h('span', { class: 'row-sub' }, 'Кредит, рассрочка, ипотека, долг или «мне должны»'))));
  root.append(dl);

  // --- рынок ---
  const status = h('span', { class: 'micro' }, s.livePrices ? `Курсы ${agoMin(s.pricesAt)}` : 'Онлайн-курсы выключены в настройках');
  const refreshBtn = h('button', { class: 'chip small', disabled: !s.livePrices, onclick: async () => {
    refreshBtn.disabled = true; status.textContent = 'Обновляем…';
    try { await store.refreshMarket(true); toast('Курсы обновлены'); } catch (e) { toast(e.message || 'Нет связи'); status.textContent = `Курсы ${agoMin(s.pricesAt)}`; refreshBtn.disabled = false; }
  } }, '⟳ Обновить');
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Рынок · топ-100')), h('div', { class: 'status-row' }, status, refreshBtn));
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
      marketList.append(h('button', { class: 'row asset', onclick: () => coinSheet(c.s) },
        h('span', { class: 'rank mono' }, c.rank || ''),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.s, h('span', { class: 'row-sub inline' }, ` ${c.n}`))),
        h('span', { class: 'amount' }, r > 0 ? money(r, b) : '—')));
    });
    if (!ui.marketAll && !q && filtered.length > 10) {
      marketList.append(h('button', { class: 'row more', onclick: () => { ui.marketAll = true; renderMarket(); } }, h('span', { class: 'row-main link' }, `Показать все ${filtered.length}`)));
    }
  };
  root.append(
    h('input', { class: 'field market-search', type: 'search', placeholder: 'Найти монету', value: ui.marketQ, oninput: (e) => { ui.marketQ = e.target.value.trim(); renderMarket(); } }),
    marketList);
  renderMarket();

  if (s.livePrices) store.refreshMarket().catch(() => {});
}
