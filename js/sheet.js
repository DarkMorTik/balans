// Модальные «листы» снизу (на широком экране — диалог по центру), подтверждения и уведомления.
import { h } from './util.js';

const stack = [];

function syncViewport() {
  const vv = window.visualViewport;
  const root = document.documentElement;
  if (!vv) return;
  root.style.setProperty('--vvh', `${vv.height}px`);
  root.style.setProperty('--vvtop', `${vv.offsetTop}px`);
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', syncViewport);
  visualViewport.addEventListener('scroll', syncViewport);
  window.addEventListener('orientationchange', () => setTimeout(syncViewport, 300));
  syncViewport();
}

// Пока открыта клавиатура, нижняя панель скрыта. После её закрытия iOS иногда не возвращает
// высоту окна — подталкиваем перерасчёт и заново берём размеры видимой области.
const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !['checkbox', 'radio', 'file', 'button'].includes(el.type);
document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('kb'); });
document.addEventListener('focusout', (e) => {
  if (!isField(e.target)) return;
  setTimeout(() => {
    if (isField(document.activeElement)) return;
    document.body.classList.remove('kb');
    window.scrollTo(window.scrollX, window.scrollY);
    syncViewport();
  }, 120);
});

/**
 * Открыть лист.
 * @param {{title?: string, content: Node, left?: Node, right?: Node, onClose?: Function, className?: string}} o
 */
export function openSheet(o) {
  const panel = h('div', { class: ['sheet', o.className], role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || '' },
    h('div', { class: 'sheet-grip' }),
    (o.title || o.left || o.right) && h('div', { class: 'sheet-head' },
      h('div', { class: 'sheet-side' }, o.left || h('button', { class: 'link', onclick: () => close() }, 'Закрыть')),
      h('div', { class: 'sheet-title' }, o.title || ''),
      h('div', { class: 'sheet-side right' }, o.right || '')),
    h('div', { class: 'sheet-body' }, o.content));
  const overlay = h('div', { class: 'overlay' }, panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // свайп вниз за «ручку» — закрыть
  let startY = null;
  panel.addEventListener('touchstart', (e) => {
    const inBody = e.target.closest('.sheet-body');
    if (inBody && inBody.scrollTop > 0) return;
    if (e.target.closest('input, textarea, select')) return;
    startY = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.setProperty('transform', `translateY(${dy}px)`);
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (startY == null) return;
    const dy = e.changedTouches[0].clientY - startY;
    startY = null;
    if (dy > 110) close();
    else panel.style.removeProperty('transform');
  });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.activeElement?.blur?.();
    overlay.classList.remove('open');
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    setTimeout(() => overlay.remove(), 260);
    if (!stack.length) document.body.classList.remove('modal-open');
    o.onClose?.();
  }
  const api = { close, panel, overlay };
  stack.push(api);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  syncViewport();
  requestAnimationFrame(() => overlay.classList.add('open'));
  return api;
}

export function closeAllSheets() {
  [...stack].forEach((x) => x.close());
}

export function confirmSheet(text, { ok = 'Удалить', danger = true, detail = '' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const sh = openSheet({
      className: 'sheet-compact',
      content: h('div', { class: 'confirm' },
        h('div', { class: 'confirm-text' }, text),
        detail && h('div', { class: 'confirm-detail' }, detail),
        h('button', { class: ['btn', danger ? 'btn-danger' : 'btn-primary'], onclick: () => { result = true; sh.close(); } }, ok),
        h('button', { class: 'btn btn-plain', onclick: () => sh.close() }, 'Отмена')),
      onClose: () => resolve(result),
    });
  });
}

let toastEl = null, toastTimer = null;
/** Уведомление. action — необязательная кнопка, например { label: 'Отменить', run }. */
export function toast(msg, action = null) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status' });
    document.body.append(toastEl);
  }
  while (toastEl.firstChild) toastEl.removeChild(toastEl.firstChild);
  toastEl.append(document.createTextNode(msg));
  toastEl.classList.toggle('has-action', !!action);
  if (action) {
    toastEl.append(h('button', { class: 'toast-act', onclick: () => { toastEl.classList.remove('show'); action.run(); } }, action.label));
  }
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), action ? 4500 : 2200);
}
