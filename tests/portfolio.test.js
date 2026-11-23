import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vault from '../js/vault.js';
import * as store from '../js/store.js';
import * as P from '../js/planner.js';

// хранилище в тестах заблокировано: save() отклоняется — это нормально
process.on('unhandledRejection', () => {});

async function fresh() {
  const st = store.initialState('USD');
  st.settings.currencies = ['USD', 'EUR', 'USDT', 'BTC'];
  st.market = { at: Date.now(), usd: { USD: 1, EUR: 1.08, USDT: 0.9986, BTC: 60000 }, coins: [] };
  await vault.replaceState(st).catch(() => {});
  return st;
}

test('portfolio: deleted account does not leave negative staking balance', async () => {
  const st = await fresh();
  const acc = store.upsert('accounts', { name: 'WhiteBit', kind: 'exchange', currency: 'USDT', initial: 6592.21, archived: false });
  store.addInvestment({ kind: 'staking', name: 'WhiteBit USDT пул', amount: 6592.21, currency: 'USDT', apr: 12, start: '2026-11-01', end: '2027-01-09' }, acc.id);
  assert.equal(store.accountBalances()[acc.id].balance, 0);
  await store.deleteAccount(acc.id).catch(() => {});
  const h = store.portfolioHoldings();
  assert.ok(!h.USDT || Math.abs(h.USDT.qty) < 1e-9, `USDT should be 0, got ${h.USDT?.qty}`);
  assert.equal(st.invest[0].fromAccountId, '');
});

test('portfolio: income/expense from home page are not portfolio assets', async () => {
  await fresh();
  await store.saveTxn({ type: 'income', amount: 100, currency: 'USD', categoryId: '' }).catch(() => {});
  await store.saveTxn({ type: 'expense', amount: 12, currency: 'EUR', rate: 1.08, categoryId: '' }).catch(() => {});
  await store.saveExchange({ amount: 500, currency: 'USD', rate: 1, toAmount: 500, toCurrency: 'USDT', toRate: 1 }).catch(() => {});
  const h = store.portfolioHoldings();
  assert.equal(h.EUR, undefined);
  assert.equal(h.USD.qty, -500); // обмен виден, доход — нет
  assert.equal(h.USDT.qty, 500);
  assert.equal(store.holdings().USD.qty, -400); // главная по-прежнему видит всё
});

test('portfolio: exchange from an account keeps the unassigned side', async () => {
  await fresh();
  const acc = store.upsert('accounts', { name: 'Card', kind: 'card', currency: 'USD', initial: 1000, archived: false });
  await store.saveExchange({ amount: 600, currency: 'USD', rate: 1, accountId: acc.id, toAmount: 0.01, toCurrency: 'BTC', toRate: 60000 }).catch(() => {});
  const h = store.portfolioHoldings();
  assert.equal(h.BTC.qty, 0.01);
  assert.equal(h.USD, undefined);
});

test('portfolio: closing staking without account returns money to portfolio', async () => {
  await fresh();
  const inv = store.addInvestment({ kind: 'staking', name: 'Pool', amount: 1000, currency: 'USDT', apr: 10, start: '2026-10-01', end: '2026-11-01' });
  await store.closeInvestment(inv, { profit: 8.5, date: '2026-11-01' }).catch(() => {});
  assert.equal(store.portfolioHoldings().USDT.qty, 1008.5);
});

test('debt in BTC keeps 8-decimal precision and converts at market rate', async () => {
  await fresh();
  const d = { principal: 0.0712, currency: 'BTC', payments: [{ amount: 0.0012 }] };
  assert.equal(P.debtRemaining(d), 0.07);
  assert.equal(P.debtRemaining({ principal: 0.07123456, currency: 'BTC' }), 0.07123456);
  assert.equal(Math.round(0.07 * store.rate('BTC') * 100) / 100, 4200);
});
