// Prowadzenie otwartych pozycji na świecach H4: co zrobić dalej z pozycją.
import { computeIchimoku, computeATR, scoreAt } from './ichimoku.js';

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Tylko zamknięte świece H4 (przedział czterogodzinny już minął). */
export function closedH4(bars, now = new Date()) {
  const nowSec = now.getTime() / 1000;
  return bars.filter((b) => b.ts + 14400 <= nowSec);
}

/**
 * Porada dla pozycji.
 *  pos      – { direction, entry, stop }
 *  d1       – ocena dzienna instrumentu (z analyzeMarket) albo null
 *  h4bars   – zamknięte świece H4
 * Zwraca { action, reason, ... }; action: HOLD | TRAIL | PARTIAL | TIGHTEN | REDUCE | EXIT | NO_DATA.
 */
export function advisePosition(pos, d1, h4bars, settings) {
  const p = settings.ichimoku;
  const need = p.senkou + p.shift;
  if (!h4bars || h4bars.length < need) return { action: 'NO_DATA', reason: 'noH4', bars: h4bars ? h4bars.length : 0, needed: need };
  const ich = computeIchimoku(h4bars, p);
  const i = h4bars.length - 1;
  const s = scoreAt(h4bars, ich, i);
  if (!s) return { action: 'NO_DATA', reason: 'noH4', bars: h4bars.length, needed: need };
  const atr = computeATR(h4bars, p.atr)[i];
  const sign = pos.direction === 'LONG' ? 1 : -1;
  const close = s.close;
  const sd = sign * s.score;                         // wynik H4 widziany od strony pozycji
  const ext = atr ? (sign * (close - s.kijun)) / atr : 0;
  const d1state = !d1 || !d1.ok ? 'UNKNOWN' : d1.dir === pos.direction ? 'WITH' : d1.dir === 'NEUTRAL' ? 'NEUTRAL' : 'AGAINST';

  const hasEntry = pos.entry != null, hasStop = pos.stop != null;
  const pnlPct = hasEntry ? round((sign * (close - pos.entry) / pos.entry) * 100, 2) : null;
  const riskDist = hasEntry && hasStop ? Math.abs(pos.entry - pos.stop) : null;
  const r = riskDist ? round((sign * (close - pos.entry)) / riskDist, 2) : null;
  const stopHit = hasStop && sign * (close - pos.stop) <= 0;
  const belowKijun = sign * (close - s.kijun) < 0;

  let action, reason;
  if (stopHit) { action = 'EXIT'; reason = 'stop'; }
  else if (d1state === 'AGAINST') { action = 'EXIT'; reason = 'd1Reversed'; }
  else if (sd <= -6) { action = d1state === 'WITH' ? 'REDUCE' : 'EXIT'; reason = d1state === 'WITH' ? 'h4Against' : 'h4AgainstNoD1'; }
  else if (belowKijun) { action = 'TIGHTEN'; reason = 'h4KijunLost'; }
  else if (d1state === 'NEUTRAL') { action = 'TIGHTEN'; reason = 'd1Faded'; }
  else if (sd >= 4 && ext > settings.scoring.extMax && (r == null || r >= 1)) { action = 'PARTIAL'; reason = 'h4Extended'; }
  else if (sd >= 4) { action = 'HOLD'; reason = 'trendIntact'; }
  else { action = 'HOLD'; reason = 'h4Neutral'; }

  // Proponowany stop: tylko w stronę zysku i tylko po właściwej stronie ceny.
  let suggestedStop = null;
  if (action !== 'EXIT' && atr) {
    let cand;
    if (action === 'TIGHTEN' || action === 'REDUCE') {
      const recent = h4bars.slice(-6);
      cand = sign > 0 ? Math.min(...recent.map((b) => b.l)) - 0.1 * atr : Math.max(...recent.map((b) => b.h)) + 0.1 * atr;
    } else {
      cand = s.kijun - sign * 0.25 * atr;
    }
    const rightSide = sign * (close - cand) > 0;
    const better = !hasStop || sign * (cand - pos.stop) > 0;
    if (rightSide && better) suggestedStop = cand;
  }
  if (action === 'HOLD' && suggestedStop != null && (r == null ? hasStop : r >= 1)) { action = 'TRAIL'; reason = 'trail'; }

  return {
    action, reason,
    h4Score: s.score, d1: d1state, d1Grade: d1?.ok ? d1.grade : null,
    close, pnlPct, r, ext: round(ext, 2),
    suggestedStop,
    levels: { tenkan: s.tenkan, kijun: s.kijun, cloudTop: s.cloudTop, cloudBottom: s.cloudBottom, atr },
    candle: h4bars[i].ts,
  };
}

/** Kolejność pilności – do sortowania i tonu powiadomień. */
export const ACTION_RANK = { EXIT: 5, REDUCE: 4, TIGHTEN: 3, PARTIAL: 2, TRAIL: 1, HOLD: 0, NO_DATA: 0 };
