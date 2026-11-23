import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/planner.js';

test('monthly occurrences clamp to month end', () => {
  const r = { freq: 'monthly', day: 31, start: '2026-01-01' };
  assert.deepEqual(P.occurrences(r, '2026-02-01', '2026-04-01'), ['2026-02-28', '2026-03-31']);
});

test('weekly and yearly occurrences', () => {
  // 2026-11-23 — понедельник
  assert.deepEqual(P.occurrences({ freq: 'weekly', weekday: 4, start: '2026-01-01' }, '2026-11-23', '2026-12-07'), ['2026-11-27', '2026-12-04']);
  assert.deepEqual(P.occurrences({ freq: 'yearly', month: 2, day: 29, start: '2020-01-01' }, '2027-01-01', '2029-01-01'), ['2027-02-28', '2028-02-29']);
  assert.deepEqual(P.occurrences({ freq: 'monthly', day: 5, active: false }, '2026-01-01', '2027-01-01'), []);
});

test('planned events: paid, overdue, upcoming', () => {
  const state = {
    recurring: [
      { id: 'r1', name: 'Аренда', amount: 500, currency: 'USD', freq: 'monthly', day: 5, start: '2026-10-01', paid: { '2026-11-05': 't1' } },
      { id: 'r2', name: 'Claude', amount: 20, currency: 'USD', freq: 'monthly', day: 17, start: '2026-10-01' },
    ],
    debts: [],
  };
  const ev = P.plannedEvents(state, '2026-11-01', '2026-12-01', '2026-11-23');
  assert.equal(ev.length, 2);
  assert.ok(ev[0].paid && ev[0].title === 'Аренда');
  assert.ok(ev[1].overdue && !ev[1].paid);
  assert.equal(P.monthlyAmount({ amount: 120, freq: 'yearly' }), 10);
});

test('debt remaining, payoff and schedule stops when repaid', () => {
  const d = { id: 'd', kind: 'loan', name: 'Кредит', principal: 1000, initialPaid: 400, payment: 250, day: 10, start: '2026-01-01', payments: [{ date: '2026-11-10', amount: 100 }] };
  assert.equal(P.debtRemaining(d), 500);
  assert.equal(P.payoff(d, '2026-11-23').n, 2);
  const ev = P.debtEvents(d, '2026-11-01', '2027-06-01', '2026-11-23');
  assert.deepEqual(ev.map((e) => e.date), ['2026-11-10', '2026-12-10', '2027-01-10']);
  assert.ok(ev[0].paid && !ev[1].paid);
});

test('tasks: repeats and per-day completion', () => {
  const daily = { id: 'a', title: 'Зарядка', date: '2026-11-20', repeat: 'daily', doneDates: ['2026-11-22'] };
  const weekdays = { id: 'b', title: 'Почта', date: '2026-11-20', repeat: 'weekdays' };
  const once = { id: 'c', title: 'Купить билеты', date: '2026-11-21', repeat: 'none', done: false };
  assert.ok(P.taskOn(daily, '2026-11-23'));
  assert.ok(!P.taskOn(daily, '2026-11-19'));
  assert.ok(!P.taskOn(weekdays, '2026-11-22')); // воскресенье
  assert.ok(P.isDone(daily, '2026-11-22') && !P.isDone(daily, '2026-11-23'));
  const st = { tasks: [daily, weekdays, once] };
  assert.equal(P.tasksFor(st, '2026-11-23').length, 2);
  assert.deepEqual(P.overdueTasks(st, '2026-11-23').map((t) => t.id), ['c']);
});

test('goal stats', () => {
  const g = { target: 1200, contributions: [{ amount: 300 }, { amount: -100 }], deadline: '2027-05-23' };
  const s = P.goalStats(g, '2026-11-23');
  assert.equal(s.saved, 200);
  assert.equal(s.left, 1000);
  assert.ok(s.perMonth > 160 && s.perMonth < 170);
});

test('investments: stats and maturity events', () => {
  const v = { id: 'i1', name: 'WhiteBit 60', amount: 1000, currency: 'USDT', apr: 18.25, start: '2026-11-01', end: '2026-12-31' };
  const s = P.investStats(v, '2026-11-21');
  assert.equal(s.total, 60);
  assert.equal(s.elapsed, 20);
  assert.equal(s.left, 40);
  assert.equal(s.expected, 30); // 1000 * 18.25% * 60/365
  assert.equal(s.accrued, 10);
  const c = P.investStats({ ...v, compound: true }, '2026-11-21');
  assert.ok(c.expected > 30 && c.expected < 30.5);
  const ev = P.plannedEvents({ recurring: [], debts: [], invest: [v, { ...v, id: 'i2', closed: true }] }, '2026-12-01', '2027-01-01', '2026-11-21');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, 'invest');
  assert.equal(ev[0].amount, 30);
  // доход от вложения не считается «зарплатой» в прогнозе
  assert.equal(P.paydayForecast({ recurring: [], debts: [], invest: [v] }, 500, () => 1, '2026-11-21'), null);
});
