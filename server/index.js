// KumoDesk – serwer HTTP (API + pliki statyczne).
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { PROVIDERS, fetchInstrumentQuote, fetchInstrument, fetchInstrumentH4 } from './providers/index.js';
import { buildLedger, tradeR } from './capital.js';
import { computeIchimoku } from './ichimoku.js';
import { getMarket, refresh, checkPositions, invalidate, job } from './runner.js';
import { closedH4 } from './positions.js';
import { startScheduler } from './scheduler.js';
import { sendTest, smtpConfigured } from './mailer.js';
import * as auth from './auth.js';
import { isValidTimezone, hhmmToMinutes, nextRun, localParts, isBarClosed } from './timeutil.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const VERSION = '2.1.0';

db.openDb(path.join(DATA_DIR, 'kumodesk.db'));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use('/api', auth.requireAuth); // wszystko poza /api/auth/* wymaga zalogowania
const admin = auth.requireAdmin;

const wrap = (fn) => (req, res) => new Promise((resolve) => resolve(fn(req, res))).catch((e) => {
  const code = e.status || (e.message === 'BUSY' ? 409 : 500);
  if (code === 500) console.error('[api]', e);
  res.status(code).json({ error: e.message });
});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

const CLASSES = ['fx', 'metal', 'index', 'commodity', 'crypto', 'stock', 'etf', 'other'];

const LOGIN_BGS = ['aurora', 'kumo', 'grid', 'mesh', 'plain'];
const APP_BGS = ['default', 'aurora', 'grid', 'midnight'];
const THEMES = ['normal', 'anime', 'cosplay', 'custom'];
const THEME_SLOTS = ['left', 'right', 'bg'];
const THEME_DIR = path.join(DATA_DIR, 'theme');
/** Rozpoznaje obraz po pierwszych bajtach – nie ufamy nagłówkowi ani nazwie pliku. */
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  return null;
}

/** Ustawienia widoczne dla użytkownika: osobiste zawsze, dane serwera (SMTP, klucze) tylko dla administratora. */
function publicSettings(user) {
  const s = db.getSettings(user.id);
  if (user.role === 'admin') return { ...s, smtp: { ...s.smtp, pass: '', passSet: !!s.smtp.pass } };
  return { ...s, smtp: { host: '', port: 587, security: 'starttls', user: '', pass: '', from: '', to: '', passSet: false }, data: { ...s.data, twelvedataKey: '', stooqKey: '' } };
}

// ---------- logowanie ----------
const appearance = () => db.getSettings().appearance;
const loginKey = (req, username) => `${req.socket.remoteAddress}|${String(username || '').toLowerCase()}`;
app.get('/api/auth/state', wrap((req, res) => {
  res.json({ setup: db.countUsers() === 0, user: auth.currentUser(req), appearance: appearance(), version: VERSION });
}));
app.post('/api/auth/setup', wrap((req, res) => {
  if (db.countUsers() > 0) throw Object.assign(new Error('err.setupDone'), { status: 409 });
  const { username, password, email } = req.body || {};
  if (!auth.validUsername(username)) throw bad('err.username');
  if (!auth.validPassword(password)) throw bad('err.password');
  const user = db.createUser({ username: String(username), pass_hash: auth.hashPassword(password), role: 'admin', email: String(email || '').trim().slice(0, 200) });
  auth.startSession(req, res, user.id);
  invalidate();
  res.status(201).json({ user });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const key = loginKey(req, username);
  if (!auth.loginAllowed(key)) throw Object.assign(new Error('err.loginLocked'), { status: 429 });
  const u = db.getUserAuth(String(username || ''));
  // sprawdzamy hasło także dla nieistniejącego loginu, żeby czas odpowiedzi nie zdradzał, czy konto istnieje
  const ok = auth.verifyPassword(String(password || ''), u ? u.pass_hash : 'scrypt$00$00') && !!u;
  if (!ok) { auth.loginFailed(key); throw Object.assign(new Error('err.loginBad'), { status: 401 }); }
  auth.loginOk(key);
  auth.startSession(req, res, u.id);
  res.json({ user: db.getUser(u.id) });
}));
// obrazki własnego motywu – widoczne także na ekranie logowania
app.get('/api/auth/theme/:slot', wrap((req, res) => {
  const slot = req.params.slot, meta = appearance().custom?.[slot];
  if (!THEME_SLOTS.includes(slot) || !meta) return res.status(404).end();
  res.setHeader('Content-Type', meta.type); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(path.join(THEME_DIR, slot)).on('error', () => res.status(404).end()).pipe(res);
}));
app.post('/api/auth/logout', wrap((req, res) => { auth.endSession(req, res); res.json({ ok: true }); }));

