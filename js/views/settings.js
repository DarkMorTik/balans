// Настройки: валюты, ярлыки, безопасность, резервные копии.
import { h, clear, parseAmount, currencySymbol, dayKey, money, isCrypto } from '../util.js';
import * as store from '../store.js';
import * as vault from '../vault.js';
import { encryptBackup, decryptBackup, keyFromPassword, unwrapKey, unb64 } from '../crypto.js';
import { openSheet, confirmSheet, toast } from '../sheet.js';
import { openCategoryEditor, pickCurrency } from './editor.js';
import { pinPad } from './lock.js';

const group = (title, ...rows) => h('section', { class: 'set-group' }, title && h('div', { class: 'set-title micro' }, title), h('div', { class: 'card list' }, ...rows));
const row = (label, value, onclick, extra = {}) => h(onclick ? 'button' : 'div', { class: ['row', 'set-row', extra.danger && 'danger'], onclick },
  extra.icon && h('span', { class: 'cat-ico', style: { '--c': extra.color || '#8e8e93' } }, extra.icon),
  h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label), extra.sub && h('span', { class: 'row-sub' }, extra.sub)),
  value != null && h('span', { class: 'row-value' }, value),
  onclick && !extra.noChevron && h('span', { class: 'chevron' }, '›'));

export async function renderSettings(root, { lockNow }) {
  clear(root);
  const st = store.state();
  const s = st.settings;
  const meta = await vault.getMeta();

  root.append(h('button', { class: 'back-btn', onclick: () => window.dispatchEvent(new CustomEvent('nav', { detail: 'home' })) }, '‹ Главная'));
  root.append(h('h1', { class: 'page-title' }, 'Настройки'));

  // --- валюты и курсы ---
  const rateLabel = (c) => {
    const r = store.rate(c);
    if (!(r > 0)) return 'нет курса';
    const tag = s.manualRates?.[c] ? ' · вручную' : store.marketRate(c) > 0 ? '' : ' · из операций';
    return money(r, s.base) + tag;
  };
  const liveToggle = h('input', {
    type: 'checkbox', class: 'switch', checked: !!s.livePrices, 'aria-label': 'Онлайн-курсы',
    onchange: async (e) => {
      await store.setSetting('livePrices', e.target.checked);
      if (e.target.checked) store.refreshMarket(true).then(() => toast('Курсы обновлены')).catch(() => toast('Нет связи с сервисом курсов'));
    },
  });
  root.append(group('Валюты и курсы',
    row('Основная валюта', `${currencySymbol(s.base)} ${s.base}`, () => changeBaseSheet()),
    ...s.currencies.filter((c) => c !== s.base).map((c) => row(c, rateLabel(c), () => rateSheet(c), { sub: isCrypto(c) ? 'криптовалюта' : null })),
    row('Добавить валюту или монету', null, () => pickCurrency({ current: null, title: 'Добавить', onPick: () => toast('Добавлено') }), { icon: '+', color: '#7fe0c2' }),
    h('label', { class: 'row set-row' },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Онлайн-курсы'),
        h('span', { class: 'row-sub wrap' }, 'Фиат и топ-100 криптовалют. В запросе только коды валют.')),
      liveToggle)));

  // --- ярлыки ---
  const typeLabel = { expense: 'расход', income: 'доход', both: 'расход и доход' };
  root.append(group('Ярлыки',
    ...st.categories.map((c) => row(c.name, store.usageCount(c.id) || null, () => openCategoryEditor({ cat: c }), {
      icon: c.icon, color: c.color, sub: typeLabel[c.type] + (c.limit ? ` · лимит ${c.limit} ${s.base}` : ''),
    })),
    row('Новый ярлык', null, () => openCategoryEditor({}), { icon: '+', color: '#0a84ff' })));

  // --- безопасность ---
  const lockOpts = [[0, 'Сразу'], [60, '1 мин'], [300, '5 мин']];
  const lockSeg = h('div', { class: 'seg small' }, lockOpts.map(([v, l]) =>
    h('button', { class: s.lockAfter === v ? 'on' : '', onclick: () => store.setSetting('lockAfter', v) }, l)));
  const bioToggle = h('input', {
    type: 'checkbox', class: 'switch', checked: !!meta?.bio, 'aria-label': 'Face ID',
    onchange: async (e) => {
      const want = e.target.checked;
      try {
        if (want) { await vault.enableBiometrics(); toast('Face ID включён'); }
        else { await vault.disableBiometrics(); toast('Face ID выключен'); }
      } catch (err) {
        e.target.checked = !want;
        toast(err?.message === 'prf-unsupported' ? 'Не поддерживается на этом устройстве (нужна iOS 18+)' : 'Не удалось включить Face ID');
      }
    },
  });
  root.append(group('Безопасность',
    vault.biometricsAvailable() && h('label', { class: 'row set-row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Вход по Face ID / Touch ID')), bioToggle),
    row('Сменить PIN', null, () => changePinSheet()),
    h('div', { class: 'row set-row' }, h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Блокировка в фоне')), lockSeg),
    row('Заблокировать сейчас', null, lockNow, { noChevron: true })));

  // --- данные ---
  root.append(group('Резервная копия',
    row('Экспорт (зашифрованный файл)', null, () => exportSheet(), { sub: 'Для переноса на iPad/Mac или хранения' }),
    row('Импорт из файла', null, () => importBackup())));

  root.append(group('',
    row('Удалить все данные', null, async () => {
      const ok = await confirmSheet('Удалить все данные?', { detail: 'Операции, ярлыки и PIN будут стёрты с этого устройства без возможности восстановления. Сделайте резервную копию заранее.', ok: 'Удалить всё' });
      if (ok) { await vault.wipe(); location.reload(); }
    }, { danger: true, noChevron: true })));

  root.append(h('div', { class: 'about' },
    h('p', {}, h('b', {}, 'Баланс'), ' · версия 2.0'),
    h('p', {}, `Данные хранятся только на этом устройстве и зашифрованы AES-256-GCM. Ключ выводится из PIN (PBKDF2, 600 000 итераций) или из passkey Face ID. Единственный сетевой запрос — загрузка курсов (только коды валют, можно выключить). Нет аналитики, рекламы и сторонних библиотек. Операций: ${st.txns.length}.`)));
}

