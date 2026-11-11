// Market layer: builds a picture of the whole market from the Ichimoku scores of single instruments.
// Returns only codes and numbers – texts come from the dictionary (public/i18n.js).
import { computeIchimoku, computeATR, scoreAt, toWeekly, direction } from './ichimoku.js';
import { CURRENCIES, BASKETS } from './defaults.js';
import { isBarClosed } from './timeutil.js';
import { sessionSupport } from './sessions.js';

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const stdev = (a) => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map((x) => (x - m) ** 2))) : 0; };
const GRADE_RANK = { A: 3, B: 2, C: 1, D: 0 };

/** Analysis of a single instrument on D1 and W1. bars = closed candles only. */
export function analyzeInstrument(inst, bars, settings) {
  const p = settings.ichimoku;
  const thr = settings.scoring.dirThreshold;
  const base = { id: inst.id, name: inst.name, class: inst.class, category: inst.category || inst.class, base: inst.base, quote: inst.quote, group_id: inst.group_id };
  const minBars = p.senkou + p.shift;
  if (!bars || bars.length < minBars) {
    return { ...base, ok: false, reason: 'NO_DATA', bars: bars ? bars.length : 0, needed: minBars };
  }
  const ich = computeIchimoku(bars, p);
  const atrArr = computeATR(bars, p.atr);
  const i = bars.length - 1;
  const d1 = scoreAt(bars, ich, i);
  if (!d1) return { ...base, ok: false, reason: 'NO_DATA', bars: bars.length, needed: minBars };

  // score history (for the chart and for counting how many candles the direction has held)
  const history = [];
  for (let j = Math.max(minBars - 1, i - 89); j <= i; j++) {
    const s = scoreAt(bars, ich, j);
    if (s) history.push({ date: bars[j].date, score: s.score });
  }
  const dir = direction(d1.score, thr);
  let held = 0;
  for (let j = history.length - 1; j >= 0; j--) {
    if (direction(history[j].score, thr) === dir) held++; else break;
  }

  const weekly = toWeekly(bars);
  const wIch = computeIchimoku(weekly, p);
  const w1 = scoreAt(weekly, wIch, weekly.length - 1);
  const w1dir = direction(w1?.score, thr);

  let align = 'NONE';
  if (dir !== 'NEUTRAL') align = !w1 || w1dir === 'NEUTRAL' ? 'D1' : w1dir === dir ? 'FULL' : 'CONFLICT';

  const atr = atrArr[i];
  const ext = atr ? (d1.close - d1.kijun) / atr : 0;
  const thick = atr ? (d1.cloudTop - d1.cloudBottom) / atr : 0;
  const prev = bars[i - 1];
  return {
    ...base, ok: true,
    date: bars[i].date,
    close: d1.close,
    changePct: round(((d1.close - prev.c) / prev.c) * 100, 2),
    d1: d1.score, w1: w1 ? w1.score : null,
    dir, w1dir, align,
    components: d1.components.map((c) => ({ key: c.key, weight: c.weight, value: c.value })),
    w1components: w1 ? w1.components.map((c) => ({ key: c.key, weight: c.weight, value: c.value })) : null,
    cloudPos: d1.cloudPos,
    held,
    ext: round(ext, 2), thick: round(thick, 2),
    levels: { tenkan: d1.tenkan, kijun: d1.kijun, cloudTop: d1.cloudTop, cloudBottom: d1.cloudBottom, atr },
    history,
  };
}

/** Whether the setup's direction agrees with the climate (risk-on / risk-off): WITH | AGAINST | NA. */
export function climateFit(a, climate) {
  if (a.dir === 'NEUTRAL' || climate.quality === 'LOW' || (climate.mood !== 'RISK_ON' && climate.mood !== 'RISK_OFF')) return 'NA';
  const bucket = (c) => (BASKETS.CARRY.includes(c) ? 1 : BASKETS.SAFE.includes(c) ? -1 : 0);
  let exposure = 0; // +1 = the instrument rises with risk appetite
  if (a.class === 'fx') exposure = Math.sign(bucket(a.base) - bucket(a.quote));
  else if (a.class === 'index' || a.class === 'stock' || a.class === 'crypto') exposure = 1;
  if (!exposure) return 'NA';
  const want = climate.mood === 'RISK_ON' ? 1 : -1;
  return (a.dir === 'LONG' ? 1 : -1) * exposure * want > 0 ? 'WITH' : 'AGAINST';
}

