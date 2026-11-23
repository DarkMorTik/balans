import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick, guessCategory } from '../js/nlp.js';
import { parseCSV, parseNum, parseDate, detectColumns, rowsToDrafts } from '../js/csv.js';
import { buildICS, rruleFor } from '../js/ics.js';
import { mergeStates } from '../js/sync.js';
import * as P from '../js/planner.js';

const cats = [
  { id: 'taxi', name: 'Такси', type: 'expense' }, { id: 'food', name: 'Продукты', type: 'expense' },
  { id: 'cafe', name: 'Кафе', type: 'expense' }, { id: 'sub', name: 'Подписки', type: 'expense' },
  { id: 'sal', name: 'Зарплата', type: 'income' }, { id: 'other', name: 'Другое', type: 'both' },
];

test('parseQuick: digits, currency, income', () => {
  assert.deepEqual(parseQuick('такси 12 долларов'), { type: 'expense', amount: 12, currency: 'USD', note: 'Такси' });
  const r = parseQuick('Зарплата 2 400 евро');
  assert.equal(r.type, 'income'); assert.equal(r.amount, 2400); assert.equal(r.currency, 'EUR');
  assert.equal(parseQuick('кофе 4,5').amount, 4.5);
  assert.equal(parseQuick('ноутбук 3к').amount, 3000);
  assert.equal(parseQuick('продукты').amount, null);
});

test('parseQuick: number words', () => {
  assert.equal(parseQuick('обед двести пятьдесят рублей').amount, 250);
  assert.equal(parseQuick('аренда полторы тысячи долларов').amount, 1500);
  const r = parseQuick('такси двенадцать долларов');
  assert.equal(r.amount, 12); assert.equal(r.note, 'Такси');
});

test('guessCategory: history, name, dictionary', () => {
  assert.equal(guessCategory('Uber поездка', cats), 'taxi');
  assert.equal(guessCategory('Claude Pro', cats), 'sub');
  assert.equal(guessCategory('Пятёрочка', cats), 'food');
  assert.equal(guessCategory('Лавка у дома', cats, [{ note: 'Лавка у дома', categoryId: 'cafe', type: 'expense' }]), 'cafe');
  assert.equal(guessCategory('аванс', cats, [], 'income'), 'sal');
  assert.equal(guessCategory('xyz', cats), null);
});

test('CSV: numbers and dates', () => {
  assert.equal(parseNum('1 234,56'), 1234.56);
  assert.equal(parseNum('1,234.56'), 1234.56);
  assert.equal(parseNum('-12.5'), -12.5);
  assert.equal(parseNum('(45.00)'), -45);
  assert.equal(parseNum('12,50 ₽'), 12.5);
  assert.equal(parseNum('1.234.567'), 1234567);
  assert.equal(parseDate('23.11.2026'), '2026-11-23');
  assert.equal(parseDate('2026-11-05 14:30'), '2026-11-05');
  assert.equal(parseDate('11/23/26'), '2026-11-23');
  assert.equal(parseDate('03/04/2026', 'mdy'), '2026-03-04');
  assert.equal(parseDate('31.02.2026'), null);
});

test('CSV: detect columns and drafts (semicolon, debit/credit)', () => {
  const text = 'Дата;Описание;Списание;Зачисление\n23.11.2026;"Uber, поездка";12,50;\n22.11.2026;Зарплата;;2400\n';
  const rows = parseCSV(text);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], 'Uber, поездка');
  const cols = detectColumns(rows);
  assert.equal(cols.date, 0); assert.equal(cols.desc, 1); assert.equal(cols.debit, 2); assert.equal(cols.credit, 3);
  const d = rowsToDrafts(rows, cols);
  assert.deepEqual(d.map((x) => [x.date, x.type, x.amount]), [['2026-11-23', 'expense', 12.5], ['2026-11-22', 'income', 2400]]);
});

test('CSV: single signed amount column without header', () => {
  const rows = parseCSV('2026-11-01,Coffee shop,-4.20,USD\n2026-11-02,Refund,10.00,USD');
  const cols = detectColumns(rows);
  assert.equal(cols.header, false);
  const d = rowsToDrafts(rows, cols);
  assert.equal(d.length, 2);
  assert.equal(d[0].type, 'expense'); assert.equal(d[0].amount, 4.2); assert.equal(d[0].currency, 'USD');
});

test('ICS: rrules and structure', () => {
  assert.equal(rruleFor({ freq: 'monthly', day: 5 }), 'FREQ=MONTHLY;BYMONTHDAY=5');
  assert.equal(rruleFor({ freq: 'monthly', day: 31 }), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1');
  assert.equal(rruleFor({ freq: 'weekly', weekday: 4 }), 'FREQ=WEEKLY;BYDAY=FR');
  const ics = buildICS([{ uid: 'r1', title: 'Аренда; 650 $', start: '2026-12-05', rrule: 'FREQ=MONTHLY;BYMONTHDAY=5' }]);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261205'));
  assert.ok(ics.includes('DTEND;VALUE=DATE:20261206'));
  assert.ok(ics.includes('SUMMARY:Аренда\\; 650 $'));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
});

test('sync: merge by updatedAt with tombstones', () => {
  const base = { settings: { currencies: ['USD'], rates: {}, manualRates: {} }, dismissed: [], focus: {} };
  const local = { ...base, txns: [{ id: 'a', amount: 1, updatedAt: 10 }, { id: 'b', amount: 2, updatedAt: 10 }, { id: 'c', amount: 3, updatedAt: 10 }], deleted: {} };
  const remote = { ...base, settings: { currencies: ['EUR'], rates: {}, manualRates: {} }, txns: [{ id: 'a', amount: 9, updatedAt: 20 }, { id: 'd', amount: 4, updatedAt: 5 }], deleted: { b: Date.now() } };
  const { state, stats } = mergeStates(local, remote);
  const byId = Object.fromEntries(state.txns.map((t) => [t.id, t.amount]));
  assert.deepEqual(byId, { a: 9, c: 3, d: 4 });
  assert.deepEqual(stats, { added: 1, updated: 1, removed: 1 });
  assert.deepEqual(state.settings.currencies.sort(), ['EUR', 'USD']);
  // повторное слияние ничего не меняет
  const again = mergeStates(state, remote);
  assert.deepEqual(again.stats, { added: 0, updated: 0, removed: 0 });
});

test('payday forecast and habit week', () => {
  const st = {
    recurring: [
      { id: 's', name: 'Зарплата', type: 'income', amount: 2000, currency: 'USD', freq: 'monthly', day: 10, start: '2026-01-01' },
      { id: 'r', name: 'Аренда', amount: 600, currency: 'USD', freq: 'monthly', day: 5, start: '2026-01-01' },
    ],
    debts: [],
  };
  const f = P.paydayForecast(st, 1000, () => 1, '2026-11-23');
  assert.equal(f.date, '2026-12-10');
  assert.equal(f.plannedBefore, 600);
  assert.equal(f.free, 400);
  assert.equal(f.days, 17);
  assert.equal(f.perDay, 23.53);
  const t = { date: '2026-11-01', repeat: 'daily', doneDates: ['2026-11-22', '2026-11-23'] };
  const w = P.habitWeek(t, '2026-11-23');
  assert.equal(w.days.length, 7); assert.equal(w.done, 2); assert.equal(w.due, 7);
});
