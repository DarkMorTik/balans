// Инвестиции, вклады и стейкинг: сумма, ставка, срок, накопленный и ожидаемый доход.
import { h, clear, parseAmount, money, dayKey, addDays, shortDate, plural, isCrypto, currencySymbol, haptic } from '../util.js';
import * as store from '../store.js';
import * as P from '../planner.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { pickCurrency, accountPicker } from './editor.js';

const label = (t) => h('div', { class: 'section-label micro' }, t);
const TERMS = [7, 14, 30, 60, 90, 180, 365];

export function openInvestEditor({ item = null } = {}) {
  const today = dayKey();
  const d = {
    kind: item?.kind || 'staking', name: item?.name || '', amountStr: item ? String(item.amount).replace('.', ',') : '',
    currency: item?.currency || (store.settings().currencies.includes('USDT') ? 'USDT' : store.base()),
    aprStr: item?.apr != null ? String(item.apr).replace('.', ',') : '', start: item?.start || today,
    end: item?.end || addDays(today, 30), compound: !!item?.compound, note: item?.note || '', fromAccountId: '',
  };
  const preview = h('div', { class: 'invest-preview' });
  const termRow = h('div', { class: 'kind-row' });
  const endInput = h('input', { type: 'date', class: 'field', value: d.end, onchange: (e) => { if (e.target.value) { d.end = e.target.value; renderTerm(); renderPreview(); } } });
  const startInput = h('input', { type: 'date', class: 'field', value: d.start, onchange: (e) => { if (e.target.value) { d.start = e.target.value; renderTerm(); renderPreview(); } } });
  const kinds = h('div', { class: 'kind-row' });
  const renderKinds = () => {
    clear(kinds);
    Object.entries(P.INVEST_KINDS).forEach(([k, v]) => kinds.append(h('button', { type: 'button', class: ['chip', k === d.kind && 'active'], onclick: () => { d.kind = k; renderKinds(); } }, `${v.icon} ${v.label}`)));
  };
  function renderTerm() {
    clear(termRow);
    const days = Math.round((new Date(d.end) - new Date(d.start)) / 864e5);
    TERMS.forEach((n) => termRow.append(h('button', { type: 'button', class: ['chip', 'mono', n === days && 'active'], onclick: () => {
      d.end = addDays(d.start, n); endInput.value = d.end; renderTerm(); renderPreview();
    } }, `${n} д`)));
  }
  function renderPreview() {
    clear(preview);
    const amount = parseAmount(d.amountStr), apr = parseAmount(d.aprStr) || 0;
    if (!(amount > 0) || d.end <= d.start) return;
    const s = P.investStats({ amount, apr, start: d.start, end: d.end, compound: d.compound }, today);
    preview.append(
      h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, 'срок'), h('span', { class: 'mono' }, `${s.total} ${plural(s.total, 'день', 'дня', 'дней')}`)),
      h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, 'доход за срок'), h('span', { class: 'mono inc' }, `+${money(s.expected, d.currency)}`)),
      h('div', { class: 'note-kv' }, h('span', { class: 'micro' }, 'в конце'), h('span', { class: 'mono' }, money(amount + s.expected, d.currency))));
  }
  const curBtn = h('button', { type: 'button', class: 'cur-btn' });
  const syncCur = () => { curBtn.textContent = isCrypto(d.currency) ? d.currency : currencySymbol(d.currency); };
  curBtn.addEventListener('click', () => pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; syncCur(); renderPreview(); } }));
  syncCur();

  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!d.name.trim()) return toast('Введите название, например «WhiteBit USDT 60 дней»');
    if (!(amount > 0)) return toast('Введите сумму');
    if (d.end <= d.start) return toast('Дата окончания должна быть позже начала');
    const data = { ...(item || {}), kind: d.kind, name: d.name.trim(), amount, currency: d.currency, apr: parseAmount(d.aprStr) || 0, start: d.start, end: d.end, compound: d.compound, note: d.note.trim() };
    if (item) store.upsert('invest', data); else store.addInvestment(data, d.fromAccountId);
    haptic();
    sh.close();
    toast(item ? 'Сохранено' : `Добавлено · окончание ${shortDate(d.end)}`);
  }

  const sh = openSheet({
    title: item ? 'Вложение' : 'Новое вложение',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      kinds,
      label('Название и площадка'),
      h('input', { class: 'field', placeholder: 'Например, «WhiteBit USDT пул 60 дней»', maxlength: '60', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      label('Сумма'),
      h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: '0', value: d.amountStr, oninput: (e) => { d.amountStr = e.target.value; renderPreview(); } }), curBtn),
      label('Ставка, % годовых (APR)'),
      h('input', { class: 'field mono', inputmode: 'decimal', placeholder: 'например 12,5', value: d.aprStr, oninput: (e) => { d.aprStr = e.target.value; renderPreview(); } }),
      label('Начало'),
      startInput,
      label('Срок'),
      termRow,
      label('Окончание'),
      endInput,
      h('label', { class: 'row set-row card' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Сложный процент'), h('span', { class: 'row-sub' }, 'Доход начисляется каждый день и тоже приносит доход')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.compound, onchange: (e) => { d.compound = e.target.checked; renderPreview(); } })),
      preview,
      !item && accountPicker(d, 'fromAccountId', 'Списать сумму со счёта (необязательно)'),
      label('Заметка'),
      h('input', { class: 'field', placeholder: 'Условия, досрочный вывод, ссылка', maxlength: '200', value: d.note, oninput: (e) => { d.note = e.target.value; } }),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить вложение'),
      item && h('button', { class: 'btn btn-plain danger', onclick: async () => {
        if (await confirmSheet(`Удалить «${item.name}»?`, { detail: 'Уже записанные доходы останутся в операциях.' })) { await store.removeItem('invest', item.id); sh.close(); }
      } }, 'Удалить')),
  });
  renderKinds(); renderTerm(); renderPreview();
}

