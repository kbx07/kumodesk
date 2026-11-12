// KumoDesk – HTTP server (API + static files).
import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { PROVIDERS, fetchInstrumentQuote, fetchInstrument, fetchInstrumentH4, deriveSymbol } from './providers/index.js';
import { buildLedger, tradeR } from './capital.js';
import { computeIchimoku } from './ichimoku.js';
import { getMarket, refresh, checkPositions, invalidate, job } from './runner.js';
import { closedH4 } from './positions.js';
import { startScheduler } from './scheduler.js';
import { sendTest, sendInvite, smtpConfigured, smtpReady } from './mailer.js';
import * as auth from './auth.js';
import * as totp from './totp.js';
import QRCode from 'qrcode';
import { vapidPublicKey, pushToUser } from './push.js';
import { updateSignals, signalStats, signalsBusy } from './signals.js';
import { t as tr } from '../public/i18n.js';
import { VERSION, compareVersions, updateMode, checkLatest, updateState, runUpdate } from './update.js';
import { isValidTimezone, hhmmToMinutes, nextRun, localParts, isBarClosed } from './timeutil.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

db.openDb(path.join(DATA_DIR, 'kumodesk.db'));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use('/api', auth.requireAuth); // everything except /api/auth/* requires a session
const admin = auth.requireAdmin;
const superOnly = auth.requireSuper; // the first account: updates, market data, notifications, logs

const wrap = (fn) => (req, res) => new Promise((resolve) => resolve(fn(req, res))).catch((e) => {
  const code = e.status || (e.message === 'BUSY' ? 409 : 500);
  if (code === 500) console.error('[api]', e);
  res.status(code).json({ error: e.message });
});
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

const CLASSES = ['fx', 'metal', 'index', 'commodity', 'crypto', 'stock', 'etf', 'other'];

const LOGIN_BGS = ['aurora', 'kumo', 'grid', 'mesh', 'plain'];
const APP_BGS = ['default', 'aurora', 'grid', 'midnight'];
const THEMES = ['normal', 'anime', 'custom'];
// accent colours offered in Settings → General (all dark enough for white button text)
const ACCENTS = ['#2b7fff', '#0e94d8', '#0d9488', '#16a34a', '#65a30d', '#d97706', '#ea580c', '#dc2626', '#e8589a', '#c94fd0', '#8b5cf6', '#64748b'];
const THEME_SLOTS = ['left', 'right', 'bg'];
const THEME_DIR = path.join(DATA_DIR, 'theme');
/** Detects an image by its first bytes – neither the header nor the file name is trusted. */
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  return null;
}

const API_KEYS = ['twelvedataKey', 'stooqKey', 'eodhdKey', 'finnhubKey'];
/** Settings visible to a user: personal ones always, server data (SMTP, keys) for administrators only. */
function publicSettings(user) {
  const s = db.getSettings(user.id);
  // API keys and passwords never leave the server: the page only learns whether one is stored
  const keys = Object.fromEntries(API_KEYS.flatMap((k) => [[k, ''], [`${k}Set`, !!s.data[k]]]));
  if (user.super) return { ...s, data: { ...s.data, ...keys }, smtp: { ...s.smtp, pass: '', passSet: !!s.smtp.pass, oauthClientSecret: '', oauthSecretSet: !!s.smtp.oauthClientSecret, oauthRefreshToken: '', oauthConnected: !!s.smtp.oauthRefreshToken } };
  return { ...s, smtp: { host: '', port: 587, security: 'starttls', user: '', pass: '', from: '', to: '', passSet: false, auth: 'password', oauthClientId: '', oauthClientSecret: '', oauthRefreshToken: '' }, data: { ...s.data, twelvedataKey: '', stooqKey: '', finnhubKey: '', eodhdKey: '' } };
}

/** Writes an event log entry. */
const log = (req, category, code, params = {}, level = 'info', userId = undefined) =>
  db.addLog({ user_id: userId !== undefined ? userId : (req?.user?.id ?? null), category, level, code, params, ip: req ? auth.clientIp(req) : null });

// ---------- sign-in ----------
const appearance = () => db.getSettings().appearance;
// the former "cosplay" theme was merged into "anime"
if (db.getSettings().appearance.theme === 'cosplay') db.saveSettings({ appearance: { theme: 'anime' } });
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
  log(req, 'auth', 'auth.setup', {}, 'info', user.id);
  res.status(201).json({ user });
}));
app.post('/api/auth/login', wrap((req, res) => {
  const { username, password, code, remember } = req.body || {};
  const key = loginKey(req, username);
  if (!auth.loginAllowed(key)) throw Object.assign(new Error('err.loginLocked'), { status: 429 });
  const u = db.getUserByLogin(username);
  // verify the password even for an unknown username so response time does not reveal whether the account exists
  const ok = auth.verifyPassword(String(password || ''), u ? u.pass_hash : 'scrypt$00$00') && !!u;
  if (!ok) { auth.loginFailed(key); log(req, 'auth', 'auth.loginFailed', { username: String(username || '').slice(0, 40) }, 'warn', u ? u.id : null); throw Object.assign(new Error('err.loginBad'), { status: 401 }); }
  // second step: app code or recovery code, unless the device is remembered
  if (u.totp_enabled && !auth.deviceRemembered(req, u.id)) {
    if (!code) return res.json({ twofa: true });
    const counter = totp.verify(u.totp_secret, code, { lastCounter: u.totp_last });
    if (counter != null) db.setTotpLast(u.id, counter);
    else {
      const left = JSON.parse(u.recovery || '[]'), hsh = totp.hashCode(code);
      if (!left.includes(hsh)) { auth.loginFailed(key); log(req, 'auth', 'auth.twofaFail', {}, 'warn', u.id); throw Object.assign(new Error('err.twofaBad'), { status: 401 }); }
      db.setRecovery(u.id, left.filter((x) => x !== hsh));
      log(req, 'auth', 'auth.recoveryUsed', { left: left.length - 1 }, 'warn', u.id);
    }
    if (remember) auth.rememberDevice(req, res, u.id);
  }
  auth.loginOk(key);
  auth.startSession(req, res, u.id);
  log(req, 'auth', 'auth.login', {}, 'info', u.id);
  // existing accounts without 2FA get one reminder in the bell
  if (!u.totp_enabled && !u.totp_required && !u.totp_nagged) {
    db.saveAlerts([{ type: 'SECURITY', severity: 'MED', user_id: u.id, message: JSON.stringify({ code: 'alert.twofa', params: {} }) }]);
    db.markNagged(u.id);
  }
  res.json({ user: db.getUser(u.id) });
}));

