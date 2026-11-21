// Листы: операция, обмен, ярлык, выбор валюты.
import { h, clear, parseAmount, dayKey, addDays, money, currencySymbol, firstGrapheme, haptic, isCrypto, CRYPTO, roundAmt } from '../util.js';
import * as store from '../store.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';

const EMOJI = ['🛒', '🍎', '☕', '🍔', '🍷', '🚕', '🚇', '⛽', '🚗', '✈️', '🏠', '💡', '📱', '💻', '🛍️', '👕', '💊', '🏋️', '🎬', '🎮', '📚', '🎓', '🐶', '👶', '🎁', '💐', '🔁', '💳', '🏦', '📈', '💱', '₿', '💼', '🧰', '💰', '↩️', '🧾', '✂️', '🔧', '•'];

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

const fmtRate = (r) => {
  if (!(r > 0)) return '';
  const frac = r >= 100 ? 2 : r >= 1 ? 4 : 8;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: frac, useGrouping: false }).format(r);
};

function dateRow(d, onChange) {
  const wrap = h('div', { class: 'date-row' });
  const input = h('input', { type: 'date', class: 'date-input', value: d.date, max: addDays(dayKey(), 366), 'aria-label': 'Дата', onchange: (e) => { if (e.target.value) { d.date = e.target.value; render(); onChange?.(); } } });
  function render() {
    clear(wrap);
    const today = dayKey(), yest = addDays(today, -1);
    [[today, 'Сегодня'], [yest, 'Вчера']].forEach(([v, l]) => wrap.append(h('button', {
      type: 'button', class: ['chip', d.date === v && 'active'], onclick: () => { d.date = v; input.value = v; render(); onChange?.(); },
    }, l)));
    wrap.append(h('label', { class: ['chip', 'date-chip', d.date !== today && d.date !== yest && 'active'] }, input));
  }
  render();
  return wrap;
}

// ---------- выбор валюты ----------
export function pickCurrency({ current, onPick, title = 'Валюта' }) {
  const s = store.settings();
  let q = '';
  const list = h('div', { class: 'cur-list' });
  const pick = async (code) => {
    if (!s.currencies.includes(code)) await store.addCurrency(code, 0);
    sh.close();
    onPick(code);
  };
  const item = (code, name, extra) => h('button', { class: ['cur-item', code === current && 'active'], onclick: () => pick(code) },
    h('span', { class: ['cur-badge', isCrypto(code) && 'crypto'] }, currencySymbol(code).slice(0, 2)),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, code), h('span', { class: 'row-sub' }, name)),
    extra && h('span', { class: 'row-sub mono' }, extra));
  const priceOf = (code) => {
    if (code === s.base) return 'основная';
    const r = store.rate(code);
    return r > 0 ? money(r, s.base) : '';
  };
  const fiatName = (c) => { try { return new Intl.DisplayNames(['ru'], { type: 'currency' }).of(c); } catch { return c; } };

  function render() {
    clear(list);
    const match = (code, name) => !q || code.toLowerCase().includes(q) || (name || '').toLowerCase().includes(q);
    const mine = s.currencies.filter((c) => match(c, isCrypto(c) ? CRYPTO[c].name : fiatName(c)));
    if (mine.length) {
      list.append(h('div', { class: 'micro list-label' }, 'Ваши'));
      mine.forEach((c) => list.append(item(c, isCrypto(c) ? CRYPTO[c].name : fiatName(c), priceOf(c))));
    }
    const fiat = store.CURRENCIES.filter((c) => !s.currencies.includes(c) && match(c, fiatName(c)));
    if (fiat.length) {
      list.append(h('div', { class: 'micro list-label' }, 'Валюты'));
      fiat.forEach((c) => list.append(item(c, fiatName(c), priceOf(c))));
    }
    const coins = store.coinList().filter((c) => !s.currencies.includes(c.s) && match(c.s, c.n));
    if (coins.length) {
      list.append(h('div', { class: 'micro list-label' }, 'Криптовалюта · топ-100 по капитализации'));
      coins.forEach((c) => list.append(item(c.s, `${c.rank ? `#${c.rank} · ` : ''}${c.n}`, priceOf(c.s))));
    }
    // произвольный код фиата, например «VND»
    const code = q.toUpperCase();
    if (/^[A-Z]{3}$/.test(code) && !s.currencies.includes(code) && !store.CURRENCIES.includes(code) && !isCrypto(code)) {
      list.append(item(code, 'Добавить валюту', priceOf(code)));
    }
    if (!list.children.length) list.append(h('div', { class: 'empty small' }, 'Ничего не найдено'));
  }
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Поиск: доллар, BTC, Solana…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); render(); } });
  const sh = openSheet({ title, content: h('div', { class: 'editor' }, search, list) });
  render();
  if (s.livePrices) store.refreshMarket().then((upd) => { if (upd) render(); }).catch(() => {});
}

