// Счета и переводы, шаблоны быстрых операций, умный и голосовой ввод.
import { h, clear, parseAmount, money, dayKey, isCrypto, currencySymbol, roundAmt, haptic } from '../util.js';
import * as store from '../store.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { segmented, pickCurrency, dateRow, openTxnEditor, defaultAccount } from './editor.js';
import { parseQuick, guessCategory } from '../nlp.js';
import { txnListSheet } from './home.js';

const label = (t) => h('div', { class: 'section-label micro' }, t);

// ---------- счёт ----------
export function openAccountEditor({ item = null } = {}) {
  const d = {
    name: item?.name || '', kind: item?.kind || 'card', currency: item?.currency || store.base(),
    initialStr: item ? String(item.initial || 0).replace('.', ',') : '', archived: !!item?.archived,
  };
  const kinds = h('div', { class: 'kind-row' });
  const renderKinds = () => {
    clear(kinds);
    Object.entries(store.ACCOUNT_KINDS).forEach(([k, v]) => kinds.append(h('button', { type: 'button', class: ['chip', k === d.kind && 'active'], onclick: () => { d.kind = k; renderKinds(); } }, `${v.icon} ${v.label}`)));
  };
  const curBtn = h('button', { type: 'button', class: 'cur-btn' });
  const syncCur = () => { curBtn.textContent = d.currency; };
  curBtn.addEventListener('click', () => {
    if (item && store.state().txns.some((t) => t.accountId === item.id || t.toAccountId === item.id)) return toast('Валюту счёта с операциями менять нельзя');
    pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; syncCur(); } });
  });
  syncCur();
  async function save() {
    if (!d.name.trim()) return toast('Введите название счёта');
    const acc = store.upsert('accounts', { ...(item || {}), name: d.name.trim(), kind: d.kind, icon: store.ACCOUNT_KINDS[d.kind].icon, currency: d.currency, initial: parseAmount(d.initialStr) || 0, archived: d.archived });
    if (!store.settings().lastAccount) store.settings().lastAccount = acc.id;
    sh.close();
    toast(item ? 'Сохранено' : 'Счёт добавлен');
  }
  const sh = openSheet({
    title: item ? 'Счёт' : 'Новый счёт',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      kinds,
      label('Название'),
      h('input', { class: 'field', placeholder: 'Например, «Карта Monobank» или «Наличные»', maxlength: '40', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      label('Начальный остаток и валюта'),
      h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: '0', value: d.initialStr, oninput: (e) => { d.initialStr = e.target.value; } }), curBtn),
      h('p', { class: 'muted small' }, 'Сколько на счету сейчас. Операции, записанные раньше без счёта, считаются уже учтёнными в этом остатке. Позже остаток можно сверить кнопкой «Сверить остаток».'),
      item && h('label', { class: 'row set-row card' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'В архиве'), h('span', { class: 'row-sub' }, 'Скрыть из выбора, история сохранится')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.archived, onchange: (e) => { d.archived = e.target.checked; } })),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить счёт'),
      item && h('button', { class: 'btn btn-plain danger', onclick: async () => {
        if (!(await confirmSheet(`Удалить счёт «${item.name}»?`, { detail: 'Операции останутся, но будут без счёта. Чтобы просто скрыть счёт, отправьте его в архив.' }))) return;
        store.state().txns.forEach((t) => { if (t.accountId === item.id) delete t.accountId; if (t.toAccountId === item.id) delete t.toAccountId; });
        await store.removeItem('accounts', item.id);
        sh.close();
      } }, 'Удалить счёт')),
  });
  renderKinds();
}