// ---------- two-factor authentication (needs a session; also works while 2FA is still pending) ----------
const sessionUser = (req) => { const u = auth.currentUser(req); if (!u) throw Object.assign(new Error('err.loginNeeded'), { status: 401 }); return u; };
app.post('/api/auth/2fa/begin', wrap(async (req, res) => {
  const u = sessionUser(req), full = db.getUserAuthById(u.id);
  // changing an already enabled second factor requires the password
  if (full.totp_enabled && !auth.verifyPassword(String(req.body?.password || ''), full.pass_hash)) throw bad('err.passwordCurrent');
  const secret = totp.newSecret();
  db.setTotpPending(u.id, secret);
  const url = totp.otpauthUrl(secret, u.username);
  res.json({ secret, url, qr: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
}));
app.post('/api/auth/2fa/enable', wrap((req, res) => {
  const u = sessionUser(req), full = db.getUserAuthById(u.id);
  if (!full.totp_pending) throw bad('err.twofaBegin');
  const counter = totp.verify(full.totp_pending, req.body?.code);
  if (counter == null) throw bad('err.twofaBad');
  const codes = totp.newRecoveryCodes();
  db.enableTotp(u.id, full.totp_pending, counter, codes.map(totp.hashCode));
  if (req.body?.remember) auth.rememberDevice(req, res, u.id);
  log(req, 'auth', 'auth.twofaOn', {}, 'info', u.id);
  res.json({ user: db.getUser(u.id), recovery: codes });
}));
app.post('/api/auth/2fa/disable', wrap((req, res) => {
  const u = sessionUser(req), full = db.getUserAuthById(u.id);
  if (full.totp_required) throw bad('err.twofaMandatory');
  if (!auth.verifyPassword(String(req.body?.password || ''), full.pass_hash)) throw bad('err.passwordCurrent');
  db.disableTotp(u.id);
  log(req, 'auth', 'auth.twofaOff', {}, 'warn', u.id);
  res.json({ user: db.getUser(u.id) });
}));
app.post('/api/auth/2fa/recovery', wrap((req, res) => {
  const u = sessionUser(req), full = db.getUserAuthById(u.id);
  if (!full.totp_enabled) throw bad('err.twofaBegin');
  if (!auth.verifyPassword(String(req.body?.password || ''), full.pass_hash)) throw bad('err.passwordCurrent');
  const codes = totp.newRecoveryCodes();
  db.setRecovery(u.id, codes.map(totp.hashCode));
  res.json({ recovery: codes });
}));
app.post('/api/auth/2fa/forget-devices', wrap((req, res) => { const u = sessionUser(req); db.forgetDevices(u.id); res.json({ ok: true }); }));
app.get('/api/auth/2fa/devices', wrap((req, res) => res.json(db.listDevices(sessionUser(req).id))));
// custom theme images – also visible on the sign-in screen
app.get('/api/auth/theme/:slot', wrap((req, res) => {
  const slot = req.params.slot, meta = appearance().custom?.[slot];
  if (!THEME_SLOTS.includes(slot) || !meta) return res.status(404).end();
  res.setHeader('Content-Type', meta.type); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=86400');
  fs.createReadStream(path.join(THEME_DIR, slot)).on('error', () => res.status(404).end()).pipe(res);
}));
app.post('/api/auth/logout', wrap((req, res) => { const u = auth.currentUser(req); if (u) log(req, 'auth', 'auth.logout', {}, 'info', u.id); auth.endSession(req, res); res.json({ ok: true }); }));

// ---------- version and update ----------
app.get('/api/update', superOnly, wrap(async (req, res) => {
  const c = await checkLatest(req.query.check === '1');
  res.json({ current: VERSION, latest: c.latest, checked: c.checked, error: c.error, available: !!c.latest && compareVersions(c.latest, VERSION) > 0, mode: updateMode(), state: updateState });
}));
app.post('/api/update', superOnly, wrap((req, res) => {
  if (updateMode() !== 'self') throw bad('err.updateManual');
  if (updateState.running) throw Object.assign(new Error('err.updateBusy'), { status: 409 });
  log(req, 'admin', 'admin.update', { from: VERSION });
  runUpdate().catch((e) => { console.error('[update]', e.message); db.addLog({ category: 'system', level: 'error', code: 'system.updateError', params: { error: String(e.stderr || e.message).slice(-200) } }); });
  res.status(202).json({ ok: true });
}));

// ---------- account and users ----------
const LANGS = ['pl', 'de', 'en'];
const INVITE_DAYS = 7;
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
/** Creates an invitation for the account and e-mails the link where the user sets their own password. */
async function invite(req, user, lang) {
  const settings = db.getSettings();
  if (!user.email) throw bad('err.inviteEmail');
  if (!smtpReady(settings)) throw bad('err.inviteSmtp');
  const token = crypto.randomBytes(32).toString('base64url');
  db.createInvite(user.id, tokenHash(token), Date.now() + INVITE_DAYS * 86400000);
  const link = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}/#/invite/${token}`;
  try { await sendInvite(settings, { to: user.email, lang: lang || user.lang, username: user.username, link, days: INVITE_DAYS }); }
  catch (e) { console.error('[mail]', e.message); log(req, 'notify', 'notify.mailError', { error: e.message.slice(0, 200) }, 'error'); throw bad('err.inviteSend'); }
  log(req, 'admin', 'admin.userInvite', { name: user.username, to: user.email });
}
const cleanEmail = (e) => { const v = String(e || '').trim().slice(0, 200); if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('err.email'); return v; };
app.put('/api/account', wrap((req, res) => {
  const b = req.body || {};
  const patch = {};
  if (b.email !== undefined) patch.email = cleanEmail(b.email);
  if (LANGS.includes(b.lang)) patch.lang = b.lang; // interface language – e-mails follow it
  if (b.password) {
    if (!auth.verifyPassword(String(b.current || ''), db.getUserAuthById(req.user.id).pass_hash)) throw bad('err.passwordCurrent');
    if (!auth.validPassword(b.password)) throw bad('err.password');
    patch.pass_hash = auth.hashPassword(b.password);
  }
  const user = db.updateUser(req.user.id, patch);
  if (patch.pass_hash) { auth.startSession(req, res, user.id); log(req, 'auth', 'auth.password'); } // a password change signs out other devices
  res.json({ user });
}));
// list for choosing a recipient (sharing, messages): no e-mail addresses for regular users
app.get('/api/users', wrap((req, res) => res.json(db.listUsers().map((u) => (req.user.role === 'admin' ? { ...u, ...auth.presence(u.id) } : { id: u.id, username: u.username, role: u.role })))));
app.post('/api/users', admin, wrap(async (req, res) => {
  const { username, password, role, email } = req.body || {};
  const byInvite = !!req.body?.invite, lang = LANGS.includes(req.body?.lang) ? req.body.lang : null;
  if (!auth.validUsername(username)) throw bad('err.username');
  if (!byInvite && !auth.validPassword(password)) throw bad('err.password');
  if (db.getUserAuth(String(username))) throw bad('err.userExists');
  const mail = cleanEmail(email);
  if (byInvite && !mail) throw bad('err.inviteEmail');
  if (byInvite && !smtpReady(db.getSettings())) throw bad('err.inviteSmtp');
  // an invited account gets a random password nobody knows until the user sets their own
  const user = db.createUser({ username: String(username), pass_hash: auth.hashPassword(byInvite ? crypto.randomBytes(32).toString('hex') : password), role: role === 'admin' ? 'admin' : 'user', email: mail, lang });
  if (byInvite) {
    try { await invite(req, user, lang); } catch (e) { db.deleteUser(user.id); throw e; }
  }
  log(req, 'admin', 'admin.userAdd', { name: String(username) });
  res.status(201).json(db.getUser(user.id));
}));
// sends the invitation again (a new link; the previous one stops working)
app.post('/api/users/:id/invite', admin, wrap(async (req, res) => {
  const cur = db.getUser(Number(req.params.id));
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  if (!cur.invited) throw bad('err.inviteDone');
  await invite(req, cur, null);
  res.json({ ok: true });
}));
// the invited person: check the link, then choose a password (public – the token is the proof)
const invited = (req) => { const inv = db.getInvite(tokenHash(req.params.token)); const u = inv && db.getUser(inv.user_id); if (!u) throw Object.assign(new Error('err.inviteInvalid'), { status: 404 }); return u; };
app.get('/api/auth/invite/:token', wrap((req, res) => { const u = invited(req); res.json({ username: u.username, email: u.email }); }));
app.post('/api/auth/invite/:token', wrap((req, res) => {
  const u = invited(req), b = req.body || {};
  // the person may correct the username and must confirm an e-mail address
  const username = b.username === undefined ? u.username : String(b.username).trim();
  if (!auth.validUsername(username)) throw bad('err.username');
  const other = db.getUserAuth(username);
  if (other && other.id !== u.id) throw bad('err.userExists');
  const email = b.email === undefined ? u.email : cleanEmail(b.email);
  if (!email) throw bad('err.emailRequired');
  if (!auth.validPassword(b.password)) throw bad('err.password');
  db.updateUser(u.id, { username, email, pass_hash: auth.hashPassword(b.password), ...(LANGS.includes(b.lang) ? { lang: b.lang } : {}) }); // also removes the invitation
  log(req, 'auth', 'auth.inviteAccepted', {}, 'info', u.id);
  res.json({ ok: true, username }); // no session: the person signs in on the start page next
}));
app.put('/api/users/:id', admin, wrap((req, res) => {
  const id = Number(req.params.id), cur = db.getUser(id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  const b = req.body || {}, patch = {};
  // the super administrator's account can be changed only by its owner, and always stays an administrator
  if (cur.super && (req.user.id !== cur.id || (b.role != null && b.role !== 'admin'))) return res.status(403).json({ error: 'err.superProtected' });
  if (b.role != null) {
    patch.role = b.role === 'admin' ? 'admin' : 'user';
    if (cur.role === 'admin' && patch.role !== 'admin' && db.countAdmins() <= 1) throw bad('err.lastAdmin');
  }
  if (b.email !== undefined) patch.email = cleanEmail(b.email);
  if (b.password) { if (!auth.validPassword(b.password)) throw bad('err.password'); patch.pass_hash = auth.hashPassword(b.password); }
  if (b.reset2fa) db.disableTotp(id); // the user sets up the second factor again at sign-in
  log(req, 'admin', 'admin.userEdit', { name: cur.username, reset2fa: !!b.reset2fa, password: !!b.password });
  res.json(db.updateUser(id, patch));
}));
app.delete('/api/users/:id', admin, wrap((req, res) => {
  const id = Number(req.params.id), cur = db.getUser(id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  if (id === req.user.id) throw bad('err.deleteSelf');
  if (cur.super) return res.status(403).json({ error: 'err.superProtected' });
  if (cur.role === 'admin' && db.countAdmins() <= 1) throw bad('err.lastAdmin');
  for (const fid of db.filesOfUser(id)) fs.rmSync(path.join(FILES_DIR, String(fid)), { force: true });
  db.deleteUser(id); auth.forgetPresence(id); invalidate();
  log(req, 'admin', 'admin.userDelete', { name: cur.username });
  res.json({ ok: true });
}));

// ---------- custom theme: image upload ----------
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

// ---------- Google: connecting an account for sending mail (OAuth2) ----------
// Needs your own OAuth client in Google Cloud with the redirect URI https://<your-domain>/api/auth/google/callback.
const googleRedirect = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.headers.host}/api/auth/google/callback`;
app.get('/api/google/start', superOnly, wrap((req, res) => {
  const s = db.getSettings().smtp;
  if (!s.oauthClientId || !s.oauthClientSecret) throw bad('err.googleClient');
  const state = crypto.randomBytes(24).toString('hex');
  db.setMeta('googleState', JSON.stringify({ state, user: req.user.id, exp: Date.now() + 10 * 60 * 1000 }));
  const q = new URLSearchParams({ client_id: s.oauthClientId, redirect_uri: googleRedirect(req), response_type: 'code', scope: 'https://mail.google.com/', access_type: 'offline', prompt: 'consent', state });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, redirect: googleRedirect(req) });
}));
app.get('/api/auth/google/callback', wrap(async (req, res) => {
  const user = auth.currentUser(req);
  let saved = {}; try { saved = JSON.parse(db.getMeta('googleState') || '{}'); } catch { /* none */ }
  const done = (msg) => res.redirect(`/#/settings?google=${encodeURIComponent(msg)}`);
  if (!user || user.role !== 'admin' || !saved.state || saved.state !== req.query.state || saved.user !== user.id || saved.exp < Date.now()) return done('state');
  db.setMeta('googleState', '');
  if (!req.query.code) return done(String(req.query.error || 'denied'));
  const s = db.getSettings().smtp;
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({ code: String(req.query.code), client_id: s.oauthClientId, client_secret: s.oauthClientSecret, redirect_uri: googleRedirect(req), grant_type: 'authorization_code' }) });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) return done(j.error_description || j.error || 'no_refresh_token');
    db.saveSettings({ smtp: { auth: 'oauth2', oauthRefreshToken: j.refresh_token, host: s.host || 'smtp.gmail.com', port: s.host ? s.port : 465, security: s.host ? s.security : 'tls' } });
    db.addLog({ user_id: user.id, category: 'admin', code: 'admin.google', params: {} });
    done('ok');
  } catch (e) { done(e.message.slice(0, 80)); }
}));
app.post('/api/google/disconnect', superOnly, wrap((req, res) => {
  const all = db.getSettings(); all.smtp.oauthRefreshToken = ''; all.smtp.auth = 'password';
  db.replaceSetting('smtp', all.smtp);
  res.json({ ok: true });
}));