// ---------- курс внутри операции ----------
function rateField(d, onChange) {
  const row = h('div', { class: 'rate-row' });
  let manual = false;
  function render() {
    clear(row);
    const b = store.base();
    row.hidden = d.currency === b;
    if (row.hidden) return;
    const market = store.marketRate(d.currency) > 0;
    row.append(
      h('span', { class: 'micro' }, `1 ${d.currency} =`),
      h('input', {
        class: 'rate-input mono', inputmode: 'decimal', value: fmtRate(d.rate).replace('.', ','), placeholder: 'курс',
        'aria-label': 'Курс', oninput: (e) => { manual = true; d.rate = parseAmount(e.target.value) || 0; onChange(); },
      }),
      h('span', { class: 'micro' }, b),
      h('span', { class: ['rate-tag', market && !manual ? 'live' : ''] }, market && !manual ? 'рынок' : d.rate > 0 ? 'вручную' : 'нет курса'));
  }
  return {
    el: row,
    render,
    setCurrency(cur) {
      d.currency = cur;
      manual = false;
      d.rate = store.rate(cur);
      render();
      if (!(d.rate > 0) || store.settings().livePrices) {
        store.refreshMarket().then(() => {
          if (!manual && d.currency === cur) { d.rate = store.rate(cur); render(); onChange(); }
        }).catch(() => {});
      }
    },
  };
}

// ---------- трата / доход ----------
export function openTxnEditor({ type = 'expense', txn = null, onDone } = {}) {
  const st = store.settings();
  const startCur = txn?.currency || (st.currencies.includes(st.lastCurrency) ? st.lastCurrency : st.base);
  const d = {
    type: txn?.type || type,
    amountStr: txn ? String(txn.amount).replace('.', ',') : '',
    currency: startCur,
    rate: txn?.rate || store.rate(startCur),
    categoryId: txn?.categoryId || null,
    note: txn?.note || '',
    date: txn?.date || dayKey(),
  };

  const amountInput = h('input', {
    class: 'amount-input mono', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: '0', value: d.amountStr, 'aria-label': 'Сумма',
    oninput: (e) => { d.amountStr = e.target.value; updatePreview(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); amountInput.blur(); } },
  });
  const curBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency({ current: d.currency, onPick: (c) => { rf.setCurrency(c); updateCur(); } }) });
  const preview = h('div', { class: 'amount-preview mono' });
  const rf = rateField(d, () => updatePreview());

  function updateCur() {
    curBtn.textContent = isCrypto(d.currency) ? d.currency : currencySymbol(d.currency);
    rf.render();
    updatePreview();
  }
  function updatePreview() {
    const a = parseAmount(d.amountStr);
    const isExpr = /[+\-*/]/.test(d.amountStr.replace(/^-/, ''));
    const parts = [];
    if (isExpr && a > 0) parts.push(`= ${money(a, d.currency)}`);
    if (d.currency !== st.base && a > 0 && d.rate > 0) parts.push(`≈ ${money(a * d.rate, st.base)}`);
    preview.textContent = parts.join('   ');
  }

  const seg = segmented([['expense', 'Трата'], ['income', 'Доход']], d.type, (v) => {
    d.type = v;
    const cat = store.state().categories.find((c) => c.id === d.categoryId);
    if (cat && cat.type !== 'both' && cat.type !== v) d.categoryId = null;
    renderCats();
    sheet.panel.classList.toggle('is-income', v === 'income');
  });

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

  const noteInput = h('input', {
    class: 'field', placeholder: 'Например, «обед с командой»', maxlength: '200', value: d.note, enterkeyhint: 'done',
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

  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!(amount > 0)) { toast('Введите сумму'); amountInput.focus(); return; }
    if (!d.categoryId) { toast('Выберите ярлык'); return; }
    if (d.currency !== st.base && !(d.rate > 0)) { toast('Нет курса — введите его вручную'); return; }
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
    rf.el,
    h('div', { class: 'section-label micro' }, 'Ярлык'),
    cats,
    h('div', { class: 'section-label micro' }, 'Описание'),
    noteInput,
    sugg,
    h('div', { class: 'section-label micro' }, 'Дата'),
    dateRow(d),
    h('button', { class: 'btn btn-primary save-btn', onclick: save }, txn ? 'Сохранить' : d.type === 'income' ? 'Добавить доход' : 'Добавить трату'),
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
  if (!txn && d.currency !== st.base) rf.setCurrency(d.currency);
  if (!txn) amountInput.focus(); // синхронно в обработчике касания — iOS сразу покажет клавиатуру
  return sheet;
}

