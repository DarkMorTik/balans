// Аналитика и «умный анализатор». Чистые функции, всё считается на устройстве.
import {
  round2, dayKey, addDays, diffDays, monthStart, addMonths, daysInMonth, weekStart, weekday,
  monthName, monthShort, cap, shortDate, parseDay, WEEKDAYS_PLURAL, WEEKDAYS_SHORT, money, plural,
} from './util.js';

/** Операции с суммой в основной валюте (поле v). */
export function enrich(state) {
  const base = state.settings.base;
  return state.txns.map((t) => ({ ...t, v: round2(t.amount * (t.currency === base ? 1 : t.rate || 0)) }));
}

const inRange = (t, start, end) => t.date >= start && t.date < end;

export function totals(txns, start, end) {
  let inc = 0, exp = 0, count = 0;
  for (const t of txns) {
    if (!inRange(t, start, end) || (t.type !== 'income' && t.type !== 'expense')) continue;
    count++;
    if (t.type === 'income') inc += t.v; else exp += t.v;
  }
  return { inc: round2(inc), exp: round2(exp), net: round2(inc - exp), count };
}

// ---------- периоды ----------
export function period(mode, anchor) {
  let start, end, label, prevStart;
  if (mode === 'week') {
    start = weekStart(anchor);
    end = addDays(start, 7);
    prevStart = addDays(start, -7);
    label = `${shortDate(start)} – ${shortDate(addDays(end, -1))}`;
  } else if (mode === 'year') {
    start = `${anchor.slice(0, 4)}-01-01`;
    end = `${Number(anchor.slice(0, 4)) + 1}-01-01`;
    prevStart = `${Number(anchor.slice(0, 4)) - 1}-01-01`;
    label = anchor.slice(0, 4);
  } else {
    start = monthStart(anchor);
    end = addMonths(start, 1);
    prevStart = addMonths(start, -1);
    const y = start.slice(0, 4);
    label = cap(monthName(start)) + (y === dayKey().slice(0, 4) ? '' : ` ${y}`);
  }
  return { mode, start, end, label, prev: { start: prevStart, end: start } };
}

export function shiftAnchor(mode, anchor, dir) {
  if (mode === 'week') return addDays(anchor, 7 * dir);
  if (mode === 'year') return `${Number(anchor.slice(0, 4)) + dir}-06-15`;
  return addMonths(anchor, dir);
}

/** Корзины для столбчатой диаграммы. */
export function buckets(txns, p) {
  const out = [];
  if (p.mode === 'year') {
    for (let m = 0; m < 12; m++) {
      const s = addMonths(p.start, m);
      const e = addMonths(p.start, m + 1);
      out.push({ key: s, label: monthShort(s), long: cap(monthName(s)), ...totals(txns, s, e) });
    }
  } else {
    for (let d = p.start; d < p.end; d = addDays(d, 1)) {
      const lbl = p.mode === 'week' ? WEEKDAYS_SHORT[weekday(d)] : String(parseDay(d).getDate());
      out.push({ key: d, label: lbl, long: shortDate(d), ...totals(txns, d, addDays(d, 1)) });
    }
  }
  return out;
}

/** Нарастающий итог расходов внутри периода + прогноз (только для текущего месяца). */
export function cumulative(txns, p, today = dayKey()) {
  if (p.mode === 'year') return null;
  const pts = [];
  let acc = 0;
  for (let d = p.start; d < p.end; d = addDays(d, 1)) {
    if (d > today) break;
    acc += totals(txns, d, addDays(d, 1)).exp;
    pts.push({ key: d, value: round2(acc) });
  }
  const totalDays = diffDays(p.start, p.end);
  let forecast = null;
  if (p.mode === 'month' && today >= p.start && today < p.end && pts.length >= 3) {
    const passed = pts.length;
    const daily = acc / passed;
    forecast = { from: pts.length - 1, value: round2(acc + daily * (totalDays - passed)), days: totalDays };
  }
  // прошлый период для сравнения
  const prev = [];
  let pacc = 0;
  for (let d = p.prev.start, i = 0; d < p.prev.end && i < totalDays; d = addDays(d, 1), i++) {
    pacc += totals(txns, d, addDays(d, 1)).exp;
    prev.push(round2(pacc));
  }
  return { pts, forecast, totalDays, prev };
}