// ---------- live prices for open positions ----------
const liveCache = new Map(); // id -> { at, quote }
app.get('/api/positions/live', wrap(async (req, res) => {
  const s = db.getSettings();
  const ttl = Math.max(5, s.data.liveSeconds || 20) * 1000;
  const out = {};
  for (const pos of db.listPositions(req.user.id)) {
    const id = pos.instrument_id;
    if (out[id]) continue;
    const hit = liveCache.get(id);
    if (hit && Date.now() - hit.at < ttl) { out[id] = hit.quote; continue; }
    const inst = db.getInstrument(id);
    if (!inst) continue;
    try { const q = await quoteFor(inst); liveCache.set(id, { at: Date.now(), quote: q }); out[id] = q; }
    catch { /* no price – the position shows the last close */ }
  }
  res.json({ quotes: out, every: Math.round(ttl / 1000) });
}));

// ---------- algorithm accuracy ----------
app.get('/api/signals', wrap((req, res) => {
  const since = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10);
  const all = db.listSignals(since);
  // period: signals that ended within the last N days (default two weeks)
  const days = [14, 30, 91, 182, 365].includes(Number(req.query.days)) ? Number(req.query.days) : 14;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  // only grade A setups count – the ones the app calls primary
  const list = all.filter((x) => x.grade === 'A' && (!x.closed || x.closed >= cutoff));
  res.json({ busy: signalsBusy(), through: db.getMeta('signalsThrough'), days, from: cutoff, stats: signalStats(list), recent: list.filter((x) => x.closed).slice(0, 500), open: all.filter((x) => x.grade === 'A' && !x.closed).length });
}));
app.post('/api/signals/rebuild', admin, wrap((req, res) => {
  if (signalsBusy()) throw Object.assign(new Error('BUSY'), { status: 409 });
  db.resetSignals();
  updateSignals().then(() => invalidate()).catch((e) => console.error('[signals]', e.message));
  res.status(202).json({ started: true });
}));