export function accountSheet(acc) {
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const a = store.account(acc.id);
    if (!a) return;
    const bal = store.accountBalances()[a.id];
    let actual = '';
    body.append(
      h('div', { class: 'debt-hero' },
        h('div', { class: 'micro' }, `${store.ACCOUNT_KINDS[a.kind]?.label || 'Счёт'} · баланс`),
        h('div', { class: ['debt-rem', 'mono', bal.balance < 0 && 'neg'] }, money(bal.balance, a.currency)),
        a.currency !== store.base() ? h('div', { class: 'muted small mono' }, `≈ ${money(bal.inBase, store.base())}`) : null),
      h('div', { class: 'dock-actions two' },
        h('button', { class: 'act act-swap', onclick: () => openTransferSheet({ fromId: a.id }) }, h('span', { class: 'act-sign' }, '⇄'), 'Перевести'),
        h('button', { class: 'act', onclick: () => txnListSheet(a.name, store.state().txns.filter((t) => t.accountId === a.id || t.toAccountId === a.id)) }, h('span', { class: 'act-sign' }, '≡'), 'Операции')),
      h('div', { class: 'card pad editor' },
        h('div', { class: 'micro' }, 'Фактический остаток'),
        h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: String(bal.balance).replace('.', ','), oninput: (e) => { actual = e.target.value; } }), h('span', { class: 'cur-btn' }, a.currency)),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          const v = parseAmount(actual);
          if (Number.isNaN(v) || actual === '') return toast('Введите остаток');
          await store.setAccountBalance(a, v);
          toast('Остаток обновлён');
        } }, 'Сверить остаток'),
        h('p', { class: 'muted small' }, 'Разница запишется корректировкой и не попадёт в доходы и расходы.')),
      h('button', { class: 'btn btn-plain', onclick: () => openAccountEditor({ item: a }) }, 'Изменить счёт'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: acc.name, content: body, onClose: unsub });
}

export function openTransferSheet({ fromId = '', txn = null } = {}) {
  const accs = store.activeAccounts();
  if (accs.length < 2) return toast('Для перевода нужно минимум два счёта');
  const d = {
    fromId: txn?.accountId || fromId || accs[0].id,
    toId: txn?.toAccountId || accs.find((a) => a.id !== (fromId || accs[0].id))?.id,
    amountStr: txn ? String(txn.amount).replace('.', ',') : '', toStr: txn ? String(txn.toAmount).replace('.', ',') : '',
    note: txn?.note || '', date: txn?.date || dayKey(),
  };
  const box = h('div', { class: 'editor' });
  let toTouched = !!txn;
  function render() {
    clear(box);
    const from = store.account(d.fromId), to = store.account(d.toId);
    const bal = store.accountBalances();
    const pick = (key, other) => h('div', { class: 'kind-row' }, accs.map((a) => h('button', {
      type: 'button', class: ['chip', d[key] === a.id && 'active'], disabled: a.id === d[other],
      onclick: () => { d[key] = a.id; toTouched = false; render(); },
    }, `${a.icon || '▫'} ${a.name}`)));
    const diffCur = from && to && from.currency !== to.currency;
    const toInput = h('input', { class: 'swap-input mono', inputmode: 'decimal', placeholder: '0', value: d.toStr, oninput: (e) => { d.toStr = e.target.value; toTouched = true; } });
    const fromInput = h('input', { class: 'swap-input mono', inputmode: 'decimal', placeholder: '0', value: d.amountStr, oninput: (e) => {
      d.amountStr = e.target.value;
      if (diffCur && !toTouched) {
        const r = store.pairRate(from.currency, to.currency);
        const a = parseAmount(d.amountStr);
        d.toStr = a > 0 && r > 0 ? String(roundAmt(a * r, to.currency)).replace('.', ',') : '';
        toInput.value = d.toStr;
      }
    } });
    box.append(
      label('Откуда'), pick('fromId', 'toId'),
      h('div', { class: 'swap-side' }, h('div', { class: 'swap-row' }, fromInput, h('span', { class: 'cur-btn' }, from?.currency || '')),
        h('div', { class: 'swap-hint mono' }, from ? `на счету ${money(bal[from.id]?.balance || 0, from.currency)}` : '')),
      label('Куда'), pick('toId', 'fromId'),
      diffCur && h('div', { class: 'swap-side' }, h('div', { class: 'swap-row' }, toInput, h('span', { class: 'cur-btn' }, to.currency)),
        h('div', { class: 'swap-hint mono' }, 'сумма зачисления — по курсу, можно поправить')),
      label('Описание'),
      h('input', { class: 'field', placeholder: 'Например, «снял в банкомате»', value: d.note, oninput: (e) => { d.note = e.target.value; } }),
      label('Дата'), dateRow(d),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, txn ? 'Сохранить' : 'Перевести'),
      txn && h('button', { class: 'btn btn-plain danger', onclick: async () => { if (await confirmSheet('Удалить перевод?')) { await store.deleteTxn(txn.id); sh.close(); } } }, 'Удалить перевод'));
  }
  async function save() {
    const a = parseAmount(d.amountStr);
    if (!(a > 0)) return toast('Введите сумму');
    if (!d.toId || d.toId === d.fromId) return toast('Выберите разные счета');
    const from = store.account(d.fromId), to = store.account(d.toId);
    const b = from.currency === to.currency ? a : parseAmount(d.toStr);
    if (!(b > 0)) return toast('Введите сумму зачисления');
    await store.saveTransfer({ id: txn?.id, fromId: d.fromId, toId: d.toId, amount: a, toAmount: b, date: d.date, note: d.note });
    haptic();
    sh.close();
    toast(txn ? 'Сохранено' : 'Перевод записан');
  }
  const sh = openSheet({ title: 'Перевод между счетами', right: h('button', { class: 'link strong', onclick: save }, 'Готово'), content: box });
  render();
}