// A stock should move the same way as its index – its equivalent of currency symmetry.
const STOCK_INDEX = { dax: 'DAX', sp500: 'SPX' };

function gradeSetup(a, strength, settings, climate, indexDir = {}) {
  const sc = settings.scoring;
  if (a.dir === 'NEUTRAL') return { op: round(Math.abs(a.d1) * 0.5, 1), grade: 'D', sym: a.class === 'fx' ? 'WEAK' : 'NA', risk: 'HIGH', over: 'OK', confirmed: false, climateFit: 'NA' };
  const sign = a.dir === 'LONG' ? 1 : -1;
  let op = 0.5 * Math.abs(a.d1);
  if (a.align === 'FULL') op += 0.25 * Math.abs(a.w1);
  else if (a.align === 'CONFLICT') op -= 0.25 * Math.abs(a.w1);
  let sym = 'NA', spread = null;
  if (a.class === 'fx' && strength[a.base] != null && strength[a.quote] != null) {
    const strong = sign * strength[a.base], weak = sign * strength[a.quote];
    spread = strong - weak;
    if (strong >= sc.strongCurrency && weak <= -sc.strongCurrency) { sym = 'CLEAN'; op += 2.5; }
    else if (spread >= sc.strongCurrency * 1.5) { sym = 'MIXED'; op += 1.25; }
    else sym = 'WEAK';
  } else {
    op *= 10 / 7.5; // instruments without currency symmetry: same 0–10 scale
    const idx = a.class === 'stock' ? STOCK_INDEX[a.category] : null;
    if (idx && indexDir[idx]) {
      a.refIndex = idx;
      sym = indexDir[idx] === a.dir ? 'CLEAN' : indexDir[idx] === 'NEUTRAL' ? 'MIXED' : 'WEAK';
    }
  }
  const absExt = Math.abs(a.ext);
  const stretched = sign * a.ext > 0; // stretched in the signal's direction
  let over = 'OK';
  if (stretched && absExt > sc.extMax) { over = 'HOT'; op -= 2; }
  else if (stretched && absExt > sc.extWarn) { over = 'WARM'; op -= 1; }
  op = Math.max(0, Math.min(10, op));

  let risk = 'MED';
  if (a.align === 'CONFLICT' || over === 'HOT' || a.cloudPos === 0) risk = 'HIGH';
  else if (a.align === 'FULL' && over === 'OK' && a.thick >= 0.5) risk = 'LOW';

  // Grade A needs every confirmation: W1 agrees, price on the right side of the cloud,
  // Chikou confirms, clean symmetry (FX), not overextended.
  const chikou = a.components.find((c) => c.key === 'chikou')?.value ?? 0;
  const confirmed = a.cloudPos === sign && chikou === sign;
  let grade = 'D';
  if (op >= 8 && a.align === 'FULL' && confirmed && (sym === 'CLEAN' || sym === 'NA') && over === 'OK') grade = 'A';
  else if (op >= 6.5 && a.align !== 'CONFLICT') grade = 'B';
  else if (op >= 5) grade = 'C';
  // Weak symmetry: the pair has no backing in the currency basket – watch at most.
  if (sym === 'WEAK' && (grade === 'A' || grade === 'B')) grade = 'C';
  // A trade against the climate cannot be a primary setup.
  const fit = climateFit(a, climate);
  if (fit === 'AGAINST' && grade === 'A') grade = 'B';

  return { op: round(op, 1), grade, sym, spread: round(spread, 1), risk, over, confirmed, climateFit: fit };
}