// ---------- logs ----------
const LOG_CATEGORIES = ['auth', 'trade', 'system', 'data', 'notify', 'admin'];
app.get('/api/logs', superOnly, wrap((req, res) => {
  const q = req.query, isAdm = true;
  const category = LOG_CATEGORIES.includes(q.category) ? q.category : null;
  const rows = db.listLogs({ all: isAdm, userId: isAdm ? (q.user === 'system' ? 0 : Number(q.user) || null) : req.user.id, category, before: Number(q.before) || null, limit: Number(q.limit) || 100 });
  res.json({ categories: LOG_CATEGORIES, rows: rows.map((r) => ({ id: r.id, ts: r.ts, user: r.username || null, category: r.category, level: r.level, code: r.code, params: r.params, ip: isAdm ? r.ip : undefined })) });
}));

// ---------- portfolio sharing ----------
app.get('/api/shares', wrap((req, res) => res.json({ viewers: db.sharesOf(req.user.id), sharedWithMe: db.sharedWith(req.user.id) })));
app.put('/api/shares', wrap((req, res) => {
  const ids = Array.isArray(req.body?.viewers) ? req.body.viewers.map(Number).filter(Number.isInteger).slice(0, 500) : [];
  db.setShares(req.user.id, ids);
  res.json({ viewers: db.sharesOf(req.user.id) });
}));
// Another user's portfolio – only when they shared it. Read-only.
app.get('/api/portfolio/:userId', wrap((req, res) => {
  const owner = db.getUser(Number(req.params.userId));
  if (!owner || !db.canView(owner.id, req.user.id)) return res.status(403).json({ error: 'err.notShared' });
  const s = db.getSettings(owner.id);
  const market = getMarket(owner.id);
  res.json({ owner: { id: owner.id, username: owner.username }, portfolio: market.portfolio, capital: s.capital, ...buildLedger(db.listTrades(owner.id), s.capital.start) });
}));

