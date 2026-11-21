import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, addDays, weekStart, daysInMonth, addMonths, plural } from '../js/util.js';
import * as A from '../js/analytics.js';
import * as C from '../js/crypto.js';

test('parseAmount', () => {
  assert.equal(parseAmount('1 200,50'), 1200.5);
  assert.equal(parseAmount('120+45'), 165);
  assert.equal(parseAmount('100-20*2'), 60);
  assert.equal(parseAmount('3*150'), 450);
  assert.ok(Number.isNaN(parseAmount('')));
  assert.ok(Number.isNaN(parseAmount('+')));
});

test('dates', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(weekStart('2026-11-21'), '2026-11-16'); // суббота → понедельник
  assert.equal(daysInMonth('2028-02-10'), 29);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-01');
  assert.equal(plural(21, 'раз', 'раза', 'раз'), 'раз');
  assert.equal(plural(3, 'день', 'дня', 'дней'), 'дня');
});

const cat = (id) => ({ id, name: id, icon: '•', color: '#888' });

function demo(today) {
  const txns = [];
  let n = 0;
  const add = (date, type, amount, categoryId, note = '', currency = 'RUB', rate = 1) =>
    txns.push({ id: `t${n++}`, date, type, amount, categoryId, note, currency, rate, createdAt: n });
  for (let i = 0; i < 150; i++) {
    const d = addDays(today, -i);
    add(d, 'expense', 400 + (i % 5) * 30, 'food');
    if (i % 2 === 0) add(d, 'expense', 250, 'taxi');
    if (i < 30 || i % 3 === 0) add(d, 'expense', 180, 'cafe'); // рост кафе в последние 30 дней
  }
  for (let m = 0; m < 5; m++) {
    add(addMonths(today, -m).slice(0, 8) + '05', 'income', 90000, 'salary');
    add(addDays(today, -3 - m * 30), 'expense', 599, 'subs', 'Музыка');
  }
  add(addDays(today, -2), 'expense', 5200, 'food', 'Банкет'); // выброс
  add(addDays(today, -1), 'expense', 777, 'taxi');
  add(addDays(today, -1), 'expense', 777, 'taxi'); // дубль
  add(addDays(today, -4), 'expense', 10, 'cafe', '', 'USD', 90); // валюта
  return { settings: { base: 'RUB' }, categories: [], txns, dismissed: [] };
}

test('enrich converts currency', () => {
  const st = demo('2026-11-21');
  const usd = A.enrich(st).find((t) => t.currency === 'USD');
  assert.equal(usd.v, 900);
});

test('period and buckets', () => {
  const p = A.period('month', '2026-11-21');
  assert.equal(p.start, '2026-11-01');
  assert.equal(p.end, '2026-12-01');
  assert.equal(A.buckets([], p).length, 30);
  assert.equal(A.buckets([], A.period('year', '2026-11-21')).length, 12);
  assert.equal(A.buckets([], A.period('week', '2026-11-21')).length, 7);
});

test('insights find problems', () => {
  const today = '2026-11-21';
  const ins = A.insights(demo(today), cat, today);
  const keys = ins.map((x) => x.key.split(':')[0]);
  assert.ok(keys.includes('out'), 'outlier: ' + keys);
  assert.ok(keys.includes('dup'), 'duplicate: ' + keys);
  assert.ok(keys.includes('grow'), 'growth: ' + keys);
  assert.ok(keys.includes('subs'), 'subscription: ' + keys);
  // скрытая находка не возвращается
  const st = demo(today);
  st.dismissed = [ins.find((x) => x.key.startsWith('dup')).key];
  assert.ok(!A.insights(st, cat, today).some((x) => x.key.startsWith('dup')));
});

test('trend and cumulative', () => {
  const today = '2026-11-21';
  const tx = A.enrich(demo(today));
  const tr = A.trend(tx, today, 6);
  assert.equal(tr.rows.length, 6);
  assert.ok(tr.slopePct != null);
  const cum = A.cumulative(tx, A.period('month', today), today);
  assert.equal(cum.pts.length, 21);
  assert.ok(cum.forecast.value > cum.pts.at(-1).value);
});

test('crypto roundtrip and wrong password', async () => {
  const key = await C.generateDataKey();
  const salt = C.randomBytes(16);
  const kek = await C.keyFromPassword('123987', salt, 1000);
  const w = await C.wrapKey(key, kek);
  const k2 = await C.unwrapKey(w, await C.keyFromPassword('123987', salt, 1000));
  const blob = await C.encryptJSON(key, { a: 1, s: 'Привет' });
  assert.deepEqual(await C.decryptJSON(k2, blob), { a: 1, s: 'Привет' });
  await assert.rejects(C.unwrapKey(w, await C.keyFromPassword('000000', salt, 1000)));
  const b = await C.encryptBackup({ x: 5 }, 'password1');
  assert.deepEqual(await C.decryptBackup(b, 'password1'), { x: 5 });
  await assert.rejects(C.decryptBackup(b, 'nope'), /Неверный пароль/);
});