function buildPlan(a, g) {
  if (a.dir === 'NEUTRAL') return { code: 'plan.neutral', params: {} };
  const L = a.levels, long = a.dir === 'LONG';
  const stop = long ? L.kijun - 0.5 * L.atr : L.kijun + 0.5 * L.atr;
  const params = {
    tenkan: L.tenkan, kijun: L.kijun, stop,
    cloud: long ? L.cloudTop : L.cloudBottom,
    ext: Math.abs(a.ext),
  };
  const side = long ? 'long' : 'short';
  if (g.grade === 'D') return { code: `plan.${side}.weak`, params };
  if (g.over !== 'OK') return { code: `plan.${side}.pullback`, params };
  if (a.align === 'CONFLICT') return { code: `plan.${side}.conflict`, params };
  return { code: `plan.${side}.continuation`, params };
}

function portfolioState(positions, byId, settings) {
  const lim = settings.risk;
  const exposure = {};
  let total = 0;
  const threats = [];
  const rows = positions.map((pos) => {
    const a = byId[pos.instrument_id];
    const sign = pos.direction === 'LONG' ? 1 : -1;
    total += pos.risk_pct;
    if (a && a.class === 'fx') {
      exposure[a.base] = (exposure[a.base] || 0) + sign * pos.risk_pct;
      exposure[a.quote] = (exposure[a.quote] || 0) - sign * pos.risk_pct;
    }
    let status = 'OK';
    if (!a || !a.ok) status = 'NO_DATA';
    else if (a.dir === 'NEUTRAL') status = 'FADED';
    else if (a.dir !== pos.direction) status = 'REVERSED';
    else if (a.grade === 'D') status = 'WEAK';
    const stopHit = a?.ok && pos.stop != null && (sign > 0 ? a.close <= pos.stop : a.close >= pos.stop);
    if (stopHit) threats.push({ code: 'threat.stop', level: 'HIGH', instrument_id: pos.instrument_id, params: { id: pos.instrument_id } });
    if (status === 'REVERSED') threats.push({ code: 'threat.reversed', level: 'HIGH', instrument_id: pos.instrument_id, params: { id: pos.instrument_id, dir: pos.direction } });
    if (status === 'FADED') threats.push({ code: 'threat.faded', level: 'MED', instrument_id: pos.instrument_id, params: { id: pos.instrument_id } });
    if (pos.risk_pct > lim.maxPosition) threats.push({ code: 'threat.position', level: 'MED', instrument_id: pos.instrument_id, params: { id: pos.instrument_id, risk: pos.risk_pct, limit: lim.maxPosition } });
    return { ...pos, status, stopHit: !!stopHit, signalDir: a?.dir ?? null, signalGrade: a?.grade ?? null, close: a?.close ?? null };
  });
  let state = 'OK';
  const bump = (s) => { if (s === 'BLOCK' || (s === 'CAUTION' && state === 'OK')) state = s; };
  if (total >= lim.maxTotal) { bump('BLOCK'); threats.push({ code: 'threat.total', level: 'HIGH', params: { risk: round(total, 2), limit: lim.maxTotal } }); }
  else if (total >= 0.7 * lim.maxTotal) bump('CAUTION');
  for (const [cur, v] of Object.entries(exposure)) {
    const av = Math.abs(v);
    if (av >= lim.maxCurrency) { bump('BLOCK'); threats.push({ code: 'threat.currency', level: 'HIGH', params: { cur, risk: round(v, 2), limit: lim.maxCurrency } }); }
    else if (av >= 0.7 * lim.maxCurrency) { bump('CAUTION'); threats.push({ code: 'threat.currencyNear', level: 'MED', params: { cur, risk: round(v, 2), limit: lim.maxCurrency } }); }
  }
  if (threats.some((t) => t.level === 'HIGH')) bump('CAUTION');
  for (const k of Object.keys(exposure)) exposure[k] = round(exposure[k], 2);
  return { state, total: round(total, 2), exposure, positions: rows, threats, limits: lim };
}

