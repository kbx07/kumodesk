import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeR, buildLedger } from '../server/capital.js';

test('result in R for LONG and SHORT', () => {
  assert.equal(tradeR('LONG', 100, 95, 110), 2);
  assert.equal(tradeR('LONG', 100, 95, 95), -1);
  assert.equal(tradeR('SHORT', 100, 104, 92), 2);
  assert.equal(tradeR('SHORT', 100, 104, 106), -1.5);
  assert.equal(tradeR('LONG', 100, null, 110), null);
  assert.equal(tradeR('LONG', 100, 100, 110), null);
});

test('ledger: compounding, statistics, drawdown', () => {
  const t = (id, closed, r, extra = {}) => ({ id, instrument_id: 'EURUSD', direction: 'LONG', risk_pct: 1, closed, r, pnl_manual: null, ...extra });
  const L = buildLedger([
    t(2, '2026-01-03', -1),                      // given out of order – sorted by close date
    t(1, '2026-01-02', 2),
    t(3, '2026-01-04', null, { pnl_manual: 50, instrument_id: 'DAX' }),
  ], 10000);
  assert.deepEqual(L.trades.map((x) => x.id), [1, 2, 3]);
  assert.equal(L.trades[0].pnl, 200);            // 10000 × 1% × 2R
  assert.equal(L.trades[1].pnl, -102);           // 10200 × 1% × −1R
  assert.equal(L.trades[2].pnl, 50);             // hand-entered amount
  assert.deepEqual(L.curve.map((p) => p.equity), [10000, 10200, 10098, 10148]);
  const s = L.stats;
  assert.equal(s.equity, 10148); assert.equal(s.profit, 148); assert.equal(s.returnPct, 1.48);
  assert.equal(s.trades, 3); assert.equal(s.wins, 2); assert.equal(s.losses, 1); assert.equal(s.winRate, 66.7);
  assert.equal(s.avgPnl, 49.33); assert.equal(s.avgR, 0.5);
  assert.equal(s.best, 200); assert.equal(s.worst, -102);
  assert.equal(s.profitFactor, 2.45);            // 250 / 102
  assert.equal(s.maxDrawdownPct, 1);             // 10200 -> 10098
  assert.deepEqual(L.byInstrument, [{ id: 'EURUSD', pnl: 98, trades: 2 }, { id: 'DAX', pnl: 50, trades: 1 }]);
});

test('ledger without trades and without capital', () => {
  const L = buildLedger([], 5000);
  assert.equal(L.stats.equity, 5000); assert.equal(L.stats.trades, 0); assert.equal(L.stats.winRate, null); assert.equal(L.curve.length, 1);
  const Z = buildLedger([{ id: 1, instrument_id: 'X', direction: 'LONG', risk_pct: 1, closed: '2026-01-01', r: 2, pnl_manual: null }], 0);
  assert.equal(Z.trades[0].pnl, 0); assert.equal(Z.stats.returnPct, null);
});
