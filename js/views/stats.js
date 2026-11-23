// Аналитика: периоды, графики, категории, тенденция и умный анализатор.
import { h, clear, money, dayKey, diffDays, round2 } from '../util.js';
import * as store from '../store.js';
import * as A from '../analytics.js';
import * as charts from '../charts.js';
import { txnListSheet } from './home.js';
import { budgetCard } from './budget.js';
import { openReport } from '../report.js';

const ui = { mode: 'month', anchor: dayKey(), catType: 'expense', sel: -1 };

function pct(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

function delta(cur, prev, goodWhenDown) {
  const p = pct(cur, prev);
  if (p == null || p === 0) return h('span', { class: 'delta' }, p === 0 ? 'как раньше' : '');
  const up = p > 0;
  const good = goodWhenDown ? !up : up;
  return h('span', { class: ['delta', good ? 'good' : 'bad'] }, `${up ? '↑' : '↓'} ${Math.abs(p)}%`);
}

function card(title, ...children) {
  return h('section', { class: 'card pad' }, title && h('h3', { class: 'card-title' }, title), ...children);
}

export function renderStats(root) {
  clear(root);
  const st = store.state();
  const base = st.settings.base;
  const fmt = (v) => money(v, base);
  const txns = A.enrich(st);
  const today = dayKey();
  const p = A.period(ui.mode, ui.anchor);
  const cur = A.totals(txns, p.start, p.end);
  const prev = A.totals(txns, p.prev.start, p.prev.end);
  const rerender = () => renderStats(root);

  root.append(h('h1', { class: 'page-title' }, 'Аналитика'));

  // --- переключатель периода ---
  const seg = h('div', { class: 'seg' }, [['week', 'Неделя'], ['month', 'Месяц'], ['year', 'Год']].map(([v, l]) =>
    h('button', { class: v === ui.mode ? 'on' : '', onclick: () => { ui.mode = v; ui.sel = -1; rerender(); } }, l)));
  const isCurrent = today >= p.start && today < p.end;
  const nav = h('div', { class: 'period-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Назад', onclick: () => { ui.anchor = A.shiftAnchor(ui.mode, ui.anchor, -1); ui.sel = -1; rerender(); } }, '‹'),
    h('button', { class: 'period-label', onclick: () => { ui.anchor = today; rerender(); } }, p.label),
    h('button', { class: 'icon-btn', 'aria-label': 'Вперёд', disabled: isCurrent || p.start > today, onclick: () => { ui.anchor = A.shiftAnchor(ui.mode, ui.anchor, 1); ui.sel = -1; rerender(); } }, '›'));
  root.append(seg, nav);
  if (st.txns.length) root.append(h('div', { class: 'stats-tools' }, h('button', { class: 'chip small', onclick: () => openReport(ui.mode === 'month' ? p.start : dayKey()) }, '⎙ Отчёт за месяц (PDF)')));

  if (!st.txns.length) {
    root.append(h('div', { class: 'empty' }, h('div', { class: 'empty-ico' }, '📊'), 'Здесь появится аналитика', h('div', { class: 'muted small' }, 'Добавьте несколько операций на главном экране.')));
    return;
  }

  // --- ключевые цифры ---
  const days = isCurrent ? diffDays(p.start, today) + 1 : diffDays(p.start, p.end);
  const savings = cur.inc > 0 ? Math.round((cur.net / cur.inc) * 100) : null;
  root.append(h('div', { class: 'kpis' },
    h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Доходы'), h('span', { class: 'kpi-val inc' }, fmt(cur.inc)), delta(cur.inc, prev.inc, false)),
    h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Расходы'), h('span', { class: 'kpi-val' }, fmt(cur.exp)), delta(cur.exp, prev.exp, true)),
    h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'Итог'), h('span', { class: ['kpi-val', cur.net < 0 && 'neg'] }, money(cur.net, base, { sign: true })),
      h('span', { class: 'delta' }, savings != null ? `сбережено ${savings}%` : '')),
    h('div', { class: 'kpi' }, h('span', { class: 'kpi-label' }, 'В день'), h('span', { class: 'kpi-val' }, fmt(round2(cur.exp / Math.max(1, days)))), h('span', { class: 'delta' }, 'средний расход'))));

  if (ui.mode === 'month') root.append(budgetCard(st, p, txns));
  const grid = h('div', { class: 'stats-grid' });
  root.append(grid);

  // --- анализатор ---
  const ins = A.insights(st, store.category, today, store.rate);
  const insWrap = h('div', { class: 'insights' });
  if (!ins.length) {
    insWrap.append(h('div', { class: 'insight good' }, h('span', { class: 'ins-ico' }, '✨'),
      h('div', {}, h('div', { class: 'ins-title' }, 'Всё под контролем'), h('div', { class: 'ins-text' }, 'Проблемных или лишних операций не найдено. Чем больше данных, тем точнее анализ.'))));
  }
  ins.forEach((x) => insWrap.append(h('div', { class: ['insight', x.level, x.ids && 'tap'], onclick: x.ids ? () => txnListSheet(x.title, st.txns.filter((t) => x.ids.includes(t.id))) : null },
    h('span', { class: 'ins-ico' }, x.icon),
    h('div', { class: 'ins-body' }, h('div', { class: 'ins-title' }, x.title), h('div', { class: 'ins-text' }, x.text), x.ids && h('div', { class: 'ins-more' }, 'Показать операции ›')),
    h('button', { class: 'ins-x', 'aria-label': 'Скрыть', onclick: (e) => { e.stopPropagation(); store.dismissInsight(x.key); } }, '×'))));
  grid.append(card('Анализатор', insWrap));

  // --- динамика ---
  const bk = A.buckets(txns, p);
  const caption = h('div', { class: 'chart-caption' });
  const setCaption = (i) => {
    clear(caption);
    if (i < 0) {
      caption.append(h('span', { class: 'muted' }, 'Нажмите на столбец'), legend());
      return;
    }
    const b = bk[i];
    caption.append(h('b', {}, b.long), h('span', {}, `−${fmt(b.exp)}`), h('span', { class: 'inc' }, `+${fmt(b.inc)}`));
  };
  const chartBox = h('div', { class: 'chart-box' });
  grid.append(card('Динамика', caption, chartBox));
  setCaption(ui.sel);
  chartBox.append(charts.bars(chartBox.clientWidth, bk, { onSelect: (i) => { ui.sel = i; setCaption(i); }, selected: ui.sel }));

  // --- нарастающий итог и прогноз ---
  const cum = A.cumulative(txns, p, today);
  if (cum) {
    const box = h('div', { class: 'chart-box' });
    const info = cum.forecast
      ? h('p', { class: 'muted small' }, `Прогноз расходов на месяц: `, h('b', {}, `≈ ${fmt(cum.forecast.value)}`), prev.exp ? ` (прошлый месяц ${fmt(prev.exp)})` : '')
      : null;
    grid.append(card('Расходы нарастающим итогом', info, box,
      h('div', { class: 'legend' }, h('span', { class: 'lg lg-line' }, 'этот период'), h('span', { class: 'lg lg-prev' }, 'прошлый'), cum.forecast && h('span', { class: 'lg lg-fc' }, 'прогноз'))));
    box.append(charts.cumulativeLine(box.clientWidth, cum));
  }

  // --- категории ---
  const cats = A.byCategory(txns, p.start, p.end, ui.catType, store.category);
  const prevCats = new Map(A.byCategory(txns, p.prev.start, p.prev.end, ui.catType, store.category).map((c) => [c.id, c.total]));
  const total = ui.catType === 'expense' ? cur.exp : cur.inc;
  const catSeg = h('div', { class: 'seg small' }, [['expense', 'Расходы'], ['income', 'Доходы']].map(([v, l]) =>
    h('button', { class: v === ui.catType ? 'on' : '', onclick: () => { ui.catType = v; rerender(); } }, l)));
  const catList = h('div', { class: 'cat-list' });
  cats.forEach((c) => {
    const pv = prevCats.get(c.id);
    catList.append(h('button', { class: 'cat-row', onclick: () => txnListSheet(`${c.cat.icon} ${c.cat.name}`, st.txns.filter((t) => t.categoryId === c.id && t.type === ui.catType && t.date >= p.start && t.date < p.end)) },
      h('span', { class: 'cat-ico', style: { '--c': c.cat.color } }, c.cat.icon),
      h('span', { class: 'cat-row-main' },
        h('span', { class: 'cat-row-top' }, h('span', {}, c.cat.name), h('b', {}, fmt(c.total))),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { '--c': c.cat.color, '--w': `${Math.max(2, c.share * 100)}%` } })),
        h('span', { class: 'cat-row-bottom' }, h('span', {}, `${Math.round(c.share * 100)}% · ${c.count} опер.`), pv != null ? delta(c.total, pv, ui.catType === 'expense') : h('span', { class: 'delta' }, 'новое'),
          c.cat.limit > 0 && ui.catType === 'expense' && ui.mode === 'month' ? h('span', { class: ['limit', c.total > c.cat.limit && 'bad'] }, `лимит ${fmt(c.cat.limit)}`) : null))));
  });
  grid.append(card('Категории', catSeg,
    cats.length ? h('div', { class: 'cat-wrap' }, charts.donut(cats, { center: money(total, base, { frac: 0 }), sub: ui.catType === 'expense' ? 'расходы' : 'доходы' }), catList)
      : h('div', { class: 'empty small' }, 'Нет операций за период')));

  // --- тенденция ---
  const tr = A.trend(txns, today, 6);
  const trBox = h('div', { class: 'chart-box' });
  let trText = 'Нужно минимум 3 полных месяца данных, чтобы увидеть тенденцию.';
  if (tr.slopePct != null) {
    const sp = Math.round(tr.slopePct);
    trText = Math.abs(sp) < 3 ? 'Расходы стабильны: заметного роста или снижения нет.'
      : sp > 0 ? `Расходы растут в среднем на ${sp}% в месяц. Стоит присмотреться к категориям с ростом.`
        : `Расходы снижаются в среднем на ${-sp}% в месяц. Так держать!`;
  }
  grid.append(card('Тенденция за 6 месяцев', h('p', { class: 'muted small' }, trText), trBox));
  trBox.append(charts.trendBars(trBox.clientWidth, tr));
}

function legend() {
  return h('span', { class: 'legend inline' }, h('span', { class: 'lg lg-exp' }, 'расход'), h('span', { class: 'lg lg-inc' }, 'доход'));
}
