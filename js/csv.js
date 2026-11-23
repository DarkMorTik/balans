// Импорт банковских выписок (CSV): разбор, определение колонок, даты и суммы.

/** CSV → массив строк (массивов ячеек). Разделитель определяется автоматически. */
export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [';', ',', '\t', '|'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/** «1 234,56», «1,234.56», «-12.5», «(45.00)», «12,50 ₽» → число или NaN. */
export function parseNum(str) {
  if (str == null) return NaN;
  let s = String(str).trim();
  if (!s) return NaN;
  let neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s) || /[-−]$/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0 && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

const pad = (n) => String(n).padStart(2, '0');

/** Дата в YYYY-MM-DD. order — для двусмысленных 01/02/2026: 'dmy' (по умолчанию) или 'mdy'. */
export function parseDate(str, order = 'dmy') {
  const s = String(str || '').trim();
  let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += 2000;
    let d = a, mo = b;
    if (order === 'mdy' || (a <= 12 && b > 12)) { d = b; mo = a; }
    return valid(y, mo, d);
  }
  return null;
}
function valid(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * Угадать роли колонок по заголовкам и содержимому.
 * → { header: boolean, date, amount, debit, credit, desc, currency } (индексы или -1)
 */
export function detectColumns(rows) {
  const head = (rows[0] || []).map((c) => c.toLowerCase());
  const sample = rows.slice(1, 30);
  const find = (re) => head.findIndex((c) => re.test(c));
  let date = find(/дата|date|время|day/);
  let amount = find(/сумма|amount|sum\b|итог|value|total/);
  const debit = find(/расход|списан|debit|withdraw|outflow|снят/);
  const credit = find(/приход|зачисл|поступ|credit|deposit|inflow/);
  let desc = find(/описан|назначен|description|details|merchant|получател|контраг|payee|memo|комментар|narrative|опис/);
  let currency = find(/валют|currency|curr\b/);
  const header = date >= 0 || amount >= 0 || desc >= 0 || debit >= 0;
  const data = header ? sample : rows.slice(0, 30);
  const cols = Math.max(...rows.map((r) => r.length));
  const score = (i, fn) => data.filter((r) => fn(r[i])).length;
  if (date < 0) for (let i = 0; i < cols; i++) if (score(i, (v) => parseDate(v)) > data.length * 0.6) { date = i; break; }
  if (amount < 0 && debit < 0) {
    for (let i = cols - 1; i >= 0; i--) if (i !== date && score(i, (v) => /\d/.test(v || '') && !Number.isNaN(parseNum(v)) && !parseDate(v)) > data.length * 0.6) { amount = i; break; }
  }
  if (currency < 0) {
    for (let i = 0; i < cols; i++) if (i !== date && i !== amount && score(i, (v) => /^[A-Z]{3,5}$/.test((v || '').trim())) > data.length * 0.6) { currency = i; break; }
  }
  if (desc < 0) {
    let best = -1, bestLen = 0;
    for (let i = 0; i < cols; i++) {
      if (i === date || i === amount || i === debit || i === credit || i === currency) continue;
      const len = data.reduce((a, r) => a + (Number.isNaN(parseNum(r[i])) ? (r[i] || '').length : 0), 0);
      if (len > bestLen) { bestLen = len; best = i; }
    }
    desc = best;
  }
  return { header, date, amount, debit, credit, desc, currency };
}

/**
 * Превратить строки в черновики операций.
 * → [{ date, amount (>0), type, note, currency|null }]
 */
export function rowsToDrafts(rows, cols, { order = 'dmy' } = {}) {
  const body = cols.header ? rows.slice(1) : rows;
  const out = [];
  for (const r of body) {
    const date = parseDate(r[cols.date], order);
    if (!date) continue;
    let v;
    if (cols.debit >= 0 || cols.credit >= 0) {
      const d = Math.abs(parseNum(r[cols.debit]) || 0), c = Math.abs(parseNum(r[cols.credit]) || 0);
      v = c - d;
    } else v = parseNum(r[cols.amount]);
    if (!v || Number.isNaN(v)) continue;
    const cur = cols.currency >= 0 ? String(r[cols.currency] || '').toUpperCase().replace(/[^A-Z]/g, '') : '';
    out.push({ date, amount: Math.abs(Math.round(v * 100) / 100), type: v < 0 ? 'expense' : 'income', note: (r[cols.desc] || '').slice(0, 200), currency: cur.length >= 3 && cur.length <= 5 ? cur : null });
  }
  return out;
}