// ---------- konto i użytkownicy ----------
const cleanEmail = (e) => { const v = String(e || '').trim().slice(0, 200); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('err.email'); return v; };
app.put('/api/account', wrap((req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.email !== undefined) patch.email = cleanEmail(b.email);
  if (b.password) {
    if (!auth.verifyPassword(String(b.current || ''), db.getUserAuthById(req.user.id).pass_hash)) throw bad('err.passwordCurrent');
    if (!auth.validPassword(b.password)) throw bad('err.password');
    patch.pass_hash = auth.hashPassword(b.password);
  }
  const user = db.updateUser(req.user.id, patch);
  if (patch.pass_hash) auth.startSession(req, res, user.id); // zmiana hasła wylogowuje inne urządzenia
  res.json({ user });
}));
// lista do wyboru odbiorcy (udostępnianie, wiadomości): bez adresów e-mail dla zwykłych użytkowników
app.get('/api/users', wrap((req, res) => res.json(db.listUsers().map((u) => (req.user.role === 'admin' ? u : { id: u.id, username: u.username, role: u.role })))));
app.post('/api/users', admin, wrap((req, res) => {
  const { username, password, role, email } = req.body || {};
  if (!auth.validUsername(username)) throw bad('err.username');
  if (!auth.validPassword(password)) throw bad('err.password');
  if (db.getUserAuth(String(username))) throw bad('err.userExists');
  res.status(201).json(db.createUser({ username: String(username), pass_hash: auth.hashPassword(password), role: role === 'admin' ? 'admin' : 'user', email: cleanEmail(email) }));
}));
app.put('/api/users/:id', admin, wrap((req, res) => {
  const id = Number(req.params.id), cur = db.getUser(id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  const b = req.body || {}, patch = {};
  if (b.role != null) {
    patch.role = b.role === 'admin' ? 'admin' : 'user';
    if (cur.role === 'admin' && patch.role !== 'admin' && db.countAdmins() <= 1) throw bad('err.lastAdmin');
  }
  if (b.email !== undefined) patch.email = cleanEmail(b.email);
  if (b.password) { if (!auth.validPassword(b.password)) throw bad('err.password'); patch.pass_hash = auth.hashPassword(b.password); }
  res.json(db.updateUser(id, patch));
}));
app.delete('/api/users/:id', admin, wrap((req, res) => {
  const id = Number(req.params.id), cur = db.getUser(id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  if (id === req.user.id) throw bad('err.deleteSelf');
  if (cur.role === 'admin' && db.countAdmins() <= 1) throw bad('err.lastAdmin');
  db.deleteUser(id); invalidate();
  res.json({ ok: true });
}));

// ---------- własny motyw: wgrywanie obrazków ----------
app.put('/api/theme/:slot', admin, express.raw({ type: () => true, limit: '5mb' }), wrap((req, res) => {
  const slot = req.params.slot;
  if (!THEME_SLOTS.includes(slot)) throw bad('err.background');
  const type = Buffer.isBuffer(req.body) ? sniffImage(req.body) : null;
  if (!type) throw bad('err.imageType');
  fs.mkdirSync(THEME_DIR, { recursive: true });
  fs.writeFileSync(path.join(THEME_DIR, slot), req.body);
  const custom = { ...(appearance().custom || {}), [slot]: { type, v: Date.now() } };
  db.saveSettings({ appearance: { custom } });
  res.json({ appearance: appearance() });
}));
app.delete('/api/theme/:slot', admin, wrap((req, res) => {
  const slot = req.params.slot;
  if (!THEME_SLOTS.includes(slot)) throw bad('err.background');
  fs.rmSync(path.join(THEME_DIR, slot), { force: true });
  const custom = { ...(appearance().custom || {}) }; delete custom[slot];
  const all = db.getSettings(); all.appearance.custom = custom;
  db.replaceSetting('appearance', all.appearance);
  res.json({ appearance: appearance() });
}));

// ---------- udostępnianie portfela ----------
app.get('/api/shares', wrap((req, res) => res.json({ viewers: db.sharesOf(req.user.id), sharedWithMe: db.sharedWith(req.user.id) })));
app.put('/api/shares', wrap((req, res) => {
  const ids = Array.isArray(req.body?.viewers) ? req.body.viewers.map(Number).filter(Number.isInteger).slice(0, 500) : [];
  db.setShares(req.user.id, ids);
  res.json({ viewers: db.sharesOf(req.user.id) });
}));
// Portfel innego użytkownika – tylko gdy go udostępnił. Wyłącznie do odczytu.
app.get('/api/portfolio/:userId', wrap((req, res) => {
  const owner = db.getUser(Number(req.params.userId));
  if (!owner || !db.canView(owner.id, req.user.id)) return res.status(403).json({ error: 'err.notShared' });
  const s = db.getSettings(owner.id);
  const market = getMarket(owner.id);
  res.json({ owner: { id: owner.id, username: owner.username }, portfolio: market.portfolio, capital: s.capital, ...buildLedger(db.listTrades(owner.id), s.capital.start) });
}));

// ---------- wiadomości ----------
function tradeSnapshot(userId, tradeId) {
  const t = db.getTrade(tradeId);
  if (!t || t.user_id !== userId) throw bad('err.tradeNotFound');
  const s = db.getSettings(userId);
  const row = buildLedger(db.listTrades(userId), s.capital.start).trades.find((x) => x.id === t.id);
  return { instrument_id: t.instrument_id, direction: t.direction, risk_pct: t.risk_pct, entry: t.entry, stop_initial: t.stop_initial, exit: t.exit,
    opened: t.opened, closed: t.closed, r: t.r, pnl: row?.pnl ?? null, pnlPct: row?.pnlPct ?? null, currency: s.capital.currency };
}
app.get('/api/messages', wrap((req, res) => {
  const users = Object.fromEntries(db.listUsers().map((u) => [u.id, u.username]));
  res.json(db.threadSummaries(req.user.id).filter((t) => users[t.other]).map((t) => ({ user: { id: t.other, username: users[t.other] }, unread: t.unread, last: t.last }))
    .sort((a, b) => b.last.id - a.last.id));
}));
app.get('/api/messages/:userId', wrap((req, res) => {
  const other = db.getUser(Number(req.params.userId));
  if (!other) return res.status(404).json({ error: 'err.notFound' });
  db.markThreadRead(req.user.id, other.id);
  res.json({ user: { id: other.id, username: other.username }, messages: db.thread(req.user.id, other.id) });
}));
app.post('/api/messages', wrap((req, res) => {
  const b = req.body || {};
  const to = db.getUser(Number(b.to));
  if (!to || to.id === req.user.id) throw bad('err.recipient');
  const body = String(b.body || '').trim().slice(0, 2000);
  const trade = b.trade_id != null ? tradeSnapshot(req.user.id, Number(b.trade_id)) : null;
  if (!body && !trade) throw bad('err.messageEmpty');
  res.status(201).json({ id: db.addMessage({ from_id: req.user.id, to_id: to.id, body, trade }) });
}));

// ---------- rynek ----------
app.get('/api/dashboard', wrap((req, res) => res.json(getMarket(req.user.id))));

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
  const market = getMarket(req.user.id);
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
    bell: { unread: db.countAlertsAfter(db.getBellSeen(req.user.id), req.user.id) },
    mail: { unread: db.unreadMessages(req.user.id) },
    user: req.user,
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

// Dzwonek: te same zdarzenia, które trafiają do e-maili.
app.get('/api/notifications', wrap((req, res) => {
  const seen = db.getBellSeen(req.user.id);
  res.json({ seen, items: db.listAlerts(40, req.user.id).map((a) => {
    let msg = {}; try { msg = JSON.parse(a.message); } catch { msg = { code: 'raw', params: { text: a.message } }; }
    return { id: a.id, ts: a.ts, type: a.type, severity: a.severity, instrument_id: a.instrument_id, unread: a.id > seen, ...msg };
  }) });
}));
app.post('/api/notifications/seen', wrap((req, res) => {
  const top = db.listAlerts(1, req.user.id)[0]?.id || 0;
  db.setBellSeen(req.user.id, Math.min(top, Math.max(Number(req.body?.id) || top, db.getBellSeen(req.user.id))));
  res.json({ ok: true });
}));

app.get('/api/alerts', wrap((req, res) => {
  res.json(db.listAlerts(300, req.user.id).map((a) => {
    let msg = {}; try { msg = JSON.parse(a.message); } catch { msg = { code: 'raw', params: { text: a.message } }; }
    return { id: a.id, ts: a.ts, type: a.type, severity: a.severity, instrument_id: a.instrument_id, ...msg };
  }));
}));

// ---------- ustawienia ----------
app.get('/api/settings', wrap((req, res) => {
  res.json({
    settings: publicSettings(req.user),
    loginBgs: LOGIN_BGS, appBgs: APP_BGS, themes: THEMES,
    providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, needsKey: p.needsKey })),
    classes: CLASSES,
  });
}));