/**
 * Main function: instruments = list from the database, candlesById = {id: bars},
 * groupsById = {id: group}. Only closed candles are analysed.
 */
export function analyzeMarket({ instruments, candlesById, groupsById, positions, settings, sessions = null, now = new Date() }) {
  const items = [];
  for (const inst of instruments) {
    if (!inst.enabled) continue;
    let bars = candlesById[inst.id] || [];
    const g = groupsById[inst.group_id];
    if (g && bars.length && !isBarClosed(bars[bars.length - 1].date, g, now)) bars = bars.slice(0, -1);
    items.push(analyzeInstrument(inst, bars, settings));
  }
  const ok = items.filter((x) => x.ok);
  const fx = ok.filter((x) => x.class === 'fx');
  // The market picture (structure, alignment, Matrix) is calculated from currencies, metals and indices.
  // Single stocks get their own grades but do not change the market-wide rating.
  const single = (x) => x.class === 'stock' || x.class === 'etf' || x.class === 'crypto';
  const hasMacro = ok.some((x) => !single(x));
  const macro = hasMacro ? ok.filter((x) => !single(x)) : ok;

  // --- currency strength ---
  const acc = {};
  for (const a of fx) {
    (acc[a.base] ||= []).push(a.d1);
    (acc[a.quote] ||= []).push(-a.d1);
  }
  const strength = {};
  for (const c of Object.keys(acc)) strength[c] = round(mean(acc[c]), 1);
  const strengthList = Object.entries(strength)
    .map(([currency, value]) => ({ currency, value, pairs: acc[currency].length }))
    .sort((x, y) => y.value - x.value);

  // --- regime (from FX; without FX – from the whole market) ---
  const pool = fx.length >= 6 ? fx : macro;
  const trendShare = pool.length ? pool.filter((a) => Math.abs(a.d1) >= 7).length / pool.length : 0;
  const neutralShare = pool.length ? pool.filter((a) => a.dir === 'NEUTRAL').length / pool.length : 1;
  const dispersion = stdev(strengthList.map((s) => s.value));
  let regime = 'ROTATIONAL';
  if (trendShare >= 0.45 && (fx.length < 6 || dispersion >= 3.5)) regime = 'TREND';
  else if (trendShare < 0.2 && neutralShare >= 0.5) regime = 'RANGE';

  // --- climate (currency baskets + indices) ---
  const basket = {};
  for (const [k, list] of Object.entries(BASKETS)) {
    const vals = list.map((c) => strength[c]).filter((v) => v != null);
    basket[k] = vals.length ? round(mean(vals), 1) : null;
  }
  const idx = ok.filter((x) => x.class === 'index');
  const idxAvg = idx.length ? round(mean(idx.map((x) => x.d1)), 1) : null;
  const haveBaskets = basket.SAFE != null && basket.CARRY != null;
  const appetite = haveBaskets ? round(basket.CARRY - basket.SAFE, 1) : null;
  let dominant = null, mood = 'MIXED', quality = 'LOW';
  if (haveBaskets) {
    dominant = Object.entries(basket).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1])[0][0];
    const agree = idxAvg == null || Math.sign(idxAvg) === Math.sign(appetite) || Math.abs(idxAvg) < 2;
    if (Math.abs(appetite) >= 2) mood = appetite > 0 ? 'RISK_ON' : 'RISK_OFF';
    if (Math.abs(appetite) >= 5 && agree) quality = 'HIGH';
    else if (Math.abs(appetite) >= 2.5) quality = 'MEDIUM';
    if (!agree && mood !== 'MIXED') mood = 'DIVERGENT';
  } else if (idxAvg != null) {
    mood = idxAvg >= 3 ? 'RISK_ON' : idxAvg <= -3 ? 'RISK_OFF' : 'MIXED';
    quality = Math.abs(idxAvg) >= 6 ? 'HIGH' : Math.abs(idxAvg) >= 3 ? 'MEDIUM' : 'LOW';
  }
  const climate = { basket, dominant, appetite, indices: idxAvg, mood, quality };

  // --- setup grades ---
  const indexDir = Object.fromEntries(ok.filter((x) => x.class === 'index').map((x) => [x.id, x.dir]));
  for (const a of ok) Object.assign(a, gradeSetup(a, strength, settings, climate, indexDir));

  // --- structure quality ---
  const cls = (a) => (a.dir !== 'NEUTRAL' && a.align === 'FULL' && a.cloudPos !== 0 ? 'CLEAN'
    : a.dir === 'NEUTRAL' || a.align === 'CONFLICT' ? 'WEAK' : 'MIXED');
  const counts = { CLEAN: 0, MIXED: 0, WEAK: 0 };
  for (const a of ok) a.structure = cls(a);
  for (const a of macro) counts[a.structure]++;
  const n = macro.length || 1;
  const structure = {
    clean: round((counts.CLEAN / n) * 100, 1), mixed: round((counts.MIXED / n) * 100, 1), weak: round((counts.WEAK / n) * 100, 1),
    quality: round((10 * (counts.CLEAN + 0.5 * counts.MIXED)) / n, 1),
  };

  // --- portfolio ---
  const byId = Object.fromEntries(items.map((a) => [a.id, a]));
  const portfolio = portfolioState(positions || [], byId, settings);

  // --- Matrix Score ---
  const nA = macro.filter((a) => a.grade === 'A').length, nB = macro.filter((a) => a.grade === 'B').length;
  const parts = {
    structure: round((structure.quality / 10) * 35, 1),
    trend: round(Math.min(1, (fx.length >= 6 ? dispersion / 5 : trendShare * 1.5)) * 20, 1),
    setups: round(Math.min(1, (nA + 0.5 * nB) / 4) * 20, 1),
    climate: { HIGH: 15, MEDIUM: 9, LOW: 3 }[climate.quality],
    portfolio: { OK: 10, CAUTION: 5, BLOCK: 0 }[portfolio.state],
  };
  const matrix = ok.length ? Math.round(Object.values(parts).reduce((s, x) => s + x, 0)) : 0;
  let exec = matrix >= 70 ? 'OFFENSIVE' : matrix >= 45 ? 'SELECTIVE' : 'DEFENSIVE';
  let mode = exec === 'OFFENSIVE' ? 'ATTACK' : exec === 'SELECTIVE' ? 'SELECTIVE' : 'PROTECT';
  if (portfolio.state === 'BLOCK') { exec = 'DEFENSIVE'; mode = 'PROTECT'; }

  // --- decisions and plan ---
  for (const a of ok) {
    a.action = a.grade === 'A' ? 'PLAY' : a.grade === 'B' ? (exec === 'DEFENSIVE' ? 'WATCH' : 'PLAY') : a.grade === 'C' ? 'WATCH' : 'WAIT';
    if (portfolio.state === 'BLOCK' && a.action === 'PLAY') a.action = 'WATCH';
    a.plan = buildPlan(a, a);
    // concentration warning: a new position would deepen existing exposure
    a.concentration = null;
    if (a.class === 'fx' && a.dir !== 'NEUTRAL') {
      const s = a.dir === 'LONG' ? 1 : -1;
      const lim = settings.risk.maxCurrency * 0.7;
      if (s * (portfolio.exposure[a.base] || 0) >= lim) a.concentration = a.base;
      else if (-s * (portfolio.exposure[a.quote] || 0) >= lim) a.concentration = a.quote;
    }
    a.inPortfolio = portfolio.positions.some((p) => p.instrument_id === a.id);
  }
  // ranking: grade, opportunity, W1 strength, symmetry, and on a tie closer to Kijun (better reward to risk)
  const ranked = ok.filter((a) => a.dir !== 'NEUTRAL').sort((x, y) =>
    GRADE_RANK[y.grade] - GRADE_RANK[x.grade] || y.op - x.op || Math.abs(y.d1) - Math.abs(x.d1) || Math.abs(y.w1 ?? 0) - Math.abs(x.w1 ?? 0) ||
    (y.spread ?? 0) - (x.spread ?? 0) || Math.abs(x.ext) - Math.abs(y.ext) || x.id.localeCompare(y.id));
  // correlation: a weaker setup trading the same currency in the same direction as a better one
  const legs = {};
  for (const a of ranked) {
    a.correlated = null;
    if (a.class !== 'fx' || a.grade === 'D') continue;
    const s = a.dir === 'LONG' ? 1 : -1;
    for (const [cur, side] of [[a.base, s], [a.quote, -s]]) {
      const key = `${cur}:${side}`;
      if (legs[key] && !a.correlated) a.correlated = { with: legs[key], cur };
    }
    for (const [cur, side] of [[a.base, s], [a.quote, -s]]) legs[`${cur}:${side}`] ||= a.id;
  }
  const primary = ranked.find((a) => a.grade !== 'D') || null;

  // --- funnel: each instrument's path through the stages ---
  for (const a of items) {
    a.funnel = buildFunnel(a, { climate, portfolio, exec, sessions });
    a.failedAt = a.funnel.find((s) => s.status === 'FAIL')?.key ?? null;
  }
  let alive = items.length;
  const funnel = FUNNEL_STAGES.map((key, i) => {
    const entered = alive;
    alive = items.filter((a) => !a.funnel.slice(0, i + 1).some((s) => s.status === 'FAIL')).length;
    return { key, in: entered, out: alive, dropped: entered - alive, warned: items.filter((a) => a.funnel[i].status === 'WARN' && !a.funnel.slice(0, i + 1).some((s) => s.status === 'FAIL')).length };
  });

  // --- market alignment and symmetry (header tiles) ---
  const directional = macro.filter((a) => a.dir !== 'NEUTRAL');
  const alignShare = directional.length ? directional.filter((a) => a.align === 'FULL').length / directional.length : 0;
  const conflictShare = directional.length ? directional.filter((a) => a.align === 'CONFLICT').length / directional.length : 0;
  const tfState = alignShare >= 0.6 ? 'ALIGNED' : conflictShare >= 0.4 ? 'CONFLICT' : 'PARTIAL';
  const fxDir = fx.filter((a) => a.dir !== 'NEUTRAL');
  const cleanShare = fxDir.length ? fxDir.filter((a) => a.sym === 'CLEAN').length / fxDir.length : 0;
  const symState = !fxDir.length ? 'NA' : cleanShare >= 0.5 ? 'CLEAN' : cleanShare >= 0.2 ? 'MIXED' : 'WEAK';

  // --- notes ---
  const notes = [];
  notes.push({ code: `note.regime.${regime}`, params: { trend: Math.round(trendShare * 100), disp: round(dispersion, 1) } });
  if (strengthList.length >= 2) notes.push({ code: 'note.strength', params: { strong: strengthList[0].currency, sv: strengthList[0].value, weak: strengthList.at(-1).currency, wv: strengthList.at(-1).value } });
  notes.push({ code: `note.mood.${climate.mood}`, params: { appetite: climate.appetite, indices: idxAvg } });
  notes.push({ code: `note.exec.${exec}`, params: { a: nA, b: nB } });
  if (portfolio.state !== 'OK') notes.push({ code: `note.portfolio.${portfolio.state}`, params: { total: portfolio.total, limit: settings.risk.maxTotal } });
  const failed = items.filter((x) => !x.ok);
  if (failed.length) notes.push({ code: 'note.nodata', params: { n: failed.length, list: failed.slice(0, 6).map((x) => x.id).join(', ') } });

  return {
    generatedAt: now.toISOString(),
    empty: ok.length === 0,
    regime: { state: regime, trendShare: round(trendShare * 100, 0), neutralShare: round(neutralShare * 100, 0), dispersion: round(dispersion, 1) },
    climate, structure,
    tf: { state: tfState, aligned: round(alignShare * 100, 0), conflict: round(conflictShare * 100, 0) },
    symmetry: { state: symState, clean: round(cleanShare * 100, 0) },
    portfolio,
    matrix: { score: matrix, parts },
    exec, mode,
    counts: { total: items.length, analyzed: ok.length, A: nA, B: nB, C: macro.filter((a) => a.grade === 'C').length },
    strength: strengthList,
    primary: primary ? primary.id : null,
    ranking: ranked.map((a) => a.id),
    funnel,
    sessions: sessions ? { sessions: sessions.sessions.map(({ moves, ...s }) => s), order: sessions.order, summary: sessions.summary } : null,
    instruments: items,
    notes,
  };
}

