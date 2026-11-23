// Бюджет месяца «план / факт»: лимиты по ярлыкам, распределение дохода.
import { h, clear, money, parseAmount, dayKey, diffDays, addMonths, monthStart, round2 } from '../util.js';
import * as store from '../store.js';
import * as A from '../analytics.js';
import * as P from '../planner.js';
import { openSheet, toast } from '../sheet.js';

/** Средние траты по ярлыкам за до 3 прошлых месяцев; без истории — прогноз по темпу текущего месяца. */
function averages(txns, start) {
  const from = addMonths(start, -3);
  const out = {};
  const months = new Set();
  for (const t of txns) {
    if (t.type !== 'expense' || t.date < from || t.date >= start) continue;
    out[t.categoryId] = (out[t.categoryId] || 0) + t.v;
    months.add(t.date.slice(0, 7));
  }
  if (months.size) {
    for (const k of Object.keys(out)) out[k] = round2(out[k] / months.size);
    return out;
  }
  const end = addMonths(start, 1);
  const dim = diffDays(start, end);
  const passed = Math.min(dim, Math.max(1, diffDays(start, dayKey()) + 1));
  for (const t of txns) if (t.type === 'expense' && t.date >= start && t.date < end) out[t.categoryId] = (out[t.categoryId] || 0) + t.v;
  for (const k of Object.keys(out)) out[k] = round2((out[k] / passed) * dim);
  return out;
}

function expectedIncome(st, txns, start) {
  const fromRec = (st.recurring || []).filter((r) => r.type === 'income' && r.active !== false).reduce((a, r) => a + P.monthlyAmount(r) * store.rate(r.currency), 0);
  if (fromRec > 0) return round2(fromRec);
  const from = addMonths(start, -3);
  const inc = txns.filter((t) => t.type === 'income' && t.date >= from && t.date < start).reduce((a, t) => a + t.v, 0);
  return round2(inc / 3);
}

export function budgetCard(st, p, txns) {
  const base = st.settings.base;
  const fmt = (v) => money(v, base);
  const limited = st.categories.filter((c) => c.limit > 0 && c.type !== 'income');
  const card = h('section', { class: 'card pad budget' }, h('h3', { class: 'card-title section-head' }, h('span', {}, 'Бюджет месяца'),
    h('button', { class: 'micro link-micro', onclick: () => openBudgetSheet(p.start) }, limited.length ? 'Изменить' : 'Настроить')));
  if (!limited.length) {
    card.append(h('p', { class: 'muted small' }, 'Распределите доход по ярлыкам: сколько на продукты, кафе, транспорт. Здесь будет видно «план / факт» и сколько можно тратить в день.'),
      h('button', { class: 'btn btn-primary', onclick: () => openBudgetSheet(p.start) }, 'Распределить бюджет'));
    return card;
  }
  const spent = {};
  for (const t of txns) if (t.type === 'expense' && t.date >= p.start && t.date < p.end) spent[t.categoryId] = (spent[t.categoryId] || 0) + t.v;
  const plan = limited.reduce((a, c) => a + c.limit, 0);
  const fact = limited.reduce((a, c) => a + (spent[c.id] || 0), 0);
  const outside = Object.entries(spent).filter(([id]) => !limited.some((c) => c.id === id)).reduce((a, [, v]) => a + v, 0);
  const today = dayKey();
  const daysLeft = today >= p.start && today < p.end ? diffDays(today, p.end) : 0;
  const share = plan ? fact / plan : 0;
  card.append(
    h('div', { class: 'budget-top' },
      h('div', {}, h('div', { class: 'micro' }, 'потрачено из плана'), h('div', { class: 'budget-sum mono' }, `${fmt(fact)} `, h('span', { class: 'muted' }, `/ ${fmt(plan)}`))),
      h('div', { class: ['budget-pct', 'mono', share > 1 && 'neg'] }, `${Math.round(share * 100)}%`)),
    h('div', { class: 'bar-track big' }, h('span', { class: 'bar-fill', style: { '--c': share > 1 ? 'var(--coral)' : share > 0.85 ? 'var(--brass)' : 'var(--mint)', '--w': `${Math.min(100, Math.round(share * 100))}%` } })),
    daysLeft && plan > fact ? h('p', { class: 'muted small' }, `Осталось ${fmt(plan - fact)} — это ${fmt((plan - fact) / daysLeft)} в день до конца месяца.`) : null,
    outside > 0 ? h('p', { class: 'muted small' }, `Вне бюджета: ${fmt(outside)} (ярлыки без лимита).`) : null);
  const list = h('div', { class: 'cat-list' });
  [...limited].sort((a, b) => (spent[b.id] || 0) / b.limit - (spent[a.id] || 0) / a.limit).forEach((c) => {
    const f = spent[c.id] || 0, r = f / c.limit;
    list.append(h('div', { class: 'cat-row' },
      h('span', { class: 'cat-ico', style: { '--c': c.color } }, c.icon),
      h('span', { class: 'cat-row-main' },
        h('span', { class: 'cat-row-top' }, h('span', {}, c.name), h('b', { class: r > 1 ? 'neg' : '' }, `${fmt(f)} / ${fmt(c.limit)}`)),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { '--c': r > 1 ? 'var(--coral)' : c.color, '--w': `${Math.min(100, Math.max(2, Math.round(r * 100)))}%` } })),
        h('span', { class: 'cat-row-bottom' }, h('span', { class: r > 1 ? 'neg' : '' }, r > 1 ? `перерасход ${fmt(f - c.limit)}` : `осталось ${fmt(c.limit - f)}`)))));
  });
  card.append(list);
  return card;
}