app.put('/api/settings', wrap((req, res) => {
  const patch = req.body || {};
  // kapitał i limity ryzyka są osobiste; reszta to ustawienia serwera i wymaga administratora
  const personal = {};
  for (const k of db.PERSONAL_KEYS) if (patch[k]) { personal[k] = patch[k]; }
  const globalKeys = Object.keys(patch).filter((k) => !db.PERSONAL_KEYS.includes(k));
  if (globalKeys.length && req.user.role !== 'admin') throw Object.assign(new Error('err.adminOnly'), { status: 403 });
  if (patch.appearance) {
    if (patch.appearance.loginBg != null && !LOGIN_BGS.includes(patch.appearance.loginBg)) throw bad('err.background');
    if (patch.appearance.appBg != null && !APP_BGS.includes(patch.appearance.appBg)) throw bad('err.background');
    if (patch.appearance.theme != null && !THEMES.includes(patch.appearance.theme)) throw bad('err.background');
    delete patch.appearance.custom; // obrazki zmienia się tylko przez wgranie pliku
  }
  if (patch.risk) for (const k of ['maxTotal', 'maxCurrency', 'maxPosition']) if (patch.risk[k] != null) { const v = Number(patch.risk[k]); if (!(v > 0 && v <= 100)) throw bad('err.riskPct'); patch.risk[k] = v; }
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
  for (const k of db.PERSONAL_KEYS) delete patch[k];
  if (globalKeys.length) db.saveSettings(patch);
  if (Object.keys(personal).length) db.saveUserSettings(req.user.id, personal);
  invalidate();
  res.json({ settings: publicSettings(req.user) });
}));

