// Pluggable sources of daily OHLC data.
// Each source: fetchDaily(symbol, { years, settings }) -> [{date:'YYYY-MM-DD', o,h,l,c,v}] ascending.

// Honest client identifier – the app does not pretend to be a browser.
const UA = 'kumodesk/1.0';

async function http(url, { timeout = 25000, accept = '*/*' } = {}) {
  // On a 429 response (rate limit) wait and retry – at most 3 attempts.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 5000 : 15000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.trim().slice(0, 160)}`);
    return text;
  }
}

// Simple throttle: a minimum gap between requests to a given source.
const lastCall = new Map();
async function throttle(name, gapMs) {
  const now = Date.now();
  const next = Math.max(now, (lastCall.get(name) || 0) + gapMs);
  lastCall.set(name, next);
  if (next > now) await new Promise((r) => setTimeout(r, next - now));
}

async function yahooChart(symbol, query) {
  await throttle('yahoo', 800);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${query}&includePrePost=false`;
  const json = JSON.parse(await http(url, { accept: 'application/json' }));
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || 'no data for symbol');
  const q = r.indicators?.quote?.[0] || {};
  const rows = [];
  (r.timestamp || []).forEach((ts, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) return;
    rows.push({ ts, o, h, l, c, v: q.volume?.[i] ?? null });
  });
  return { rows, meta: r.meta || {} };
}

/** Hourly candles without the live quote appended at the end (its timestamp is off the grid). */
async function yahooHourly(symbol, range) {
  const { rows, meta } = await yahooChart(symbol, `range=${range}&interval=1h`);
  while (rows.length && rows.at(-1).ts % 1800 !== 0) rows.pop();
  return { rows, meta };
}

/**
 * For some instruments (currencies) Yahoo reports a daily close equal to the open.
 * The market is continuous, so the real close of a day is the next day's open; the last candle
 * gets the current price. The repair applies only when the defect is visible in the data.
 */
export function repairFlatCloses(bars, lastPrice) {
  const sample = bars.slice(-120).filter((b) => b.h > b.l);
  if (sample.length < 20) return bars;
  const ratios = sample.map((b) => Math.abs(b.c - b.o) / (b.h - b.l)).sort((x, y) => x - y);
  if (ratios[Math.floor(ratios.length / 2)] >= 0.12) return bars; // healthy data: median body ratio ~0.4–0.5
  return bars.map((b, i) => {
    const c = i < bars.length - 1 ? bars[i + 1].o : (Number.isFinite(lastPrice) ? lastPrice : b.c);
    return { ...b, c, h: Math.max(b.h, c), l: Math.min(b.l, c) };
  });
}

/** Builds fixed-step candles (seconds) from finer ones; key = start of the UTC bucket. */
export function aggregateBars(rows, stepSec) {
  const out = [];
  let cur = null;
  for (const r of rows) {
    const key = Math.floor(r.ts / stepSec) * stepSec;
    if (!cur || cur.ts !== key) { cur = { ts: key, o: r.o, h: r.h, l: r.l, c: r.c }; out.push(cur); }
    else { if (r.h > cur.h) cur.h = r.h; if (r.l < cur.l) cur.l = r.l; cur.c = r.c; }
  }
  return out;
}

const yahoo = {
  id: 'yahoo',
  name: 'Yahoo Finance',
  needsKey: false,
  async fetchDaily(symbol, { years = 3 } = {}) {
    const range = years <= 1 ? '1y' : years <= 2 ? '2y' : years <= 5 ? '5y' : '10y';
    const { rows, meta } = await yahooChart(symbol, `range=${range}&interval=1d`);
    const off = meta.gmtoffset || 0;
    const day = (ts) => new Date((ts + off) * 1000).toISOString().slice(0, 10);
    if (rows.length >= 30) {
      const bars = rows.map((r) => ({ date: day(r.ts), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }));
      return repairFlatCloses(bars, meta.regularMarketPrice);
    }
    // No daily history (e.g. WIG20): build days from hourly data (up to 2 years back).
    const hourly = await yahooHourly(symbol, '730d');
    const byDay = new Map();
    for (const r of hourly.rows) {
      const d = day(r.ts), cur = byDay.get(d);
      if (!cur) byDay.set(d, { date: d, o: r.o, h: r.h, l: r.l, c: r.c, v: null });
      else { if (r.h > cur.h) cur.h = r.h; if (r.l < cur.l) cur.l = r.l; cur.c = r.c; }
    }
    return [...byDay.values()];
  },
  /** Hourly candles of the last few days (session analysis). */
  async fetchH1(symbol) {
    const { rows } = await yahooHourly(symbol, '5d');
    return rows.map((r) => ({ ts: r.ts - (r.ts % 3600), o: r.o, h: r.h, l: r.l, c: r.c }));
  },
  /** Current price of the instrument. */
  async fetchQuote(symbol) {
    const { rows, meta } = await yahooChart(symbol, 'range=1d&interval=1d');
    const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : rows.at(-1)?.c;
    if (!Number.isFinite(price)) throw new Error('no quote');
    return { price, time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null };
  },
  /** 4-hour candles built from hourly ones (Yahoo's ready-made 4h bars have wrong opens). */
  async fetchH4(symbol) {
    const { rows } = await yahooHourly(symbol, '6mo');
    return aggregateBars(rows, 14400);
  },
};

const twelvedata = {
  id: 'twelvedata',
  name: 'Twelve Data',
  needsKey: true,
  async fetchDaily(symbol, { years = 3, settings } = {}) {
    const key = settings?.data?.twelvedataKey;
    if (!key) throw new Error('Twelve Data API key missing');
    await throttle('twelvedata', 8000);
    const size = Math.min(5000, Math.ceil(years * 262));
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${size}&apikey=${encodeURIComponent(key)}`;
    const json = JSON.parse(await http(url, { accept: 'application/json' }));
    if (json.status !== 'ok') throw new Error(json.message || 'Twelve Data error');
    return json.values.map((v) => ({
      date: v.datetime.slice(0, 10), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: v.volume != null ? +v.volume : null,
    })).reverse();
  },
  async fetchQuote(symbol, { settings } = {}) {
    const key = settings?.data?.twelvedataKey;
    if (!key) throw new Error('Twelve Data API key missing');
    await throttle('twelvedata', 8000);
    const json = JSON.parse(await http(`https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, { accept: 'application/json' }));
    const price = Number(json.price);
    if (!Number.isFinite(price)) throw new Error(json.message || 'no quote');
    return { price, time: new Date().toISOString() };
  },
  async fetchH4(symbol, { settings } = {}) {
    const key = settings?.data?.twelvedataKey;
    if (!key) throw new Error('Twelve Data API key missing');
    await throttle('twelvedata', 8000);
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=4h&outputsize=400&timezone=UTC&apikey=${encodeURIComponent(key)}`;
    const json = JSON.parse(await http(url, { accept: 'application/json' }));
    if (json.status !== 'ok') throw new Error(json.message || 'Twelve Data error');
    return json.values.map((v) => ({ ts: Math.floor(Date.parse(v.datetime.replace(' ', 'T') + 'Z') / 1000), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).reverse();
  },
};

const stooq = {
  id: 'stooq',
  name: 'Stooq',
  needsKey: false,
  async fetchDaily(symbol, { years = 3, settings } = {}) {
    await throttle('stooq', 1200);
    const d2 = new Date(), d1 = new Date(Date.now() - years * 366 * 86400000);
    const f = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
    const key = settings?.data?.stooqKey ? `&apikey=${encodeURIComponent(settings.data.stooqKey)}` : '';
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&d1=${f(d1)}&d2=${f(d2)}&i=d${key}`;
    const text = await http(url, { accept: 'text/csv' });
    const lines = text.trim().split(/\r?\n/);
    if (!/^date,open,high,low,close/i.test(lines[0] || '')) throw new Error(`Stooq: ${lines[0]?.slice(0, 120) || 'empty response'}`);
    const out = [];
    for (const line of lines.slice(1)) {
      const [date, o, h, l, c, v] = line.split(',');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const bar = { date, o: +o, h: +h, l: +l, c: +c, v: v ? +v : null };
      if ([bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)) out.push(bar);
    }
    return out;
  },
};

// Finnhub: live quotes (free or paid key). No daily candles on the free plan,
// so it serves only as a live price source.
const finnhub = {
  id: 'finnhub',
  name: 'Finnhub',
  needsKey: true,
  liveOnly: true,
  async fetchQuote(symbol, { settings } = {}) {
    const key = settings?.data?.finnhubKey;
    if (!key) throw new Error('Finnhub API key missing');
    await throttle('finnhub', 1100);
    const json = JSON.parse(await http(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`, { accept: 'application/json' }));
    if (!Number.isFinite(json.c) || json.c === 0) throw new Error(json.error || 'no quote');
    return { price: json.c, time: json.t ? new Date(json.t * 1000).toISOString() : new Date().toISOString() };
  },
};

// EODHD: paid plans cover daily candles and live quotes for stocks, currencies, indices and crypto.
const eodhd = {
  id: 'eodhd',
  name: 'EODHD',
  needsKey: true,
  async fetchDaily(symbol, { years = 3, settings } = {}) {
    const key = settings?.data?.eodhdKey;
    if (!key) throw new Error('EODHD API key missing');
    await throttle('eodhd', 300);
    const from = new Date(Date.now() - years * 366 * 86400000).toISOString().slice(0, 10);
    if (!/^[A-Za-z0-9._-]+\.[A-Za-z]+$/.test(symbol)) throw new Error(`"${symbol}" is not an EODHD symbol – use CODE.EXCHANGE, e.g. EURUSD.FOREX, GSPC.INDX, SAP.XETRA, AAPL.US`);
    const json = JSON.parse(await http(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?from=${from}&period=d&fmt=json&api_token=${encodeURIComponent(key)}`, { accept: 'application/json' }));
    if (!Array.isArray(json)) throw new Error(typeof json === 'string' ? json.slice(0, 120) : 'EODHD error');
    return json.map((v) => ({ date: v.date, o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: v.volume != null ? +v.volume : null })).filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite));
  },
  async fetchQuote(symbol, { settings } = {}) {
    const key = settings?.data?.eodhdKey;
    if (!key) throw new Error('EODHD API key missing');
    await throttle('eodhd', 300);
    const json = JSON.parse(await http(`https://eodhd.com/api/real-time/${encodeURIComponent(symbol)}?fmt=json&api_token=${encodeURIComponent(key)}`, { accept: 'application/json' }));
    const price = Number(json.close);
    if (!Number.isFinite(price)) throw new Error('no quote');
    return { price, time: json.timestamp ? new Date(json.timestamp * 1000).toISOString() : new Date().toISOString() };
  },
};

export const PROVIDERS = { yahoo, twelvedata, stooq, eodhd, finnhub };

const EODHD_EXCHANGE = { DE: 'XETRA', F: 'F', L: 'LSE', PA: 'PA', AS: 'AS', BR: 'BR', MI: 'MI', MC: 'MC', SW: 'SW', VI: 'VI', ST: 'ST', HE: 'HE', CO: 'CO', OL: 'OL', WA: 'WAR', TO: 'TO' };
/**
 * A source symbol worked out from what is known about the instrument, for sources whose symbol was not typed in.
 * EODHD writes symbols as CODE.EXCHANGE (EURUSD.FOREX, GSPC.INDX, SAP.XETRA, AAPL.US, BTC-USD.CC).
 */
export function deriveSymbol(pid, inst) {
  if (pid !== 'eodhd') return null;
  const y = String(inst.symbols?.yahoo || '');
  if ((inst.class === 'fx' || inst.class === 'metal') && /^[A-Z]{3}$/.test(inst.base || '') && /^[A-Z]{3}$/.test(inst.quote || '')) return `${inst.base}${inst.quote}.FOREX`;
  if (/^[A-Z]{6}=X$/.test(y)) return `${y.slice(0, 6)}.FOREX`;
  if (y.startsWith('^')) return `${y.slice(1)}.INDX`;
  if (inst.class === 'crypto' && /^[A-Z0-9]+-[A-Z]{3}$/.test(y)) return `${y}.CC`;
  const m = /^([A-Z0-9-]+)\.([A-Z]{1,2})$/.exec(y);
  if (m) return inst.class === 'index' ? `${m[1]}.INDX` : EODHD_EXCHANGE[m[2]] ? `${m[1]}.${EODHD_EXCHANGE[m[2]]}` : null;
  if (/^[A-Z][A-Z0-9-]{0,6}$/.test(y) && (inst.class === 'stock' || inst.class === 'etf')) return `${y}.US`;
  return null;
}
/** The symbol to ask a source for: the one typed in for the instrument, otherwise a derived one. */
export const symbolFor = (inst, pid) => inst.symbols?.[pid] || deriveSymbol(pid, inst);

/**
 * Tidies candles: sorts, removes duplicate dates, and merges Saturday/Sunday candles
 * (the short FX opening session) into the next business day.
 */
export function normalizeBars(bars) {
  const byDate = new Map();
  for (const b of bars) byDate.set(b.date, b);
  const sorted = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  let pending = null;
  for (const b of sorted) {
    const dow = new Date(b.date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) {
      pending = pending
        ? { ...pending, h: Math.max(pending.h, b.h), l: Math.min(pending.l, b.l) }
        : { o: b.o, h: b.h, l: b.l };
      continue;
    }
    if (pending) {
      out.push({ ...b, o: pending.o, h: Math.max(pending.h, b.h), l: Math.min(pending.l, b.l) });
      pending = null;
    } else out.push(b);
  }
  return out;
}

/** Fetches an instrument's data: instrument source → default → fallback. */
export async function fetchInstrument(inst, settings) {
  const order = [inst.provider, settings.data.provider, settings.data.fallbackProvider]
    .filter((p, i, a) => p && PROVIDERS[p]?.fetchDaily && a.indexOf(p) === i);
  const errors = [];
  for (const pid of order) {
    const symbol = symbolFor(inst, pid);
    if (!symbol) { errors.push(`${PROVIDERS[pid].name}: no symbol configured`); continue; }
    try {
      const bars = normalizeBars(await PROVIDERS[pid].fetchDaily(symbol, { years: settings.data.historyYears, settings }));
      if (bars.length < 5) throw new Error('not enough data');
      return { provider: pid, bars };
    } catch (e) {
      errors.push(`${PROVIDERS[pid].name}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | ') || 'no data source configured');
}

/** An instrument's H4 candles (sources with intraday data only). */
export async function fetchInstrumentH4(inst, settings) {
  const order = [inst.provider, settings.data.provider, settings.data.fallbackProvider, 'yahoo']
    .filter((p, i, a) => p && PROVIDERS[p]?.fetchH4 && a.indexOf(p) === i);
  const errors = [];
  for (const pid of order) {
    const symbol = symbolFor(inst, pid);
    if (!symbol) { errors.push(`${PROVIDERS[pid].name}: no symbol configured`); continue; }
    try {
      const bars = await PROVIDERS[pid].fetchH4(symbol, { settings });
      if (bars.length < 10) throw new Error('not enough data');
      return { provider: pid, bars };
    } catch (e) { errors.push(`${PROVIDERS[pid].name}: ${e.message}`); }
  }
  throw new Error(errors.join(' | ') || 'no intraday data source configured');
}

/** Current price of an instrument from a source that supports quotes. */
export async function fetchInstrumentQuote(inst, settings) {
  // first the chosen live price source, then the instrument's data sources
  const order = [settings.data.liveProvider, inst.provider, settings.data.provider, settings.data.fallbackProvider, 'yahoo']
    .filter((p, i, a) => p && PROVIDERS[p]?.fetchQuote && a.indexOf(p) === i);
  const errors = [];
  for (const pid of order) {
    const symbol = symbolFor(inst, pid);
    if (!symbol) continue;
    try { return { provider: pid, ...(await PROVIDERS[pid].fetchQuote(symbol, { settings })) }; }
    catch (e) { errors.push(`${PROVIDERS[pid].name}: ${e.message}`); }
  }
  throw new Error(errors.join(' | ') || 'no quote source configured');
}

/** An instrument's hourly candles (for session analysis). */
export async function fetchInstrumentH1(inst, settings) {
  const pid = [inst.provider, settings.data.provider, 'yahoo'].find((p) => p && PROVIDERS[p]?.fetchH1 && inst.symbols?.[p]);
  if (!pid) throw new Error('no hourly data source configured');
  return PROVIDERS[pid].fetchH1(inst.symbols[pid], { settings });
}
