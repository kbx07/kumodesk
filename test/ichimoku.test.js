import test from 'node:test';
import assert from 'node:assert/strict';
import { midpoint, computeIchimoku, computeATR, scoreAt, toWeekly, direction } from '../server/ichimoku.js';

// Syntetyczny szereg: dni robocze od 2024-01-01, cena wg funkcji f(i).
function series(n, f) {
  const out = []; let d = new Date('2024-01-01T00:00:00Z'), i = 0;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(i++); out.push({ date: d.toISOString().slice(0, 10), o: c - 0.2, h: c + 1, l: c - 1, c }); }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

test('midpoint = (najwyższy high + najniższy low) / 2', () => {
  const bars = [{ h: 10, l: 8 }, { h: 12, l: 9 }, { h: 11, l: 7 }];
  assert.equal(midpoint(bars, 2, 3), (12 + 7) / 2);
  assert.equal(midpoint(bars, 2, 2), (12 + 7) / 2);
  assert.equal(midpoint(bars, 1, 3), null);
});

test('linie Ichimoku na trendzie liniowym mają wartości zamknięte', () => {
  const bars = series(200, (i) => 100 + i); // h = c+1, l = c-1
  const ich = computeIchimoku(bars);
  const i = 199, c = bars[i].c;
  assert.equal(ich.tenkan[i], ((c + 1) + (c - 8 - 1)) / 2);    // 9 świec
  assert.equal(ich.kijun[i], ((c + 1) + (c - 25 - 1)) / 2);    // 26 świec
  assert.equal(ich.rawB[i], ((c + 1) + (c - 51 - 1)) / 2);     // 52 świece
  assert.equal(ich.cloudA[i + 26], ich.rawA[i]);               // chmura przesunięta o 26 w przód
  assert.equal(ich.cloudA[i], ich.rawA[i - 26]);
  assert.equal(ich.cloudA.length, 226);
});

test('czysty trend wzrostowy daje +10, spadkowy −10', () => {
  const up = series(200, (i) => 100 + i), dn = series(200, (i) => 500 - i);
  assert.equal(scoreAt(up, computeIchimoku(up), 199).score, 10);
  assert.equal(scoreAt(dn, computeIchimoku(dn), 199).score, -10);
  assert.equal(direction(10, 4), 'LONG'); assert.equal(direction(-4, 4), 'SHORT'); assert.equal(direction(3, 4), 'NEUTRAL');
});

test('płaski rynek daje wynik 0, a za krótka historia null', () => {
  const flat = series(200, () => 100);
  assert.equal(scoreAt(flat, computeIchimoku(flat), 199).score, 0);
  const short = series(60, (i) => 100 + i);
  assert.equal(scoreAt(short, computeIchimoku(short), 59), null);
});

test('niestandardowe parametry są respektowane', () => {
  const bars = series(200, (i) => 100 + i);
  const ich = computeIchimoku(bars, { tenkan: 5, kijun: 10, senkou: 20, shift: 10 });
  const c = bars[199].c;
  assert.equal(ich.tenkan[199], ((c + 1) + (c - 4 - 1)) / 2);
  assert.equal(ich.cloudB.length, 210);
});

test('ATR przy stałym zakresie świec równa się temu zakresowi', () => {
  const flat = series(50, () => 100);
  assert.equal(computeATR(flat, 14)[49], 2);
  assert.equal(computeATR(flat, 14)[12], null);
});

test('agregacja tygodniowa: poniedziałek–piątek w jedną świecę', () => {
  const bars = series(10, (i) => 100 + i); // 2024-01-01 to poniedziałek
  const w = toWeekly(bars);
  assert.equal(w.length, 2);
  assert.deepEqual({ date: w[0].date, o: w[0].o, h: w[0].h, l: w[0].l, c: w[0].c }, { date: '2024-01-01', o: 99.8, h: 105, l: 99, c: 104 });
  assert.equal(w[1].date, '2024-01-08');
});