// ---------- messages ----------
function tradeSnapshot(userId, tradeId) {
  const t = db.getTrade(tradeId);
  if (!t || t.user_id !== userId) throw bad('err.tradeNotFound');
  const s = db.getSettings(userId);
  const row = buildLedger(db.listTrades(userId), s.capital.start).trades.find((x) => x.id === t.id);
  return { instrument_id: t.instrument_id, direction: t.direction, risk_pct: t.risk_pct, entry: t.entry, stop_initial: t.stop_initial, exit: t.exit,
    opened: t.opened, closed: t.closed, r: t.r, pnl: row?.pnl ?? null, pnlPct: row?.pnlPct ?? null, currency: s.capital.currency };
}
const FILES_DIR = path.join(DATA_DIR, 'files');
/** Shared part of sending: body, trade, attachment. */
function messageParts(req) {
  const b = req.body || {};
  const body = String(b.body || '').trim().slice(0, 2000);
  const trade = b.trade_id != null ? tradeSnapshot(req.user.id, Number(b.trade_id)) : null;
  let file_id = null;
  if (b.file_id != null) { const f = db.getFile(b.file_id); if (!f || f.owner_id !== req.user.id) throw bad('err.fileNotFound'); file_id = f.id; }
  if (!body && !trade && !file_id) throw bad('err.messageEmpty');
  return { body, trade, file_id };
}
const pushMessage = (toId, from, body, url) => pushToUser(toId, (lang) => ({ title: tr(lang, 'push.message', { name: from }), body: body || tr(lang, 'push.attachment'), url })).catch(() => {});

app.get('/api/messages', wrap((req, res) => {
  const users = Object.fromEntries(db.listUsers().map((u) => [u.id, u.username]));
  res.json({
    threads: db.threadSummaries(req.user.id).filter((x) => users[x.other]).map((x) => ({ user: { id: x.other, username: users[x.other] }, unread: x.unread, last: x.last })).sort((a, b) => b.last.id - a.last.id),
    rooms: db.listRooms(req.user.id, req.user.role === 'admin'),
  });
}));
app.get('/api/messages/:userId', wrap((req, res) => {
  const other = db.getUser(Number(req.params.userId));
  if (!other) return res.status(404).json({ error: 'err.notFound' });
  db.markThreadRead(req.user.id, other.id);
  res.json({ user: { id: other.id, username: other.username }, messages: db.thread(req.user.id, other.id) });
}));
app.post('/api/messages', wrap((req, res) => {
  const to = db.getUser(Number(req.body?.to));
  if (!to || to.id === req.user.id) throw bad('err.recipient');
  const parts = messageParts(req);
  const id = db.addMessage({ from_id: req.user.id, to_id: to.id, ...parts });
  pushMessage(to.id, req.user.username, parts.body, `/#/messages?u=${req.user.id}`);
  res.status(201).json({ id });
}));

// ---------- group chat: groups are created and staffed by an administrator ----------
function validRoom(b) {
  const name = String(b?.name || '').trim().slice(0, 60);
  if (!name) throw bad('err.roomName');
  const members = Array.isArray(b?.members) ? [...new Set(b.members.map(Number).filter(Number.isInteger))].slice(0, 500) : [];
  return { name, members };
}
app.post('/api/rooms', admin, wrap((req, res) => { const r = db.saveRoom({ ...validRoom(req.body), created_by: req.user.id }); log(req, 'admin', 'admin.room', { name: r.name }); res.status(201).json(r); }));
app.put('/api/rooms/:id', admin, wrap((req, res) => {
  if (!db.getRoom(req.params.id)) return res.status(404).json({ error: 'err.notFound' });
  const r = db.saveRoom({ id: Number(req.params.id), ...validRoom(req.body) }); log(req, 'admin', 'admin.room', { name: r.name }); res.json(r);
}));
app.delete('/api/rooms/:id', admin, wrap((req, res) => { const r = db.getRoom(req.params.id); if (r) { db.deleteRoom(r.id); log(req, 'admin', 'admin.roomDelete', { name: r.name }); } res.json({ ok: true }); }));
const memberRoom = (req) => { const r = db.getRoom(req.params.id); if (!r || !db.isMember(r.id, req.user.id)) throw Object.assign(new Error('err.notMember'), { status: 403 }); return r; };
app.get('/api/rooms/:id/messages', wrap((req, res) => {
  const r = memberRoom(req);
  db.markRoomRead(r.id, req.user.id);
  const users = Object.fromEntries(db.listUsers().map((u) => [u.id, u.username]));
  res.json({ room: { id: r.id, name: r.name, members: db.roomMembers(r.id).map((id) => ({ id, username: users[id] })).filter((m) => m.username) },
    messages: db.roomThread(r.id).map((m) => ({ ...m, from: users[m.from_id] || '?' })) });
}));
app.post('/api/rooms/:id/messages', wrap((req, res) => {
  const r = memberRoom(req), parts = messageParts(req);
  const id = db.addMessage({ from_id: req.user.id, room_id: r.id, ...parts });
  for (const u of db.roomMembers(r.id)) if (u !== req.user.id) pushMessage(u, `${req.user.username} · ${r.name}`, parts.body, `/#/messages?r=${r.id}`);
  res.status(201).json({ id });
}));

