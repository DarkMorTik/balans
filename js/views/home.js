// Главный экран: «купюра» месяца, действия, лента операций.
import { h, clear, money, dayKey, dayTitle, monthStart, addMonths, addDays, monthName, cap, round2, fullDay, isCrypto, plural } from '../util.js';
import * as store from '../store.js';
import { openTxnEditor, openExchangeEditor } from './editor.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { guilloche } from '../guilloche.js';
import * as P from '../planner.js';
import { eventRow, taskRow } from './calendar.js';
import { useTemplate, openTemplateEditor, openSmartInput } from './money-sheets.js';

/** Сколько денег есть сейчас: сумма счетов или (если счетов нет) фиатные остатки по операциям. */
export function availableNow() {
  const accs = store.liquidAccounts();
  if (!accs.length) return null;
  const b = store.accountBalances();
  return accs.reduce((a, x) => a + (b[x.id]?.inBase || 0), 0);
}

const nav = (to) => window.dispatchEvent(new CustomEvent('nav', { detail: to }));

function todayTicket(st, today) {
  const events = P.plannedEvents(st, addDays(today, -31), addDays(today, 8), today).filter((e) => !e.paid && e.type !== 'income' && (e.overdue || e.date >= today));
  const tasks = P.tasksFor(st, today);
  const over = P.overdueTasks(st, today);
  const cash = availableNow();
  const pay = cash == null ? null : P.paydayForecast(st, cash, store.rate, today);
  const maturing = P.investEvents(st, addDays(today, -60), addDays(today, 8), today);
  if (!events.length && !tasks.length && !over.length && !pay && !maturing.length) return null;
  const done = tasks.filter((t) => P.isDone(t, today)).length;
  const base = st.settings.base;
  const t = h('section', { class: 'ticket' },
    h('div', { class: 'ticket-head' }, h('span', { class: 'micro' }, `Чек дня · ${fullDay(today).split(',')[0]}`),
      h('button', { class: 'micro link-micro', onclick: () => nav('calendar') }, 'Календарь ›')));
  if (pay) {
    t.append(h('div', { class: 'payday' },
      h('div', { class: 'payday-main' },
        h('span', { class: 'micro' }, `до «${pay.title}» · ${pay.days} ${plural(pay.days, 'день', 'дня', 'дней')}`),
        h('span', { class: ['payday-sum', 'mono', pay.free < 0 && 'neg'] }, `${money(pay.perDay, base)} / день`)),
      h('div', { class: 'payday-sub muted small' },
        pay.free < 0
          ? `Не хватает ${money(-pay.free, base)}: до дохода спишется ${money(pay.plannedBefore, base)}.`
          : `Свободно ${money(pay.free, base)}${pay.plannedBefore ? ` после списаний на ${money(pay.plannedBefore, base)}` : ''}.`)));
    if (events.length || tasks.length || over.length) t.append(h('div', { class: 'perf' }));
  }
  if (maturing.length) {
    t.append(h('div', { class: 'ticket-label micro' }, 'Вложения заканчиваются'), h('div', { class: 'list' }, maturing.slice(0, 3).map((e) => eventRow(e, { showDate: true }))));
    if (events.length || tasks.length || over.length) t.append(h('div', { class: 'perf' }));
  }
  if (events.length) {
    t.append(h('div', { class: 'ticket-label micro' }, 'Скоро спишется'), h('div', { class: 'list' }, events.slice(0, 3).map((e) => eventRow(e, { showDate: true }))));
    if (events.length > 3) t.append(h('button', { class: 'ticket-more micro', onclick: () => nav('calendar') }, `ещё ${events.length - 3}`));
  }
  if (events.length && (tasks.length || over.length)) t.append(h('div', { class: 'perf' }));
  if (tasks.length || over.length) {
    t.append(h('div', { class: 'ticket-label micro' }, h('span', {}, 'Дела на сегодня'), h('span', { class: 'mono' }, `${done}/${tasks.length}${over.length ? ` · просрочено ${over.length}` : ''}`)));
    const undone = tasks.filter((x) => !P.isDone(x, today));
    t.append(h('div', { class: 'list' }, (undone.length ? undone : tasks).slice(0, 3).map((x) => taskRow(x, today))));
    t.append(h('button', { class: 'ticket-more micro', onclick: () => nav('plans') }, 'Все дела ›'));
  }
  return t;
}

const ui = { query: '', limit: 120, allTime: false, searchOpen: false };