export function investSheet(inv) {
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const v = store.findItem('invest', inv.id);
    if (!v) return;
    const s = P.investStats(v);
    const base = store.base();
    const kind = P.INVEST_KINDS[v.kind] || P.INVEST_KINDS.other;
    body.append(
      h('div', { class: 'debt-hero' },
        h('div', { class: 'micro' }, `${kind.label}${v.apr ? ` · ${String(v.apr).replace('.', ',')}% годовых` : ''}${v.compound ? ' · сложный %' : ''}`),
        h('div', { class: 'debt-rem mono' }, money(v.amount, v.currency)),
        v.currency !== base ? h('div', { class: 'muted small mono' }, `≈ ${money(v.amount * store.rate(v.currency), base)}`) : null,
        h('div', { class: 'bar-track big' }, h('span', { class: 'bar-fill', style: { '--c': s.matured ? 'var(--mint)' : 'var(--brass)', '--w': `${Math.max(2, Math.round(s.progress * 100))}%` } })),
        h('div', { class: 'debt-meta muted small' },
          h('span', {}, `${shortDate(v.start)} → ${shortDate(v.end)}`),
          h('span', { class: v.closed ? '' : s.matured ? 'inc' : '' }, v.closed ? 'закрыто' : s.matured ? 'срок окончен — заберите доход' : `осталось ${s.left} ${plural(s.left, 'день', 'дня', 'дней')}`))),
      h('div', { class: 'kv-grid' },
        h('div', { class: 'kv' }, h('span', { class: 'micro' }, v.closed ? 'получено' : 'накоплено'), h('span', { class: 'mono kv-val good' }, `+${money(v.closed ? v.profit || 0 : s.accrued, v.currency)}`)),
        h('div', { class: 'kv' }, h('span', { class: 'micro' }, 'за весь срок'), h('span', { class: 'mono kv-val' }, `+${money(s.expected, v.currency)}`)),
        h('div', { class: 'kv' }, h('span', { class: 'micro' }, 'в день'), h('span', { class: 'mono kv-val' }, `+${money(s.expected / s.total, v.currency)}`)),
        h('div', { class: 'kv' }, h('span', { class: 'micro' }, 'в конце'), h('span', { class: 'mono kv-val' }, money(v.amount + s.expected, v.currency)))),
      v.note ? h('p', { class: 'muted small' }, v.note) : null,
      !v.closed && h('button', { class: ['btn', s.matured ? 'btn-primary' : 'btn-plain'], onclick: () => closeSheet(v) }, s.matured ? 'Забрать доход' : 'Закрыть досрочно'),
      h('button', { class: 'btn btn-plain', onclick: async () => {
        const n = store.renewInvestment(v);
        toast(`Продлено до ${shortDate(n.end)}`);
      } }, '↻ Продлить на тот же срок'),
      !v.closed && h('button', { class: 'btn btn-plain', onclick: () => openInvestEditor({ item: v }) }, 'Изменить'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: inv.name, content: body, onClose: unsub });
}

