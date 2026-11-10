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

test('trend zgodny z pozycją: trzymaj, a przy zysku podciągnij stop', () => {
  const noStop = advisePosition({ direction: 'LONG' }, d1('LONG'), up, S);
  assert.equal(noStop.action, 'HOLD'); assert.equal(noStop.h4Score, 10);
  const a = advisePosition({ direction: 'LONG', entry: last(up) * 0.95, stop: last(up) * 0.93 }, d1('LONG'), up, S);
  assert.equal(a.action, 'TRAIL'); assert.ok(a.r > 1);
  assert.ok(a.suggestedStop > last(up) * 0.93 && a.suggestedStop < last(up)); // stop tylko w stronę zysku i poniżej ceny
  const s = advisePosition({ direction: 'SHORT', entry: last(down) * 1.05, stop: last(down) * 1.07 }, d1('SHORT'), down, S);
  assert.equal(s.action, 'TRAIL'); assert.ok(s.suggestedStop < last(down) * 1.07 && s.suggestedStop > last(down));
});

test('stop naruszony lub D1 odwrócony: zamknij', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG', entry: 130, stop: last(up) + 1 }, d1('LONG'), up, S)), ['EXIT', 'stop']);
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('SHORT'), up, S)), ['EXIT', 'd1Reversed']);
});

test('H4 przeciwko pozycji: zmniejsz gdy D1 wspiera, zamknij gdy nie', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('LONG'), down, S)), ['REDUCE', 'h4Against']);
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('NEUTRAL'), down, S)), ['EXIT', 'h4AgainstNoD1']);
  assert.ok(advisePosition({ direction: 'LONG' }, d1('LONG'), down, S).suggestedStop < last(down)); // stop pod ostatnim dołkiem H4
});

test('D1 wygasł albo cena pod Kijun H4: zacieśnij stop', () => {
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('NEUTRAL'), up, S)), ['TIGHTEN', 'd1Faded']);
  const dip = [...up]; const k = dip.length;
  for (let i = k - 3; i < k; i++) { const c = up[k - 18].c; dip[i] = { ...dip[i], o: c, h: c * 1.001, l: c * 0.999, c }; }
  assert.deepEqual(pick(advisePosition({ direction: 'LONG' }, d1('LONG'), dip, S)), ['TIGHTEN', 'h4KijunLost']);
});

test('przegrzanie na H4: zrealizuj część', () => {
  const spike = h4(200, (i) => (i < 195 ? 100 * 1.0002 ** i : 100 * 1.0002 ** 195 * 1.012 ** (i - 194)));
  const a = advisePosition({ direction: 'LONG', entry: 100, stop: 99 }, d1('LONG'), spike, S);
  assert.deepEqual(pick(a), ['PARTIAL', 'h4Extended']);
});

test('za mało świec H4 i świeca w toku', () => {
  assert.equal(advisePosition({ direction: 'LONG' }, d1('LONG'), up.slice(0, 50), S).action, 'NO_DATA');
  const t0 = up.at(-1).ts;
  assert.equal(closedH4(up, new Date((t0 + 14399) * 1000)).length, 199); // ostatnia jeszcze otwarta
  assert.equal(closedH4(up, new Date((t0 + 14400) * 1000)).length, 200);
});

test('okno H4: uruchomienie po granicy 4 h plus opóźnienie', () => {
  assert.equal(h4Slot(new Date('2026-01-07T08:03:00Z'), 5), null);
  const s = h4Slot(new Date('2026-01-07T08:05:00Z'), 5);
  assert.equal(s, h4Slot(new Date('2026-01-07T11:59:00Z'), 5));
  assert.equal(h4Slot(new Date('2026-01-07T12:05:00Z'), 5), s + 1);
});

test('naprawa zamknięć: wada Yahoo jest korygowana, zdrowe dane zostają', () => {
  const real = Array.from({ length: 60 }, (_, i) => ({ o: 100 + i, c: 101 + i, h: 101.5 + i, l: 99.5 + i }));
  const broken = real.map((b) => ({ date: 'x', o: b.o, h: b.h, l: b.l, c: b.o + 0.01 })); // zamknięcie ≈ otwarcie
  const fixed = repairFlatCloses(broken, 999);
  assert.equal(fixed[10].c, broken[11].o);            // zamknięcie = otwarcie następnego dnia
  assert.equal(fixed.at(-1).c, 999); assert.equal(fixed.at(-1).h, 999); // ostatnia świeca: bieżąca cena, zakres rozszerzony
  const healthy = real.map((b) => ({ date: 'x', ...b }));
  assert.equal(repairFlatCloses(healthy, 999), healthy);
});

test('składanie świec H4 z godzinowych', () => {
  const rows = [0, 1, 2, 3, 4].map((i) => ({ ts: 14400 * 10 + i * 3600, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i }));
  assert.deepEqual(aggregateBars(rows, 14400), [{ ts: 144000, o: 10, h: 15, l: 9, c: 14 }, { ts: 158400, o: 14, h: 16, l: 13, c: 15 }]);
});

test('lista domyślna: unikalne identyfikatory, kategorie mają nazwy', () => {
  const ids = DEFAULT_INSTRUMENTS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(DEFAULT_INSTRUMENTS.filter((i) => i.category === 'dax').length, 40);
  assert.equal(DEFAULT_INSTRUMENTS.filter((i) => i.category === 'sp500').length, 50);
  for (const c of new Set(DEFAULT_INSTRUMENTS.map((i) => i.category))) assert.ok(`cat.${c}` in MESSAGES.pl, c);
  for (const i of ids) assert.match(i, /^[A-Z0-9._-]{1,20}$/);
});

function pick(a) { return [a.action, a.reason]; }
