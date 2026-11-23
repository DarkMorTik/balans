// Тема оформления: 'auto' (как в системе), 'light' или 'dark'.
// Выбор дублируется в localStorage (не секрет), чтобы экран блокировки сразу был в нужной теме.
const KEY = 'balans-theme';

export function applyTheme(theme = 'auto') {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* приватный режим */ }
  const dark = theme === 'dark' || (theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', dark ? '#121117' : '#f4f3f8');
    m.removeAttribute('media');
  });
}

export function initTheme() {
  let t = 'auto';
  try { t = localStorage.getItem(KEY) || 'auto'; } catch { /* нет доступа */ }
  applyTheme(t);
}
