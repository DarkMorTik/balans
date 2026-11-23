// Счета и переводы, шаблоны быстрых операций, умный и голосовой ввод.
import { h, clear, parseAmount, money, dayKey, shortDate, isCrypto, currencySymbol, roundAmt, haptic } from '../util.js';
import * as store from '../store.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { segmented, pickCurrency, openTxnEditor } from './editor.js';
import { parseQuick, guessCategory } from '../nlp.js';

const label = (t) => h('div', { class: 'section-label micro' }, t);

// ---------- счёт (капитал) ----------
export function openAccountEditor({ item = null, preset = '' } = {}) {
  const d = {
    name: item?.name || '', kind: item?.kind || preset || 'card', currency: item?.currency || store.base(),
    balanceStr: item ? String(item.balance || 0).replace('.', ',') : '', archived: !!item?.archived,
    locked: item ? !!item.locked : store.LOCKED_KINDS.has(preset), lockReason: item?.lockReason || '', unlockDate: item?.unlockDate || '', countInCapital: item?.countInCapital !== false,
  };
  const kinds = h('div', { class: 'kind-row' });
  const renderKinds = () => {
    clear(kinds);
    Object.entries(store.ACCOUNT_KINDS).forEach(([k, v]) => kinds.append(h('button', { type: 'button', class: ['chip', k === d.kind && 'active'], onclick: () => {
      d.kind = k;
      if (store.LOCKED_KINDS.has(k)) d.locked = true;
      renderKinds(); renderLock();
    } }, `${v.icon} ${v.label}`)));
  };
  // --- недоступные деньги ---
  const lockBox = h('div', { class: 'editor' });
  const plusMonths = (n) => { const x = new Date(); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10); };
  function renderLock() {
    clear(lockBox);
    lockBox.append(h('label', { class: 'row set-row card' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, '🔒 Недоступно сейчас'), h('span', { class: 'row-sub wrap' }, 'Залог, заблокированный аккаунт, деньги в споре — ваши, но не на руках')),
      h('input', { type: 'checkbox', class: 'switch', checked: d.locked, onchange: (e) => { d.locked = e.target.checked; renderLock(); } })));
    if (!d.locked) return;
    const dateInput = h('input', { type: 'date', class: 'date-input', value: d.unlockDate, onchange: (e) => { d.unlockDate = e.target.value; renderLock(); } });
    lockBox.append(
      label('Причина'),
      h('input', { class: 'field', placeholder: d.kind === 'pledge' ? 'Например, «залог за квартиру на Сумской»' : 'Например, «аккаунт на проверке KYC»', maxlength: '80', value: d.lockReason, oninput: (e) => { d.lockReason = e.target.value; } }),
      label('Когда станет доступно'),
      h('div', { class: 'date-row' },
        ...[[1, '1 мес'], [3, '3 мес'], [6, '6 мес'], [12, 'год']].map(([n, l]) => h('button', { type: 'button', class: 'chip', onclick: () => { d.unlockDate = plusMonths(n); renderLock(); } }, l)),
        h('button', { type: 'button', class: ['chip', !d.unlockDate && 'active'], onclick: () => { d.unlockDate = ''; renderLock(); } }, 'Не известно'),
        h('label', { class: ['chip', 'date-chip', d.unlockDate && 'active'] }, dateInput)),
      d.unlockDate ? h('p', { class: 'muted small' }, `Дата появится в календаре и в напоминаниях: ${shortDate(d.unlockDate)}.`) : null,
      h('label', { class: 'row set-row card' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Учитывать в капитале'), h('span', { class: 'row-sub wrap' }, 'Выключите, если вернуть деньги не гарантировано')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.countInCapital, onchange: (e) => { d.countInCapital = e.target.checked; } })));
  }
  const curBtn = h('button', { type: 'button', class: 'cur-btn' });
  const syncCur = () => { curBtn.textContent = d.currency; };
  curBtn.addEventListener('click', () => pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; syncCur(); } }));
  syncCur();
  async function save() {
    if (!d.name.trim()) return toast('Введите название счёта');
    const balance = parseAmount(d.balanceStr) || 0;
    const changedBal = !item || balance !== (item.balance || 0) || d.currency !== item.currency;
    const acc = store.upsert('accounts', {
      ...(item || {}), name: d.name.trim(), kind: d.kind, icon: d.locked && !store.LOCKED_KINDS.has(d.kind) ? '🔒' : store.ACCOUNT_KINDS[d.kind].icon, currency: d.currency, balance, archived: d.archived,
      locked: d.locked, lockReason: d.locked ? d.lockReason.trim() : '', unlockDate: d.locked ? d.unlockDate : '', countInCapital: d.locked ? d.countInCapital : true,
      history: changedBal ? [...(item?.history || []), { date: dayKey(), balance, note: item ? 'изменено' : 'открыт' }].slice(-60) : item.history,
      checkedAt: changedBal ? Date.now() : item?.checkedAt,
    });
    if (changedBal) store.snapshotCapital();
    sh.close();
    toast(item ? 'Сохранено' : `Счёт «${acc.name}» добавлен`);
  }
  const sh = openSheet({
    title: item ? 'Счёт' : 'Новый счёт',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      kinds,
      label('Название'),
      h('input', { class: 'field', placeholder: 'Например, «Карта Monobank», «Ledger», «WhiteBit»', maxlength: '40', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      label('Сколько на счету сейчас'),
      h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: '0', value: d.balanceStr, oninput: (e) => { d.balanceStr = e.target.value; } }), curBtn),
      h('p', { class: 'muted small' }, 'Это часть капитала. Ежедневные траты и доходы его не меняют — остаток вы сверяете сами, когда подводите баланс.'),
      lockBox,
      item && h('label', { class: 'row set-row card' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'В архиве'), h('span', { class: 'row-sub' }, 'Не учитывать в капитале, но сохранить историю')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.archived, onchange: (e) => { d.archived = e.target.checked; } })),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить счёт'),
      item && h('button', { class: 'btn btn-plain danger', onclick: async () => {
        if (!(await confirmSheet(`Удалить счёт «${item.name}»?`, { detail: 'Счёт пропадёт из капитала. Траты и доходы в дневнике не изменятся.' }))) return;
        await store.removeItem('accounts', item.id);
        store.snapshotCapital();
        sh.close();
        toast('Счёт удалён');
      } }, 'Удалить счёт')),
  });
  renderKinds();
  renderLock();
}