export function byCategory(txns, start, end, type, catOf) {
  const map = new Map();
  let total = 0;
  for (const t of txns) {
    if (t.type !== type || !inRange(t, start, end)) continue;
    const e = map.get(t.categoryId) || { id: t.categoryId, total: 0, count: 0 };
    e.total += t.v; e.count++;
    map.set(t.categoryId, e);
    total += t.v;
  }
  return [...map.values()]
    .map((e) => ({ ...e, total: round2(e.total), share: total ? e.total / total : 0, cat: catOf(e.id) }))
    .sort((a, b) => b.total - a.total);
}

/** Тенденция по месяцам и наклон линейной регрессии. */
export function trend(txns, today = dayKey(), months = 6) {
  const cur = monthStart(today);
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {
    const s = addMonths(cur, -i);
    const e = addMonths(s, 1);
    rows.push({ key: s, label: monthShort(s), ...totals(txns, s, e), partial: i === 0 });
  }
  // регрессия по завершённым месяцам с данными
  const done = rows.filter((r) => !r.partial);
  const firstIdx = done.findIndex((r) => r.count > 0);
  const pts = firstIdx >= 0 ? done.slice(firstIdx) : [];
  let slopePct = null, line = null;
  if (pts.length >= 3) {
    const n = pts.length;
    const xs = pts.map((_, i) => i);
    const ys = pts.map((r) => r.exp);
    const mx = xs.reduce((a, b) => a + b) / n;
    const my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = den ? num / den : 0;
    const icpt = my - slope * mx;
    slopePct = my > 0 ? (slope / my) * 100 : null;
    line = { a: slope, b: icpt, offset: rows.indexOf(pts[0]) }; // x в регрессии отсчитывается от offset
  }
  return { rows, slopePct, line };
}

// ---------- статистика ----------
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Умный анализатор. Возвращает список находок:
 * { key, level: 'warn'|'info'|'good', icon, title, text, ids? }
 */
