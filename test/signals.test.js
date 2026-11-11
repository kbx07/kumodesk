import test from 'node:test';
import assert from 'node:assert/strict';
import { stepSignal, resultR, signalStats } from '../server/signals.js';

const play = (dir, stop, grade = 'A') => ({ dir, action: 'PLAY', grade, plan: { params: { stop } } });
const bar = (o, h, l, c) => ({ o, h, l, c });

test('wynik w R: long i short', () => {
  assert.equal(resultR('LONG', 100, 95, 110), 2);
  assert.equal(resultR('SHORT', 100, 104, 96), 1);
  assert.equal(resultR('LONG', 100, 100, 110), 0);
});

test('sygnał otwiera się na decyzji GRAJ po cenie zamknięcia, ze stopem z planu', () => {
  const s = stepSignal(null, play('LONG', 95), bar(99, 101, 98, 100));
  assert.deepEqual(s, { close: null, open: { dir: 'LONG', grade: 'A', entry: 100, stop: 95 } });
  assert.equal(stepSignal(null, { dir: 'LONG', action: 'WATCH', plan: { params: { stop: 95 } } }, bar(99, 101, 98, 100)).open, null);
  assert.equal(stepSignal(null, play('LONG', 101), bar(99, 101, 98, 100)).open, null); // stop po złej stronie
});

test('naruszenie stopu kończy sygnał na −1R, nawet gdy kierunek trwa', () => {
  const open = { dir: 'LONG', entry: 100, stop: 95 };
  const s = stepSignal(open, play('LONG', 96), bar(99, 100, 94.5, 98));
  assert.deepEqual(s.close, { exit: 95, r: -1, reason: 'stop' });
  assert.deepEqual(s.open, { dir: 'LONG', grade: 'A', entry: 98, stop: 96 }); // nowy sygnał może ruszyć tego samego dnia
  const short = stepSignal({ dir: 'SHORT', entry: 100, stop: 104 }, play('SHORT', 103), bar(100, 104.2, 99, 101));
  assert.equal(short.close.r, -1);
});

test('wygaśnięcie lub odwrócenie kierunku zamyka sygnał po cenie zamknięcia', () => {
  const open = { dir: 'LONG', entry: 100, stop: 95 };
  const faded = stepSignal(open, { dir: 'NEUTRAL', action: 'WAIT' }, bar(108, 111, 107, 110));
  assert.deepEqual(faded, { close: { exit: 110, r: 2, reason: 'faded' }, open: null });
  const rev = stepSignal(open, play('SHORT', 101), bar(99, 100, 96, 97));
  assert.equal(rev.close.reason, 'reversed'); assert.equal(rev.close.r, -0.6);
  assert.deepEqual(rev.open, { dir: 'SHORT', grade: 'A', entry: 97, stop: 101 });
  // kierunek trwa, stop nietknięty: nic się nie dzieje, choć decyzja spadła do OBSERWUJ
  assert.deepEqual(stepSignal(open, { dir: 'LONG', action: 'WATCH' }, bar(101, 103, 99, 102)), { close: null, open: null });
});

test('statystyka skuteczności', () => {
  const st = signalStats([
    { opened: '2026-01-05', closed: '2026-01-20', grade: 'A', r: 2, reason: 'faded' },
    { opened: '2026-02-01', closed: '2026-02-03', grade: 'A', r: -1, reason: 'stop' },
    { opened: '2026-02-10', closed: '2026-03-01', grade: 'B', r: 0.5, reason: 'reversed' },
    { opened: '2026-03-05', closed: null, grade: 'B', r: null },
  ]);
  assert.deepEqual(st.all, { n: 3, wins: 2, losses: 1, hitRate: 66.7, avgR: 0.5, totalR: 1.5 });
  assert.deepEqual(st.A, { n: 2, wins: 1, losses: 1, hitRate: 50, avgR: 0.5, totalR: 1 });
  assert.equal(st.B.n, 1); assert.equal(st.stopped, 1); assert.equal(st.open, 1); assert.equal(st.from, '2026-01-05');
  assert.equal(signalStats([]).all.hitRate, null);
});
