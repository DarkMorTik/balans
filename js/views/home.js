// Главный экран: баланс, кнопки «Трата»/«Доход», лента операций.
import { h, clear, money, dayKey, dayTitle, monthStart, addMonths, monthName, cap, round2 } from '../util.js';
import * as store from '../store.js';
import { openTxnEditor } from './editor.js';
import { openSheet } from '../sheet.js';

const ui = { query: '', limit: 120, allTime: false, searchOpen: false };

export function txnRow(t, { showDate = false } = {}) {
  const c = store.category(t.categoryId);
  const base = store.base();
  const foreign = t.currency !== base;
  const sign = t.type === 'income' ? 1 : -1;
  return h('button', { class: 'row txn', onclick: () => openTxnEditor({ txn: t }) },
    h('span', { class: 'cat-ico', style: { '--c': c.color } }, c.icon),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, t.note || c.name),
      h('span', { class: 'row-sub' }, [t.note ? c.name : null, showDate ? dayTitle(t.date) : null].filter(Boolean).join(' · '))),
    h('span', { class: 'row-end' },
      h('span', { class: ['amount', t.type === 'income' && 'inc'] }, money(sign * t.amount, t.currency, { sign: t.type === 'income' })),
      foreign && h('span', { class: 'row-sub' }, money(sign * store.inBase(t), base))));
}

export function txnListSheet(title, txns) {
  const list = h('div', { class: 'card list' });
  const render = () => {
    clear(list);
    const ids = new Set(txns.map((t) => t.id));
    const fresh = store.sortedTxns().filter((t) => ids.has(t.id));
    if (!fresh.length) list.append(h('div', { class: 'empty small' }, 'Нет операций'));
    fresh.forEach((t) => list.append(txnRow(t, { showDate: true })));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title, content: list, onClose: unsub });
}

export function renderHome(root) {
  clear(root);
  const base = store.base();
  const today = dayKey();
  const mS = monthStart(today), mE = addMonths(mS, 1);
  let inc = 0, exp = 0;
  for (const t of store.state().txns) {
    if (!ui.allTime && (t.date < mS || t.date >= mE)) continue;
    const v = store.inBase(t);
    if (t.type === 'income') inc += v; else exp += v;
  }
  const net = round2(inc - exp);

  const head = h('header', { class: 'home-head' },
    h('div', { class: 'home-top' },
      h('button', { class: 'period-toggle', onclick: () => { ui.allTime = !ui.allTime; renderHome(root); } },
        ui.allTime ? 'За всё время' : cap(monthName(today)), h('span', { class: 'chev' }, '⌄')),
      h('button', { class: ['icon-btn', ui.searchOpen && 'on'], 'aria-label': 'Поиск', onclick: () => { ui.searchOpen = !ui.searchOpen; if (!ui.searchOpen) ui.query = ''; renderHome(root); if (ui.searchOpen) root.querySelector('.search')?.focus(); } }, searchIcon())),
    h('div', { class: ['balance', net < 0 && 'neg'] }, money(net, base, { sign: true })),
    h('div', { class: 'balance-sub' },
      h('span', { class: 'inc' }, `+${money(inc, base)}`),
      h('span', { class: 'dot-sep' }, '·'),
      h('span', {}, `−${money(exp, base)}`)));

  const actions = h('div', { class: 'big-actions' },
    h('button', { class: 'big-btn exp', onclick: () => openTxnEditor({ type: 'expense' }) }, h('span', { class: 'big-ico' }, '−'), 'Трата'),
    h('button', { class: 'big-btn inc', onclick: () => openTxnEditor({ type: 'income' }) }, h('span', { class: 'big-ico' }, '+'), 'Доход'));

  root.append(head, actions);

  if (ui.searchOpen) {
    root.append(h('input', {
      class: 'field search', type: 'search', placeholder: 'Поиск по описанию, ярлыку, сумме', value: ui.query, enterkeyhint: 'search',
      oninput: (e) => { ui.query = e.target.value; renderList(); },
    }));
  }

  const listWrap = h('div', { class: 'feed' });
  root.append(listWrap);

  function renderList() {
    clear(listWrap);
    let txns = store.sortedTxns();
    const q = ui.query.trim().toLowerCase();
    if (q) {
      txns = txns.filter((t) => {
        const c = store.category(t.categoryId);
        return (t.note || '').toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || String(t.amount).includes(q.replace(',', '.'));
      });
    }
    if (!txns.length) {
      listWrap.append(h('div', { class: 'empty' },
        h('div', { class: 'empty-ico' }, q ? '🔍' : '✦'),
        q ? 'Ничего не найдено' : 'Пока нет операций',
        !q && h('div', { class: 'muted small' }, 'Нажмите «Трата» или «Доход», чтобы добавить первую.')));
      return;
    }
    const shown = txns.slice(0, ui.limit);
    let day = null, group = null, dayNet = 0, dayHead = null;
    const flush = () => { if (dayHead) dayHead.lastChild.textContent = money(dayNet, base, { sign: true }); };
    for (const t of shown) {
      if (t.date !== day) {
        flush();
        day = t.date; dayNet = 0;
        dayHead = h('div', { class: 'day-head' }, h('span', {}, dayTitle(day, today)), h('span', {}));
        group = h('div', { class: 'card list' });
        listWrap.append(dayHead, group);
      }
      dayNet += (t.type === 'income' ? 1 : -1) * store.inBase(t);
      group.append(txnRow(t));
    }
    flush();
    if (txns.length > ui.limit) {
      listWrap.append(h('button', { class: 'btn btn-plain', onclick: () => { ui.limit += 200; renderList(); } }, `Показать ещё (${txns.length - ui.limit})`));
    }
  }
  renderList();
}

function searchIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'ico');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM20 20l-4.8-4.8');
  svg.append(p);
  return svg;
}
