// Листы планировщика: регулярные платежи, обязательства, задачи, заметки, цели.
import { h, clear, parseAmount, dayKey, addDays, money, dayTitle, shortDate, isCrypto, currencySymbol } from '../util.js';
import * as store from '../store.js';
import * as P from '../planner.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { segmented, pickCurrency } from './editor.js';

const label = (t) => h('div', { class: 'section-label micro' }, t);

function futureDate(d, key = 'date') {
  const wrap = h('div', { class: 'date-row' });
  const input = h('input', { type: 'date', class: 'date-input', value: d[key] || '', onchange: (e) => { d[key] = e.target.value; render(); } });
  function render() {
    clear(wrap);
    const today = dayKey(), tom = addDays(today, 1);
    [[today, 'Сегодня'], [tom, 'Завтра']].forEach(([v, l]) => wrap.append(h('button', {
      type: 'button', class: ['chip', d[key] === v && 'active'], onclick: () => { d[key] = v; input.value = v; render(); },
    }, l)));
    wrap.append(h('label', { class: ['chip', 'date-chip', d[key] && d[key] !== today && d[key] !== tom && 'active'] }, input));
  }
  render();
  return wrap;
}

function amountRow(d, placeholder = '0') {
  const btn = h('button', { type: 'button', class: 'cur-btn' });
  const sync = () => { btn.textContent = isCrypto(d.currency) ? d.currency : currencySymbol(d.currency); };
  btn.addEventListener('click', () => pickCurrency({ current: d.currency, onPick: (c) => { d.currency = c; sync(); } }));
  sync();
  return h('div', { class: 'amount-wrap' },
    h('input', { class: 'amount-input mono', inputmode: 'decimal', placeholder, value: d.amountStr || '', 'aria-label': 'Сумма', oninput: (e) => { d.amountStr = e.target.value; } }),
    btn);
}

function deleteButton(text, question, fn) {
  return h('button', { class: 'btn btn-plain danger', onclick: async () => { if (await confirmSheet(question)) fn(); } }, text);
}