// ---------- листы ----------
function changeBaseSheet() {
  const s = store.settings();
  const sh = openSheet({
    title: 'Основная валюта', className: 'sheet-compact',
    content: h('div', {},
      h('p', { class: 'muted small' }, 'Итоги и аналитика будут пересчитаны по указанным курсам. Доступны валюты, для которых задан курс.'),
      h('div', { class: 'cur-grid' }, s.currencies.map((c) => h('button', {
        class: ['chip', c === s.base && 'active'], disabled: c !== s.base && (isCrypto(c) || !(store.rate(c) > 0)),
        onclick: async () => {
          if (c === s.base) return sh.close();
          if (!(await confirmSheet(`Сделать ${c} основной валютой?`, { ok: 'Пересчитать', danger: false }))) return;
          try { await store.changeBase(c); toast(`Основная валюта: ${c}`); sh.close(); } catch (e) { toast(e.message); }
        },
      }, c)))),
  });
}

function rateSheet(code) {
  const s = store.settings();
  const market = store.marketRate(code);
  let val = s.manualRates?.[code] || 0;
  const sh = openSheet({
    title: code, className: 'sheet-compact',
    content: h('div', { class: 'editor' },
      h('p', { class: 'muted small' }, market > 0 ? `Рыночный курс: 1 ${code} = ${money(market, s.base)}. Он подставляется автоматически.` : 'Рыночного курса нет — укажите свой.'),
      h('div', { class: 'section-label micro' }, `Свой курс, ${s.base} за 1 ${code}`),
      h('input', { class: 'field mono', inputmode: 'decimal', value: val ? String(val).replace('.', ',') : '', placeholder: market > 0 ? 'авто' : '0', oninput: (e) => { val = parseAmount(e.target.value) || 0; } }),
      h('button', { class: 'btn btn-primary', onclick: async () => { await store.setManualRate(code, val); sh.close(); } }, val || !market ? 'Сохранить курс' : 'Сохранить'),
      s.manualRates?.[code] && h('button', { class: 'btn btn-plain', onclick: async () => { await store.setManualRate(code, 0); sh.close(); toast('Снова по рынку'); } }, 'Вернуть рыночный курс'),
      h('button', { class: 'btn btn-plain danger', onclick: async () => { await store.removeCurrency(code); sh.close(); } }, 'Убрать из списка')),
  });
}