// ---------- message attachments (up to 5 MB) ----------
app.post('/api/files', express.raw({ type: () => true, limit: '5mb' }), wrap((req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('err.fileEmpty');
  let name = 'file';
  try { name = decodeURIComponent(String(req.headers['x-filename'] || 'file')); } catch { /* keep the default name */ }
  name = name.replace(/[\\/\u0000-\u001f"<>|:*?]/g, '_').slice(-120) || 'file';
  // the type is decided here: recognised images are previewed, everything else is download-only
  const type = sniffImage(req.body) || 'application/octet-stream';
  const id = db.addFile({ owner_id: req.user.id, name, type, size: req.body.length });
  fs.mkdirSync(FILES_DIR, { recursive: true });
  fs.writeFileSync(path.join(FILES_DIR, String(id)), req.body);
  res.status(201).json({ id, name, type, size: req.body.length, image: type.startsWith('image/') });
}));
app.get('/api/files/:id', wrap((req, res) => {
  const f = db.getFile(req.params.id);
  if (!f || !db.canSeeFile(f.id, req.user.id)) return res.status(404).json({ error: 'err.notFound' });
  res.setHeader('Content-Type', f.type); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', `${f.type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  fs.createReadStream(path.join(FILES_DIR, String(f.id))).on('error', () => res.status(404).end()).pipe(res);
}));

// ---------- push notifications ----------
app.get('/api/push/key', wrap((req, res) => res.json({ key: vapidPublicKey(), devices: db.pushSubs(req.user.id).length })));
app.post('/api/push/subscribe', wrap((req, res) => {
  const sub = req.body?.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw bad('err.pushSub');
  db.addPushSub({ user_id: req.user.id, endpoint: String(sub.endpoint).slice(0, 1000), p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth), lang: String(req.body.lang || 'en').slice(0, 5) });
  res.json({ ok: true });
}));
app.post('/api/push/unsubscribe', wrap((req, res) => { if (req.body?.endpoint) db.removePushSub(String(req.body.endpoint)); res.json({ ok: true }); }));
app.post('/api/push/test', wrap(async (req, res) => {
  const n = await pushToUser(req.user.id, (lang) => ({ title: 'KumoDesk', body: tr(lang, 'push.test'), url: '/#/' }));
  if (!n) throw bad('err.pushNone');
  res.json({ sent: n });
}));

// ---------- market ----------
app.get('/api/dashboard', wrap((req, res) => res.json(getMarket(req.user.id))));

// "Current" chart: fetches fresh data for the instrument, at most once every 5 minutes.
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
  // view=analysis: exactly the candles the analysis is calculated on (closed only)
  // view=live: the same plus the candle still in progress, with fresh data
  const view = req.query.view === 'live' ? 'live' : 'analysis';
  const allH4 = db.getH4(inst.id);
  const tf = req.query.tf === 'h4' && allH4.length ? 'h4' : 'd1';
  if (view === 'live') { await freshenForLiveView(inst, tf); inst = db.getInstrument(inst.id); }
  const market = getMarket(req.user.id);
  let analysis = market.instruments.find((a) => a.id === inst.id) || null;
  if (analysis?.funnel) { // add when each stage last changed its status
    const log = Object.fromEntries(db.stagesOf(req.user.id, inst.id).map((r) => [r.stage, r]));
    const hist = Object.fromEntries(db.stageHistOf(inst.id).map((r) => [r.stage, r]));
    analysis = { ...analysis, funnel: analysis.funnel.map((st) => {
      const own = log[st.key]?.status === st.status ? log[st.key] : null;
      if (own && !own.initial) return { ...st, since: own.since };                                   // seen changing by an analysis run: exact time
      if (hist[st.key]?.status === st.status) return { ...st, sinceCandle: hist[st.key].since };      // from the replayed history: the candle
      return own ? { ...st, since: own.since, sinceInitial: true } : st;
    }) };
    // since when the overall outcome holds ("passed everything" / "stopped at stage X")
    const want = analysis.failedAt ? `STOP:${analysis.failedAt}` : 'REACHED';
    if (log.result?.status === want) analysis.resultSince = { ts: log.result.since, initial: !!log.result.initial };
    // before stage times were recorded: the candle on which "trade" last appeared tells when everything was passed
    if (!analysis.failedAt && (!analysis.resultSince || analysis.resultSince.initial)) {
      const last = db.playMarksOf(inst.id).filter((x) => x.dir === analysis.dir).at(-1);
      if (last) analysis.resultSince = { candle: last.date };
    }
  }
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
    cloudA: ich.cloudA.slice(from), cloudB: ich.cloudB.slice(from), // longer by `shift` (future cloud)
  };
  const positions = market.portfolio.positions.filter((p) => p.instrument_id === inst.id);
  // Chart arrows: every candle on which the recommendation turned into "trade"; drawn on the next candle (the entry day).
  // The stored history ends with the last finished day, so the newest candle is added from the current analysis.
  const signals = tf === 'h4' ? [] : db.playMarksOf(inst.id);
  if (tf !== 'h4' && analysis?.ok && analysis.action === 'PLAY' && analysis.date > (db.getMeta('signalsThrough') || '')) {
    let state = {}; try { state = JSON.parse(db.getMeta('playState') || '{}'); } catch { state = {}; }
    if ((state[inst.id] || null) !== analysis.dir && !signals.some((x) => x.date === analysis.date)) signals.push({ date: analysis.date, dir: analysis.dir, grade: analysis.grade ?? null });
  }
  chart.signals = signals;
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
  res.json(db.listSnapshots(300, req.user.id).map((s) => ({
    id: s.id, ts: s.ts, trigger: s.trigger, matrix: s.matrix_score, regime: s.regime, exec: s.exec_state,
    primary: s.summary.primary, primaryDir: s.summary.grades?.[s.summary.primary]?.d ?? null,
    mood: s.summary.mood, portfolio: s.summary.portfolio,
  })));
}));