// ---------- регулярный платёж ----------
export function openRecurringEditor({ item = null, date = null } = {}) {
  const base = store.base();
  const d = {
    name: item?.name || '', amountStr: item ? String(item.amount).replace('.', ',') : '', currency: item?.currency || base,
    categoryId: item?.categoryId || store.categoryByName('Подписки')?.id, freq: item?.freq || 'monthly',
    day: item?.day || Number((date || dayKey()).slice(8)), weekday: item?.weekday ?? 0, month: item?.month || Number((date || dayKey()).slice(5, 7)),
    start: item?.start || (date || dayKey()).slice(0, 8) + '01', active: item?.active !== false, icon: item?.icon || '🔁',
  };
  const when = h('div', { class: 'editor' });
  function renderWhen() {
    clear(when);
    if (d.freq === 'monthly') {
      when.append(label('Число месяца'), h('div', { class: 'day-grid' }, Array.from({ length: 31 }, (_, i) => i + 1).map((n) =>
        h('button', { type: 'button', class: ['day-btn', 'mono', n === d.day && 'active'], onclick: () => { d.day = n; renderWhen(); } }, n))),
      d.day > 28 ? h('p', { class: 'muted small' }, 'В коротких месяцах — в последний день.') : null);
    } else if (d.freq === 'weekly') {
      when.append(label('День недели'), h('div', { class: 'date-row' }, ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'].map((w, i) =>
        h('button', { type: 'button', class: ['chip', i === d.weekday && 'active'], onclick: () => { d.weekday = i; renderWhen(); } }, w))));
    } else {
      const v = `2026-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
      when.append(label('Дата каждый год'), h('input', { type: 'date', class: 'field', value: v, onchange: (e) => { if (e.target.value) { d.month = Number(e.target.value.slice(5, 7)); d.day = Number(e.target.value.slice(8)); } } }));
    }
  }
  const cats = h('div', { class: 'cat-grid' });
  function renderCats() {
    clear(cats);
    store.categoriesFor('expense').forEach((c) => cats.append(h('button', {
      type: 'button', class: ['cat-chip', c.id === d.categoryId && 'active'], style: { '--c': c.color },
      onclick: () => { d.categoryId = c.id; d.icon = c.icon; renderCats(); },
    }, h('span', { class: 'cat-ico' }, c.icon), h('span', { class: 'cat-name' }, c.name))));
  }
  async function save() {
    const amount = parseAmount(d.amountStr);
    if (!d.name.trim()) return toast('Введите название');
    if (!(amount > 0)) return toast('Введите сумму');
    store.upsert('recurring', { ...(item || {}), name: d.name.trim(), amount, currency: d.currency, categoryId: d.categoryId, icon: d.icon,
      freq: d.freq, day: d.day, weekday: d.weekday, month: d.month, start: d.start, active: d.active, paid: item?.paid || {} });
    sh.close();
    toast(item ? 'Сохранено' : 'Платёж добавлен');
  }
  const sh = openSheet({
    title: item ? 'Регулярный платёж' : 'Новый регулярный платёж',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      label('Название'),
      h('input', { class: 'field', placeholder: 'Например, «Аренда квартиры» или «Claude Pro»', maxlength: '60', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      amountRow(d),
      label('Как часто'),
      segmented([['monthly', 'Ежемесячно'], ['weekly', 'Еженедельно'], ['yearly', 'Ежегодно']], d.freq, (v) => { d.freq = v; renderWhen(); }),
      when,
      label('Ярлык'),
      cats,
      label('Действует с'),
      h('input', { type: 'date', class: 'field', value: d.start, onchange: (e) => { d.start = e.target.value || d.start; } }),
      h('label', { class: 'row set-row card' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Активен'), h('span', { class: 'row-sub' }, 'Выключите, чтобы приостановить без удаления')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.active, onchange: (e) => { d.active = e.target.checked; } })),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить платёж'),
      item && deleteButton('Удалить платёж', `Удалить «${item.name}»?`, async () => { await store.removeItem('recurring', item.id); sh.close(); toast('Удалено'); })),
  });
  renderWhen();
  renderCats();
}

// ---------- обязательство ----------
export function openDebtEditor({ item = null } = {}) {
  const base = store.base();
  const d = {
    kind: item?.kind || 'loan', name: item?.name || '', amountStr: item ? String(item.principal).replace('.', ',') : '', currency: item?.currency || base,
    remainingStr: item ? '' : '', paymentStr: item?.payment ? String(item.payment).replace('.', ',') : '', day: item?.day || 0,
    rate: item?.rate || '', start: item?.start || dayKey(), note: item?.note || '',
  };
  const kinds = h('div', { class: 'kind-row' });
  function renderKinds() {
    clear(kinds);
    Object.entries(P.DEBT_KINDS).forEach(([k, v]) => kinds.append(h('button', { type: 'button', class: ['chip', k === d.kind && 'active'], onclick: () => { d.kind = k; renderKinds(); } }, `${v.icon} ${v.label}`)));
  }
  const dayWrap = h('div', { class: 'day-grid' });
  function renderDays() {
    clear(dayWrap);
    dayWrap.append(h('button', { type: 'button', class: ['day-btn', !d.day && 'active'], onclick: () => { d.day = 0; renderDays(); } }, '—'));
    for (let n = 1; n <= 31; n++) dayWrap.append(h('button', { type: 'button', class: ['day-btn', 'mono', n === d.day && 'active'], onclick: () => { d.day = n; renderDays(); } }, n));
  }
  async function save() {
    const principal = parseAmount(d.amountStr);
    if (!d.name.trim()) return toast('Введите название');
    if (!(principal > 0)) return toast('Введите сумму долга');
    const remaining = parseAmount(d.remainingStr);
    const out = {
      ...(item || {}), kind: d.kind, name: d.name.trim(), principal, currency: d.currency,
      payment: parseAmount(d.paymentStr) || 0, day: d.day, rate: parseAmount(String(d.rate)) || 0, start: d.start, note: d.note.trim(),
      payments: item?.payments || [],
    };
    out.initialPaid = !item && remaining >= 0 && remaining < principal ? principal - remaining : item?.initialPaid || 0;
    store.upsert('debts', out);
    sh.close();
    toast(item ? 'Сохранено' : 'Обязательство добавлено');
  }
  const sh = openSheet({
    title: item ? 'Обязательство' : 'Новое обязательство',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      kinds,
      label('Название'),
      h('input', { class: 'field', placeholder: 'Например, «Кредит на машину» или «Долг Саше»', maxlength: '60', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      label('Сумма долга'),
      amountRow(d),
      !item && label('Осталось выплатить (если часть уже погашена)'),
      !item && h('input', { class: 'field mono', inputmode: 'decimal', placeholder: 'Вся сумма', oninput: (e) => { d.remainingStr = e.target.value; } }),
      label('Ежемесячный платёж (необязательно)'),
      h('input', { class: 'field mono', inputmode: 'decimal', placeholder: '0', value: d.paymentStr, oninput: (e) => { d.paymentStr = e.target.value; } }),
      label('День платежа — появится в календаре'),
      dayWrap,
      label('Ставка, % годовых (для справки)'),
      h('input', { class: 'field mono', inputmode: 'decimal', placeholder: '0', value: d.rate ? String(d.rate) : '', oninput: (e) => { d.rate = e.target.value; } }),
      label('Комментарий'),
      h('input', { class: 'field', placeholder: 'Банк, договор, условия', maxlength: '200', value: d.note, oninput: (e) => { d.note = e.target.value; } }),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить'),
      item && deleteButton('Удалить обязательство', `Удалить «${item.name}»? Записанные платежи останутся в операциях.`, async () => { await store.removeItem('debts', item.id); sh.close(); toast('Удалено'); })),
  });
  renderKinds();
  renderDays();
}

export function debtSheet(debt) {
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const d = store.findItem('debts', debt.id);
    if (!d) return;
    const rem = P.debtRemaining(d);
    const prog = P.debtProgress(d);
    const po = P.payoff(d);
    const lent = d.kind === 'lent';
    let amt = d.payment ? String(Math.min(d.payment, rem)).replace('.', ',') : '';
    let record = true;
    body.append(
      h('div', { class: 'debt-hero' },
        h('div', { class: 'micro' }, `${P.DEBT_KINDS[d.kind]?.label || ''} · осталось`),
        h('div', { class: ['debt-rem', 'mono', lent ? 'inc' : ''] }, money(rem, d.currency)),
        h('div', { class: 'bar-track big' }, h('span', { class: 'bar-fill', style: { '--c': lent ? 'var(--mint)' : 'var(--violet)', '--w': `${Math.round(prog * 100)}%` } })),
        h('div', { class: 'debt-meta muted small' },
          h('span', {}, `${Math.round(prog * 100)}% из ${money(d.principal, d.currency)}`),
          po ? h('span', {}, `ещё ${po.n} плат. · до ${po.date ? shortDate(po.date) : '—'}`) : rem === 0 ? h('span', { class: 'inc' }, 'погашено') : null)),
      rem > 0 && h('div', { class: 'card pad editor' },
        h('div', { class: 'micro' }, lent ? 'Мне вернули' : 'Внести платёж'),
        h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', value: amt, placeholder: '0', oninput: (e) => { amt = e.target.value; } }), h('span', { class: 'cur-btn' }, d.currency)),
        h('label', { class: 'row set-row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, lent ? 'Записать как доход' : 'Записать в траты')),
          h('input', { type: 'checkbox', class: 'switch', checked: true, onchange: (e) => { record = e.target.checked; } })),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          const a = parseAmount(amt);
          if (!(a > 0)) return toast('Введите сумму');
          await store.payDebt(d, Math.min(a, rem), dayKey(), record);
          toast(lent ? 'Возврат записан' : 'Платёж записан');
        } }, lent ? 'Записать возврат' : 'Записать платёж')),
      (d.payments || []).length ? h('div', { class: 'micro list-label' }, 'История платежей') : null,
      (d.payments || []).length ? h('div', { class: 'card list' }, [...d.payments].reverse().map((p) => h('div', { class: 'row' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title mono' }, money(p.amount, d.currency)), h('span', { class: 'row-sub' }, dayTitle(p.date))),
        h('button', { class: 'chip small', onclick: async () => { if (await confirmSheet('Удалить платёж?', { detail: p.txnId ? 'Связанная операция тоже удалится.' : '' })) store.removeDebtPayment(d, p.id); } }, 'Удалить')))) : null,
      d.note ? h('p', { class: 'muted small' }, d.note) : null,
      h('button', { class: 'btn btn-plain', onclick: () => openDebtEditor({ item: d }) }, 'Изменить'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: debt.name, content: body, onClose: unsub });
}

// ---------- задача ----------
export function openTaskEditor({ item = null, date = dayKey() } = {}) {
  const d = { title: item?.title || '', date: item?.date || date, time: item?.time || '', repeat: item?.repeat || 'none', note: item?.note || '' };
  const titleInput = h('input', { class: 'field', placeholder: 'Что нужно сделать?', maxlength: '120', value: d.title, enterkeyhint: 'done', oninput: (e) => { d.title = e.target.value; } });
  async function save() {
    if (!d.title.trim()) return toast('Введите задачу');
    store.upsert('tasks', { ...(item || {}), title: d.title.trim(), date: d.date || dayKey(), time: d.time, repeat: d.repeat, note: d.note.trim(), done: item?.done || false, doneDates: item?.doneDates || [] });
    sh.close();
  }
  const repeats = h('div', { class: 'kind-row' });
  const renderRepeats = () => {
    clear(repeats);
    Object.entries(P.REPEATS).forEach(([k, v]) => repeats.append(h('button', { type: 'button', class: ['chip', k === d.repeat && 'active'], onclick: () => { d.repeat = k; renderRepeats(); } }, v)));
  };
  const sh = openSheet({
    title: item ? 'Задача' : 'Новая задача',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      titleInput,
      label('День'),
      futureDate(d),
      label('Время (необязательно)'),
      h('input', { type: 'time', class: 'field mono', value: d.time, onchange: (e) => { d.time = e.target.value; } }),
      label('Повтор — для ежедневной рутины'),
      repeats,
      label('Заметка'),
      h('textarea', { class: 'field area', rows: '3', placeholder: 'Детали, ссылки, шаги', oninput: (e) => { d.note = e.target.value; } }, d.note),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Добавить задачу'),
      item && deleteButton('Удалить задачу', `Удалить «${item.title}»?${item.repeat && item.repeat !== 'none' ? ' Она исчезнет из всех дней.' : ''}`, async () => { await store.removeItem('tasks', item.id); sh.close(); })),
  });
  renderRepeats();
  if (!item) titleInput.focus();
}

// ---------- заметка ----------
export const NOTE_KINDS = {
  note: { label: 'Заметка', icon: '✎' },
  plan: { label: 'План', icon: '◷' },
  idea: { label: 'Идея', icon: '✦' },
  business: { label: 'Бизнес-идея', icon: '◆' },
};

export function openNoteEditor({ item = null, kind = 'note' } = {}) {
  const d = { kind: item?.kind || kind, title: item?.title || '', body: item?.body || '', pinned: !!item?.pinned };
  const area = h('textarea', { class: 'field area note-area', placeholder: 'Пишите свободно. Каждая строка, начатая с «- », станет пунктом списка.', oninput: (e) => { d.body = e.target.value; grow(); } }, d.body);
  const grow = () => { area.style.setProperty('height', 'auto'); area.style.setProperty('height', `${Math.max(160, area.scrollHeight)}px`); };
  async function save() {
    if (!d.title.trim() && !d.body.trim()) { sh.close(); return; }
    store.upsert('notes', { ...(item || {}), kind: d.kind, title: d.title.trim(), body: d.body, pinned: d.pinned });
    sh.close();
  }
  const sh = openSheet({
    title: item ? NOTE_KINDS[d.kind].label : 'Новая запись',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      segmented(Object.entries(NOTE_KINDS).map(([k, v]) => [k, v.label.replace('Бизнес-идея', 'Бизнес')]), d.kind, (v) => { d.kind = v; }),
      h('input', { class: 'field note-title', placeholder: 'Заголовок', maxlength: '120', value: d.title, oninput: (e) => { d.title = e.target.value; } }),
      area,
      h('label', { class: 'row set-row card' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Закрепить сверху')),
        h('input', { type: 'checkbox', class: 'switch', checked: d.pinned, onchange: (e) => { d.pinned = e.target.checked; } })),
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, 'Сохранить'),
      item && deleteButton('Удалить', 'Удалить запись?', async () => { await store.removeItem('notes', item.id); sh.close(); })),
  });
  requestAnimationFrame(grow);
  if (!item) sh.panel.querySelector('.note-title')?.focus();
}

// ---------- цель ----------
const GOAL_ICONS = ['🎯', '🏠', '🚗', '✈️', '💻', '📱', '🎓', '💍', '🏖️', '🛡️', '💰', '📈'];

export function openGoalEditor({ item = null } = {}) {
  const d = { name: item?.name || '', icon: item?.icon || '🎯', amountStr: item ? String(item.target).replace('.', ',') : '', currency: item?.currency || store.base(), deadline: item?.deadline || '' };
  const icons = h('div', { class: 'emoji-grid' });
  const renderIcons = () => { clear(icons); GOAL_ICONS.forEach((e) => icons.append(h('button', { type: 'button', class: ['emoji-btn', e === d.icon && 'active'], onclick: () => { d.icon = e; renderIcons(); } }, e))); };
  async function save() {
    const target = parseAmount(d.amountStr);
    if (!d.name.trim()) return toast('Введите название');
    if (!(target > 0)) return toast('Введите сумму цели');
    store.upsert('goals', { ...(item || {}), name: d.name.trim(), icon: d.icon, target, currency: d.currency, deadline: d.deadline, contributions: item?.contributions || [] });
    sh.close();
  }
  const sh = openSheet({
    title: item ? 'Цель' : 'Новая цель',
    right: h('button', { class: 'link strong', onclick: save }, 'Готово'),
    content: h('div', { class: 'editor' },
      label('На что копим'),
      h('input', { class: 'field', placeholder: 'Например, «Подушка безопасности» или «MacBook»', maxlength: '60', value: d.name, oninput: (e) => { d.name = e.target.value; } }),
      label('Сумма цели'),
      amountRow(d),
      label('Срок (необязательно)'),
      h('input', { type: 'date', class: 'field', value: d.deadline, onchange: (e) => { d.deadline = e.target.value; } }),
      label('Иконка'),
      icons,
      h('button', { class: 'btn btn-primary save-btn', onclick: save }, item ? 'Сохранить' : 'Создать цель'),
      item && deleteButton('Удалить цель', `Удалить цель «${item.name}»?`, async () => { await store.removeItem('goals', item.id); sh.close(); })),
  });
  renderIcons();
}

export function goalSheet(goal) {
  const body = h('div', { class: 'editor' });
  const render = () => {
    clear(body);
    const g = store.findItem('goals', goal.id);
    if (!g) return;
    const s = P.goalStats(g);
    let amt = '';
    body.append(
      h('div', { class: 'goal-hero' }, goalRing(g, 132),
        h('div', {},
          h('div', { class: 'micro' }, 'Накоплено'),
          h('div', { class: 'debt-rem mono' }, money(s.saved, g.currency)),
          h('div', { class: 'muted small' }, `из ${money(g.target, g.currency)}`),
          s.perMonth ? h('div', { class: 'goal-pace' }, `нужно ${money(s.perMonth, g.currency)} в месяц`) : null,
          s.left === 0 ? h('div', { class: 'goal-pace inc' }, 'Цель достигнута 🎉') : null)),
      h('div', { class: 'card pad editor' },
        h('div', { class: 'micro' }, 'Пополнить или снять'),
        h('div', { class: 'amount-wrap' }, h('input', { class: 'amount-input mono small-amount', inputmode: 'decimal', placeholder: '0', oninput: (e) => { amt = e.target.value; } }), h('span', { class: 'cur-btn' }, g.currency)),
        h('div', { class: 'dock-actions two' },
          h('button', { class: 'act act-inc', onclick: async () => { const a = parseAmount(amt); if (!(a > 0)) return toast('Введите сумму'); await store.contributeGoal(g, a); toast('Отложено'); } }, h('span', { class: 'act-sign' }, '+'), 'Отложить'),
          h('button', { class: 'act act-exp', onclick: async () => { const a = parseAmount(amt); if (!(a > 0)) return toast('Введите сумму'); await store.contributeGoal(g, -a); toast('Снято'); } }, h('span', { class: 'act-sign' }, '−'), 'Снять'))),
      h('p', { class: 'muted small' }, 'Пополнения цели — это ваши отложенные деньги. Они не считаются тратой и не влияют на баланс месяца.'),
      h('button', { class: 'btn btn-plain', onclick: () => openGoalEditor({ item: g }) }, 'Изменить цель'));
  };
  render();
  const unsub = store.subscribe(render);
  openSheet({ title: goal.name, content: body, onClose: unsub });
}

/** Кольцо прогресса цели. */
export function goalRing(g, size = 64) {
  const s = P.goalStats(g);
  const NS = 'http://www.w3.org/2000/svg';
  const r = size / 2 - 6;
  const C = 2 * Math.PI * r;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('class', 'goal-ring');
  const mk = (cls, extra = {}) => {
    const c = document.createElementNS(NS, 'circle');
    Object.entries({ cx: size / 2, cy: size / 2, r, class: cls, ...extra }).forEach(([k, v]) => c.setAttribute(k, v));
    svg.append(c);
  };
  mk('ring-bg');
  mk('ring-fg', { 'stroke-dasharray': `${C * s.progress} ${C}`, transform: `rotate(-90 ${size / 2} ${size / 2})` });
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('x', size / 2); t.setAttribute('y', size / 2 + size * 0.06);
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('class', 'ring-text');
  t.setAttribute('font-size', size * 0.2);
  t.textContent = g.icon || '🎯';
  svg.append(t);
  return svg;
}
