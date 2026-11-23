// Календарь: тепловая карта трат, будущие списания, дела по дням, регулярные платежи.
import { h, clear, money, dayKey, addDays, monthStart, addMonths, daysInMonth, weekday, monthName, cap, dayTitle, round2, shortDate, WEEKDAYS_SHORT, fullDay } from '../util.js';
import * as store from '../store.js';
import * as P from '../planner.js';
import { openTxnEditor } from './editor.js';
import { txnRow } from './home.js';
import { openRecurringEditor, openTaskEditor, debtSheet } from './planner-sheets.js';
import { buildICS, rruleFor } from '../ics.js';
import { investSheet } from './invest.js';
import { confirmSheet, toast } from '../sheet.js';

const ui = { month: monthStart(dayKey()), sel: dayKey() };

export function eventRow(e, { showDate = false } = {}) {
  const today = dayKey();
  const inc = e.type === 'income';
  const btn = e.paid
    ? h('button', { class: 'pay-chip paid', onclick: (ev) => { ev.stopPropagation(); if (e.kind === 'recurring') store.unpayRecurring(e.ref, e.date); else debtSheet(e.ref); } }, inc ? '✓ получено' : '✓ оплачено')
    : h('button', { class: ['pay-chip', inc && 'income', e.overdue && !inc && 'overdue'], onclick: (ev) => {
      ev.stopPropagation();
      if (e.kind === 'recurring') store.payRecurring(e.ref, e.date);
      else if (e.kind === 'invest') investSheet(e.ref);
      else debtSheet(e.ref);
    } }, e.kind === 'invest' ? 'Забрать' : inc ? 'Получено' : 'Оплатить');
  const when = e.date === today ? 'сегодня' : e.date === addDays(today, 1) ? 'завтра' : shortDate(e.date);
  return h('div', { class: ['row', 'event', e.paid && 'is-paid'], role: 'button', tabindex: '0', onclick: () => (e.kind === 'recurring' ? openRecurringEditor({ item: e.ref }) : e.kind === 'invest' ? investSheet(e.ref) : debtSheet(e.ref)) },
    h('span', { class: 'cat-ico swap' }, e.icon),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, e.title),
      h('span', { class: ['row-sub', e.overdue && !inc && 'neg'] }, e.kind === 'invest' ? `${e.overdue ? 'срок окончен' : 'окончание'} · ${when} · тело ${money(e.principal, e.currency)}` : e.overdue ? `${inc ? 'ожидался' : 'просрочено'} · ${when}` : showDate ? `${when} · ${inc ? 'доход' : e.kind === 'debt' ? 'кредит' : 'регулярный'}` : inc ? 'регулярный доход' : e.kind === 'debt' ? 'обязательство' : 'регулярный платёж')),
    h('span', { class: 'row-end' }, h('span', { class: ['amount', inc && 'inc'] }, money(inc ? e.amount : -e.amount, e.currency, { sign: inc })), btn));
}

export function taskRow(t, date) {
  const done = P.isDone(t, date);
  return h('div', { class: ['row', 'task', done && 'done'], role: 'button', tabindex: '0', onclick: () => openTaskEditor({ item: t }) },
    h('button', { class: ['check', done && 'on'], 'aria-label': done ? 'Отметить невыполненной' : 'Выполнено', onclick: (ev) => { ev.stopPropagation(); store.toggleTask(t, date); } }),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, t.title),
      (t.time || (t.repeat && t.repeat !== 'none')) && h('span', { class: 'row-sub' }, [t.time, t.repeat && t.repeat !== 'none' ? `↻ ${P.REPEATS[t.repeat].toLowerCase()}` : null].filter(Boolean).join(' · '))));
}

