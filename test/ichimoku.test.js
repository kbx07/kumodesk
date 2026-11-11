import test from 'node:test';
import assert from 'node:assert/strict';
import { midpoint, computeIchimoku, computeATR, scoreAt, toWeekly, direction } from '../server/ichimoku.js';

// Synthetic series: business days from 2024-01-01, price given by f(i).
function series(n, f) {
  const out = []; let d = new Date('2024-01-01T00:00:00Z'), i = 0;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(i++); out.push({ date: d.toISOString().slice(0, 10), o: c - 0.2, h: c + 1, l: c - 1, c }); }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

test('midpoint = (highest high + lowest low) / 2', () => {
  const bars = [{ h: 10, l: 8 }, { h: 12, l: 9 }, { h: 11, l: 7 }];
  assert.equal(midpoint(bars, 2, 3), (12 + 7) / 2);
  assert.equal(midpoint(bars, 2, 2), (12 + 7) / 2);
  assert.equal(midpoint(bars, 1, 3), null);
});

test('Ichimoku lines on a linear trend have closed-form values', () => {
  const bars = series(200, (i) => 100 + i); // h = c+1, l = c-1
  const ich = computeIchimoku(bars);
  const i = 199, c = bars[i].c;
  assert.equal(ich.tenkan[i], ((c + 1) + (c - 8 - 1)) / 2);    // 9 candles
  assert.equal(ich.kijun[i], ((c + 1) + (c - 25 - 1)) / 2);    // 26 candles
  assert.equal(ich.rawB[i], ((c + 1) + (c - 51 - 1)) / 2);     // 52 candles
  assert.equal(ich.cloudA[i + 26], ich.rawA[i]);               // cloud shifted 26 ahead
  assert.equal(ich.cloudA[i], ich.rawA[i - 26]);
  assert.equal(ich.cloudA.length, 226);
});

test('a clean uptrend scores +10, a downtrend −10', () => {
  const up = series(200, (i) => 100 + i), dn = series(200, (i) => 500 - i);
  assert.equal(scoreAt(up, computeIchimoku(up), 199).score, 10);
  assert.equal(scoreAt(dn, computeIchimoku(dn), 199).score, -10);
  assert.equal(direction(10, 4), 'LONG'); assert.equal(direction(-4, 4), 'SHORT'); assert.equal(direction(3, 4), 'NEUTRAL');
});

test('a flat market scores 0 and too short a history gives null', () => {
  const flat = series(200, () => 100);
  assert.equal(scoreAt(flat, computeIchimoku(flat), 199).score, 0);
  const short = series(60, (i) => 100 + i);
  assert.equal(scoreAt(short, computeIchimoku(short), 59), null);
});

test('custom parameters are respected', () => {
  const bars = series(200, (i) => 100 + i);
  const ich = computeIchimoku(bars, { tenkan: 5, kijun: 10, senkou: 20, shift: 10 });
  const c = bars[199].c;
  assert.equal(ich.tenkan[199], ((c + 1) + (c - 4 - 1)) / 2);
  assert.equal(ich.cloudB.length, 210);
});

test('ATR with a constant candle range equals that range', () => {
  const flat = series(50, () => 100);
  assert.equal(computeATR(flat, 14)[49], 2);
  assert.equal(computeATR(flat, 14)[12], null);
});

test('weekly aggregation: Monday–Friday into one candle', () => {
  const bars = series(10, (i) => 100 + i); // 2024-01-01 is a Monday
  const w = toWeekly(bars);
  assert.equal(w.length, 2);
  assert.deepEqual({ date: w[0].date, o: w[0].o, h: w[0].h, l: w[0].l, c: w[0].c }, { date: '2024-01-01', o: 99.8, h: 105, l: 99, c: 104 });
  assert.equal(w[1].date, '2024-01-08');
});
