// Листы добавления/редактирования операции и ярлыка.
import { h, clear, parseAmount, dayKey, addDays, money, currencySymbol, firstGrapheme, haptic } from '../util.js';
import * as store from '../store.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';

const EMOJI = ['🛒', '🍎', '☕', '🍔', '🍷', '🚕', '🚇', '⛽', '🚗', '✈️', '🏠', '💡', '📱', '💻', '🛍️', '👕', '💊', '🏋️', '🎬', '🎮', '📚', '🎓', '🐶', '👶', '🎁', '💐', '🔁', '💳', '🏦', '📈', '💱', '💼', '🧰', '💰', '↩️', '🧾', '✂️', '🧹', '🔧', '•'];

function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const render = () => {
    clear(el);
    options.forEach(([v, label]) => el.append(h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(v === value), class: v === value ? 'on' : '',
      onclick: () => { if (v !== value) { value = v; render(); onChange(v); } },
    }, label)));
  };
  render();
  return el;
}

export function openTxnEditor({ type = 'expense', txn = null, onDone } = {}) {
  const st = store.settings();
  const d = {
    type: txn?.type || type,
    amountStr: txn ? String(txn.amount).replace('.', ',') : '',
    currency: txn?.currency || st.lastCurrency || st.base,
    rate: txn?.rate || store.rate(txn?.currency || st.lastCurrency || st.base),
    categoryId: txn?.categoryId || null,
    note: txn?.note || '',
    date: txn?.date || dayKey(),
  };
  if (!st.currencies.includes(d.currency)) d.currency = st.base;

  // --- сумма ---
  const amountInput = h('input', {
    class: 'amount-input', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: '0', value: d.amountStr, 'aria-label': 'Сумма',
    oninput: (e) => { d.amountStr = e.target.value; updatePreview(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); amountInput.blur(); } },
  });
  const curBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency() });
  const preview = h('div', { class: 'amount-preview' });
  const rateRow = h('div', { class: 'rate-row' });

  function updateCur() {
    curBtn.textContent = currencySymbol(d.currency);
    clear(rateRow);
    rateRow.hidden = d.currency === st.base;
    if (!rateRow.hidden) {
      rateRow.append(
        h('span', {}, `1 ${d.currency} =`),
        h('input', {
          class: 'rate-input', inputmode: 'decimal', value: d.rate ? String(d.rate).replace('.', ',') : '', placeholder: 'курс',
          'aria-label': 'Курс', oninput: (e) => { d.rate = parseAmount(e.target.value) || 0; updatePreview(); },
        }),
        h('span', {}, st.base));
    }
    updatePreview();
  }
  function updatePreview() {
    const a = parseAmount(d.amountStr);
    const isExpr = /[+\-*/]/.test(d.amountStr.replace(/^-/, ''));
    const parts = [];
    if (isExpr && a > 0) parts.push(`= ${money(a, d.currency)}`);
    if (d.currency !== st.base && a > 0 && d.rate > 0) parts.push(`≈ ${money(a * d.rate, st.base)}`);
    preview.textContent = parts.join('  ');
  }

  function pickCurrency() {
    const sh = openSheet({
      title: 'Валюта', className: 'sheet-compact',
      content: h('div', {},
        h('div', { class: 'cur-grid' }, st.currencies.map((c) => h('button', {
          class: ['chip', c === d.currency && 'active'],
          onclick: () => { d.currency = c; d.rate = store.rate(c); updateCur(); sh.close(); },
        }, `${currencySymbol(c)} ${c === currencySymbol(c) ? '' : c}`))),
        h('p', { class: 'muted small center' }, 'Добавить валюты можно в Настройках.')),
    });
  }

  // --- тип ---
  const seg = segmented([['expense', 'Трата'], ['income', 'Доход']], d.type, (v) => {
    d.type = v;
    const cat = store.state().categories.find((c) => c.id === d.categoryId);
    if (cat && cat.type !== 'both' && cat.type !== v) d.categoryId = null;
    renderCats();
    sheet.panel.classList.toggle('is-income', v === 'income');
  });

  // --- ярлыки ---
  const cats = h('div', { class: 'cat-grid' });
  function renderCats() {
    clear(cats);
    store.categoriesFor(d.type).forEach((c) => cats.append(h('button', {
      type: 'button', class: ['cat-chip', c.id === d.categoryId && 'active'], style: { '--c': c.color },
      onclick: () => { d.categoryId = c.id; haptic(); renderCats(); renderSuggestions(); },
    }, h('span', { class: 'cat-ico' }, c.icon), h('span', { class: 'cat-name' }, c.name))));
    cats.append(h('button', {
      type: 'button', class: 'cat-chip add',
      onclick: () => openCategoryEditor({ type: d.type, onSave: (c) => { d.categoryId = c.id; renderCats(); } }),
    }, h('span', { class: 'cat-ico' }, '+'), h('span', { class: 'cat-name' }, 'Свой')));
  }

  // --- описание + подсказки из прошлых операций ---
  const noteInput = h('input', {
    class: 'field', placeholder: 'Описание (необязательно)', maxlength: '200', value: d.note, enterkeyhint: 'done',
    autocomplete: 'off', 'aria-label': 'Описание',
    oninput: (e) => { d.note = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); noteInput.blur(); } },
  });
  const sugg = h('div', { class: 'sugg' });
  function renderSuggestions() {
    clear(sugg);
    if (!d.categoryId) return;
    const seen = new Set();
    for (const t of store.sortedTxns()) {
      if (t.categoryId !== d.categoryId || !t.note || seen.has(t.note)) continue;
      seen.add(t.note);
      sugg.append(h('button', { type: 'button', class: 'chip small', onclick: () => { d.note = t.note; noteInput.value = t.note; } }, t.note));
      if (seen.size >= 5) break;
    }
  }

  // --- дата ---
  const dateInput = h('input', { type: 'date', class: 'date-input', value: d.date, max: addDays(dayKey(), 366), 'aria-label': 'Дата', onchange: (e) => { if (e.target.value) { d.date = e.target.value; renderDates(); } } });
  const dateChips = h('div', { class: 'date-row' });
  function renderDates() {
    clear(dateChips);
    const today = dayKey(), yest = addDays(today, -1);
    [[today, 'Сегодня'], [yest, 'Вчера']].forEach(([v, l]) => dateChips.append(h('button', {
      type: 'button', class: ['chip', d.date === v && 'active'], onclick: () => { d.date = v; dateInput.value = v; renderDates(); },
    }, l)));
    dateChips.append(h('label', { class: ['chip', 'date-chip', d.date !== today && d.date !== yest && 'active'] }, '📅 ', dateInput));
  }

  // --- сохранение ---
  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!(amount > 0)) { toast('Введите сумму'); amountInput.focus(); return; }
    if (!d.categoryId) { toast('Выберите ярлык'); return; }
    if (d.currency !== st.base && !(d.rate > 0)) { toast('Укажите курс валюты'); return; }
    await store.saveTxn({ ...(txn || {}), type: d.type, amount, currency: d.currency, rate: d.rate, categoryId: d.categoryId, note: d.note, date: d.date });
    haptic();
    sheet.close();
    toast(txn ? 'Сохранено' : d.type === 'income' ? 'Доход добавлен' : 'Трата добавлена');
    onDone?.();
  }

  const content = h('div', { class: 'editor' },
    seg,
    h('div', { class: 'amount-wrap' }, amountInput, curBtn),
    preview,
    rateRow,
    h('div', { class: 'section-label' }, 'Ярлык'),
    cats,
    h('div', { class: 'section-label' }, 'Описание'),
    noteInput,
    sugg,
    h('div', { class: 'section-label' }, 'Дата'),
    dateChips,
    h('button', { class: 'btn btn-primary save-btn', onclick: save }, txn ? 'Сохранить' : 'Добавить'),
    txn && h('button', {
      class: 'btn btn-plain danger', onclick: async () => {
        if (await confirmSheet('Удалить операцию?')) { await store.deleteTxn(txn.id); sheet.close(); toast('Удалено'); onDone?.(); }
      },
    }, 'Удалить операцию'));

  const sheet = openSheet({
    title: txn ? 'Операция' : '',
    className: ['sheet-editor', d.type === 'income' && 'is-income'].filter(Boolean).join(' '),
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content,
  });
  updateCur();
  renderCats();
  renderSuggestions();
  renderDates();
  // фокус синхронно в обработчике касания — тогда iOS сразу покажет клавиатуру
  if (!txn) amountInput.focus();
  return sheet;
}

