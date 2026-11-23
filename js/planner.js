// Планировщик: регулярные платежи, обязательства, задачи, цели. Чистые функции.
import { addDays, daysInMonth, monthStart, addMonths, weekday, round2, diffDays, dayKey } from './util.js';

const pad = (n) => String(n).padStart(2, '0');

// ---------- регулярные платежи ----------
/**
 * Даты списаний регулярного платежа в диапазоне [from, to).
 * r: { freq: 'monthly'|'weekly'|'yearly', day, weekday, month, start, end, active }
 */
export function occurrences(r, from, to) {
  if (r.active === false) return [];
  const out = [];
  const start = r.start || '2000-01-01';
  const end = r.end || '9999-12-31';
  const lo = from > start ? from : start;
  if (lo >= to) return out;
  if (r.freq === 'weekly') {
    let d = addDays(lo, ((r.weekday ?? 0) - weekday(lo) + 7) % 7);
    for (; d < to && d <= end; d = addDays(d, 7)) out.push(d);
  } else if (r.freq === 'yearly') {
    for (let y = Number(lo.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      const m = `${y}-${pad(r.month || 1)}-01`;
      const d = m.slice(0, 8) + pad(Math.min(r.day || 1, daysInMonth(m)));
      if (d >= lo && d < to && d <= end) out.push(d);
    }
  } else {
    for (let m = monthStart(lo); m < to; m = addMonths(m, 1)) {
      const d = m.slice(0, 8) + pad(Math.min(r.day || 1, daysInMonth(m)));
      if (d >= lo && d < to && d <= end) out.push(d);
    }
  }
  return out;
}

export function nextOccurrence(r, today = dayKey()) {
  return occurrences(r, today, addDays(today, 400))[0] || null;
}

/** Примерная сумма в месяц (для бюджета). */
export function monthlyAmount(r) {
  if (r.active === false) return 0;
  if (r.freq === 'weekly') return r.amount * 4.345;
  if (r.freq === 'yearly') return r.amount / 12;
  return r.amount;
}

export function freqLabel(r) {
  const WD = ['каждый понедельник', 'каждый вторник', 'каждую среду', 'каждый четверг', 'каждую пятницу', 'каждую субботу', 'каждое воскресенье'];
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  if (r.freq === 'weekly') return WD[r.weekday ?? 0];
  if (r.freq === 'yearly') return `каждый год ${r.day} ${MON[(r.month || 1) - 1]}`;
  return `каждое ${r.day} число`;
}

// ---------- обязательства ----------
export const DEBT_KINDS = {
  loan: { label: 'Кредит', icon: '🏦' },
  installment: { label: 'Рассрочка', icon: '🧾' },
  mortgage: { label: 'Ипотека', icon: '🏠' },
  card: { label: 'Кредитка', icon: '💳' },
  owe: { label: 'Я должен', icon: '🤝' },
  lent: { label: 'Мне должны', icon: '↩️' },
};

export function debtPaid(d) {
  return round2((d.initialPaid || 0) + (d.payments || []).reduce((a, p) => a + p.amount, 0));
}
export function debtRemaining(d) {
  return Math.max(0, round2(d.principal - debtPaid(d)));
}
export function debtProgress(d) {
  return d.principal > 0 ? Math.min(1, debtPaid(d) / d.principal) : 0;
}
/** Сколько ещё платежей и дата последнего. */
export function payoff(d, today = dayKey()) {
  const rem = debtRemaining(d);
  if (!(rem > 0) || !(d.payment > 0)) return null;
  const n = Math.ceil(rem / d.payment - 1e-9);
  const dates = occurrences({ freq: 'monthly', day: d.day || 1, start: today }, today, addMonths(today, n + 2));
  return { n, date: dates[n - 1] || null };
}

/** Плановые платежи по обязательству в диапазоне. Будущие — только пока долг не погашен. */
export function debtEvents(d, from, to, today = dayKey()) {
  if (!(d.payment > 0) || !d.day) return [];
  const all = occurrences({ freq: 'monthly', day: d.day, start: d.start || '2000-01-01' }, from, to);
  const paidMonths = new Set((d.payments || []).map((p) => p.date.slice(0, 7)));
  const rem = debtRemaining(d);
  let futureLeft = Math.ceil(rem / d.payment - 1e-9);
  const thisMonthPaid = paidMonths.has(today.slice(0, 7));
  return all.flatMap((date) => {
    const paid = paidMonths.has(date.slice(0, 7));
    if (date.slice(0, 7) < today.slice(0, 7)) return paid ? [{ date, paid: true }] : [];
    if (paid) return [{ date, paid: true }];
    if (date.slice(0, 7) === today.slice(0, 7) && thisMonthPaid) return [];
    if (futureLeft <= 0) return [];
    futureLeft--;
    return [{ date, paid: false }];
  });
}

/**
 * Все плановые списания в диапазоне: регулярные платежи и платежи по обязательствам.
 * → [{ date, kind, ref, title, amount, currency, icon, paid, overdue }]
 */
const createdDay = (x) => (x.createdAt ? dayKey(new Date(x.createdAt)) : '0000-00-00');

export function plannedEvents(state, from, to, today = dayKey()) {
  const out = [];
  for (const r of state.recurring || []) {
    const born = createdDay(r);
    for (const date of occurrences(r, from, to)) {
      const paid = !!r.paid?.[date];
      if (!paid && date < born) continue; // до создания платежа долгов нет
      out.push({ date, kind: 'recurring', ref: r, title: r.name, amount: r.amount, currency: r.currency, icon: r.icon || '🔁', paid, overdue: !paid && date < today });
    }
  }
  for (const d of state.debts || []) {
    if (d.kind === 'lent') continue;
    const born = createdDay(d);
    for (const e of debtEvents(d, from, to, today)) {
      if (!e.paid && e.date < born) continue;
      out.push({ date: e.date, kind: 'debt', ref: d, title: d.name, amount: Math.min(d.payment, debtRemaining(d) || d.payment), currency: d.currency, icon: DEBT_KINDS[d.kind]?.icon || '🏦', paid: e.paid, overdue: !e.paid && e.date < today });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

// ---------- задачи ----------
export const REPEATS = { none: 'Один раз', daily: 'Каждый день', weekdays: 'По будням', weekly: 'Каждую неделю', monthly: 'Каждый месяц' };

export function taskOn(t, date) {
  const r = t.repeat || 'none';
  if (r === 'none') return t.date === date;
  if (date < t.date || (t.until && date > t.until)) return false;
  if (r === 'daily') return true;
  if (r === 'weekdays') return weekday(date) < 5;
  if (r === 'weekly') return weekday(date) === weekday(t.date);
  if (r === 'monthly') return date.slice(8) === t.date.slice(8);
  return false;
}
export function isDone(t, date) {
  return (t.repeat || 'none') === 'none' ? !!t.done : (t.doneDates || []).includes(date);
}
export function tasksFor(state, date) {
  return (state.tasks || []).filter((t) => taskOn(t, date))
    .sort((a, b) => (isDone(a, date) - isDone(b, date)) || (a.time || '99').localeCompare(b.time || '99') || a.createdAt - b.createdAt);
}
export function overdueTasks(state, today = dayKey()) {
  return (state.tasks || []).filter((t) => (t.repeat || 'none') === 'none' && !t.done && t.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------- цели ----------
export function goalStats(g, today = dayKey()) {
  const saved = (g.contributions || []).reduce((a, c) => a + c.amount, 0);
  const left = Math.max(0, g.target - saved);
  const progress = g.target > 0 ? Math.min(1, saved / g.target) : 0;
  let perMonth = null, daysLeft = null;
  if (g.deadline && left > 0) {
    daysLeft = diffDays(today, g.deadline);
    const months = Math.max(1, daysLeft / 30.4);
    perMonth = daysLeft > 0 ? left / months : left;
  }
  return { saved: round2(saved), left: round2(left), progress, perMonth: perMonth != null ? round2(perMonth) : null, daysLeft };
}
