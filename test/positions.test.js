import test from 'node:test';
import assert from 'node:assert/strict';
import { advisePosition, closedH4 } from '../server/positions.js';
import { repairFlatCloses, aggregateBars } from '../server/providers/index.js';
import { h4Slot } from '../server/scheduler.js';
import { DEFAULT_SETTINGS as S, DEFAULT_INSTRUMENTS } from '../server/defaults.js';
import { MESSAGES } from '../public/i18n.js';

const h4 = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i); return { ts: 1700000000 - (1700000000 % 14400) + i * 14400, o: c * 0.9995, h: c * 1.002, l: c * 0.998, c }; });
const up = h4(200, (i) => 100 * 1.0005 ** i), down = h4(200, (i) => 100 * 0.9995 ** i);
const d1 = (dir) => ({ ok: true, dir, grade: 'A' });
const last = (b) => b.at(-1).c;

test('trend with the position: hold, and trail the stop when in profit', () => {
  const noStop = advisePosition({ direction: 'LONG' }, d1('LONG'), up, S);
  assert.equal(noStop.action, 'HOLD'); assert.equal(noStop.h4Score, 10);
  const a = advisePosition({ direction: 'LONG', entry: last(up) * 0.95, stop: last(up) * 0.93 }, d1('LONG'), up, S);
  assert.equal(a.action, 'TRAIL'); assert.ok(a.r > 1);
  assert.ok(a.suggestedStop > last(up) * 0.93 && a.suggestedStop < last(up)); // stop only towards profit and below price
  const s = advisePosition({ direction: 'SHORT', entry: last(down) * 1.05, stop: last(down) * 1.07 }, d1('SHORT'), down, S);
  assert.equal(s.action, 'TRAIL'); assert.ok(s.suggestedStop < last(down) * 1.07 && s.suggestedStop > last(down));
});

test('stop breached or D1 reversed: close', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG', entry: 130, stop: last(up) + 1 }, d1('LONG'), up, S)), ['EXIT', 'stop']);
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('SHORT'), up, S)), ['EXIT', 'd1Reversed']);
});

test('H4 against the position: reduce when D1 supports it, close when it does not', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('LONG'), down, S)), ['REDUCE', 'h4Against']);
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('NEUTRAL'), down, S)), ['EXIT', 'h4AgainstNoD1']);
  assert.ok(advisePosition({ direction: 'LONG' }, d1('LONG'), down, S).suggestedStop < last(down)); // stop below the latest H4 low
});

test('D1 faded or price below the H4 Kijun: tighten the stop', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('NEUTRAL'), up, S)), ['TIGHTEN', 'd1Faded']);
  const dip = [...up]; const k = dip.length;
  for (let i = k - 3; i < k; i++) { const c = up[k - 18].c; dip[i] = { ...dip[i], o: c, h: c * 1.001, l: c * 0.999, c }; }
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('LONG'), dip, S)), ['TIGHTEN', 'h4KijunLost']);
});

test('overextended on H4: take partial profit', () => {
  const spike = h4(200, (i) => (i < 195 ? 100 * 1.0002 ** i : 100 * 1.0002 ** 195 * 1.012 ** (i - 194)));
  const a = advisePosition({ direction: 'LONG', entry: 100, stop: 99 }, d1('LONG'), spike, S);
  assert.deepEqual(pick(a), ['PARTIAL', 'h4Extended']);
});

test('too few H4 candles and the candle in progress', () => {
  assert.equal(advisePosition({ direction: 'LONG' }, d1('LONG'), up.slice(0, 50), S).action, 'NO_DATA');
  const t0 = up.at(-1).ts;
  assert.equal(closedH4(up, new Date((t0 + 14399) * 1000)).length, 199); // the last one is still open
  assert.equal(closedH4(up, new Date((t0 + 14400) * 1000)).length, 200);
});