// Bell: the same events that go out by e-mail.
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

// ---------- settings ----------
app.get('/api/settings', wrap((req, res) => {
  res.json({
    settings: publicSettings(req.user),
    mailReady: smtpReady(db.getSettings()),
    loginBgs: LOGIN_BGS, appBgs: APP_BGS, themes: THEMES, accents: ACCENTS,
    providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, needsKey: p.needsKey, daily: !!p.fetchDaily, live: !!p.fetchQuote })),
    classes: CLASSES,
  });
}));

app.put('/api/settings', wrap((req, res) => {
  const patch = req.body || {};
  // capital and risk limits are personal; the rest are server settings and need an administrator
  const personal = {};
  for (const k of db.PERSONAL_KEYS) if (patch[k]) { personal[k] = patch[k]; }
  const globalKeys = Object.keys(patch).filter((k) => !db.PERSONAL_KEYS.includes(k));
  if (globalKeys.length && req.user.role !== 'admin') throw Object.assign(new Error('err.adminOnly'), { status: 403 });
  // market data, mail server and notification rules belong to the super administrator
  if (globalKeys.some((k) => ['data', 'smtp', 'notify'].includes(k)) && !req.user.super) throw Object.assign(new Error('err.superOnly'), { status: 403 });
  if (patch.appearance) {
    if (patch.appearance.loginBg != null && !LOGIN_BGS.includes(patch.appearance.loginBg)) throw bad('err.background');
    if (patch.appearance.appBg != null && !APP_BGS.includes(patch.appearance.appBg)) throw bad('err.background');
    if (patch.appearance.theme != null && !THEMES.includes(patch.appearance.theme)) throw bad('err.background');
    if (patch.appearance.accent != null && patch.appearance.accent !== '' && !ACCENTS.includes(patch.appearance.accent)) throw bad('err.background');
    delete patch.appearance.custom; // images change only through file upload
  }
  if (patch.risk) for (const k of ['maxTotal', 'maxCurrency', 'maxPosition']) if (patch.risk[k] != null) { const v = Number(patch.risk[k]); if (!(v > 0 && v <= 100)) throw bad('err.riskPct'); patch.risk[k] = v; }
  if (patch.smtp) {
    if (!patch.smtp.pass && !patch.smtp.clearPass) delete patch.smtp.pass;
    if (!patch.smtp.oauthClientSecret) delete patch.smtp.oauthClientSecret;
    if (patch.smtp.auth != null && !['password', 'oauth2'].includes(patch.smtp.auth)) throw bad('err.smtp');
    // the refresh token is set only by connecting to Google or by pasting it explicitly
    if (!patch.smtp.oauthRefreshToken) delete patch.smtp.oauthRefreshToken;
    delete patch.smtp.passSet; delete patch.smtp.clearPass; delete patch.smtp.oauthSecretSet; delete patch.smtp.oauthConnected;
  }
  if (patch.data) for (const k of API_KEYS) {
    delete patch.data[`${k}Set`];
    if (patch.data[k] === '-') patch.data[k] = '';                                   // a single dash removes the stored key
    else if (!patch.data[k]) delete patch.data[k];                                   // empty = keep what is stored
    else patch.data[k] = String(patch.data[k]).trim();
  }
  if (patch.data?.provider && !PROVIDERS[patch.data.provider]?.fetchDaily) throw bad('err.provider');
  if (patch.data?.liveProvider && !PROVIDERS[patch.data.liveProvider]?.fetchQuote) throw bad('err.provider');
  if (patch.data?.liveSeconds != null) patch.data.liveSeconds = Math.max(5, Math.min(600, Math.round(Number(patch.data.liveSeconds)) || 20));
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
  log(req, globalKeys.length ? 'admin' : 'trade', 'admin.settings', { keys: [...globalKeys, ...Object.keys(personal)].join(', ') });
  invalidate();
  res.json({ settings: publicSettings(req.user) });
}));

