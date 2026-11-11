// Śledzenie sygnałów: kiedy instrument dostał „zielone światło” (decyzja GRAJ) i jak skończyłoby się
// wejście zaraz po sygnale zgodnie z planem. Służy do oceny skuteczności algorytmu.
//
// Reguły (uzgodnione z użytkownikiem):
//   wejście  – po zamknięciu świecy, na której pojawił się sygnał (cena zamknięcia),
//   stop     – stop z planu z dnia sygnału,
//   koniec   – świeca narusza stop (wynik −1R) albo kierunek wygasa lub się odwraca (wynik po zamknięciu),
//   „rację”  – algorytm miał, gdy wynik zagrania jest dodatni.
import * as db from './db.js';
import { analyzeMarket } from './analysis.js';

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Wynik w R pozycji otwartej po `entry` ze stopem `stop`, liczony do ceny `price`. */
export function resultR(dir, entry, stop, price) {
  const risk = Math.abs(entry - stop);
  return risk ? ((dir === 'LONG' ? 1 : -1) * (price - entry)) / risk : 0;
}

/**
 * Jeden krok automatu dla jednego instrumentu i jednej nowej świecy.
 *   open – otwarty sygnał albo null; a – analiza instrumentu na tej świecy; bar – ta świeca.
 * Zwraca { close: {...} | null, open: {...} | null } – co zamknąć i co otworzyć.
 */
export function stepSignal(open, a, bar) {
  let close = null, cur = open;
  if (cur) {
    const stopHit = cur.dir === 'LONG' ? bar.l <= cur.stop : bar.h >= cur.stop;
    if (stopHit) close = { exit: cur.stop, r: -1, reason: 'stop' };
    else if (a.dir !== cur.dir) close = { exit: bar.c, r: round(resultR(cur.dir, cur.entry, cur.stop, bar.c), 3), reason: a.dir === 'NEUTRAL' ? 'faded' : 'reversed' };
    if (close) cur = null;
  }
  let next = null;
  if (!cur && a.action === 'PLAY' && a.plan?.params?.stop != null) {
    const stop = a.plan.params.stop;
    // stop musi leżeć po stronie straty – inaczej sygnał nie nadaje się do śledzenia
    if (a.dir === 'LONG' ? stop < bar.c : stop > bar.c) next = { dir: a.dir, grade: a.grade, entry: bar.c, stop };
  }
  return { close, open: next };
}

let running = false;
export const signalsBusy = () => running;

/**
 * Dolicza sygnały za dni, których jeszcze nie przetworzono (przy pierwszym uruchomieniu: ostatni rok).
 * Dzień jest przetwarzany dopiero, gdy się skończył (UTC), bo wtedy wszystkie rynki mają już jego świecę.
 */
export async function updateSignals({ days = 370, now = new Date() } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    const instruments = db.listInstruments().filter((i) => i.enabled);
    const settings = db.getSettings();
    const groupsById = Object.fromEntries(db.listGroups().map((g) => [g.id, g]));
    const candles = {};
    for (const i of instruments) candles[i.id] = db.getCandles(i.id);
    const today = now.toISOString().slice(0, 10);
    const first = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    const through = db.getMeta('signalsThrough') || first;
    const dates = [...new Set(Object.values(candles).flatMap((b) => b.map((x) => x.date)))].filter((d) => d > through && d < today).sort();
    if (!dates.length) return { processed: 0 };
    const open = {};
    for (const s of db.openSignals()) open[s.instrument_id] = s;
    const ptr = Object.fromEntries(instruments.map((i) => [i.id, 0]));
    let opened = 0, closed = 0;
    for (const d of dates) {
      const slice = {}, barOf = {};
      for (const i of instruments) {
        const b = candles[i.id];
        while (ptr[i.id] < b.length && b[ptr[i.id]].date <= d) ptr[i.id]++;
        const end = ptr[i.id];
        slice[i.id] = b.slice(Math.max(0, end - 560), end);
        if (end > 0 && b[end - 1].date === d) barOf[i.id] = b[end - 1];
      }
      const market = analyzeMarket({ instruments, candlesById: slice, groupsById, positions: [], settings, now: new Date(Date.parse(d + 'T00:00:00Z') + 2 * 86400000) });
      for (const a of market.instruments) {
        const bar = barOf[a.id];
        if (!a.ok || !bar) continue; // brak nowej świecy tego dnia (święto, weekend)
        const step = stepSignal(open[a.id] || null, a, bar);
        if (step.close) { db.closeSignal(open[a.id].id, { closed: d, ...step.close }); delete open[a.id]; closed++; }
        if (step.open) { const id = db.openSignal({ instrument_id: a.id, opened: d, ...step.open }); open[a.id] = { id, instrument_id: a.id, opened: d, ...step.open }; opened++; }
      }
      db.setMeta('signalsThrough', d);
      await new Promise((r) => setImmediate(r)); // nie blokujemy serwera podczas przeliczania roku wstecz
    }
    return { processed: dates.length, opened, closed };
  } finally { running = false; }
}

/** Statystyka skuteczności z zakończonych sygnałów. */
export function signalStats(list) {
  const done = list.filter((s) => s.closed);
  const agg = (rows) => {
    const n = rows.length, wins = rows.filter((s) => s.r > 0).length;
    const sum = rows.reduce((t, s) => t + s.r, 0);
    return { n, wins, losses: n - wins, hitRate: n ? round((wins / n) * 100, 1) : null, avgR: n ? round(sum / n, 2) : null, totalR: round(sum, 1) };
  };
  return {
    all: agg(done), A: agg(done.filter((s) => s.grade === 'A')), B: agg(done.filter((s) => s.grade === 'B')),
    stopped: done.filter((s) => s.reason === 'stop').length, open: list.length - done.length,
    from: done.length ? done.reduce((m, s) => (s.opened < m ? s.opened : m), done[0].opened) : null,
  };
}