test('H4 window: runs after the 4 h boundary plus the delay', () => {
  assert.equal(h4Slot(new Date('2026-01-07T08:03:00Z'), 5), null);
  const s = h4Slot(new Date('2026-01-07T08:05:00Z'), 5);
  assert.equal(s, h4Slot(new Date('2026-01-07T11:59:00Z'), 5));
  assert.equal(h4Slot(new Date('2026-01-07T12:05:00Z'), 5), s + 1);
});

test('close repair: the Yahoo defect is corrected, healthy data is left alone', () => {
  const real = Array.from({ length: 60 }, (_, i) => ({ o: 100 + i, c: 101 + i, h: 101.5 + i, l: 99.5 + i }));
  const broken = real.map((b) => ({ date: 'x', o: b.o, h: b.h, l: b.l, c: b.o + 0.01 })); // close ≈ open
  const fixed = repairFlatCloses(broken, 999);
  assert.equal(fixed[10].c, broken[11].o);            // close = the next day's open
  assert.equal(fixed.at(-1).c, 999); assert.equal(fixed.at(-1).h, 999); // last candle: current price, range widened
  const healthy = real.map((b) => ({ date: 'x', ...b }));
  assert.equal(repairFlatCloses(healthy, 999), healthy);
});

test('building H4 candles from hourly ones', () => {
  const rows = [0, 1, 2, 3, 4].map((i) => ({ ts: 14400 * 10 + i * 3600, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i }));
  assert.deepEqual(aggregateBars(rows, 14400), [{ ts: 144000, o: 10, h: 15, l: 9, c: 14 }, { ts: 158400, o: 14, h: 16, l: 13, c: 15 }]);
});

test('default list: unique identifiers, categories have names', () => {
  const ids = DEFAULT_INSTRUMENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(DEFAULT_INSTRUMENTS.filter((i) => i.category === 'dax').length, 40);
  assert.equal(DEFAULT_INSTRUMENTS.filter((i) => i.category === 'sp500').length, 50);
  for (const c of new Set(DEFAULT_INSTRUMENTS.map((i) => i.category))) assert.ok(`cat.${c}` in MESSAGES.pl, c);
  for (const i of ids) assert.match(i, /^[A-Z0-9._-]{1,20}$/);
});

function pick(a) { return [a.action, a.reason]; }

test('EODHD symbols are derived when none is typed in', async () => {
  const { deriveSymbol, symbolFor } = await import('../server/providers/index.js');
  const d = (inst) => deriveSymbol('eodhd', inst);
  assert.equal(d({ class: 'fx', base: 'EUR', quote: 'USD', symbols: { yahoo: 'EURUSD=X' } }), 'EURUSD.FOREX');
  assert.equal(d({ class: 'metal', base: 'XAU', quote: 'USD', symbols: { yahoo: 'GC=F' } }), 'XAUUSD.FOREX');
  assert.equal(d({ class: 'index', symbols: { yahoo: '^GDAXI' } }), 'GDAXI.INDX');
  assert.equal(d({ class: 'index', symbols: { yahoo: 'WIG20.WA' } }), 'WIG20.INDX');
  assert.equal(d({ class: 'stock', symbols: { yahoo: 'SAP.DE' } }), 'SAP.XETRA');
  assert.equal(d({ class: 'stock', symbols: { yahoo: 'AAPL' } }), 'AAPL.US');
  assert.equal(d({ class: 'crypto', symbols: { yahoo: 'BTC-USD' } }), 'BTC-USD.CC');
  assert.equal(d({ class: 'other', symbols: { yahoo: 'ZZ=F' } }), null);
  assert.equal(symbolFor({ class: 'stock', symbols: { yahoo: 'SAP.DE', eodhd: 'SAP.F' } }, 'eodhd'), 'SAP.F'); // a typed symbol wins
  assert.equal(deriveSymbol('stooq', { class: 'stock', symbols: { yahoo: 'SAP.DE' } }), null);
});