export function openCategoryEditor({ cat = null, type = 'expense', onSave } = {}) {
  const d = { name: cat?.name || '', icon: cat?.icon || '🛒', color: cat?.color || store.COLORS[6], type: cat?.type || type, limit: cat?.limit || 0 };
  const preview = h('div', { class: 'cat-preview' });
  const nameInput = h('input', { class: 'field', placeholder: 'Название, например «Кофе»', maxlength: '30', value: d.name, 'aria-label': 'Название', oninput: (e) => { d.name = e.target.value; renderPreview(); } });
  const iconInput = h('input', { class: 'field emoji-field', placeholder: '🙂', value: d.icon, 'aria-label': 'Свой эмодзи', oninput: (e) => { const g = firstGrapheme(e.target.value); if (g) { d.icon = g; renderPreview(); renderEmoji(); } } });
  const emojiGrid = h('div', { class: 'emoji-grid' });
  const colorRow = h('div', { class: 'color-row' });
  const limitWrap = h('div');

  function renderPreview() {
    clear(preview);
    preview.style.setProperty('--c', d.color);
    preview.append(h('span', { class: 'cat-ico big' }, d.icon), h('span', {}, d.name || 'Новый ярлык'));
  }
  function renderEmoji() {
    clear(emojiGrid);
    EMOJI.forEach((e) => emojiGrid.append(h('button', { type: 'button', class: ['emoji-btn', e === d.icon && 'active'], onclick: () => { d.icon = e; iconInput.value = e; renderPreview(); renderEmoji(); } }, e)));
  }
  function renderColors() {
    clear(colorRow);
    store.COLORS.forEach((c) => colorRow.append(h('button', { type: 'button', class: ['swatch', c === d.color && 'active'], style: { '--c': c }, 'aria-label': c, onclick: () => { d.color = c; renderPreview(); renderColors(); } })));
  }
  function renderLimit() {
    clear(limitWrap);
    if (d.type === 'income') return;
    limitWrap.append(
      h('div', { class: 'section-label' }, `Лимит в месяц, ${store.base()} (необязательно)`),
      h('input', { class: 'field', inputmode: 'decimal', placeholder: 'Без лимита', value: d.limit ? String(d.limit) : '', 'aria-label': 'Лимит', oninput: (e) => { d.limit = parseAmount(e.target.value) || 0; } }));
  }

  async function save() {
    if (!d.name.trim()) { toast('Введите название'); nameInput.focus(); return; }
    const c = store.saveCategory({ ...(cat || {}), ...d });
    sheet.close();
    onSave?.(c);
  }

  const sheet = openSheet({
    title: cat ? 'Ярлык' : 'Новый ярлык',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      preview,
      h('div', { class: 'section-label' }, 'Название'),
      nameInput,
      h('div', { class: 'section-label' }, 'Тип'),
      segmented([['expense', 'Расход'], ['income', 'Доход'], ['both', 'Оба']], d.type, (v) => { d.type = v; renderLimit(); }),
      h('div', { class: 'section-label' }, 'Иконка'),
      h('div', { class: 'emoji-row' }, iconInput, h('span', { class: 'muted small' }, 'или выберите:')),
      emojiGrid,
      h('div', { class: 'section-label' }, 'Цвет'),
      colorRow,
      limitWrap,
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Сохранить'),
      cat && h('button', {
        class: 'btn btn-plain danger', onclick: async () => {
          const n = store.usageCount(cat.id);
          const ok = await confirmSheet(`Удалить ярлык «${cat.name}»?`, { detail: n ? `${n} операций будут перенесены в «Другое».` : '' });
          if (ok) { await store.deleteCategory(cat.id); sheet.close(); }
        },
      }, 'Удалить ярлык')),
  });
  renderPreview(); renderEmoji(); renderColors(); renderLimit();
  if (!cat) nameInput.focus();
}