export function openBudgetSheet(start = monthStart(dayKey())) {
  const st = store.state();
  const base = st.settings.base;
  const fmt = (v) => money(v, base);
  const txns = A.enrich(st);
  const avg = averages(txns, start);
  const cats = st.categories.filter((c) => c.type !== 'income');
  const limits = Object.fromEntries(cats.map((c) => [c.id, c.limit || 0]));
  let income = st.settings.budgetIncome || expectedIncome(st, txns, start);
  const summary = h('div', { class: 'budget-summary' });
  const inputs = {};
  function renderSummary() {
    clear(summary);
    const total = Object.values(limits).reduce((a, b) => a + (b || 0), 0);
    const free = income - total;
    summary.append(
      h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, 'распределено'), h('span', { class: 'mono' }, fmt(total))),
      h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, free >= 0 ? 'свободно' : 'не хватает'), h('span', { class: ['mono', free < 0 ? 'neg' : 'inc'] }, fmt(Math.abs(free)))),
      income > 0 ? h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, 'от дохода'), h('span', { class: 'mono' }, `${Math.round((total / income) * 100)}%`)) : null);
  }
  const rows = h('div', { class: 'card list' }, cats.map((c) => {
    const inp = h('input', {
      class: 'budget-input mono', inputmode: 'decimal', placeholder: avg[c.id] ? `≈ ${Math.round(avg[c.id])}` : '0',
      value: limits[c.id] ? String(limits[c.id]) : '', 'aria-label': `Лимит: ${c.name}`,
      oninput: (e) => { limits[c.id] = parseAmount(e.target.value) || 0; renderSummary(); },
    });
    inputs[c.id] = inp;
    return h('label', { class: 'row budget-row' },
      h('span', { class: 'cat-ico', style: { '--c': c.color } }, c.icon),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, c.name), h('span', { class: 'row-sub' }, avg[c.id] ? `в среднем ${fmt(avg[c.id])} / мес` : 'нет данных')),
      inp);
  }));
  const sh = openSheet({
    title: 'Бюджет на месяц',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      h('div', { class: 'section-label micro' }, `Ожидаемый доход в месяц, ${base}`),
      h('input', { class: 'field mono', inputmode: 'decimal', value: income ? String(income) : '', placeholder: '0', oninput: (e) => { income = parseAmount(e.target.value) || 0; renderSummary(); } }),
      summary,
      h('button', { class: 'chip', onclick: () => {
        for (const c of cats) if (avg[c.id] && !limits[c.id]) { limits[c.id] = Math.ceil(avg[c.id] / 10) * 10; inputs[c.id].value = String(limits[c.id]); }
        renderSummary();
      } }, '✦ Заполнить по средним тратам'),
      h('div', { class: 'section-label micro' }, 'Лимиты по ярлыкам'),
      rows,
      h('p', { class: 'muted small' }, 'Пустое поле — ярлык без лимита. Лимиты действуют каждый месяц, анализатор предупредит, если он скоро закончится.'),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Сохранить бюджет')),
  });
  renderSummary();
  function save() {
    for (const c of cats) if ((c.limit || 0) !== (limits[c.id] || 0)) store.saveCategory({ ...c, limit: limits[c.id] || 0 });
    store.setSetting('budgetIncome', income);
    sh.close();
    toast('Бюджет сохранён');
  }
}