export const FUNNEL_STAGES = ['input', 'sessions', 'climate', 'selection', 'symmetry', 'synthesis', 'portfolio', 'matrix', 'decision'];

/**
 * Nine stages from data to decision. Each stage: PASS | WARN | FAIL | NA + a reason code.
 * FAIL at any stage means the instrument does not reach the "trade" decision.
 */
function buildFunnel(a, { climate, portfolio, exec, sessions }) {
  const st = (key, status, code, params = {}) => ({ key, status, code: code === 'skipped' ? 'funnel.skipped' : `funnel.${key}.${code}`, params });
  if (!a.ok) {
    return FUNNEL_STAGES.map((k) => (k === 'input' ? st(k, 'FAIL', 'nodata', { bars: a.bars, needed: a.needed }) : st(k, 'NA', 'skipped')));
  }
  const out = [st('input', 'PASS', 'ok', { date: a.date })];

  const sup = a.class === 'fx' ? sessionSupport(sessions, a.id, a.dir) : null;
  a.sessionSupport = sup;
  if (!sup) out.push(st('sessions', 'NA', a.class === 'fx' ? 'nodata' : 'na'));
  else out.push(st('sessions', sup.agree * 2 > sup.total ? 'PASS' : 'WARN', sup.agree * 2 > sup.total ? 'with' : 'against', sup));

  if (a.climateFit === 'NA') out.push(st('climate', 'NA', a.dir === 'NEUTRAL' ? 'skipped' : 'neutral', { mood: climate.mood }));
  else out.push(st('climate', a.climateFit === 'WITH' ? 'PASS' : 'WARN', a.climateFit === 'WITH' ? 'with' : 'against', { mood: climate.mood }));

  if (a.dir === 'NEUTRAL') out.push(st('selection', 'FAIL', 'neutral', { score: a.d1 }));
  else if (a.align === 'CONFLICT') out.push(st('selection', 'FAIL', 'conflict', { d1: a.d1, w1: a.w1 }));
  else if (!a.confirmed) out.push(st('selection', 'WARN', 'unconfirmed', { score: a.d1 }));
  else if (a.align !== 'FULL') out.push(st('selection', 'WARN', 'd1only', { score: a.d1 }));
  else out.push(st('selection', 'PASS', 'ok', { d1: a.d1, w1: a.w1 }));

  if (a.sym === 'NA') out.push(st('symmetry', 'NA', 'na'));
  else out.push(st('symmetry', a.sym === 'CLEAN' ? 'PASS' : a.sym === 'MIXED' ? 'WARN' : 'FAIL', (a.refIndex ? 'stock' : '') + a.sym.toLowerCase(), { base: a.base, quote: a.quote, spread: a.spread, index: a.refIndex }));

  const synth = a.op >= 8 && a.over === 'OK' ? 'PASS' : a.op >= 6.5 ? 'WARN' : 'FAIL';
  out.push(st('synthesis', synth, a.over !== 'OK' && synth !== 'FAIL' ? 'stretched' : synth === 'PASS' ? 'ok' : synth === 'WARN' ? 'conditional' : 'weak', { op: a.op, ext: Math.abs(a.ext) }));

  if (portfolio.state === 'BLOCK') out.push(st('portfolio', 'FAIL', 'blocked'));
  else if (a.concentration) out.push(st('portfolio', 'WARN', 'concentration', { cur: a.concentration }));
  else if (a.correlated) out.push(st('portfolio', 'WARN', 'correlated', a.correlated));
  else if (a.inPortfolio) out.push(st('portfolio', 'WARN', 'held'));
  else out.push(st('portfolio', 'PASS', 'ok'));

  if (exec === 'DEFENSIVE' && a.grade !== 'A') out.push(st('matrix', 'FAIL', 'defensive'));
  else if (exec === 'DEFENSIVE' || (exec === 'SELECTIVE' && a.grade !== 'A')) out.push(st('matrix', 'WARN', exec === 'DEFENSIVE' ? 'defensiveA' : 'selective'));
  else out.push(st('matrix', 'PASS', exec === 'OFFENSIVE' ? 'offensive' : 'selectiveA'));

  out.push(st('decision', a.action === 'PLAY' ? 'PASS' : 'FAIL', a.action.toLowerCase(), { grade: a.grade }));
  return out;
}