export function accountSheet(acc) {
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const a = store.account(acc.id);
    if (!a) return;
    const bal = store.accountBalances()[a.id];
    let actual = '';
    const hist = [...(a.history || [])].reverse().slice(0, 8);
    body.append(
      h('div', { class: 'debt-hero' },
        h('div', { class: 'micro' }, `${store.ACCOUNT_KINDS[a.kind]?.label || 'Счёт'}${a.checkedAt ? ` · сверено ${ago(a.checkedAt)}` : ''}`),
        h('div', { class: ['debt-rem', 'mono', bal.balance < 0 && 'neg'] }, money(bal.balance, a.currency)),
        a.currency !== store.base() ? h('div', { class: 'muted small mono' }, `≈ ${money(bal.inBase, store.base())}`) : null),
      a.locked && h('div', { class: 'lock-banner' },
        h('span', { class: 'lock-ico' }, '🔒'),
        h('div', { class: 'row-main' },
          h('span', { class: 'row-title' }, a.lockReason || 'Недоступно сейчас'),
          h('span', { class: 'row-sub' }, [a.unlockDate ? `станет доступно ${shortDate(a.unlockDate)}` : 'срок не известен', a.countInCapital === false ? 'не входит в капитал' : 'входит в капитал'].join(' · ')))),
      a.locked && h('button', { class: 'btn btn-primary', onclick: async () => {
        if (await confirmSheet('Деньги стали доступны?', { ok: 'Да, доступны', danger: false, detail: 'Счёт станет обычным и войдёт в доступные деньги.' })) { await store.unlockAccount(a); toast('Готово — деньги доступны'); }
      } }, '🔓 Деньги стали доступны'),
      h('div', { class: 'card pad editor' },
        h('div', { class: 'micro' }, 'Сверить: сколько сейчас на самом деле'),
        h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: String(bal.balance).replace('.', ','), oninput: (e) => { actual = e.target.value; } }), h('span', { class: 'cur-btn' }, a.currency)),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          const v = parseAmount(actual);
          if (Number.isNaN(v) || actual === '') return toast('Введите остаток');
          await store.setAccountBalance(a, v);
          toast('Остаток сверен');
        } }, 'Сохранить остаток')),
      store.activeAccounts().length > 1 && h('button', { class: 'btn btn-plain', onclick: () => openTransferSheet({ fromId: a.id }) }, '⇄ Перевести на другой счёт'),
      hist.length ? h('div', { class: 'micro list-label' }, 'История остатка') : null,
      hist.length ? h('div', { class: 'card list' }, hist.map((x) => h('div', { class: 'row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title mono' }, money(x.balance, a.currency)), h('span', { class: 'row-sub' }, [shortDate(x.date), x.note].filter(Boolean).join(' · ')))))) : null,
      h('button', { class: 'btn btn-plain', onclick: () => openAccountEditor({ item: a }) }, 'Изменить счёт'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: acc.name, content: body, onClose: unsub });
}