function openAdjust(t) {
  const sh = openSheet({
    title: 'Корректировка', className: 'sheet-compact',
    content: h('div', { class: 'confirm' },
      h('div', { class: 'confirm-text mono' }, money(t.amount, t.currency, { sign: true })),
      h('div', { class: 'confirm-detail' }, `${dayTitle(t.date)}. Изменяет остаток в портфеле, но не считается доходом или расходом.`),
      h('button', { class: 'btn btn-danger', onclick: async () => {
        if (await confirmSheet('Удалить корректировку?')) { await store.deleteTxn(t.id); sh.close(); toast('Удалено'); }
      } }, 'Удалить'),
      h('button', { class: 'btn btn-plain', onclick: () => sh.close() }, 'Закрыть')),
  });
}

export function txnRow(t, { showDate = false } = {}) {
  const base = store.base();
  if (t.type === 'exchange') {
    return h('button', { class: 'row txn', onclick: () => openExchangeEditor({ txn: t }) },
      h('span', { class: 'cat-ico swap' }, '⇄'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, t.note || `${t.currency} → ${t.toCurrency}`),
        h('span', { class: 'row-sub' }, ['Обмен', showDate ? dayTitle(t.date) : null].filter(Boolean).join(' · '))),
      h('span', { class: 'row-end' },
        h('span', { class: 'amount inc' }, money(t.toAmount, t.toCurrency, { sign: true })),
        h('span', { class: 'row-sub mono' }, money(-t.amount, t.currency))));
  }
  if (t.type === 'adjust') {
    return h('button', { class: 'row txn', onclick: () => openAdjust(t) },
      h('span', { class: 'cat-ico swap' }, '±'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, 'Корректировка остатка'),
        h('span', { class: 'row-sub' }, [t.currency, showDate ? dayTitle(t.date) : null].filter(Boolean).join(' · '))),
      h('span', { class: 'row-end' }, h('span', { class: 'amount' }, money(t.amount, t.currency, { sign: true }))));
  }
  const c = store.category(t.categoryId);
  const foreign = t.currency !== base;
  const sign = t.type === 'income' ? 1 : -1;
  return h('button', { class: 'row txn', onclick: () => openTxnEditor({ txn: t }) },
    h('span', { class: 'cat-ico', style: { '--c': c.color } }, c.icon),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, t.note || c.name),
      h('span', { class: 'row-sub' }, [t.note ? c.name : null, showDate ? dayTitle(t.date) : null].filter(Boolean).join(' · '))),
    h('span', { class: 'row-end' },
      h('span', { class: ['amount', t.type === 'income' && 'inc'] }, money(sign * t.amount, t.currency, { sign: t.type === 'income' })),
      foreign && h('span', { class: 'row-sub mono' }, money(sign * store.inBase(t), base))));
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

function searchIcon() {
  return h('span', { class: 'ico-search', 'aria-hidden': 'true' });
}

