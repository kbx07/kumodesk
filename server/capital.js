// Kapitał i historia zagrań: wynik w R, wynik w pieniądzu, krzywa kapitału, statystyki.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Wynik zagrania w jednostkach ryzyka (R) albo null, gdy brakuje wejścia lub stopu. */
export function tradeR(direction, entry, stop, exit) {
  if (entry == null || stop == null || exit == null) return null;
  const risk = Math.abs(entry - stop);
  if (!risk) return null;
  return ((direction === 'LONG' ? 1 : -1) * (exit - entry)) / risk;
}

/**
 * Składa historię: każde zagranie dostaje wynik pieniężny liczony od kapitału
 * sprzed tego zagrania (procent składany). Zagranie z ręcznie wpisanym wynikiem
 * (pnl_manual) używa tej kwoty wprost.
 * trades: [{ id, instrument_id, direction, risk_pct, entry, stop_initial, exit, opened, closed, r, pnl_manual }]
 */
export function buildLedger(trades, startCapital) {
  const start = Number(startCapital) > 0 ? Number(startCapital) : 0;
  const sorted = [...trades].sort((a, b) => (a.closed === b.closed ? a.id - b.id : a.closed < b.closed ? -1 : 1));
  let equity = start, peak = start, maxDd = 0;
  const rows = [], curve = [{ date: null, equity: start }];
  for (const t of sorted) {
    const before = equity;
    const pnl = t.pnl_manual != null ? t.pnl_manual : t.r != null ? (before * (t.risk_pct / 100)) * t.r : 0;
    equity = before + pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
    rows.push({ ...t, pnl: round(pnl, 2), pnlPct: before > 0 ? round((pnl / before) * 100, 2) : null, equity: round(equity, 2) });
    curve.push({ date: t.closed, equity: round(equity, 2), id: t.id });
  }
  const n = rows.length;
  const wins = rows.filter((r) => r.pnl > 0), losses = rows.filter((r) => r.pnl < 0);
  const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
  const gross = sum(wins, (r) => r.pnl), lost = -sum(losses, (r) => r.pnl);
  const withR = rows.filter((r) => r.r != null);
  const byInstrument = {};
  for (const r of rows) {
    const b = (byInstrument[r.instrument_id] ||= { id: r.instrument_id, pnl: 0, trades: 0 });
    b.pnl += r.pnl; b.trades++;
  }
  const stats = {
    start, equity: round(equity, 2),
    profit: round(equity - start, 2),
    returnPct: start > 0 ? round(((equity - start) / start) * 100, 2) : null,
    trades: n, wins: wins.length, losses: losses.length,
    winRate: n ? round((wins.length / n) * 100, 1) : null,
    avgPnl: n ? round((equity - start) / n, 2) : null,
    avgR: withR.length ? round(sum(withR, (r) => r.r) / withR.length, 2) : null,
    avgWin: wins.length ? round(gross / wins.length, 2) : null,
    avgLoss: losses.length ? round(-lost / losses.length, 2) : null,
    best: n ? round(Math.max(...rows.map((r) => r.pnl)), 2) : null,
    worst: n ? round(Math.min(...rows.map((r) => r.pnl)), 2) : null,
    profitFactor: lost > 0 ? round(gross / lost, 2) : null,
    maxDrawdownPct: round(maxDd, 2),
  };
  return {
    stats, curve, trades: rows,
    byInstrument: Object.values(byInstrument).map((b) => ({ ...b, pnl: round(b.pnl, 2) })).sort((a, b) => b.pnl - a.pnl),
  };
}