/** Compact state for snapshots and comparisons (alerts). */
export function summarize(m) {
  const grades = {};
  for (const a of m.instruments) if (a.ok) grades[a.id] = { g: a.grade, d: a.dir, op: a.op, s: a.d1, grp: a.group_id };
  return {
    regime: m.regime.state, exec: m.exec, matrix: m.matrix.score, mood: m.climate.mood,
    portfolio: m.portfolio.state, primary: m.primary, grades,
    threats: m.portfolio.threats.map((t) => `${t.code}:${t.instrument_id || t.params.cur || ''}`),
    strength: Object.fromEntries(m.strength.map((s) => [s.currency, s.value])),
  };
}

/** Differences between snapshots -> alerts (codes). groupId limits setup alerts to a group. */
export function diffAlerts(prev, cur, { minGrade = 'B', groupId = null } = {}) {
  const out = [];
  if (!prev) return out;
  const min = GRADE_RANK[minGrade] ?? 2;
  if (prev.regime !== cur.regime) out.push({ type: 'REGIME', severity: 'MED', code: 'alert.regime', params: { from: prev.regime, to: cur.regime } });
  if (prev.exec !== cur.exec) out.push({ type: 'EXEC', severity: 'MED', code: 'alert.exec', params: { from: prev.exec, to: cur.exec, matrix: cur.matrix } });
  for (const [id, c] of Object.entries(cur.grades)) {
    if (groupId != null && c.grp !== groupId) continue;
    const p = prev.grades?.[id];
    const was = p && GRADE_RANK[p.g] >= min && p.d !== 'NEUTRAL';
    const is = GRADE_RANK[c.g] >= min && c.d !== 'NEUTRAL';
    if (is && (!was || p.d !== c.d)) out.push({ type: 'NEW_SETUP', severity: c.g === 'A' ? 'HIGH' : 'MED', instrument_id: id, code: 'alert.newSetup', params: { id, dir: c.d, grade: c.g, op: c.op } });
    else if (is && was && GRADE_RANK[c.g] > GRADE_RANK[p.g]) out.push({ type: 'UPGRADE', severity: 'MED', instrument_id: id, code: 'alert.upgrade', params: { id, dir: c.d, from: p.g, grade: c.g } });
    else if (was && !is) out.push({ type: 'SETUP_LOST', severity: 'LOW', instrument_id: id, code: 'alert.lost', params: { id, dir: p.d, from: p.g, grade: c.g } });
  }
  const before = new Set(prev.threats || []);
  for (const t of cur.threats || []) {
    if (before.has(t)) continue;
    const [code, subject] = t.split(':');
    if (code === 'threat.reversed' || code === 'threat.stop' || code === 'threat.faded') {
      out.push({ type: 'POSITION', severity: code === 'threat.faded' ? 'MED' : 'HIGH', instrument_id: subject, code: `alert.${code.split('.')[1]}`, params: { id: subject } });
    }
  }
  return out;
}

export { CURRENCIES };
