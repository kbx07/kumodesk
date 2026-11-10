// KumoDesk – serwer HTTP (API + pliki statyczne).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { PROVIDERS, fetchInstrumentQuote, fetchInstrument, fetchInstrumentH4 } from './providers/index.js';
import { buildLedger, tradeR } from './capital.js';
import { computeIchimoku } from './ichimoku.js';
import { getMarket, refresh, checkPositions, invalidate, job } from './runner.js';
import { closedH4 } from './positions.js';
import { startScheduler } from './scheduler.js';
import { sendTest, smtpConfigured } from './mailer.js';
import { isValidTimezone, hhmmToMinutes, nextRun, localParts, isBarClosed } from './timeutil.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const VERSION = '1.6.0';

db.openDb(path.join(DATA_DIR, 'kumodesk.db'));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

const wrap = (fn) => (req, res) => new Promise((resolve) => resolve(fn(req, res))).catch((e) => {
  const code = e.status || (e.message === 'BUSY' ? 409 : 500);
  if (code === 500) console.error('[api]', e);
  res.status(code).json({ error: e.message });
});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

const CLASSES = ['fx', 'metal', 'index', 'commodity', 'crypto', 'stock', 'other'];

function publicSettings() {
  const s = db.getSettings();
  return { ...s, smtp: { ...s.smtp, pass: '', passSet: !!s.smtp.pass } };
}

// ---------- rynek ----------
app.get('/api/dashboard', wrap((req, res) => res.json(getMarket())));

// Wykres „obecny”: dociąga świeże dane instrumentu, najwyżej raz na 5 minut.
async function freshenForLiveView(inst, tf) {
  if (job.running) return;
  const age = inst.last_fetch_at ? Date.now() - Date.parse(inst.last_fetch_at) : Infinity;
  const settings = db.getSettings();
  try {
    if (tf === 'h4') { db.saveH4(inst.id, (await fetchInstrumentH4(inst, settings)).bars); return; }
    if (age < 5 * 60 * 1000) return;
    db.saveCandles(inst.id, (await fetchInstrument(inst, settings)).bars);
    db.markFetch(inst.id, null);
    invalidate();
  } catch (e) { console.warn('[live]', inst.id, e.message); }
}

app.get('/api/instrument/:id', wrap(async (req, res) => {
  let inst = db.getInstrument(req.params.id);
  if (!inst) return res.status(404).json({ error: 'err.notFound' });
  // view=analysis: dokładnie te świece, na których liczona jest analiza (tylko zamknięte)
  // view=live: to samo plus świeca jeszcze niezamknięta, ze świeżymi danymi
  const view = req.query.view === 'live' ? 'live' : 'analysis';
  const allH4 = db.getH4(inst.id);
  const tf = req.query.tf === 'h4' && allH4.length ? 'h4' : 'd1';
  if (view === 'live') { await freshenForLiveView(inst, tf); inst = db.getInstrument(inst.id); }
  const market = getMarket();
  const analysis = market.instruments.find((a) => a.id === inst.id) || null;
  const group = db.getGroup(inst.group_id);
  const settings = db.getSettings();
  let bars, openBar = false;
  if (tf === 'h4') {
    const raw = db.getH4(inst.id), closed = closedH4(raw);
    const use = view === 'live' ? raw : closed;
    openBar = view === 'live' && raw.length > closed.length;
    bars = use.map((b) => ({ date: new Date(b.ts * 1000).toISOString().slice(0, 16).replace('T', ' '), o: b.o, h: b.h, l: b.l, c: b.c }));
  } else {
    bars = db.getCandles(inst.id);
    const lastOpen = !!(group && bars.length && !isBarClosed(bars.at(-1).date, group));
    if (lastOpen && view === 'analysis') bars = bars.slice(0, -1);
    openBar = lastOpen && view === 'live';
  }
  const ich = computeIchimoku(bars, settings.ichimoku);
  const shift = ich.params.shift;
  const from = Math.max(0, bars.length - 200);
  const chart = {
    shift,
    bars: bars.slice(from),
    tenkan: ich.tenkan.slice(from), kijun: ich.kijun.slice(from),
    cloudA: ich.cloudA.slice(from), cloudB: ich.cloudB.slice(from), // dłuższe o `shift` (chmura przyszła)
  };
  const positions = market.portfolio.positions.filter((p) => p.instrument_id === inst.id);
  res.json({ instrument: inst, group, analysis, chart, tf, view, openBar, updatedAt: inst.last_fetch_at, hasH4: allH4.length > 0, positions });
}));

