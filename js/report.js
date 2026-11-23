// Месячный отчёт на одной странице: печать или «Сохранить как PDF» через системное меню печати.
import { h, money, monthName, cap, addMonths, monthStart, dayKey, shortDate } from './util.js';
import * as store from './store.js';
import * as A from './analytics.js';
import * as P from './planner.js';
import * as charts from './charts.js';

export function openReport(anchor = dayKey()) {
  const st = store.state();
  const base = st.settings.base;
  const fmt = (v) => money(v, base);
  const txns = A.enrich(st);
  const p = A.period('month', monthStart(anchor));
  const cur = A.totals(txns, p.start, p.end);
  const prev = A.totals(txns, p.prev.start, p.prev.end);
  const cats = A.byCategory(txns, p.start, p.end, 'expense', store.category);
  const top = txns.filter((t) => t.type === 'expense' && t.date >= p.start && t.date < p.end).sort((a, b) => b.v - a.v).slice(0, 8);
  const ins = A.insights(st, store.category, dayKey(), store.rate).slice(0, 6);
  const debts = (st.debts || []).filter((d) => P.debtRemaining(d) > 0);
  const goals = st.goals || [];
  const recurring = (st.recurring || []).filter((r) => r.active !== false);
  const delta = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / b) * 100))}% к прошлому месяцу` : '');
  const title = `${cap(monthName(p.start))} ${p.start.slice(0, 4)}`;

  const chartBox = h('div', { class: 'rp-chart' });
  const page = h('div', { class: 'report-page' },
    h('header', { class: 'rp-head' },
      h('div', {}, h('div', { class: 'micro' }, 'Баланс · отчёт'), h('h1', {}, title)),
      h('div', { class: 'rp-net mono' }, money(cur.net, base, { sign: true }))),
    h('div', { class: 'rp-kpis' },
      kpi('Доходы', fmt(cur.inc), delta(cur.inc, prev.inc)),
      kpi('Расходы', fmt(cur.exp), delta(cur.exp, prev.exp)),
      kpi('Сбережено', cur.inc > 0 ? `${Math.round((cur.net / cur.inc) * 100)}%` : '—', cur.inc > 0 ? fmt(cur.net) : ''),
      kpi('Операций', String(cur.count), '')),
    h('h2', {}, 'По дням'), chartBox,
    h('div', { class: 'rp-cols' },
      h('section', {}, h('h2', {}, 'Расходы по ярлыкам'),
        h('table', {}, h('tbody', {}, cats.slice(0, 12).map((c) => h('tr', {},
          h('td', {}, `${c.cat.icon} ${c.cat.name}`), h('td', { class: 'mono r' }, fmt(c.total)), h('td', { class: 'mono r muted' }, `${Math.round(c.share * 100)}%`)))))),
      h('section', {}, h('h2', {}, 'Крупнейшие траты'),
        h('table', {}, h('tbody', {}, top.map((t) => h('tr', {},
          h('td', {}, `${shortDate(t.date)} · ${t.note || store.category(t.categoryId).name}`), h('td', { class: 'mono r' }, fmt(t.v)))))))),
    ins.length ? h('section', {}, h('h2', {}, 'Выводы анализатора'), h('ul', { class: 'rp-ins' }, ins.map((x) => h('li', {}, h('b', {}, x.title), ' — ', x.text)))) : null,
    h('div', { class: 'rp-cols' },
      recurring.length ? h('section', {}, h('h2', {}, 'Регулярные операции'), h('table', {}, h('tbody', {}, recurring.map((r) => h('tr', {},
        h('td', {}, `${r.name} · ${P.freqLabel(r)}`), h('td', { class: ['mono', 'r', r.type === 'income' && 'inc'] }, money(r.type === 'income' ? r.amount : -r.amount, r.currency, { sign: r.type === 'income' }))))))) : null,
      debts.length || goals.length ? h('section', {},
        debts.length ? h('h2', {}, 'Обязательства') : null,
        debts.length ? h('table', {}, h('tbody', {}, debts.map((d) => h('tr', {}, h('td', {}, d.name), h('td', { class: 'mono r' }, money(P.debtRemaining(d), d.currency)), h('td', { class: 'mono r muted' }, `${Math.round(P.debtProgress(d) * 100)}%`))))) : null,
        goals.length ? h('h2', {}, 'Цели') : null,
        goals.length ? h('table', {}, h('tbody', {}, goals.map((g) => { const s = P.goalStats(g); return h('tr', {}, h('td', {}, `${g.icon || '🎯'} ${g.name}`), h('td', { class: 'mono r' }, `${money(s.saved, g.currency)} / ${money(g.target, g.currency)}`), h('td', { class: 'mono r muted' }, `${Math.round(s.progress * 100)}%`)); }))) : null) : null),
    h('footer', { class: 'rp-foot micro' }, `Сформировано ${new Date().toLocaleDateString('ru-RU')} · данные хранятся только на вашем устройстве`));

  const bar = h('div', { class: 'report-bar' },
    h('button', { class: 'chip', onclick: close, 'aria-label': 'Закрыть' }, '✕'),
    h('button', { class: 'chip', onclick: () => go(-1) }, '‹'),
    h('span', { class: 'micro' }, title),
    h('button', { class: 'chip', onclick: () => go(1) }, '›'),
    h('button', { class: 'chip active', onclick: () => window.print() }, 'PDF'));
  const wrap = h('div', { class: 'report' }, bar, page);
  document.body.append(wrap);
  document.body.classList.add('printing');
  chartBox.append(charts.bars(680, A.buckets(txns, p), { height: 150 }));

  function close() { wrap.remove(); document.body.classList.remove('printing'); }
  function go(dir) { close(); openReport(addMonths(p.start, dir)); }
}

function kpi(label, value, sub) {
  return h('div', { class: 'rp-kpi' }, h('span', { class: 'micro' }, label), h('span', { class: 'mono rp-kpi-v' }, value), h('span', { class: 'rp-kpi-s' }, sub));
}