function closeSheet(v) {
  const s = P.investStats(v);
  const d = { profitStr: String(Math.round((s.matured ? s.expected : s.accrued) * 100) / 100).replace('.', ','), toAccountId: v.fromAccountId || '', returnPrincipal: true };
  const sh = openSheet({
    title: 'Забрать доход', className: 'sheet-compact',
    content: h('div', { class: 'editor' },
      h('div', { class: 'section-label micro' }, `Фактический доход, ${v.currency}`),
      h('input', { class: 'field mono', inputmode: 'decimal', value: d.profitStr, oninput: (e) => { d.profitStr = e.target.value; } }),
      h('p', { class: 'muted small' }, 'Запишется доходом с ярлыком «Доход от вложений» — попадёт в аналитику.'),
      accountPicker(d, 'toAccountId', 'Зачислить на счёт'),
      h('label', { class: 'row set-row card' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, `Вернуть тело ${money(v.amount, v.currency)} на счёт`), h('span', { class: 'row-sub' }, 'Только если выбран счёт')),
        h('input', { type: 'checkbox', class: 'switch', checked: true, onchange: (e) => { d.returnPrincipal = e.target.checked; } })),
      h('button', { class: 'btn btn-primary', onclick: async () => {
        const profit = parseAmount(d.profitStr) || 0;
        await store.closeInvestment(v, { profit, toAccountId: d.toAccountId, returnPrincipal: d.returnPrincipal });
        sh.close();
        toast(profit > 0 ? `Доход +${money(profit, v.currency)} записан` : 'Вложение закрыто');
      } }, 'Закрыть вложение')),
  });
}

/** Раздел для портфеля. */
export function investSection(root, base) {
  const st = store.state();
  const list = st.invest || [];
  const active = list.filter((v) => !v.closed).sort((a, b) => (a.end < b.end ? -1 : 1));
  const closed = list.filter((v) => v.closed).sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1)).slice(0, 5);
  const totalBase = active.reduce((a, v) => a + v.amount * store.rate(v.currency), 0);
  const accruedBase = active.reduce((a, v) => a + P.investStats(v).accrued * store.rate(v.currency), 0);
  root.append(h('div', { class: 'set-title micro section-head' }, h('span', {}, 'Инвестиции и стейкинг'),
    active.length ? h('span', { class: 'mono' }, `${money(totalBase, base)} · +${money(accruedBase, base)}`) : null));
  const box = h('div', { class: 'card list' });
  active.forEach((v) => {
    const s = P.investStats(v);
    box.append(h('button', { class: ['row', 'invest-row', s.matured && 'matured'], onclick: () => investSheet(v) },
      h('span', { class: 'cat-ico swap' }, P.INVEST_KINDS[v.kind]?.icon || '📈'),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, v.name),
        h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: { '--c': s.matured ? 'var(--mint)' : 'var(--brass)', '--w': `${Math.max(2, Math.round(s.progress * 100))}%` } })),
        h('span', { class: ['row-sub', s.matured && 'inc'] }, s.matured ? `окончен ${shortDate(v.end)} — заберите доход` : `осталось ${s.left} ${plural(s.left, 'день', 'дня', 'дней')} · до ${shortDate(v.end)}${v.apr ? ` · ${String(v.apr).replace('.', ',')}%` : ''}`)),
      h('span', { class: 'row-end' }, h('span', { class: 'amount' }, money(v.amount, v.currency)), h('span', { class: 'row-sub mono inc' }, `+${money(s.expected, v.currency)}`))));
  });
  box.append(h('button', { class: 'row', onclick: () => openInvestEditor({}) },
    h('span', { class: 'cat-ico add-ico' }, '+'), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Добавить вложение'), h('span', { class: 'row-sub' }, 'Стейкинг, вклад, накопительный счёт'))));
  root.append(box);
  if (closed.length) {
    root.append(h('div', { class: 'micro list-label' }, 'Закрытые'), h('div', { class: 'card list' }, closed.map((v) => h('button', { class: 'row is-paid', onclick: () => investSheet(v) },
      h('span', { class: 'cat-ico swap' }, P.INVEST_KINDS[v.kind]?.icon || '📈'),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, v.name), h('span', { class: 'row-sub' }, `закрыто ${shortDate(v.closedAt || v.end)}`)),
      h('span', { class: 'amount inc' }, `+${money(v.profit || 0, v.currency)}`)))));
  }
  return { totalBase, accruedBase };
}