export function insights(state, catOf, today = dayKey(), rateOf = null) {
  const base = state.settings.base;
  const fmt = (v) => money(v, base);
  const txns = enrich(state);
  const exps = txns.filter((t) => t.type === 'expense' && t.date <= today);
  const out = [];
  const dismissed = new Set(state.dismissed || []);
  const push = (x) => { if (!dismissed.has(x.key)) out.push(x); };

  if (!exps.length) return out;

  const mStart = monthStart(today);
  const mEnd = addMonths(mStart, 1);
  const month = totals(txns, mStart, mEnd);
  const prevMonth = totals(txns, addMonths(mStart, -1), mStart);
  const passed = diffDays(mStart, today) + 1;
  const dim = daysInMonth(today);

  // 1. Прогноз на конец месяца
  if (passed >= 5 && month.exp > 0) {
    const projected = month.exp / passed * dim;
    const incomeRef = Math.max(month.inc, prevMonth.inc);
    if (incomeRef > 0 && projected > incomeRef * 1.02) {
      push({
        key: `fc-over:${mStart}`, level: 'warn', icon: '⚠️',
        title: 'Расходы могут превысить доходы',
        text: `При текущем темпе к концу месяца вы потратите около ${fmt(projected)}, а доход ${fmt(incomeRef)}. Чтобы уложиться, тратьте не больше ${fmt(Math.max(0, (incomeRef - month.exp) / Math.max(1, dim - passed + 1)))} в день.`,
      });
    } else if (prevMonth.exp > 0) {
      const diff = (projected - prevMonth.exp) / prevMonth.exp * 100;
      if (Math.abs(diff) >= 10) {
        push({
          key: `fc:${mStart}:${diff > 0 ? 'up' : 'down'}`, level: diff > 0 ? 'warn' : 'good', icon: diff > 0 ? '📈' : '📉',
          title: diff > 0 ? `Темп трат выше на ${Math.round(diff)}%` : `Темп трат ниже на ${Math.round(-diff)}%`,
          text: `Прогноз расходов за месяц: ${fmt(projected)} против ${fmt(prevMonth.exp)} в прошлом месяце.`,
        });
      }
    }
  }

  // 2. Аномально крупные траты (выбросы по ярлыку, медиана + MAD)
  const since180 = addDays(today, -180);
  const since30 = addDays(today, -30);
  const byCat = new Map();
  exps.filter((t) => t.date >= since180).forEach((t) => {
    if (!byCat.has(t.categoryId)) byCat.set(t.categoryId, []);
    byCat.get(t.categoryId).push(t);
  });
  for (const [cid, list] of byCat) {
    if (list.length < 6) continue;
    const vals = list.map((t) => t.v);
    const med = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - med))) * 1.4826;
    const limit = mad > 0 ? Math.max(med + 4 * mad, med * 2) : med * 3;
    list.filter((t) => t.date >= since30 && t.v > limit && med > 0).forEach((t) => {
      push({
        key: `out:${t.id}`, level: 'warn', icon: '🔺',
        title: `Необычно крупная трата: ${catOf(cid).name}`,
        text: `${fmt(t.v)} ${shortDate(t.date)}${t.note ? ` («${t.note}»)` : ''} — в ${(t.v / med).toFixed(1)} раза больше обычного (${fmt(med)}).`,
        ids: [t.id],
      });
    });
  }

  // 3. Растущие категории: последние 30 дней против среднего за 3 предыдущих периода
  const cur30 = new Map(), prev90 = new Map();
  let total30 = 0;
  exps.forEach((t) => {
    if (t.date > since30) { cur30.set(t.categoryId, (cur30.get(t.categoryId) || 0) + t.v); total30 += t.v; }
    else if (t.date > addDays(today, -120)) prev90.set(t.categoryId, (prev90.get(t.categoryId) || 0) + t.v);
  });
  const hasHistory = exps.some((t) => t.date <= addDays(today, -90));
  if (hasHistory) {
    for (const [cid, cur] of cur30) {
      const avg = (prev90.get(cid) || 0) / 3;
      if (avg > 0 && cur > avg * 1.4 && cur - avg > total30 * 0.05) {
        push({
          key: `grow:${cid}:${mStart}`, level: 'warn', icon: '📊',
          title: `${catOf(cid).name}: рост на ${Math.round((cur / avg - 1) * 100)}%`,
          text: `За 30 дней ${fmt(cur)}, обычно около ${fmt(avg)} в месяц. Лишние ${fmt(cur - avg)}.`,
          ids: exps.filter((t) => t.categoryId === cid && t.date > since30).map((t) => t.id),
        });
      }
    }
  }

  // 4. Мелкие частые траты — «утечки»
  const recentVals = exps.filter((t) => t.date > addDays(today, -90)).map((t) => t.v);
  const globalMed = median(recentVals);
  const small = new Map();
  exps.filter((t) => t.date > since30 && t.v <= globalMed).forEach((t) => {
    const e = small.get(t.categoryId) || { n: 0, sum: 0, ids: [] };
    e.n++; e.sum += t.v; e.ids.push(t.id);
    small.set(t.categoryId, e);
  });
  for (const [cid, e] of small) {
    if (e.n >= 8 && e.sum >= total30 * 0.07) {
      push({
        key: `leak:${cid}:${mStart}`, level: 'info', icon: '💧',
        title: `Мелкие траты: ${catOf(cid).name}`,
        text: `${e.n} ${plural(e.n, 'раз', 'раза', 'раз')} за 30 дней на ${fmt(e.sum)}. В год это около ${fmt(e.sum * 12)}.`,
        ids: e.ids,
      });
    }
  }

  // 5. Возможные дубли
  const seen = new Map();
  txns.filter((t) => t.date > addDays(today, -60) && t.type !== 'adjust').forEach((t) => {
    const k = [t.type, t.amount, t.currency, t.categoryId, t.date].join('|');
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(t);
  });
  for (const list of seen.values()) {
    if (list.length < 2) continue;
    const t = list[0];
    push({
      key: `dup:${list.map((x) => x.id).sort().join(',')}`, level: 'warn', icon: '⧉',
      title: 'Возможный дубль',
      text: `${list.length} одинаковые операции ${fmt(t.v)} (${catOf(t.categoryId).name}) ${shortDate(t.date)}. Проверьте, не внесено ли дважды.`,
      ids: list.map((x) => x.id),
    });
  }

  // 6. Регулярные платежи (подписки)
  const groups = new Map();
  exps.forEach((t) => {
    const k = t.note ? `n:${norm(t.note)}` : `c:${t.categoryId}:${Math.round(t.v)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  const subs = [];
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const vals = list.map((t) => t.v);
    const med = median(vals);
    if (!vals.every((v) => Math.abs(v - med) <= med * 0.1)) continue;
    const gaps = list.slice(1).map((t, i) => diffDays(list[i].date, t.date));
    const monthly = gaps.every((g) => g >= 26 && g <= 35);
    const weekly = gaps.every((g) => g >= 6 && g <= 8);
    if (!(monthly || weekly)) continue;
    if (diffDays(list.at(-1).date, today) > (monthly ? 40 : 10)) continue;
    subs.push({ list, perMonth: monthly ? med : med * 4.33, name: list.at(-1).note || catOf(list[0].categoryId).name });
  }
  if (subs.length) {
    const sum = subs.reduce((a, b) => a + b.perMonth, 0);
    push({
      key: `subs:${subs.length}:${Math.round(sum)}`, level: 'info', icon: '🔁',
      title: `Регулярные платежи: ${subs.length}`,
      text: `${subs.map((x) => x.name).join(', ')}. Итого ≈ ${fmt(sum)} в месяц / ${fmt(sum * 12)} в год. Все ли ещё нужны?`,
      ids: subs.flatMap((x) => x.list.map((t) => t.id)),
    });
  }

  // 7. Лимиты по ярлыкам
  for (const c of state.categories) {
    if (!(c.limit > 0)) continue;
    const spent = txns.filter((t) => t.type === 'expense' && t.categoryId === c.id && inRange(t, mStart, mEnd)).reduce((a, t) => a + t.v, 0);
    const proj = passed >= 3 ? spent / passed * dim : spent;
    if (spent >= c.limit) {
      push({ key: `lim-over:${c.id}:${mStart}`, level: 'warn', icon: '⛔', title: `Лимит «${c.name}» превышен`, text: `Потрачено ${fmt(spent)} из ${fmt(c.limit)} (+${fmt(spent - c.limit)}).` });
    } else if (proj > c.limit && spent >= c.limit * 0.5) {
      const daysLeft = Math.floor((c.limit - spent) / (spent / passed));
      push({ key: `lim-soon:${c.id}:${mStart}`, level: 'warn', icon: '⏳', title: `Лимит «${c.name}» скоро закончится`, text: `Осталось ${fmt(c.limit - spent)}. При текущем темпе хватит примерно на ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}.` });
    }
  }

  // 8. День недели с наибольшими тратами
  const last90 = exps.filter((t) => t.date > addDays(today, -90));
  if (last90.length >= 20) {
    const byWd = Array(7).fill(0);
    last90.forEach((t) => { byWd[weekday(t.date)] += t.v; });
    const mean = byWd.reduce((a, b) => a + b) / 7;
    const max = Math.max(...byWd);
    const wd = byWd.indexOf(max);
    if (mean > 0 && max > mean * 1.6) {
      push({ key: `wd:${wd}:${mStart}`, level: 'info', icon: '📅', title: `Больше всего тратите по ${WEEKDAYS_PLURAL[wd]}`, text: `В среднем на ${Math.round((max / mean - 1) * 100)}% больше, чем в обычный день.` });
    }
  }

  // 9. Норма сбережений
  if (prevMonth.inc > 0 && prevMonth.count >= 5) {
    const rate = prevMonth.net / prevMonth.inc;
    if (rate >= 0.2) push({ key: `save:${mStart}`, level: 'good', icon: '✅', title: `Вы сохранили ${Math.round(rate * 100)}% дохода`, text: `В прошлом месяце остаток ${fmt(prevMonth.net)}. Отличный результат.` });
    else if (rate < 0) push({ key: `deficit:${mStart}`, level: 'warn', icon: '🔻', title: 'Прошлый месяц в минусе', text: `Расходы превысили доходы на ${fmt(-prevMonth.net)}.` });
  }

  // 10. Нагрузка обязательных платежей (регулярные + кредиты) относительно дохода
  if (rateOf && ((state.recurring || []).some((r) => r.type !== 'income') || (state.debts || []).length)) {
    const rec = (state.recurring || []).filter((r) => r.active !== false && r.type !== 'income')
      .reduce((a, r) => a + (r.freq === 'weekly' ? r.amount * 4.345 : r.freq === 'yearly' ? r.amount / 12 : r.amount) * rateOf(r.currency), 0);
    const loans = (state.debts || []).filter((d) => d.kind !== 'lent' && d.payment > 0)
      .reduce((a, d) => a + d.payment * rateOf(d.currency), 0);
    const fixed = rec + loans;
    const incRef = Math.max(month.inc, prevMonth.inc);
    if (fixed > 0 && incRef > 0) {
      const share = fixed / incRef;
      push({
        key: `fixed:${mStart}:${Math.round(share * 20)}`, level: share > 0.5 ? 'warn' : 'info', icon: '📌',
        title: `Обязательные платежи: ${Math.round(share * 100)}% дохода`,
        text: `${fmt(fixed)} в месяц уходит на регулярные платежи${loans ? ' и кредиты' : ''}. ${share > 0.5 ? 'Это больше половины дохода — стоит пересмотреть подписки или условия кредитов.' : 'Свободно остаётся около ' + fmt(incRef - fixed) + '.'}`,
      });
    }
  }

  const order = { warn: 0, info: 1, good: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
