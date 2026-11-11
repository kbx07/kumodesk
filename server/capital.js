// Capital and trade history: result in R, result in money, equity curve, statistics.

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Trade result in risk units (R), or null when entry or stop is missing. */
export function tradeR(direction, entry, stop, exit) {
  if (entry == null || stop == null || exit == null) return null;
  const risk = Math.abs(entry - stop);
  if (!risk) return null;
  return ((direction === 'LONG' ? 1 : -1) * (exit - entry)) / risk;
}

/**
 * Builds the ledger: each trade gets a money result calculated from the capital
 * before that trade (compounding). A trade with a hand-entered result
 * (pnl_manual) uses that amount directly.
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
