// Экран блокировки и первый запуск (создание PIN, выбор валюты, Face ID).
import { h, clear, haptic, dayKey } from '../util.js';
import { guilloche } from '../guilloche.js';
import * as vault from '../vault.js';
import { initialState, CURRENCIES } from '../store.js';

const PIN_LEN = 6;

export function pinPad({ title, subtitle, onComplete, bioButton }) {
  let value = '';
  let busy = false;
  const dots = h('div', { class: 'pin-dots' }, Array.from({ length: PIN_LEN }, () => h('span')));
  const sub = h('div', { class: 'pin-sub' }, subtitle || '');
  const update = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i < value.length));

  async function press(d) {
    if (busy || value.length >= PIN_LEN) return;
    haptic();
    value += d;
    update();
    if (value.length === PIN_LEN) {
      busy = true;
      const v = value;
      try {
        await onComplete(v, api);
      } finally {
        busy = false;
      }
    }
  }
  function back() {
    if (busy) return;
    value = value.slice(0, -1);
    update();
  }
  const key = (d, sm) => h('button', { class: 'pin-key', type: 'button', onclick: () => press(d), 'aria-label': d }, d, sm ? h('small', {}, sm) : null);
  const pad = h('div', { class: 'pin-pad' },
    key('1', ' '), key('2', 'abc'), key('3', 'def'),
    key('4', 'ghi'), key('5', 'jkl'), key('6', 'mno'),
    key('7', 'pqrs'), key('8', 'tuv'), key('9', 'wxyz'),
    bioButton || h('span'),
    key('0'),
    h('button', { class: 'pin-key pin-fn', type: 'button', onclick: back, 'aria-label': 'Стереть' }, '⌫'));

  const onKey = (e) => {
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') back();
  };
  window.addEventListener('keydown', onKey);

  const titleEl = h('div', { class: 'pin-title' }, title);
  const el = h('div', { class: 'pin' }, titleEl, sub, dots, pad);
  const api = {
    el,
    reset(msg, shake = true) {
      value = '';
      update();
      if (msg != null) sub.textContent = msg;
      if (shake) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
    },
    setTitle(t) { titleEl.textContent = t; },
    setSub(t) { sub.textContent = t; },
    setBusy(b) { el.classList.toggle('busy', b); },
    destroy() { window.removeEventListener('keydown', onKey); },
  };
  return api;
}