app.get('/api/status', wrap((req, res) => {
  const now = new Date();
  const s = db.getSettings();
  res.json({
    version: VERSION,
    now: now.toISOString(),
    job,
    smtpConfigured: smtpConfigured(s),
    provider: s.data.provider,
    h4: { enabled: !!s.h4.enabled, last: db.getMeta('h4status'), next: s.h4.enabled ? new Date((Math.floor(now.getTime() / 14400000) + (now.getTime() % 14400000 >= (s.h4.delay_min ?? 5) * 60000 ? 1 : 0)) * 14400000 + (s.h4.delay_min ?? 5) * 60000).toISOString() : null },
    groups: db.listGroups().map((g) => ({
      id: g.id, name: g.name, close_time: g.close_time, timezone: g.timezone, enabled: !!g.enabled,
      localTime: localParts(g.timezone, now).time,
      nextRun: nextRun(g, now)?.toISOString() ?? null,
      last_run_at: g.last_run_at, last_status: g.last_status,
    })),
  });
}));

app.post('/api/refresh', wrap((req, res) => {
  if (job.running) throw Object.assign(new Error('BUSY'), { status: 409 });
  const groupId = req.body?.groupId != null ? Number(req.body.groupId) : null;
  if (groupId != null && !db.getGroup(groupId)) throw bad('err.group');
  refresh({ groupId, trigger: 'manual' }).catch((e) => console.error('[refresh]', e));
  res.status(202).json({ started: true });
}));

app.get('/api/history', wrap((req, res) => {
  res.json(db.listSnapshots(300).map((s) => ({
    id: s.id, ts: s.ts, trigger: s.trigger, matrix: s.matrix_score, regime: s.regime, exec: s.exec_state,
    primary: s.summary.primary, primaryDir: s.summary.grades?.[s.summary.primary]?.d ?? null,
    mood: s.summary.mood, portfolio: s.summary.portfolio,
  })));
}));

app.get('/api/alerts', wrap((req, res) => {
  res.json(db.listAlerts(300).map((a) => {
    let msg = {}; try { msg = JSON.parse(a.message); } catch { msg = { code: 'raw', params: { text: a.message } }; }
    return { id: a.id, ts: a.ts, type: a.type, severity: a.severity, instrument_id: a.instrument_id, ...msg };
  }));
}));

// ---------- ustawienia ----------
app.get('/api/settings', wrap((req, res) => {
  res.json({
    settings: publicSettings(),
    providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, needsKey: p.needsKey })),
    classes: CLASSES,
  });
}));

app.put('/api/settings', wrap((req, res) => {
  const patch = req.body || {};
  if (patch.smtp) {
    if (!patch.smtp.pass && !patch.smtp.clearPass) delete patch.smtp.pass;
    delete patch.smtp.passSet; delete patch.smtp.clearPass;
  }
  if (patch.data?.provider && !PROVIDERS[patch.data.provider]) throw bad('err.provider');
  if (patch.ichimoku) {
    for (const k of ['tenkan', 'kijun', 'senkou', 'shift', 'atr']) {
      if (patch.ichimoku[k] != null) {
        const v = Math.round(Number(patch.ichimoku[k]));
        if (!(v >= 2 && v <= 400)) throw bad('err.ichimokuRange');
        patch.ichimoku[k] = v;
      }
    }
  }
  if (patch.capital) {
    if (patch.capital.start != null) { const v = Number(patch.capital.start); if (!(v >= 0)) throw bad('err.capital'); patch.capital.start = v; }
    if (patch.capital.currency != null) patch.capital.currency = String(patch.capital.currency).trim().toUpperCase().slice(0, 6) || 'PLN';
    if (patch.capital.defaultRisk != null) { const v = Number(patch.capital.defaultRisk); if (!(v > 0 && v <= 100)) throw bad('err.riskPct'); patch.capital.defaultRisk = v; }
  }
  db.saveSettings(patch);
  invalidate();
  res.json({ settings: publicSettings() });
}));

