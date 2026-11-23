// Планировщик: регулярные платежи, обязательства, задачи, цели. Чистые функции.
import { addDays, daysInMonth, monthStart, addMonths, weekday, round2, roundAmt, diffDays, dayKey } from './util.js';

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
  return roundAmt((d.initialPaid || 0) + (d.payments || []).reduce((a, p) => a + p.amount, 0), d.currency);
}
export function debtRemaining(d) {
  return Math.max(0, roundAmt(d.principal - debtPaid(d), d.currency));
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
      out.push({ date, kind: 'recurring', type: r.type || 'expense', ref: r, title: r.name, amount: r.amount, currency: r.currency, icon: r.icon || (r.type === 'income' ? '💼' : '🔁'), paid, overdue: !paid && date < today });
    }
  }
  for (const d of state.debts || []) {
    if (d.kind === 'lent') continue;
    const born = createdDay(d);
    for (const e of debtEvents(d, from, to, today)) {
      if (!e.paid && e.date < born) continue;
      out.push({ date: e.date, kind: 'debt', type: 'expense', ref: d, title: d.name, amount: Math.min(d.payment, debtRemaining(d) || d.payment), currency: d.currency, icon: DEBT_KINDS[d.kind]?.icon || '🏦', paid: e.paid, overdue: !e.paid && e.date < today });
    }
  }
  out.push(...investEvents(state, from, to, today));
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

// ---------- прогноз до зарплаты ----------
/**
 * Ближайший ожидаемый доход и сколько можно тратить в день до него.
 * available — сколько денег есть сейчас (в основной валюте); rateOf(cur) — курс к основной.
 * → { date, days, amount, plannedBefore, free, perDay, title } | null
 */
export function paydayForecast(state, available, rateOf, today = dayKey()) {
  const horizon = addDays(today, 62);
  const events = plannedEvents(state, today, horizon, today).filter((e) => !e.paid);
  const income = events.find((e) => e.type === 'income' && e.kind === 'recurring' && e.date >= today);
  if (!income) return null;
  const plannedBefore = events
    .filter((e) => e.type !== 'income' && e.date < income.date)
    .reduce((a, e) => a + e.amount * rateOf(e.currency), 0);
  const days = Math.max(1, diffDays(today, income.date));
  const free = available - plannedBefore;
  return {
    date: income.date, days, title: income.title,
    amount: round2(income.amount * rateOf(income.currency)),
    plannedBefore: round2(plannedBefore), free: round2(free), perDay: round2(Math.max(0, free) / days),
  };
}

// ---------- статистика привычек ----------
/** Последние n дней по повторяющейся задаче: [{ date, due, done }] и процент выполнения. */
export function habitWeek(t, today = dayKey(), n = 7) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const due = taskOn(t, d);
    days.push({ date: d, due, done: due && isDone(t, d) });
  }
  const due = days.filter((x) => x.due).length;
  const done = days.filter((x) => x.done).length;
  return { days, rate: due ? done / due : 0, done, due };
}

// ---------- инвестиции и стейкинг ----------
export const INVEST_KINDS = {
  staking: { label: 'Стейкинг', icon: '◈' },
  deposit: { label: 'Вклад', icon: '🏦' },
  savings: { label: 'Накопительный', icon: '🐷' },
  bond: { label: 'Облигации', icon: '📜' },
  other: { label: 'Другое', icon: '📈' },
};

/**
 * Расчёт позиции: срок, прогресс, накоплено к сегодняшнему дню и к концу срока.
 * inv: { amount, apr (% годовых), start, end, compound }
 */
export function investStats(inv, today = dayKey()) {
  const total = Math.max(1, diffDays(inv.start, inv.end));
  const elapsedRaw = diffDays(inv.start, today);
  const elapsed = Math.min(total, Math.max(0, elapsedRaw));
  const left = Math.max(0, diffDays(today, inv.end));
  const rate = (inv.apr || 0) / 100;
  const grow = (days) => (inv.compound ? inv.amount * ((1 + rate / 365) ** days - 1) : inv.amount * rate * (days / 365));
  return {
    total, elapsed, left,
    progress: elapsed / total,
    accrued: Math.round(grow(elapsed) * 1e6) / 1e6,
    expected: Math.round(grow(total) * 1e6) / 1e6,
    matured: today >= inv.end,
    started: elapsedRaw >= 0,
  };
}

/** События окончания вложений (для календаря и напоминаний). */
export function investEvents(state, from, to, today = dayKey()) {
  return (state.invest || [])
    .filter((v) => !v.closed && v.end >= from && v.end < to)
    .map((v) => {
      const s = investStats(v, today);
      return {
        date: v.end, kind: 'invest', type: 'income', ref: v, title: v.name, amount: s.expected, principal: v.amount,
        currency: v.currency, icon: INVEST_KINDS[v.kind]?.icon || '📈', paid: false, overdue: v.end < today,
      };
    });
}