// ---------- обмен / покупка / продажа ----------
export function openExchangeEditor({ txn = null } = {}) {
  const st = store.settings();
  const ownCrypto = st.currencies.find(isCrypto) || 'BTC';
  const d = {
    from: txn?.currency || st.base,
    to: txn?.toCurrency || ownCrypto,
    fromStr: txn ? String(txn.amount).replace('.', ',') : '',
    toStr: txn ? String(txn.toAmount).replace('.', ',') : '',
    note: txn?.note || '',
    date: txn?.date || dayKey(),
    fee: 0,
  };
  let toTouched = !!txn; // пользователь ввёл «получаю» сам — не пересчитываем

  const fromInput = h('input', { class: 'swap-input mono', inputmode: 'decimal', placeholder: '0', value: d.fromStr, 'aria-label': 'Отдаю',
    oninput: (e) => { d.fromStr = e.target.value; if (!toTouched) autoTo(); updateInfo(); } });
  const toInput = h('input', { class: 'swap-input mono', inputmode: 'decimal', placeholder: '0', value: d.toStr, 'aria-label': 'Получаю',
    oninput: (e) => { d.toStr = e.target.value; toTouched = !!e.target.value; updateInfo(); } });
  const fromBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency({ current: d.from, title: 'Отдаю', onPick: (c) => { d.from = c; afterCur(); } }) });
  const toBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency({ current: d.to, title: 'Получаю', onPick: (c) => { d.to = c; afterCur(); } }) });
  const fromHint = h('div', { class: 'swap-hint mono' });
  const toHint = h('div', { class: 'swap-hint mono' });
  const info = h('div', { class: 'swap-info' });

  function autoTo() {
    const a = parseAmount(d.fromStr);
    const r = store.pairRate(d.from, d.to);
    if (a > 0 && r > 0) { d.toStr = String(roundAmt(a * r, d.to)).replace('.', ','); toInput.value = d.toStr; }
    else if (!d.fromStr) { d.toStr = ''; toInput.value = ''; }
  }
  function afterCur() {
    fromBtn.textContent = d.from;
    toBtn.textContent = d.to;
    toTouched = false;
    autoTo();
    updateInfo();
    store.refreshMarket().then((u) => { if (u && !toTouched) { autoTo(); updateInfo(); } }).catch(() => {});
  }
  function updateInfo() {
    clear(info);
    const a = parseAmount(d.fromStr), b = parseAmount(d.toStr);
    const own = store.holdings();
    fromHint.textContent = `доступно ${money(own[d.from]?.qty || 0, d.from)}`;
    toHint.textContent = `есть ${money(own[d.to]?.qty || 0, d.to)}`;
    const market = store.pairRate(d.to, d.from);
    if (a > 0 && b > 0) {
      const deal = a / b;
      info.append(h('div', {}, h('span', { class: 'micro' }, 'Курс сделки'), h('b', { class: 'mono' }, `1 ${d.to} = ${money(deal, d.from)}`)));
      if (market > 0) {
        const diff = (deal / market - 1) * 100;
        info.append(h('div', {}, h('span', { class: 'micro' }, 'Рынок'), h('span', { class: 'mono' }, `${money(market, d.from)}`,
          Math.abs(diff) >= 0.1 ? h('span', { class: ['diff', diff > 0 ? 'bad' : 'good'] }, ` ${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`) : null)));
      }
    } else if (market > 0) {
      info.append(h('div', {}, h('span', { class: 'micro' }, 'Рынок'), h('span', { class: 'mono' }, `1 ${d.to} = ${money(market, d.from)}`)));
    } else {
      info.append(h('div', { class: 'muted small' }, 'Курс этой пары неизвестен — введите обе суммы.'));
    }
  }

  const presets = segmented([['buy', 'Купить'], ['sell', 'Продать'], ['swap', 'Обменять']], txn ? 'swap' : 'buy', (v) => {
    const crypto = st.currencies.find(isCrypto) || 'BTC';
    if (v === 'buy') { d.from = st.base; d.to = isCrypto(d.to) ? d.to : crypto; }
    else if (v === 'sell') { const c = isCrypto(d.from) ? d.from : isCrypto(d.to) ? d.to : crypto; d.from = c; d.to = st.base; }
    afterCur();
  });

  async function save() {
    const a = parseAmount(d.fromStr), b = parseAmount(d.toStr);
    if (!(a > 0) || !(b > 0)) { toast('Введите обе суммы'); return; }
    if (d.from === d.to) { toast('Выберите разные валюты'); return; }
    await store.saveExchange({
      ...(txn || {}), amount: a, currency: d.from, rate: store.rate(d.from),
      toAmount: b, toCurrency: d.to, toRate: store.rate(d.to), note: d.note, date: d.date,
    }, txn ? 0 : d.fee);
    haptic();
    sheet.close();
    toast(txn ? 'Сохранено' : 'Обмен записан');
  }

  const content = h('div', { class: 'editor' },
    !txn && presets,
    h('div', { class: 'swap-card' },
      h('div', { class: 'swap-side' }, h('div', { class: 'micro' }, 'Отдаю'), h('div', { class: 'swap-row' }, fromInput, fromBtn), fromHint),
      h('button', { type: 'button', class: 'swap-flip', 'aria-label': 'Поменять местами', onclick: () => {
        [d.from, d.to] = [d.to, d.from];
        [d.fromStr, d.toStr] = [d.toStr, d.fromStr];
        fromInput.value = d.fromStr; toInput.value = d.toStr;
        afterCur();
      } }, '⇅'),
      h('div', { class: 'swap-side' }, h('div', { class: 'micro' }, 'Получаю'), h('div', { class: 'swap-row' }, toInput, toBtn), toHint)),
    info,
    !txn && h('div', { class: 'section-label micro' }, `Комиссия, ${st.base} (необязательно)`),
    !txn && h('input', { class: 'field', inputmode: 'decimal', placeholder: '0', oninput: (e) => { d.fee = parseAmount(e.target.value) || 0; } }),
    h('div', { class: 'section-label micro' }, 'Описание'),
    h('input', { class: 'field', placeholder: 'Например, «Binance» или «обменник»', maxlength: '200', value: d.note, oninput: (e) => { d.note = e.target.value; } }),
    h('div', { class: 'section-label micro' }, 'Дата'),
    dateRow(d),
    h('button', { class: 'btn btn-primary save-btn', onclick: save }, txn ? 'Сохранить' : 'Записать обмен'),
    txn && h('button', { class: 'btn btn-plain danger', onclick: async () => {
      if (await confirmSheet('Удалить обмен?')) { await store.deleteTxn(txn.id); sheet.close(); toast('Удалено'); }
    } }, 'Удалить обмен'));

  const sheet = openSheet({
    title: txn ? 'Обмен' : 'Обмен',
    className: 'sheet-editor',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content,
  });
  afterCur();
  if (!txn) fromInput.focus();
}