app.post('/api/settings/test-smtp', admin, wrap(async (req, res) => {
  try { await sendTest(db.getSettings(), req.body?.lang); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

app.post('/api/providers/test', admin, wrap(async (req, res) => {
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
app.post('/api/groups', admin, wrap((req, res) => res.status(201).json(db.createGroup(validGroup(req.body || {})))));
app.put('/api/groups/:id', admin, wrap((req, res) => {
  const g = db.updateGroup(Number(req.params.id), validGroup(req.body || {}, true));
  if (!g) return res.status(404).json({ error: 'err.notFound' });
  invalidate();
  res.json(g);
}));
app.delete('/api/groups/:id', admin, wrap((req, res) => {
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
app.post('/api/instruments', admin, wrap((req, res) => {
  const it = validInstrument(req.body || {});
  if (db.getInstrument(it.id)) throw bad('err.instExists');
  const saved = db.upsertInstrument(it);
  invalidate();
  res.status(201).json(saved);
}));
app.put('/api/instruments/:id', admin, wrap((req, res) => {
  const cur = db.getInstrument(req.params.id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  const saved = db.upsertInstrument(validInstrument(req.body || {}, cur));
  invalidate();
  res.json(saved);
}));
// Import wielu instrumentów naraz: linie „SYMBOL;Nazwa” (symbol źródła danych).
app.post('/api/instruments/import', admin, wrap((req, res) => {
  const b = req.body || {};
  const provider = PROVIDERS[b.provider] ? b.provider : db.getSettings().data.provider;
  const group_id = Number(b.group_id);
  if (!db.getGroup(group_id)) throw bad('err.instGroup');
  const cls = CLASSES.includes(b.class) ? b.class : 'stock';
  if (cls === 'fx') throw bad('err.importFx');
  const category = String(b.category || '').trim().slice(0, 30);
  if (!category) throw bad('err.category');
  const lines = String(b.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 2000);
  let added = 0, skipped = 0;
  const invalid = [];
  for (const line of lines) {
    const [symRaw, ...rest] = line.split(/[;,\t]/);
    const symbol = (symRaw || '').trim();
    // symbol źródła może zawierać ^ i = (np. ^GSPC, GC=F); identyfikator w aplikacji już nie
    const id = symbol.toUpperCase().replace(/[\^=]/g, '');
    if (!/^[A-Za-z0-9.^=_-]{1,24}$/.test(symbol) || !/^[A-Z0-9._-]{1,20}$/.test(id)) { invalid.push(line.slice(0, 30)); continue; }
    if (db.getInstrument(id)) { skipped++; continue; }
    db.upsertInstrument({ id, name: rest.join(' ').trim() || symbol, class: cls, category, group_id, enabled: b.enabled !== false, symbols: { [provider]: symbol } });
    added++;
  }
  invalidate();
  res.json({ added, skipped, invalid });
}));
app.post('/api/categories/toggle', admin, wrap((req, res) => {
  const { category, enabled } = req.body || {};
  if (!category) throw bad('err.category');
  const changed = db.setCategoryEnabled(String(category), !!enabled);
  invalidate();
  res.json({ changed });
}));
app.delete('/api/instruments/:id', admin, wrap((req, res) => { db.deleteInstrument(req.params.id); invalidate(); res.json({ ok: true }); }));

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
app.get('/api/positions', wrap((req, res) => res.json(db.listPositions(req.user.id))));
const kickH4 = (userId) => { if (!job.running) checkPositions({ trigger: 'manual', userId }).catch((e) => console.error('[h4]', e.message)); };
/** Pozycja musi należeć do zalogowanego użytkownika. */
function ownPosition(req) {
  const pos = db.getPosition(req.params.id);
  if (!pos || pos.user_id !== req.user.id) throw Object.assign(new Error('err.notFound'), { status: 404 });
  return pos;
}
app.post('/api/positions/check', wrap((req, res) => {
  if (job.running) throw Object.assign(new Error('BUSY'), { status: 409 });
  kickH4(req.user.id);
  res.status(202).json({ started: true });
}));
app.post('/api/positions', wrap(async (req, res) => {
  const p = validPosition({ ...req.body, id: undefined });
  p.user_id = req.user.id;
  let quote = null;
  if (req.body?.market) {
    // wpis „po cenie rynkowej”: cenę wejścia pobieramy z API w chwili dodania
    quote = await quoteFor(db.getInstrument(p.instrument_id));
    p.entry = quote.price;
    p.opened = p.opened || new Date().toISOString().slice(0, 10);
    if (p.stop != null && (p.direction === 'LONG' ? p.stop >= p.entry : p.stop <= p.entry)) throw bad('err.stopSide');
  }
  const id = db.savePosition(p);
  invalidate(); kickH4(req.user.id);
  res.status(201).json({ id, entry: p.entry, quote });
}));
app.post('/api/positions/:id/close', wrap(async (req, res) => {
  const pos = ownPosition(req);
  const b = req.body || {};
  const numOrNull = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  let exit = numOrNull(b.exit);
  const pnlManual = numOrNull(b.pnl);
  if (exit == null && pnlManual == null) exit = (await quoteFor(db.getInstrument(pos.instrument_id))).price;
  const stop0 = pos.stop_initial ?? pos.stop;
  const r = tradeR(pos.direction, pos.entry, stop0, exit);
  if (r == null && pnlManual == null) throw bad('err.closeNeedsResult');
  const tradeId = db.addTrade({
    user_id: req.user.id,
    instrument_id: pos.instrument_id, direction: pos.direction, risk_pct: pos.risk_pct, entry: pos.entry, stop_initial: stop0, exit,
    opened: pos.opened, closed: b.closed || new Date().toISOString().slice(0, 10), r, pnl_manual: pnlManual, note: b.note ?? pos.note,
  });
  db.deletePosition(pos.id);
  invalidate();
  res.json({ tradeId, r, exit });
}));
app.get('/api/capital', wrap((req, res) => {
  const s = db.getSettings(req.user.id);
  const market = getMarket(req.user.id);
  res.json({ capital: s.capital, ...buildLedger(db.listTrades(req.user.id), s.capital.start), openRisk: market.portfolio.total, openPositions: market.portfolio.positions.length });
}));
app.delete('/api/trades/:id', wrap((req, res) => {
  const t = db.getTrade(req.params.id);
  if (!t || t.user_id !== req.user.id) return res.status(404).json({ error: 'err.notFound' });
  db.deleteTrade(t.id); res.json({ ok: true });
}));
app.put('/api/positions/:id', wrap((req, res) => { ownPosition(req); db.savePosition(validPosition({ ...req.body, id: req.params.id })); invalidate(); res.json({ ok: true }); }));
app.delete('/api/positions/:id', wrap((req, res) => { db.deletePosition(ownPosition(req).id); invalidate(); res.json({ ok: true }); }));

// ---------- statyczne ----------
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'err.notFound' }));

app.listen(PORT, HOST, () => {
  console.log(`KumoDesk ${VERSION} – http://${HOST}:${PORT} (dane: ${DATA_DIR})`);
  if (process.env.KUMODESK_NO_SCHEDULER !== '1') startScheduler();
});