app.post('/api/settings/test-smtp', wrap(async (req, res) => {
  try { await sendTest(db.getSettings(), req.body?.lang); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

app.post('/api/providers/test', wrap(async (req, res) => {
  const { provider, symbol } = req.body || {};
  const p = PROVIDERS[provider];
  if (!p) throw bad('err.provider');
  if (!symbol) throw bad('err.symbol');
  try {
    const bars = await p.fetchDaily(String(symbol), { years: 1, settings: db.getSettings() });
    res.json({ ok: true, bars: bars.length, last: bars.at(-1) || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ---------- grupy czasowe ----------
function validGroup(b, partial = false) {
  const g = {};
  if (b.name != null || !partial) { g.name = String(b.name || '').trim(); if (!g.name) throw bad('err.groupName'); }
  if (b.close_time != null || !partial) { if (hhmmToMinutes(b.close_time) == null) throw bad('err.closeTime'); g.close_time = b.close_time; }
  if (b.timezone != null || !partial) { if (!isValidTimezone(b.timezone)) throw bad('err.timezone'); g.timezone = b.timezone; }
  if (b.delay_min != null) { const d = Math.round(Number(b.delay_min)); if (!(d >= 0 && d <= 600)) throw bad('err.delay'); g.delay_min = d; }
  if (b.days != null) {
    const days = String(b.days).split(',').map(Number).filter((d) => d >= 1 && d <= 7);
    if (!days.length) throw bad('err.days');
    g.days = [...new Set(days)].sort().join(',');
  }
  if (b.enabled != null) g.enabled = !!b.enabled;
  return g;
}
app.get('/api/groups', wrap((req, res) => res.json(db.listGroups().map((g) => ({ ...g, enabled: !!g.enabled })))));
app.post('/api/groups', wrap((req, res) => res.status(201).json(db.createGroup(validGroup(req.body || {})))));
app.put('/api/groups/:id', wrap((req, res) => {
  const g = db.updateGroup(Number(req.params.id), validGroup(req.body || {}, true));
  if (!g) return res.status(404).json({ error: 'err.notFound' });
  invalidate();
  res.json(g);
}));
app.delete('/api/groups/:id', wrap((req, res) => {
  try { db.deleteGroup(Number(req.params.id)); } catch (e) { throw bad(e.message); }
  res.json({ ok: true });
}));

// ---------- instrumenty ----------
function validInstrument(b, existing) {
  const id = String(existing?.id || b.id || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,20}$/.test(id)) throw bad('err.instId');
  const it = { id };
  it.name = String(b.name ?? existing?.name ?? id).trim() || id;
  it.class = b.class ?? existing?.class ?? 'other';
  if (!CLASSES.includes(it.class)) throw bad('err.class');
  it.base = (b.base ?? existing?.base ?? '').toString().trim().toUpperCase() || null;
  it.quote = (b.quote ?? existing?.quote ?? '').toString().trim().toUpperCase() || null;
  if (it.class === 'fx' && !(/^[A-Z]{3}$/.test(it.base || '') && /^[A-Z]{3}$/.test(it.quote || ''))) throw bad('err.fxPair');
  it.category = String(b.category ?? existing?.category ?? it.class).trim().slice(0, 30) || it.class;
  it.group_id = Number(b.group_id ?? existing?.group_id);
  if (!db.getGroup(it.group_id)) throw bad('err.instGroup');
  it.enabled = b.enabled != null ? !!b.enabled : existing ? existing.enabled : true;
  it.provider = b.provider !== undefined ? (b.provider || null) : existing?.provider ?? null;
  if (it.provider && !PROVIDERS[it.provider]) throw bad('err.provider');
  const sym = { ...(existing?.symbols || {}) };
  if (b.symbols && typeof b.symbols === 'object') for (const p of Object.keys(PROVIDERS)) if (b.symbols[p] != null) sym[p] = String(b.symbols[p]).trim();
  it.symbols = sym;
  return it;
}
app.get('/api/instruments', wrap((req, res) => res.json(db.listInstruments())));
app.post('/api/instruments', wrap((req, res) => {
  const it = validInstrument(req.body || {});
  if (db.getInstrument(it.id)) throw bad('err.instExists');
  const saved = db.upsertInstrument(it);
  invalidate();
  res.status(201).json(saved);
}));
app.put('/api/instruments/:id', wrap((req, res) => {
  const cur = db.getInstrument(req.params.id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  const saved = db.upsertInstrument(validInstrument(req.body || {}, cur));
  invalidate();
  res.json(saved);
}));
app.post('/api/categories/toggle', wrap((req, res) => {
  const { category, enabled } = req.body || {};
  if (!category) throw bad('err.category');
  const changed = db.setCategoryEnabled(String(category), !!enabled);
  invalidate();
  res.json({ changed });
}));
app.delete('/api/instruments/:id', wrap((req, res) => { db.deleteInstrument(req.params.id); invalidate(); res.json({ ok: true }); }));

// ---------- bieżąca cena ----------
/** Cena z API; gdy źródło zawiedzie – ostatnie zamknięcie z bazy (oznaczone jako nieaktualne). */
async function quoteFor(inst) {
  try {
    const q = await fetchInstrumentQuote(inst, db.getSettings());
    return { price: q.price, time: q.time, source: q.provider, live: true };
  } catch (e) {
    const last = db.getCandles(inst.id).at(-1);
    if (!last) throw bad('err.noQuote');
    return { price: last.c, time: last.date, source: 'candle', live: false, error: e.message };
  }
}
app.get('/api/quote/:id', wrap(async (req, res) => {
  const inst = db.getInstrument(req.params.id);
  if (!inst) return res.status(404).json({ error: 'err.notFound' });
  res.json(await quoteFor(inst));
}));

// ---------- portfel ----------
function validPosition(b) {
  const p = { id: b.id ? Number(b.id) : undefined };
  p.instrument_id = String(b.instrument_id || '').toUpperCase();
  if (!db.getInstrument(p.instrument_id)) throw bad('err.instrument');
  if (!['LONG', 'SHORT'].includes(b.direction)) throw bad('err.direction');
  p.direction = b.direction;
  p.risk_pct = Number(b.risk_pct);
  if (!(p.risk_pct > 0 && p.risk_pct <= 100)) throw bad('err.riskPct');
  const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  p.entry = num(b.entry); p.stop = num(b.stop);
  p.opened = b.opened || null; p.note = b.note ? String(b.note).slice(0, 300) : null;
  return p;
}
app.get('/api/positions', wrap((req, res) => res.json(db.listPositions())));
const kickH4 = () => { if (!job.running) checkPositions({ trigger: 'manual' }).catch((e) => console.error('[h4]', e.message)); };
app.post('/api/positions/check', wrap((req, res) => {
  if (job.running) throw Object.assign(new Error('BUSY'), { status: 409 });
  kickH4();
  res.status(202).json({ started: true });
}));
app.post('/api/positions', wrap(async (req, res) => {
  const p = validPosition({ ...req.body, id: undefined });
  let quote = null;
  if (req.body?.market) {
    // wpis „po cenie rynkowej”: cenę wejścia pobieramy z API w chwili dodania
    quote = await quoteFor(db.getInstrument(p.instrument_id));
    p.entry = quote.price;
    p.opened = p.opened || new Date().toISOString().slice(0, 10);
    if (p.stop != null && (p.direction === 'LONG' ? p.stop >= p.entry : p.stop <= p.entry)) throw bad('err.stopSide');
  }
  const id = db.savePosition(p);
  invalidate(); kickH4();
  res.status(201).json({ id, entry: p.entry, quote });
}));
app.post('/api/positions/:id/close', wrap(async (req, res) => {
  const pos = db.getPosition(req.params.id);
  if (!pos) return res.status(404).json({ error: 'err.notFound' });
  const b = req.body || {};
  const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  let exit = numOrNull(b.exit);
  const pnlManual = numOrNull(b.pnl);
  if (exit == null && pnlManual == null) exit = (await quoteFor(db.getInstrument(pos.instrument_id))).price;
  const stop0 = pos.stop_initial ?? pos.stop;
  const r = tradeR(pos.direction, pos.entry, stop0, exit);
  if (r == null && pnlManual == null) throw bad('err.closeNeedsResult');
  const tradeId = db.addTrade({
    instrument_id: pos.instrument_id, direction: pos.direction, risk_pct: pos.risk_pct, entry: pos.entry, stop_initial: stop0, exit,
    opened: pos.opened, closed: b.closed || new Date().toISOString().slice(0, 10), r, pnl_manual: pnlManual, note: b.note ?? pos.note,
  });
  db.deletePosition(pos.id);
  invalidate();
  res.json({ tradeId, r, exit });
}));
app.get('/api/capital', wrap((req, res) => {
  const s = db.getSettings();
  const market = getMarket();
  res.json({ capital: s.capital, ...buildLedger(db.listTrades(), s.capital.start), openRisk: market.portfolio.total, openPositions: market.portfolio.positions.length });
}));
app.delete('/api/trades/:id', wrap((req, res) => { db.deleteTrade(Number(req.params.id)); res.json({ ok: true }); }));
app.put('/api/positions/:id', wrap((req, res) => { db.savePosition(validPosition({ ...req.body, id: req.params.id })); invalidate(); res.json({ ok: true }); }));
app.delete('/api/positions/:id', wrap((req, res) => { db.deletePosition(Number(req.params.id)); invalidate(); res.json({ ok: true }); }));

// ---------- statyczne ----------
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'err.notFound' }));

app.listen(PORT, HOST, () => {
  console.log(`KumoDesk ${VERSION} – http://${HOST}:${PORT} (dane: ${DATA_DIR})`);
  if (process.env.KUMODESK_NO_SCHEDULER !== '1') startScheduler();
});