export function renderCalendar(root) {
  clear(root);
  const st = store.state();
  const base = st.settings.base;
  const today = dayKey();
  const mS = ui.month, mE = addMonths(mS, 1);

  // данные месяца
  const spend = {}, income = {};
  for (const t of st.txns) {
    if (t.date < mS || t.date >= mE) continue;
    const v = store.inBase(t);
    if (t.type === 'expense') spend[t.date] = (spend[t.date] || 0) + v;
    else if (t.type === 'income') income[t.date] = (income[t.date] || 0) + v;
  }
  const events = P.plannedEvents(st, mS, mE, today);
  const evByDay = {};
  events.forEach((e) => { (evByDay[e.date] ||= []).push(e); });
  const maxSpend = Math.max(1, ...Object.values(spend));
  const totalSpent = Object.values(spend).reduce((a, b) => a + b, 0);
  const planned = events.filter((e) => !e.paid && e.type !== 'income').reduce((a, e) => a + e.amount * store.rate(e.currency), 0);
  const expected = events.filter((e) => !e.paid && e.type === 'income').reduce((a, e) => a + e.amount * store.rate(e.currency), 0);

  root.append(h('h1', { class: 'page-title' }, 'Календарь'));
  root.append(h('div', { class: 'period-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => { ui.month = addMonths(ui.month, -1); renderCalendar(root); } }, '‹'),
    h('button', { class: 'period-label', onclick: () => { ui.month = monthStart(today); ui.sel = today; renderCalendar(root); } },
      cap(monthName(mS)) + (mS.slice(0, 4) === today.slice(0, 4) ? '' : ` ${mS.slice(0, 4)}`)),
    h('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => { ui.month = addMonths(ui.month, 1); renderCalendar(root); } }, '›')));

  root.append(h('div', { class: 'cal-summary' },
    h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'потрачено'), h('span', { class: 'mono' }, money(totalSpent, base))),
    h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'ещё спишется'), h('span', { class: 'mono brass-text' }, money(planned, base))),
    expected > 0 ? h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'ожидается'), h('span', { class: 'mono inc' }, money(expected, base))) : null));

  // сетка
  const grid = h('div', { class: 'cal-grid' });
  WEEKDAYS_SHORT.forEach((w) => grid.append(h('div', { class: 'cal-wd micro' }, w)));
  const lead = weekday(mS);
  for (let i = 0; i < lead; i++) grid.append(h('div', { class: 'cal-cell empty' }));
  const dim = daysInMonth(mS);
  for (let n = 1; n <= dim; n++) {
    const d = addDays(mS, n - 1);
    const sp = spend[d] || 0;
    const ev = evByDay[d] || [];
    const tasks = P.tasksFor(st, d);
    const undone = tasks.filter((t) => !P.isDone(t, d)).length;
    const heat = sp > 0 ? 0.12 + 0.6 * Math.sqrt(sp / maxSpend) : 0;
    grid.append(h('button', {
      class: ['cal-cell', d === today && 'today', d === ui.sel && 'sel', d < today && 'past', ev.some((e) => e.overdue) && 'overdue'],
      style: { '--heat': heat.toFixed(3) },
      'aria-label': dayTitle(d),
      onclick: () => { ui.sel = d; renderCalendar(root); },
    },
    h('span', { class: 'cal-n mono' }, n),
    sp > 0 ? h('span', { class: 'cal-sum mono' }, compactMoney(sp)) : null,
    h('span', { class: 'cal-dots' },
      ev.some((e) => e.type !== 'income') ? h('i', { class: ['dot', 'dot-plan', ev.filter((e) => e.type !== 'income').every((e) => e.paid) && 'paid'] }) : null,
      income[d] || ev.some((e) => e.type === 'income') ? h('i', { class: ['dot', 'dot-inc', !income[d] && 'paid'] }) : null,
      tasks.length ? h('i', { class: ['dot', 'dot-task', undone === 0 && 'paid'] }) : null)));
  }
  root.append(h('section', { class: 'card cal-card' }, grid,
    h('div', { class: 'legend cal-legend' },
      h('span', { class: 'lg lg-heat' }, 'траты'), h('span', { class: 'lg lg-plan' }, 'списание'), h('span', { class: 'lg lg-inc' }, 'доход'), h('span', { class: 'lg lg-task' }, 'дела'))));

  // выбранный день
  const sel = ui.sel;
  const dayEv = P.plannedEvents(st, sel, addDays(sel, 1), today);
  const dayTx = store.sortedTxns().filter((t) => t.date === sel);
  const dayTasks = P.tasksFor(st, sel);
  const dayBox = h('section', { class: 'day-panel' },
    h('div', { class: 'day-panel-head' },
      h('div', {}, h('div', { class: 'micro' }, sel === today ? 'сегодня' : sel > today ? 'впереди' : 'было'), h('h2', { class: 'day-panel-title' }, fullDay(sel))),
      h('div', { class: 'day-actions' },
        h('button', { class: 'chip small', onclick: () => openTxnEditor({ type: 'expense', date: sel }) }, '− Трата'),
        h('button', { class: 'chip small', onclick: () => openTaskEditor({ date: sel }) }, '+ Дело'))));
  if (dayEv.length) dayBox.append(h('div', { class: 'micro list-label' }, 'Списания'), h('div', { class: 'card list' }, dayEv.map((e) => eventRow(e))));
  if (dayTasks.length) dayBox.append(h('div', { class: 'micro list-label' }, 'Дела'), h('div', { class: 'card list' }, dayTasks.map((t) => taskRow(t, sel))));
  if (dayTx.length) dayBox.append(h('div', { class: 'micro list-label' }, 'Операции'), h('div', { class: 'card list' }, dayTx.map((t) => txnRow(t))));
  if (!dayEv.length && !dayTasks.length && !dayTx.length) dayBox.append(h('div', { class: 'empty small' }, sel >= today ? 'Свободный день. Добавьте дело или платёж.' : 'В этот день ничего не записано.'));
  root.append(dayBox);

  // ближайшие 30 дней
  const upcoming = P.plannedEvents(st, addDays(today, -31), addDays(today, 31), today).filter((e) => !e.paid && (e.overdue || e.date >= today));
  if (upcoming.length) {
    const sum = upcoming.reduce((a, e) => a + (e.type === 'income' ? 0 : e.amount * store.rate(e.currency)), 0);
    root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Ближайшие 30 дней'), h('span', { class: 'mono' }, money(sum, base))),
      h('div', { class: 'card list' }, upcoming.slice(0, 12).map((e) => eventRow(e, { showDate: true }))));
  }

  // регулярные платежи
  const rec = st.recurring || [];
  const monthly = round2(rec.filter((r) => r.type !== 'income').reduce((a, r) => a + P.monthlyAmount(r) * store.rate(r.currency), 0));
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Регулярные операции'), rec.length ? h('span', { class: 'mono' }, `−${money(monthly, base)} / мес`) : null));
  const list = h('div', { class: 'card list' });
  [...rec].sort((a, b) => (P.nextOccurrence(a, today) || '9') < (P.nextOccurrence(b, today) || '9') ? -1 : 1).forEach((r) => {
    const next = P.nextOccurrence(r, today);
    list.append(h('button', { class: ['row', r.active === false && 'is-paid'], onclick: () => openRecurringEditor({ item: r }) },
      h('span', { class: 'cat-ico swap' }, r.icon || '🔁'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name),
        h('span', { class: 'row-sub' }, r.active === false ? 'на паузе' : `${P.freqLabel(r)} · следующее ${next ? dayTitle(next, today).split(',')[0].toLowerCase() : '—'}`)),
      h('span', { class: ['amount', r.type === 'income' && 'inc'] }, money(r.type === 'income' ? r.amount : -r.amount, r.currency, { sign: r.type === 'income' }))));
  });
  list.append(h('button', { class: 'row', onclick: () => openRecurringEditor({ date: ui.sel >= today ? ui.sel : today }) },
    h('span', { class: 'cat-ico add-ico' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Регулярное списание'), h('span', { class: 'row-sub' }, 'Аренда, подписки, связь'))));
  list.append(h('button', { class: 'row', onclick: () => openRecurringEditor({ date: ui.sel >= today ? ui.sel : today, type: 'income' }) },
    h('span', { class: 'cat-ico add-ico inc' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Регулярный доход'), h('span', { class: 'row-sub' }, 'Зарплата, аванс, аренда от жильцов'))));
  root.append(list);
  if (rec.length || (st.debts || []).some((d) => d.payment > 0 && d.day) || (st.invest || []).some((v) => !v.closed)) {
    root.append(h('button', { class: 'btn btn-plain ics-btn', onclick: exportToCalendar }, '📅 Напоминания в Календарь iPhone'));
  }
}

function compactMoney(v) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.0', '')}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(v));
}

/** Выгрузка платежей в .ics — Календарь iPhone сам напомнит накануне в 9:00 и в день платежа. */
async function exportToCalendar() {
  const st = store.state();
  const ok = await confirmSheet('Добавить платежи в Календарь iPhone?', {
    ok: 'Создать файл', danger: false,
    detail: 'Названия и суммы попадут в ваш системный календарь (и в iCloud, если он включён). Напоминание — накануне в 9:00 и в день платежа. При изменении платежей файл нужно выгрузить заново.',
  });
  if (!ok) return;
  const today = dayKey();
  const events = [];
  for (const r of st.recurring || []) {
    if (r.active === false) continue;
    const start = P.nextOccurrence(r, today);
    if (!start) continue;
    events.push({ uid: `rec-${r.id}`, title: `${r.type === 'income' ? '↓' : '↑'} ${r.name} · ${money(r.amount, r.currency)}`, description: 'Баланс', start, rrule: rruleFor(r) });
  }
  for (const d of st.debts || []) {
    const po = P.payoff(d, today);
    if (!po || !d.day || d.kind === 'lent') continue;
    const start = P.occurrences({ freq: 'monthly', day: d.day, start: today }, today, addDays(today, 40))[0];
    if (!start) continue;
    events.push({ uid: `debt-${d.id}`, title: `↑ ${d.name} · ${money(d.payment, d.currency)}`, description: `Осталось ${po.n} платеж(ей)`, start, rrule: `${rruleFor({ freq: 'monthly', day: d.day })};COUNT=${po.n}` });
  }
  for (const v of st.invest || []) {
    if (v.closed || v.end < today) continue;
    const s = P.investStats(v, today);
    events.push({ uid: `inv-${v.id}`, title: `◈ Окончание: ${v.name} · +${money(s.expected, v.currency)}`, description: `Тело ${money(v.amount, v.currency)}. Заберите доход в приложении.`, start: v.end, alarms: ['-P1DT15H', '-PT15H', 'PT9H'] });
  }
  if (!events.length) return toast('Нет активных платежей');
  const file = new File([buildICS(events)], 'balans-platezhi.ics', { type: 'text/calendar' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Платежи' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Файл с ${events.length} платежами создан — откройте его, чтобы добавить в Календарь`);
}
