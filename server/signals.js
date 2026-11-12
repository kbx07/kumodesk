// Signal tracking: when an instrument got the "green light" (TRADE decision) and how entering
// right after the signal, following the plan, would have ended. Used to measure the algorithm's accuracy.
//
// Rules:
//   entry – after the close of the candle on which the signal appeared (closing price),
//   stop  – the plan's stop on the signal day,
//   end   – a candle breaches the stop (result −1R) or the direction fades or reverses (result at the close),
//   right – the algorithm was right when the trade's result is positive.
import * as db from './db.js';
import { analyzeMarket } from './analysis.js';

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Result in R of a position opened at `entry` with stop `stop`, measured to `price`. */
export function resultR(dir, entry, stop, price) {
  const risk = Math.abs(entry - stop);
  return risk ? ((dir === 'LONG' ? 1 : -1) * (price - entry)) / risk : 0;
}

/**
 * One step of the state machine for one instrument and one new candle.
 *   open – the open signal or null; a – the instrument's analysis on this candle; bar – this candle.
 * Returns { close: {...} | null, open: {...} | null } – what to close and what to open.
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
    // the stop must be on the losing side – otherwise the signal cannot be tracked
    if (a.dir === 'LONG' ? stop < bar.c : stop > bar.c) next = { dir: a.dir, grade: a.grade, entry: bar.c, stop };
  }
  return { close, open: next };
}

let running = false;
export const signalsBusy = () => running;

/**
 * Adds signals for days not processed yet (on first run: the last year).
 * A day is processed only once it has ended (UTC), because by then every market has its candle.
 */
export async function updateSignals({ days = 370, now = new Date() } = {}) {
  if (running) return { skipped: true };
  running = true;
  try {
    // one-off: rebuild the history so the chart arrows (added later) cover the past year too
    if (db.getMeta('marksVersion') !== '2') { db.resetSignals(); db.setMeta('marksVersion', '2'); }
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
    // chart arrows: the direction of yesterday's "trade" recommendation per instrument (null = was not "trade")
    let playState = {};
    try { playState = JSON.parse(db.getMeta('playState') || '{}'); } catch { playState = {}; }
    // funnel stages: the current result of every stage, to notice the candle on which it changes
    const stageState = new Map(db.allStageHist().map((r) => [`${r.instrument_id}|${r.stage}`, r.status]));
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
        if (!a.ok || !bar) continue; // no new candle that day (holiday, weekend)
        const play = a.action === 'PLAY' ? a.dir : null;
        if (play && play !== (playState[a.id] || null)) db.addPlayMark(a.id, d, a.dir, a.grade);
        playState[a.id] = play;
        for (const st of a.funnel || []) {
          const k = `${a.id}|${st.key}`;
          if (stageState.get(k) !== st.status) { db.setStageHist(a.id, st.key, st.status, d); stageState.set(k, st.status); }
        }
        const step = stepSignal(open[a.id] || null, a, bar);
        if (step.close) { db.closeSignal(open[a.id].id, { closed: d, ...step.close }); delete open[a.id]; closed++; }
        if (step.open) { const id = db.openSignal({ instrument_id: a.id, opened: d, ...step.open }); open[a.id] = { id, instrument_id: a.id, opened: d, ...step.open }; opened++; }
      }
      db.setMeta('playState', JSON.stringify(playState));
      db.setMeta('signalsThrough', d);
      await new Promise((r) => setImmediate(r)); // do not block the server while replaying a year
    }
    return { processed: dates.length, opened, closed };
  } finally { running = false; }
}

/** Accuracy statistics from finished signals. */
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
