// Импорт банковской выписки (CSV) с автоматическим подбором ярлыков и поиском дублей.
import { h, clear, money } from '../util.js';
import * as store from '../store.js';
import { parseCSV, detectColumns, rowsToDrafts } from '../csv.js';
import { guessCategory } from '../nlp.js';
import { openSheet, toast } from '../sheet.js';
import { pickCurrency, segmented } from './editor.js';

export function startCsvImport() {
  const input = h('input', { type: 'file', accept: '.csv,text/csv,text/plain,.txt' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let text = await f.text();
    // выписки некоторых банков в cp1251
    if (/�/.test(text)) {
      try { text = new TextDecoder('windows-1251').decode(await f.arrayBuffer()); } catch { /* оставляем как есть */ }
    }
    const rows = parseCSV(text);
    if (rows.length < 2) return toast('Не удалось прочитать таблицу');
    openImportSheet(rows, f.name);
  });
  input.click();
}

function openImportSheet(rows, fileName) {
  const st = store.state();
  const cols = detectColumns(rows);
  const opt = { order: 'dmy', currency: st.settings.base };
  let drafts = [];
  const box = h('div', { class: 'editor' });
  const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
  const head = cols.header ? rows[0] : Array.from({ length: width }, (_, i) => `Колонка ${i + 1}`);

  const history = st.txns.slice(-1500).map((t) => ({ note: t.note, categoryId: t.categoryId, type: t.type }));
  const exists = new Set(st.txns.filter((t) => t.type === 'income' || t.type === 'expense').map((t) => `${t.date}|${t.type}|${Math.round(t.amount * 100)}`));

  function build() {
    drafts = rowsToDrafts(rows, cols, { order: opt.order }).map((d) => {
      const currency = d.currency || opt.currency;
      const dup = exists.has(`${d.date}|${d.type}|${Math.round(d.amount * 100)}`);
      const categoryId = guessCategory(d.note, st.categories, history, d.type)
        || st.categories.find((c) => c.name === 'Другое')?.id;
      return { ...d, currency, categoryId, on: !dup, dup };
    });
  }

  function colSelect(key, title) {
    const sel = h('select', { class: 'field col-select', onchange: (e) => { cols[key] = Number(e.target.value); build(); render(); } },
      h('option', { value: '-1' }, '—'),
      head.map((name, i) => h('option', { value: String(i), selected: cols[key] === i }, name || `Колонка ${i + 1}`)));
    return h('label', { class: 'col-map' }, h('span', { class: 'micro' }, title), sel);
  }

  function render() {
    clear(box);
    const on = drafts.filter((d) => d.on);
    const sumExp = on.filter((d) => d.type === 'expense').reduce((a, d) => a + d.amount * store.rate(d.currency), 0);
    const sumInc = on.filter((d) => d.type === 'income').reduce((a, d) => a + d.amount * store.rate(d.currency), 0);
    const curBtn = h('button', { class: 'chip', onclick: () => pickCurrency({ current: opt.currency, onPick: (c) => { opt.currency = c; build(); render(); } }) }, `Валюта: ${opt.currency}`);
    box.append(
      h('p', { class: 'muted small' }, `${fileName} · строк: ${rows.length - (cols.header ? 1 : 0)}. Колонки определены автоматически — проверьте.`),
      h('div', { class: 'col-grid' },
        colSelect('date', 'Дата'), colSelect('desc', 'Описание'),
        colSelect('amount', 'Сумма (±)'), colSelect('currency', 'Валюта'),
        colSelect('debit', 'Расход'), colSelect('credit', 'Приход')),
      h('div', { class: 'kind-row' },
        segmented([['dmy', 'ДД.ММ.ГГГГ'], ['mdy', 'ММ/ДД/ГГГГ']], opt.order, (v) => { opt.order = v; build(); render(); }),
        curBtn),
      h('div', { class: 'import-summary' },
        h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'выбрано'), h('span', { class: 'mono' }, `${on.length} из ${drafts.length}`)),
        h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'расходы'), h('span', { class: 'mono' }, money(sumExp, st.settings.base))),
        h('span', { class: 'note-kv' }, h('span', { class: 'micro' }, 'доходы'), h('span', { class: 'mono inc' }, money(sumInc, st.settings.base)))),
      drafts.some((d) => d.dup) ? h('p', { class: 'muted small' }, `Похожих на уже внесённые: ${drafts.filter((d) => d.dup).length} — они сняты с отметки.`) : null);
    if (!drafts.length) { box.append(h('div', { class: 'empty small' }, 'Не нашлось строк с датой и суммой. Поменяйте колонки или формат даты.')); return; }
    const list = h('div', { class: 'card list' });
    drafts.slice(0, 400).forEach((d) => {
      const c = store.category(d.categoryId);
      list.append(h('div', { class: ['row', 'import-row', !d.on && 'is-paid'] },
        h('button', { class: ['check', d.on && 'on'], 'aria-label': 'Импортировать строку', onclick: () => { d.on = !d.on; render(); } }),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, d.note || '—'),
          h('span', { class: 'row-sub' }, `${d.date.slice(8)}.${d.date.slice(5, 7)}${d.dup ? ' · уже есть?' : ''}`)),
        h('button', { class: 'cat-pill', style: { '--c': c.color }, onclick: () => pickCat(d) }, `${c.icon} ${c.name}`),
        h('span', { class: ['amount', d.type === 'income' && 'inc'] }, money(d.type === 'income' ? d.amount : -d.amount, d.currency, { sign: d.type === 'income' }))));
    });
    box.append(list);
    if (drafts.length > 400) box.append(h('p', { class: 'muted small' }, `Показаны первые 400 из ${drafts.length}; импортируются все отмеченные.`));
    box.append(h('button', { class: 'btn btn-primary save-btn', disabled: !on.length, onclick: doImport }, `Импортировать ${on.length}`));
  }

  function pickCat(d) {
    const sh = openSheet({
      title: 'Ярлык', className: 'sheet-compact',
      content: h('div', { class: 'cat-grid' }, store.categoriesFor(d.type).map((c) => h('button', {
        class: ['cat-chip', c.id === d.categoryId && 'active'], style: { '--c': c.color },
        onclick: () => {
          d.categoryId = c.id;
          // то же описание в других строках получает тот же ярлык
          drafts.forEach((x) => { if (x !== d && x.note && x.note === d.note && x.type === d.type) x.categoryId = c.id; });
          sh.close(); render();
        },
      }, h('span', { class: 'cat-ico' }, c.icon), h('span', { class: 'cat-name' }, c.name)))),
    });
  }

  async function doImport() {
    const list = drafts.filter((d) => d.on).map((d) => ({
      type: d.type, amount: d.amount, currency: d.currency, rate: store.rate(d.currency),
      categoryId: d.categoryId, note: d.note, date: d.date,
    }));
    const missing = list.filter((d) => d.currency !== st.settings.base && !(d.rate > 0));
    if (missing.length) return toast(`Нет курса для ${missing[0].currency} — включите онлайн-курсы`);
    const n = await store.bulkAddTxns(list);
    sh.close();
    toast(`Импортировано операций: ${n}`);
  }

  build();
  const sh = openSheet({ title: 'Импорт выписки', content: box });
  render();
}