// ---------- шаблон ----------
export function openTemplateEditor({ item = null } = {}) {
  const st = store.settings();
  const d = {
    name: item?.name || '', type: item?.type || 'expense', amountStr: item ? String(item.amount).replace('.', ',') : '',
    currency: item?.currency || st.base, categoryId: item?.categoryId || null, accountId: item?.accountId || '',
  };
  const cats = h('div', { class: 'cat-grid' });
  const renderCats = () => {
    clear(cats);
    store.categoriesFor(d.type).forEach((c) => cats.append(h('button', { type: 'button', class: ['cat-chip', c.id === d.categoryId && 'active'], style: { '--c': c.color },
      onclick: () => { d.categoryId = c.id; renderCats(); } }, h('span', { class: 'cat-ico' }, c.icon), h('span', { class: 'cat-name' }, c.name))));
  };
  const curBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; curBtn.textContent = isCrypto(c) ? c : currencySymbol(c); } }) }, isCrypto(d.currency) ? d.currency : currencySymbol(d.currency));
  const accWrap = h('div');
  const renderAcc = () => {
    clear(accWrap);
    const accs = store.activeAccounts();
    if (!accs.length) return;
    accWrap.append(label('Счёт'), h('div', { class: 'kind-row' }, [...accs.map((a) => h('button', { type: 'button', class: ['chip', d.accountId === a.id && 'active'], onclick: () => { d.accountId = a.id; renderAcc(); } }, `${a.icon || '▫'} ${a.name}`)),
      h('button', { type: 'button', class: ['chip', !d.accountId && 'active'], onclick: () => { d.accountId = ''; renderAcc(); } }, 'Без счёта')]));
  };
  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!(amount > 0)) return toast('Введите сумму');
    if (!d.categoryId) return toast('Выберите ярлык');
    const c = store.category(d.categoryId);
    store.upsert('templates', { ...(item || {}), name: d.name.trim() || c.name, icon: c.icon, type: d.type, amount, currency: d.currency, categoryId: d.categoryId, accountId: d.accountId, note: d.name.trim() });
    sh.close();
    toast(item ? 'Шаблон сохранён' : 'Шаблон добавлен');
  }
  const sh = openSheet({
    title: item ? 'Шаблон' : 'Новый шаблон',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      segmented([['expense', 'Трата'], ['income', 'Доход']], d.type, (v) => { d.type = v; d.categoryId = null; renderCats(); }),
      label('Название'),
      h('input', { class: 'field', placeholder: 'Например, «Кофе» или «Обед»', maxlength: '30', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: '0', value: d.amountStr, oninput: (e) => { d.amountStr = e.target.value; } }), curBtn),
      label('Ярлык'), cats,
      accWrap,
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить шаблон'),
      item && h('button', { class: 'btn btn-plain danger', onclick: async () => { await store.removeItem('templates', item.id); sh.close(); toast('Шаблон удалён'); } }, 'Удалить шаблон')),
  });
  renderCats();
  renderAcc();
}

/** Применить шаблон с возможностью отмены. */
export async function useTemplate(tpl) {
  haptic();
  const t = await store.applyTemplate(tpl);
  toast(`${tpl.name}: ${money(tpl.type === 'income' ? tpl.amount : -tpl.amount, tpl.currency, { sign: tpl.type === 'income' })}`, { label: 'Отменить', run: () => store.deleteTxn(t.id) });
}

// ---------- умный и голосовой ввод ----------
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const voiceSupported = !!SR;

