// Экспорт платежей в календарь (iCalendar .ics) с напоминаниями. Работает без серверов:
// файл открывается в Календаре iPhone, и напоминания дальше делает сама iOS.

const WD = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ymd = (key) => key.replace(/-/g, '');

function fold(line) {
  // строки длиннее 75 байт переносятся (RFC 5545)
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > (out.length ? 74 : 75)) { out.push(cur); cur = ''; }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

function nextDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

/** RRULE для регулярного платежа. */
export function rruleFor(r) {
  if (r.freq === 'weekly') return `FREQ=WEEKLY;BYDAY=${WD[r.weekday ?? 0]}`;
  if (r.freq === 'yearly') return `FREQ=YEARLY;BYMONTH=${r.month || 1};BYMONTHDAY=${r.day || 1}`;
  const d = r.day || 1;
  // 29–31: в коротких месяцах — последний день месяца
  if (d >= 29) return `FREQ=MONTHLY;BYMONTHDAY=${Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`;
  return `FREQ=MONTHLY;BYMONTHDAY=${d}`;
}

/**
 * events: [{ uid, title, description, start: 'YYYY-MM-DD', rrule?: string, alarms?: ['-PT15H','PT9H'] }]
 */
export function buildICS(events, stamp = new Date()) {
  const dt = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Balans//Payments//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Баланс · платежи'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT',
      `UID:${e.uid}@balans`,
      `DTSTAMP:${dt}`,
      `DTSTART;VALUE=DATE:${ymd(e.start)}`,
      `DTEND;VALUE=DATE:${ymd(nextDay(e.start))}`,
      `SUMMARY:${esc(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.rrule) lines.push(`RRULE:${e.rrule}`);
    lines.push('TRANSP:TRANSPARENT');
    for (const trig of e.alarms || ['-PT15H', 'PT9H']) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(e.title)}`, `TRIGGER:${trig}`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