/** Подвести баланс: ввести фактические остатки всех счетов сразу. */
export function openReconcileSheet() {
  const accs = store.activeAccounts();
  if (!accs.length) return openAccountEditor({});
  const vals = Object.fromEntries(accs.map((a) => [a.id, String(a.balance || 0).replace('.', ',')]));
  const sh = openSheet({
    title: 'Подвести баланс',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      h('p', { class: 'muted small' }, 'Впишите, сколько сейчас на каждом счету. Капитал пересчитается, а в истории появится точка — так видно, как он меняется.'),
      h('div', { class: 'card list' }, accs.map((a) => h('label', { class: 'row budget-row' },
        h('span', { class: 'cat-ico swap' }, a.icon || '▫'),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, a.name), h('span', { class: 'row-sub' }, a.checkedAt ? `сверено ${ago(a.checkedAt)}` : 'ещё не сверялся')),
        h('input', { class: 'budget-input mono', inputmode: 'decimal', value: vals[a.id], 'aria-label': `Остаток: ${a.name}`, oninput: (e) => { vals[a.id] = e.target.value; } }),
        h('span', { class: 'mono rec-cur' }, a.currency)))),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Сохранить баланс')),
  });
  async function save() {
    const map = {};
    for (const a of accs) { const v = parseAmount(vals[a.id]); if (!Number.isNaN(v)) map[a.id] = v; }
    await store.reconcile(map);
    sh.close();
    toast('Баланс подведён');
  }
}

export function openTransferSheet({ fromId = '' } = {}) {
  const accs = store.activeAccounts();
  if (accs.length < 2) return toast('Для перевода нужно минимум два счёта');
  const d = { fromId: fromId || accs[0].id, toId: accs.find((a) => a.id !== (fromId || accs[0].id))?.id, amountStr: '', toStr: '' };
  const box = h('div', { class: 'editor' });
  let toTouched = false;
  function render() {
    clear(box);
    const from = store.account(d.fromId), to = store.account(d.toId);
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
        h('div', { class: 'swap-hint mono' }, from ? `на счету ${money(from.balance || 0, from.currency)}` : '')),
      label('Куда'), pick('toId', 'fromId'),
      diffCur && h('div', { class: 'swap-side' }, h('div', { class: 'swap-row' }, toInput, h('span', { class: 'cur-btn' }, to.currency)),
        h('div', { class: 'swap-hint mono' }, 'сумма зачисления — по курсу, можно поправить')),
      h('p', { class: 'muted small' }, 'Перевод меняет только остатки счетов в портфеле. В дневник трат он не попадает.'),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Перевести'));
  }
  async function save() {
    const a = parseAmount(d.amountStr);
    if (!(a > 0)) return toast('Введите сумму');
    if (!d.toId || d.toId === d.fromId) return toast('Выберите разные счета');
    const from = store.account(d.fromId), to = store.account(d.toId);
    const b = from.currency === to.currency ? a : parseAmount(d.toStr);
    if (!(b > 0)) return toast('Введите сумму зачисления');
    await store.transferBetween({ fromId: d.fromId, toId: d.toId, amount: a, toAmount: b });
    haptic();
    sh.close();
    toast('Перевод выполнен');
  }
  const sh = openSheet({ title: 'Перевод между счетами', right: h('button', { class: 'link strong', onclick: save }, 'Готово'), content: box });
  render();
}

function ago(ts) {
  const days = Math.floor((Date.now() - ts) / 864e5);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  return `${days} дн. назад`;
}

// ---------- шаблон ----------
export function openTemplateEditor({ item = null } = {}) {
  const st = store.settings();
  const d = {
    name: item?.name || '', type: item?.type || 'expense', amountStr: item ? String(item.amount).replace('.', ',') : '',
    currency: item?.currency || st.base, categoryId: item?.categoryId || null,
  };
  const cats = h('div', { class: 'cat-grid' });
  const renderCats = () => {
    clear(cats);
    store.categoriesFor(d.type).forEach((c) => cats.append(h('button', { type: 'button', class: ['cat-chip', c.id === d.categoryId && 'active'], style: { '--c': c.color },
      onclick: () => { d.categoryId = c.id; renderCats(); } }, h('span', { class: 'cat-ico' }, c.icon), h('span', { class: 'cat-name' }, c.name))));
  };
  const curBtn = h('button', { type: 'button', class: 'cur-btn', onclick: () => pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; curBtn.textContent = isCrypto(c) ? c : currencySymbol(c); } }) }, isCrypto(d.currency) ? d.currency : currencySymbol(d.currency));
  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!(amount > 0)) return toast('Введите сумму');
    if (!d.categoryId) return toast('Выберите ярлык');
    const c = store.category(d.categoryId);
    store.upsert('templates', { ...(item || {}), name: d.name.trim() || c.name, icon: c.icon, type: d.type, amount, currency: d.currency, categoryId: d.categoryId, note: d.name.trim() });
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
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить шаблон'),
      item && h('button', { class: 'btn btn-plain danger', onclick: async () => { await store.removeItem('templates', item.id); sh.close(); toast('Шаблон удалён'); } }, 'Удалить шаблон')),
  });
  renderCats();
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
    await store.saveTxn({ type: x.type, amount: x.amount, currency: x.currency, rate, categoryId: x.categoryId, note: x.note, date: dayKey() });
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