export function openSmartInput({ listen = false } = {}) {
  const st = store.state();
  let text = '';
  let rec = null;
  const preview = h('div', { class: 'smart-preview' });
  const input = h('input', {
    class: 'field smart-field', placeholder: 'Например: «такси 12 долларов»', value: '', enterkeyhint: 'done', autocomplete: 'off',
    oninput: (e) => { text = e.target.value; render(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } },
  });
  const micBtn = h('button', { class: ['mic-btn', !SR && 'off'], 'aria-label': 'Говорить', onclick: () => (rec ? stop() : start()) }, h('span', { class: 'mic-ico' }), h('span', { class: 'mic-label micro' }, SR ? 'Нажмите и говорите' : 'Диктовка: 🎤 на клавиатуре'));

  function draft() {
    const p = parseQuick(text);
    const history = st.txns.slice(-400).map((t) => ({ note: t.note, categoryId: t.categoryId, type: t.type }));
    const categoryId = guessCategory(text, st.categories, history, p.type) || guessCategory(p.note, st.categories, history, p.type);
    return { ...p, currency: p.currency || st.settings.lastCurrency || st.settings.base, categoryId };
  }
  function render() {
    clear(preview);
    if (!text.trim()) {
      preview.append(h('div', { class: 'muted small' }, 'Скажите или напишите, что и сколько: «кофе 4,5», «зарплата 2400 евро», «аренда полторы тысячи долларов». Ярлык подберётся сам по прошлым операциям.'));
      return;
    }
    const x = draft();
    const c = x.categoryId ? store.category(x.categoryId) : null;
    preview.append(h('div', { class: ['smart-card', x.type === 'income' && 'inc'] },
      h('span', { class: 'cat-ico', style: { '--c': c?.color || '#8e8a9c' } }, c?.icon || '?'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, x.note || c?.name || 'Без описания'),
        h('span', { class: 'row-sub' }, [x.type === 'income' ? 'доход' : 'трата', c ? c.name : 'ярлык не найден — выберите при сохранении'].join(' · '))),
      h('span', { class: ['amount', x.type === 'income' && 'inc'] }, x.amount ? money(x.type === 'income' ? x.amount : -x.amount, x.currency, { sign: x.type === 'income' }) : '—')));
  }
  async function add() {
    const x = draft();
    if (!x.amount || !x.categoryId) { edit(); return; }
    const rate = store.rate(x.currency);
    if (x.currency !== store.base() && !(rate > 0)) { edit(); return; }
    await store.saveTxn({ type: x.type, amount: x.amount, currency: x.currency, rate, categoryId: x.categoryId, note: x.note, date: dayKey(), accountId: defaultAccount() });
    haptic();
    sh.close();
    toast(x.type === 'income' ? 'Доход добавлен' : 'Трата добавлена');
  }
  function edit() {
    const x = draft();
    sh.close();
    openTxnEditor({ type: x.type, prefill: { type: x.type, amount: x.amount, currency: x.currency, categoryId: x.categoryId, note: x.note } });
  }
  function start() {
    if (!SR) { input.focus(); return; }
    try {
      rec = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        text = Array.from(e.results).map((r) => r[0].transcript).join(' ');
        input.value = text;
        render();
      };
      rec.onend = () => { rec = null; micBtn.classList.remove('live'); };
      rec.onerror = () => { rec = null; micBtn.classList.remove('live'); toast('Микрофон недоступен — используйте диктовку на клавиатуре'); };
      rec.start();
      micBtn.classList.add('live');
    } catch { rec = null; toast('Голосовой ввод недоступен'); }
  }
  function stop() { try { rec?.stop(); } catch { /* уже остановлен */ } }

  const sh = openSheet({
    title: 'Быстрый ввод',
    onClose: stop,
    content: h('div', { class: 'editor' },
      micBtn,
      input,
      preview,
      h('div', { class: 'dock-actions two' },
        h('button', { class: 'act act-inc', onclick: add }, h('span', { class: 'act-sign' }, '✓'), 'Добавить'),
        h('button', { class: 'act', onclick: edit }, h('span', { class: 'act-sign' }, '✎'), 'Уточнить')),
      h('p', { class: 'muted small' }, SR ? 'Распознавание речи выполняет iOS (через сервис Apple). В приложение попадает только текст, и он сразу шифруется.' : 'Текст разбирается прямо на устройстве.')),
  });
  render();
  if (listen && SR) start(); else input.focus();
}