app.post('/api/settings/test-smtp', superOnly, wrap(async (req, res) => {
  try { await sendTest(db.getSettings(), req.body?.lang); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

app.post('/api/providers/test', superOnly, wrap(async (req, res) => {
  const { provider, symbol } = req.body || {};
  const p = PROVIDERS[provider];
  if (!p) throw bad('err.provider');
  if (!symbol) throw bad('err.symbol');
  try {
    const bars = await p.fetchDaily(String(symbol), { years: 1, settings: db.getSettings() });
    res.json({ ok: true, bars: bars.length, last: bars.at(-1) || null });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));

// ---------- time groups ----------
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

// ---------- instruments ----------
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
// Instruments: one shared catalogue; every user switches their own set on and off and may add to the catalogue.
// Editing and deleting an entry is for its creator and for administrators.
const MAX_OWN_INSTRUMENTS = 500;
const canEditInst = (req, inst) => req.user.role === 'admin' || (inst.owner_id != null && inst.owner_id === req.user.id);
const ownLimit = (req, adding = 1) => { if (req.user.role !== 'admin' && db.countOwnInstruments(req.user.id) + adding > MAX_OWN_INSTRUMENTS) throw bad('err.instLimit'); };
const instFor = (req) => db.listInstruments(req.user.id).map((i) => ({ ...i, canEdit: canEditInst(req, i), autoSymbols: { eodhd: i.symbols?.eodhd ? null : deriveSymbol('eodhd', i) } }));
app.get('/api/instruments', wrap((req, res) => res.json(instFor(req))));
app.post('/api/instruments', wrap((req, res) => {
  const it = validInstrument(req.body || {});
  if (db.getInstrument(it.id)) throw bad('err.instExists');
  ownLimit(req);
  // new entries are off for everybody else; the creator's choice is stored as their own switch
  db.upsertInstrument({ ...it, enabled: false, owner_id: req.user.role === 'admin' ? null : req.user.id });
  db.setUserInstrument(req.user.id, it.id, it.enabled);
  invalidate();
  res.status(201).json(instFor(req).find((i) => i.id === it.id));
}));
app.put('/api/instruments/:id', wrap((req, res) => {
  const cur = db.getInstrument(req.params.id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  const b = req.body || {};
  const onlySwitch = Object.keys(b).every((k) => k === 'enabled');
  if (!onlySwitch) {
    if (!canEditInst(req, cur)) return res.status(403).json({ error: 'err.instNotYours' });
    db.upsertInstrument({ ...validInstrument(b, cur), enabled: cur.enabled, owner_id: cur.owner_id });
  }
  if (b.enabled != null) db.setUserInstrument(req.user.id, cur.id, !!b.enabled);
  invalidate();
  res.json(instFor(req).find((i) => i.id === cur.id));
}));
// Bulk import of instruments: lines "SYMBOL;Name" (data-source symbol).
app.post('/api/instruments/import', wrap((req, res) => {
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
    // a source symbol may contain ^ and = (e.g. ^GSPC, GC=F); the in-app identifier may not
    const id = symbol.toUpperCase().replace(/[\^=]/g, '');
    if (!/^[A-Za-z0-9.^=_-]{1,24}$/.test(symbol) || !/^[A-Z0-9._-]{1,20}$/.test(id)) { invalid.push(line.slice(0, 30)); continue; }
    if (db.getInstrument(id)) { skipped++; continue; }
    ownLimit(req);
    db.upsertInstrument({ id, name: rest.join(' ').trim() || symbol, class: cls, category, group_id, enabled: false, owner_id: req.user.role === 'admin' ? null : req.user.id, symbols: { [provider]: symbol } });
    db.setUserInstrument(req.user.id, id, b.enabled !== false);
    added++;
  }
  invalidate();
  log(req, 'admin', 'admin.import', { added, category });
  res.json({ added, skipped, invalid });
}));
app.post('/api/categories/toggle', wrap((req, res) => {
  const { category, enabled } = req.body || {};
  if (!category) throw bad('err.category');
  const changed = db.setUserCategory(req.user.id, String(category), !!enabled);
  log(req, 'admin', 'admin.category', { category: String(category), enabled: !!enabled });
  invalidate();
  res.json({ changed });
}));
app.delete('/api/instruments/:id', wrap((req, res) => {
  const cur = db.getInstrument(req.params.id);
  if (!cur) return res.status(404).json({ error: 'err.notFound' });
  if (!canEditInst(req, cur)) return res.status(403).json({ error: 'err.instNotYours' });
  if (req.user.role !== 'admin' && db.positionsOfOthers(cur.id, req.user.id)) throw bad('err.instInUse'); // someone else holds a position in it
  db.deleteInstrument(cur.id); invalidate(); res.json({ ok: true });
}));

// ---------- current price ----------
/** Price from the API; if the source fails – the last close from the database (marked as stale). */
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

// ---------- portfolio ----------
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
/** The position must belong to the signed-in user. */
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
    // "at market" entry: the entry price is fetched from the API when the position is added
    quote = await quoteFor(db.getInstrument(p.instrument_id));
    p.entry = quote.price;
    p.opened = p.opened || new Date().toISOString().slice(0, 10);
    if (p.stop != null && (p.direction === 'LONG' ? p.stop >= p.entry : p.stop <= p.entry)) throw bad('err.stopSide');
  }
  const id = db.savePosition(p);
  invalidate(); kickH4(req.user.id);
  log(req, 'trade', 'trade.open', { id: p.instrument_id, dir: p.direction, risk: p.risk_pct });
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
  log(req, 'trade', 'trade.close', { id: pos.instrument_id, r: r != null ? Math.round(r * 100) / 100 : null });
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
app.delete('/api/positions/:id', wrap((req, res) => { const pos = ownPosition(req); db.deletePosition(pos.id); invalidate(); log(req, 'trade', 'trade.delete', { id: pos.instrument_id }); res.json({ ok: true }); }));

// ---------- static files ----------
// Scripts and styles are served under /v/<version>/, so after an update no browser or proxy cache can keep old files.
const indexHtml = () => fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
  .replace('src="scheme.js"', `src="/v/${VERSION}/scheme.js"`).replace('href="style.css"', `href="/v/${VERSION}/style.css"`).replace('src="app.js"', `src="/v/${VERSION}/app.js"`);
app.get(['/', '/index.html'], (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(indexHtml()); });
app.use('/v/:version', express.static(path.join(ROOT, 'public'), { maxAge: '365d', immutable: true, index: false }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: 0 }));
app.use('/api', (req, res) => res.status(404).json({ error: 'err.notFound' }));

app.listen(PORT, HOST, () => {
  db.addLog({ category: 'system', code: 'system.start', params: { version: VERSION } });
  console.log(`KumoDesk ${VERSION} – http://${HOST}:${PORT} (data: ${DATA_DIR})`);
  if (process.env.KUMODESK_NO_SCHEDULER !== '1') startScheduler();
  // add signals in the background (on first run: the last year)
  if (process.env.KUMODESK_NO_SIGNALS !== '1') setTimeout(() => updateSignals().then(() => invalidate()).catch((e) => console.error('[signals]', e.message)), 3000);
});