export function renderHome(root) {
  clear(root);
  const base = store.base();
  const today = dayKey();
  const mS = monthStart(today), mE = addMonths(mS, 1);
  let inc = 0, exp = 0, count = 0;
  for (const t of store.state().txns) {
    if (t.type !== 'income' && t.type !== 'expense') continue;
    if (!ui.allTime && (t.date < mS || t.date >= mE)) continue;
    const v = store.inBase(t);
    count++;
    if (t.type === 'income') inc += v; else exp += v;
  }
  const net = round2(inc - exp);
  const health = inc > 0 ? net / inc : exp > 0 ? -1 : 0;
  const periodLabel = ui.allTime ? 'за всё время' : `${monthName(today)} ${today.slice(0, 4)}`;

  // --- «купюра» ---
  const note = h('section', { class: ['note', net < 0 && 'neg'] },
    guilloche({ w: 360, h: 190, seed: ui.allTime ? 'all' : mS, health }),
    h('div', { class: 'note-top' },
      h('button', { class: 'micro note-period', onclick: () => { ui.allTime = !ui.allTime; renderHome(root); }, 'aria-label': 'Сменить период' },
        `Баланс · ${periodLabel}`, h('span', { class: 'chev' }, ' ⌄')),
      h('span', { class: 'note-tools' }, h('button', { class: 'icon-btn mic', 'aria-label': 'Голосовой ввод', onclick: () => openSmartInput({ listen: true }) }, h('span', { class: 'mic-ico small' })),
      h('button', { class: ['icon-btn', ui.searchOpen && 'on'], 'aria-label': 'Поиск', onclick: () => {
        ui.searchOpen = !ui.searchOpen;
        if (!ui.searchOpen) ui.query = '';
        renderHome(root);
        if (ui.searchOpen) root.querySelector('.search')?.focus();
      } }, searchIcon()),
      h('button', { class: 'icon-btn gear', 'aria-label': 'Настройки', onclick: () => nav('settings') }, '⚙'))),
    h('div', { class: 'note-sum' }, money(net, base, { sign: true })),
    h('div', { class: 'note-foot' },
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'приход'), h('span', { class: 'mono inc' }, money(inc, base))),
      h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'расход'), h('span', { class: 'mono' }, money(exp, base))),
      h('span', { class: 'serial mono' }, `№ ${ui.allTime ? 'Σ' : today.slice(0, 7).replace('-', '·')}·${String(count).padStart(3, '0')}`)));

  const actions = h('div', { class: 'dock-actions' },
    h('button', { class: 'act act-exp', onclick: () => openTxnEditor({ type: 'expense' }) }, h('span', { class: 'act-sign' }, '−'), 'Трата'),
    h('button', { class: 'act act-inc', onclick: () => openTxnEditor({ type: 'income' }) }, h('span', { class: 'act-sign' }, '+'), 'Доход'),
    h('button', { class: 'act act-swap', onclick: () => openExchangeEditor({}), 'aria-label': 'Обмен' }, h('span', { class: 'act-sign' }, '⇄'), 'Обмен'));

  root.append(note, actions);
  root.append(templatesRow());
  const ticket = todayTicket(store.state(), today);
  if (ticket) root.append(ticket);

  if (ui.searchOpen) {
    root.append(h('input', {
      class: 'field search', type: 'search', placeholder: 'Описание, ярлык или сумма', value: ui.query, enterkeyhint: 'search',
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
        return (t.note || '').toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
          || String(t.amount).includes(q.replace(',', '.')) || (t.currency + (t.toCurrency || '')).toLowerCase().includes(q);
      });
    }
    if (!txns.length) {
      listWrap.append(h('div', { class: 'empty' },
        h('div', { class: 'empty-ico' }, q ? '⌕' : '✦'),
        q ? 'Ничего не найдено' : 'Здесь появятся операции',
        !q && h('div', { class: 'muted small' }, 'Добавьте первую трату или доход кнопками выше.')));
      return;
    }
    const shown = txns.slice(0, ui.limit);
    let day = null, group = null, dayNet = 0, dayHead = null;
    const flush = () => { if (dayHead) dayHead.lastChild.textContent = dayNet ? money(dayNet, base, { sign: true }) : ''; };
    for (const t of shown) {
      if (t.date !== day) {
        flush();
        day = t.date; dayNet = 0;
        dayHead = h('div', { class: 'day-head' }, h('span', { class: 'micro' }, dayTitle(day, today)), h('span', { class: 'mono' }));
        group = h('div', { class: 'card list' });
        listWrap.append(dayHead, group);
      }
      if (t.type === 'income' || t.type === 'expense') dayNet += (t.type === 'income' ? 1 : -1) * store.inBase(t);
      group.append(txnRow(t));
    }
    flush();
    if (txns.length > ui.limit) {
      listWrap.append(h('button', { class: 'btn btn-plain', onclick: () => { ui.limit += 200; renderList(); } }, `Показать ещё ${txns.length - ui.limit}`));
    }
  }
  renderList();
}

function templatesRow() {
  const tpls = store.items('templates');
  const row = h('div', { class: 'tpl-row', role: 'list' });
  tpls.forEach((tp) => {
    let timer = null, long = false;
    const btn = h('button', {
      class: ['tpl-chip', tp.type === 'income' && 'inc'], role: 'listitem',
      onclick: () => { if (!long) useTemplate(tp); long = false; },
      oncontextmenu: (e) => { e.preventDefault(); openTemplateEditor({ item: tp }); },
    }, h('span', { class: 'tpl-ico' }, tp.icon || '•'), h('span', {}, tp.name), h('span', { class: 'mono tpl-sum' }, money(tp.amount, tp.currency)));
    // долгое нажатие — редактировать
    btn.addEventListener('touchstart', () => { long = false; timer = setTimeout(() => { long = true; openTemplateEditor({ item: tp }); }, 550); }, { passive: true });
    ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => btn.addEventListener(ev, () => clearTimeout(timer), { passive: true }));
    row.append(btn);
  });
  row.append(h('button', { class: 'tpl-chip add', onclick: () => openTemplateEditor({}) }, '+', h('span', {}, tpls.length ? 'Шаблон' : 'Шаблон быстрой траты')));
  row.append(h('button', { class: 'tpl-chip add', onclick: () => openSmartInput({}) }, '⌨', h('span', {}, 'Ввод текстом')));
  return row;
}