function changePinSheet() {
  let step = 0, first = null;
  const box = h('div');
  const sh = openSheet({ title: 'Смена PIN', content: box, onClose: () => pad.destroy() });
  const pad = pinPad({
    title: 'Текущий PIN',
    onComplete: async (pin, p) => {
      if (step === 0) {
        p.setBusy(true);
        const ok = await verifyPin(pin);
        p.setBusy(false);
        if (!ok) return p.reset('Неверный PIN');
        step = 1; p.setTitle('Новый PIN'); return p.reset('6 цифр', false);
      }
      if (step === 1) {
        if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin)) return p.reset('Слишком простой PIN');
        first = pin; step = 2; p.setTitle('Повторите новый PIN'); return p.reset('', false);
      }
      if (pin !== first) { step = 1; p.setTitle('Новый PIN'); return p.reset('Не совпало, попробуйте снова'); }
      p.setBusy(true);
      await vault.changePin(pin);
      sh.close();
      toast('PIN изменён');
    },
  });
  box.append(pad.el);
}

async function verifyPin(pin) {
  const meta = await vault.getMeta();
  try {
    await unwrapKey(meta.pin.wrapped, await keyFromPassword(pin, unb64(meta.pin.salt), meta.pin.iter));
    return true;
  } catch {
    return false;
  }
}

function passwordSheet({ title, hint, confirm, button }) {
  return new Promise((resolve) => {
    let pw = '', pw2 = '', result = null;
    const sh = openSheet({
      title, className: 'sheet-compact', onClose: () => resolve(result),
      content: h('div', { class: 'editor' },
        h('p', { class: 'muted small' }, hint),
        h('input', { class: 'field', type: 'password', placeholder: 'Пароль', autocomplete: 'new-password', oninput: (e) => { pw = e.target.value; } }),
        confirm && h('input', { class: 'field', type: 'password', placeholder: 'Повторите пароль', autocomplete: 'new-password', oninput: (e) => { pw2 = e.target.value; } }),
        h('button', { class: 'btn btn-primary', onclick: () => {
          if (confirm && pw.length < 8) return toast('Минимум 8 символов');
          if (confirm && pw !== pw2) return toast('Пароли не совпадают');
          if (!pw) return toast('Введите пароль');
          result = pw; sh.close();
        } }, button)),
    });
  });
}

async function exportSheet() {
  const pw = await passwordSheet({
    title: 'Экспорт', confirm: true, button: 'Создать файл',
    hint: 'Файл будет зашифрован этим паролем. Без него файл не открыть — запомните или сохраните его в менеджере паролей.',
  });
  if (!pw) return;
  toast('Шифрование…');
  const backup = await encryptBackup(store.state(), pw);
  const name = `balans-${dayKey()}.balans`;
  const file = new File([JSON.stringify(backup)], name, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Резервная копия Баланса' }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function importBackup() {
  const input = h('input', { type: 'file', accept: '.balans,.json,application/json,application/octet-stream' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    let parsed;
    try { parsed = JSON.parse(await f.text()); } catch { return toast('Не удалось прочитать файл'); }
    const pw = await passwordSheet({ title: 'Импорт', button: 'Открыть', hint: 'Введите пароль, которым был зашифрован файл.' });
    if (!pw) return;
    try {
      const data = store.validateState(await decryptBackup(parsed, pw));
      const ok = await confirmSheet('Заменить текущие данные?', { detail: `В файле ${data.txns.length} операций. Текущие данные на этом устройстве будут заменены.`, ok: 'Заменить' });
      if (!ok) return;
      await store.replaceAll(data);
      toast('Данные восстановлены');
    } catch (e) {
      toast(e.message || 'Ошибка импорта');
    }
  });
  input.click();
}