// ---------- Экран блокировки ----------
export async function renderLock(root, onUnlocked) {
  clear(root);
  const meta = await vault.getMeta();
  let pad;

  let bioBusy = false;
  let done = false;
  const tryBio = async (auto = false) => {
    if (bioBusy || done) return;
    bioBusy = true;
    try {
      await vault.unlockWithBiometrics();
      done = true;
      pad.destroy();
      onUnlocked();
    } catch (e) {
      // авто-запуск без касания iOS может отклонить — тогда ждём нажатия на кнопку
      if (!auto && e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') pad.setSub('Face ID недоступен — введите PIN');
    } finally {
      bioBusy = false;
    }
  };
  // Face ID запускается сам, как только приложение на экране
  if (meta?.bio) {
    const auto = () => setTimeout(() => tryBio(true), 250);
    if (document.visibilityState === 'visible') auto();
    else document.addEventListener('visibilitychange', function once() {
      if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', once); auto(); }
    });
  }

  const bio = meta?.bio
    ? h('button', { class: 'pin-key pin-fn bio', type: 'button', onclick: () => tryBio(false), 'aria-label': 'Войти по Face ID' }, faceIdIcon())
    : null;

  pad = pinPad({
    title: 'Баланс',
    subtitle: meta?.bio ? 'Введите PIN или используйте Face ID' : 'Введите PIN',
    bioButton: bio,
    onComplete: async (pin, p) => {
      const m = await vault.getMeta();
      const wait = vault.lockoutSeconds(m);
      if (wait > 0) return p.reset(`Слишком много попыток. Подождите ${wait} с`);
      p.setBusy(true);
      try {
        await vault.unlockWithPin(pin);
        p.destroy();
        onUnlocked();
      } catch {
        const m2 = await vault.getMeta();
        const left = Math.max(0, 5 - (m2.fails || 0));
        p.reset(left > 0 ? `Неверный PIN. Осталось попыток до паузы: ${left}` : `Неверный PIN. Пауза ${vault.lockoutSeconds(m2)} с`);
      } finally {
        p.setBusy(false);
      }
    },
  });

  root.append(h('div', { class: 'lock-screen' },
    h('div', { class: 'lock-seal' }, guilloche({ w: 300, h: 300, seed: dayKey().slice(0, 7), rosette: 'center', waves: false, density: 0.8 })),
    pad.el,
    meta?.bio && h('button', { class: 'btn btn-plain bio-link', onclick: () => tryBio(false) }, 'Войти с Face ID')));
}

// ---------- Первый запуск ----------
export function renderOnboarding(root, onDone) {
  let base = guessCurrency();

  const step1 = () => {
    clear(root);
    root.append(h('div', { class: 'onb' },
      h('div', { class: 'lock-seal onb-seal' }, guilloche({ w: 300, h: 300, seed: 'balans', rosette: 'center', waves: false, density: 0.8 })),
      h('h1', {}, 'Баланс'),
      h('p', { class: 'muted' }, 'Простой учёт доходов и расходов'),
      h('ul', { class: 'onb-list' },
        h('li', {}, h('b', {}, '🔒 Только на устройстве. '), 'Данные не покидают ваш телефон, серверов нет.'),
        h('li', {}, h('b', {}, '🛡 Шифрование AES-256. '), 'Без PIN или Face ID данные не прочитать.'),
        h('li', {}, h('b', {}, '📊 Умная аналитика. '), 'Тенденции, прогноз и поиск лишних трат.')),
      h('button', { class: 'btn btn-primary', onclick: step2 }, 'Начать')));
  };

  const step2 = () => {
    clear(root);
    const grid = h('div', { class: 'cur-grid' }, CURRENCIES.map((c) =>
      h('button', { class: ['chip', c === base && 'active'], onclick: (e) => {
        base = c;
        grid.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
        e.currentTarget.classList.add('active');
      } }, c)));
    root.append(h('div', { class: 'onb' },
      h('h2', {}, 'Основная валюта'),
      h('p', { class: 'muted' }, 'В ней будут итоги и аналитика. Операции можно вносить в любой валюте.'),
      grid,
      h('button', { class: 'btn btn-primary', onclick: step3 }, 'Далее')));
  };

  const step3 = () => {
    clear(root);
    let first = null;
    const pad = pinPad({
      title: 'Придумайте PIN',
      subtitle: '6 цифр. Им шифруются ваши данные.',
      onComplete: async (pin, p) => {
        if (!first) {
          if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) {
            return p.reset('Слишком простой PIN — выберите другой');
          }
          first = pin;
          p.setTitle('Повторите PIN');
          p.reset('', false);
          return;
        }
        if (pin !== first) {
          first = null;
          p.setTitle('Придумайте PIN');
          return p.reset('PIN не совпал, попробуйте снова');
        }
        p.setBusy(true);
        p.setSub('Создаём зашифрованное хранилище…');
        await vault.setup(pin, initialState(base));
        p.destroy();
        step4();
      },
    });
    root.append(h('div', { class: 'lock-screen' }, pad.el));
  };

  const step4 = () => {
    if (!vault.biometricsAvailable()) return onDone();
    clear(root);
    const status = h('p', { class: 'muted small' });
    root.append(h('div', { class: 'onb' },
      h('div', { class: 'lock-logo big' }, faceIdIcon()),
      h('h2', {}, 'Вход по Face ID'),
      h('p', { class: 'muted' }, 'Быстрый вход без ввода PIN. Создаётся ключ доступа (passkey), он хранится в защищённом чипе устройства.'),
      status,
      h('button', { class: 'btn btn-primary', onclick: async () => {
        try {
          await vault.enableBiometrics();
          onDone();
        } catch (e) {
          status.textContent = e?.message === 'prf-unsupported'
            ? 'На этом устройстве Face ID для веб-приложений не поддерживается (нужна iOS 18+). Можно включить позже в настройках.'
            : 'Не удалось включить. Можно сделать это позже в настройках.';
        }
      } }, 'Включить Face ID'),
      h('button', { class: 'btn btn-plain', onclick: onDone }, 'Позже')));
  };

  step1();
}

function guessCurrency() {
  const lang = (navigator.language || '').toLowerCase();
  if (lang.includes('uk') || lang.endsWith('-ua')) return 'UAH';
  if (lang.endsWith('-kz') || lang.startsWith('kk')) return 'KZT';
  if (lang.endsWith('-by') || lang.startsWith('be')) return 'BYN';
  if (lang.startsWith('ru')) return 'RUB';
  if (lang.startsWith('en-us')) return 'USD';
  return 'EUR';
}

function logo() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'logo-svg');
  [[6, 22, 'logo-exp'], [19, 10, 'logo-mid'], [32, 28, 'logo-inc']].forEach(([x, y, cls]) => {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 10); r.setAttribute('height', 42 - y);
    r.setAttribute('rx', 3); r.setAttribute('class', cls);
    svg.append(r);
  });
  return svg;
}

function faceIdIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('class', 'faceid');
  const d = 'M4 10V7a3 3 0 0 1 3-3h3M22 4h3a3 3 0 0 1 3 3v3M28 22v3a3 3 0 0 1-3 3h-3M10 28H7a3 3 0 0 1-3-3v-3M11 12v2M21 12v2M16 12v6h-1.5M12 22c2.2 1.8 5.8 1.8 8 0';
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  svg.append(p);
  return svg;
}