// ---------- ярлык ----------
export function openCategoryEditor({ cat = null, type = 'expense', onSave } = {}) {
  const d = { name: cat?.name || '', icon: cat?.icon || '🛒', color: cat?.color || store.COLORS[3], type: cat?.type || type, limit: cat?.limit || 0 };
  const preview = h('div', { class: 'cat-preview' });
  const nameInput = h('input', { class: 'field', placeholder: 'Например, «Кофе»', maxlength: '30', value: d.name, 'aria-label': 'Название', oninput: (e) => { d.name = e.target.value; renderPreview(); } });
  const iconInput = h('input', { class: 'field emoji-field', placeholder: '🙂', value: d.icon, 'aria-label': 'Свой эмодзи', oninput: (e) => { const g = firstGrapheme(e.target.value); if (g) { d.icon = g; renderPreview(); renderEmoji(); } } });
  const emojiGrid = h('div', { class: 'emoji-grid' });
  const colorRow = h('div', { class: 'color-row' });
  const limitWrap = h('div', { class: 'editor' });

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
      h('div', { class: 'section-label micro' }, `Лимит в месяц, ${store.base()}`),
      h('input', { class: 'field mono', inputmode: 'decimal', placeholder: 'Без лимита', value: d.limit ? String(d.limit) : '', 'aria-label': 'Лимит', oninput: (e) => { d.limit = parseAmount(e.target.value) || 0; } }));
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
      h('div', { class: 'section-label micro' }, 'Название'),
      nameInput,
      h('div', { class: 'section-label micro' }, 'Тип'),
      segmented([['expense', 'Расход'], ['income', 'Доход'], ['both', 'Оба']], d.type, (v) => { d.type = v; renderLimit(); }),
      h('div', { class: 'section-label micro' }, 'Иконка'),
      h('div', { class: 'emoji-row' }, iconInput, h('span', { class: 'muted small' }, 'свой эмодзи или из списка')),
      emojiGrid,
      h('div', { class: 'section-label micro' }, 'Цвет'),
      colorRow,
      limitWrap,
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Сохранить ярлык'),
      cat && h('button', {
        class: 'btn btn-plain danger', onclick: async () => {
          const n = store.usageCount(cat.id);
          const ok = await confirmSheet(`Удалить ярлык «${cat.name}»?`, { detail: n ? `${n} операций перейдут в «Другое».` : '' });
          if (ok) { await store.deleteCategory(cat.id); sheet.close(); }
        },
      }, 'Удалить ярлык')),
  });
  renderPreview(); renderEmoji(); renderColors(); renderLimit();
  if (!cat) nameInput.focus();
}
