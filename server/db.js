// Database layer (built-in node:sqlite – no native dependencies).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_GROUPS, DEFAULT_INSTRUMENTS, DEFAULT_SETTINGS } from './defaults.js';

let db;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      close_time TEXT NOT NULL,
      timezone TEXT NOT NULL,
      delay_min INTEGER NOT NULL DEFAULT 15,
      days TEXT NOT NULL DEFAULT '1,2,3,4,5',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_date TEXT,
      last_run_at TEXT,
      last_status TEXT
    );
    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      class TEXT NOT NULL DEFAULT 'other',
      base TEXT,
      quote TEXT,
      group_id INTEGER REFERENCES groups(id),
      enabled INTEGER NOT NULL DEFAULT 1,
      provider TEXT,
      symbols TEXT NOT NULL DEFAULT '{}',
      sort INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_error TEXT
    );
    CREATE TABLE IF NOT EXISTS candles (
      instrument_id TEXT NOT NULL,
      date TEXT NOT NULL,
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL,
      PRIMARY KEY (instrument_id, date)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      risk_pct REAL NOT NULL DEFAULT 1,
      entry REAL, stop REAL,
      opened TEXT, note TEXT
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      trigger TEXT NOT NULL,
      group_id INTEGER,
      matrix_score INTEGER, regime TEXT, exec_state TEXT,
      summary TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      instrument_id TEXT,
      message TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS h4 (
      instrument_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
      PRIMARY KEY (instrument_id, ts)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS h1 (
      instrument_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
      PRIMARY KEY (instrument_id, ts)
    ) WITHOUT ROWID;
  `);
  addColumn('instruments', 'category', "TEXT NOT NULL DEFAULT 'other'");
  addColumn('positions', 'advice', 'TEXT');
  addColumn('positions', 'advice_at', 'TEXT');
  addColumn('positions', 'stop_initial', 'REAL');
  addColumn('positions', 'user_id', 'INTEGER');
  addColumn('alerts', 'user_id', 'INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email TEXT,
      settings TEXT NOT NULL DEFAULT '{}',
      bell_seen INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portfolio_shares (
      owner_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      PRIMARY KEY (owner_id, viewer_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      trade TEXT,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_to ON messages (to_id, read_at);
  `);
  db.exec(`
    UPDATE positions SET stop_initial = stop WHERE stop_initial IS NULL AND stop IS NOT NULL;
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      risk_pct REAL NOT NULL,
      entry REAL, stop_initial REAL, exit REAL,
      opened TEXT, closed TEXT NOT NULL,
      r REAL, pnl_manual REAL,
      note TEXT
    );
  `);
  addColumn('trades', 'user_id', 'INTEGER');
  // group chat, attachments, push
  addColumn('messages', 'room_id', 'INTEGER');
  addColumn('messages', 'file_id', 'INTEGER');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_by INTEGER, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS room_members (room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, last_read INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (room_id, user_id));
    CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS push_subs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, lang TEXT, created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_room ON messages (room_id, id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instrument_id TEXT NOT NULL, dir TEXT NOT NULL, grade TEXT,
      opened TEXT NOT NULL, entry REAL NOT NULL, stop REAL NOT NULL,
      closed TEXT, exit REAL, r REAL, reason TEXT
    );
    CREATE INDEX IF NOT EXISTS signals_inst ON signals (instrument_id, closed);
  `);
  // two-factor authentication
  addColumn('users', 'totp_secret', 'TEXT');
  addColumn('users', 'totp_pending', 'TEXT');
  addColumn('users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'totp_last', 'INTEGER NOT NULL DEFAULT -1');
  addColumn('users', 'totp_required', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'totp_nagged', 'INTEGER NOT NULL DEFAULT 0');
  // interface language (used for e-mails) and pending invitations
  addColumn('users', 'lang', 'TEXT');
  // every user has their own set of instruments: a per-user on/off choice over the shared catalogue
  addColumn('instruments', 'owner_id', 'INTEGER');
  addColumn('snapshots', 'user_id', 'INTEGER');
  // when each funnel stage of an instrument last changed its status, per user
  db.exec(`CREATE TABLE IF NOT EXISTS stage_log (user_id INTEGER NOT NULL, instrument_id TEXT NOT NULL, stage TEXT NOT NULL,
    status TEXT NOT NULL, since TEXT NOT NULL, initial INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, instrument_id, stage))`);
  db.exec('CREATE TABLE IF NOT EXISTS user_instruments (user_id INTEGER NOT NULL, instrument_id TEXT NOT NULL, enabled INTEGER NOT NULL, PRIMARY KEY (user_id, instrument_id))');
  db.exec('CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)');
  addColumn('users', 'recovery', "TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      label TEXT,
      created TEXT NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id INTEGER,
      category TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      code TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      ip TEXT
    );
    CREATE INDEX IF NOT EXISTS logs_user ON logs (user_id, id);
    CREATE INDEX IF NOT EXISTS logs_cat ON logs (category, id);
  `);
  seed();
  // one-off: account currency PLN -> EUR (requested by the installation's owner); amounts stay unchanged
  if (!getMeta('currencyEur')) {
    for (const u of db.prepare('SELECT id, settings FROM users').all()) {
      const st = safeJson(u.settings, {});
      if (st.capital?.currency === 'PLN') { st.capital.currency = 'EUR'; db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(st), u.id); }
    }
    const g = db.prepare("SELECT value FROM settings WHERE key = 'capital'").get();
    if (g) { const c = safeJson(g.value, {}); if (c.currency === 'PLN') { c.currency = 'EUR'; db.prepare("UPDATE settings SET value = ? WHERE key = 'capital'").run(JSON.stringify(c)); } }
    setMeta('currencyEur', 1);
  }
  return db;
}

function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
export const setMeta = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

const SEED_VERSION = 3;

/**
 * Seeds the initial data. When upgrading an existing database it only adds what is missing
 * (new instruments, categories) and leaves user settings alone.
 */
function seed() {
  const version = Number(getMeta('seed') || 0);
  if (version >= SEED_VERSION) return;
  const fresh = db.prepare('SELECT COUNT(*) n FROM groups').get().n === 0;
  const groups = db.prepare('SELECT * FROM groups').all();
  const insG = db.prepare('INSERT INTO groups (name, close_time, timezone, delay_min, days) VALUES (?,?,?,?,?)');
  const gid = {};
  for (const g of DEFAULT_GROUPS) {
    const found = groups.find((x) => x.timezone === g.timezone && x.close_time === g.close_time);
    gid[g.key] = found ? found.id : Number(insG.run(g.name, g.close_time, g.timezone, g.delay_min, g.days || '1,2,3,4,5').lastInsertRowid);
  }
  const existing = new Set(db.prepare('SELECT id FROM instruments').all().map((r) => r.id));
  const insI = db.prepare('INSERT INTO instruments (id, name, class, category, base, quote, group_id, symbols, sort, enabled) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const setCat = db.prepare("UPDATE instruments SET category = ? WHERE id = ? AND category = 'other'");
  DEFAULT_INSTRUMENTS.forEach((it, i) => {
    if (existing.has(it.id)) { setCat.run(it.category, it.id); return; }
    insI.run(it.id, it.name, it.class, it.category, it.base ?? null, it.quote ?? null, gid[it.group], JSON.stringify(it.symbols), i, it.enabled === false ? 0 : 1);
  });
  if (!fresh) {
    // instruments added by hand before categories existed: category = class
    db.exec("UPDATE instruments SET category = class WHERE category = 'other' AND class IN ('fx','metal','index','commodity','crypto')");
    // WIG20 used to be disabled because the source had no daily history; it is now built from hourly data
    if (version < 2) db.exec("UPDATE instruments SET enabled = 1, last_error = NULL WHERE id = 'WIG20' AND last_fetch_at IS NULL");
  }
  setMeta('seed', SEED_VERSION);
}

// ---------- settings ----------
function deepMerge(base, over) {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

/** A user's personal settings (capital, risk limits) layered over the global ones. */
export const PERSONAL_KEYS = ['capital', 'risk'];

export function getSettings(userId = null) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  for (const r of rows) { try { stored[r.key] = JSON.parse(r.value); } catch { /* ignore */ } }
  let merged = deepMerge(structuredClone(DEFAULT_SETTINGS), stored);
  if (userId) {
    const u = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
    const own = u ? safeJson(u.settings, {}) : {};
    for (const k of PERSONAL_KEYS) if (own[k]) merged = deepMerge(merged, { [k]: own[k] });
  }
  return merged;
}

/** Replaces a whole settings key (no merging) – needed when removing fields. */
export const replaceSetting = (key, value) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));

export function saveUserSettings(userId, patch) {
  const u = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
  if (!u) return;
  const cur = safeJson(u.settings, {});
  const base = getSettings(userId);
  for (const k of PERSONAL_KEYS) if (patch[k]) cur[k] = deepMerge(base[k], patch[k]);
  db.prepare('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(cur), userId);
}

export function saveSettings(patch) {
  const merged = deepMerge(getSettings(), patch);
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of Object.keys(DEFAULT_SETTINGS)) up.run(k, JSON.stringify(merged[k]));
  return merged;
}

// ---------- groups ----------
export const listGroups = () => db.prepare('SELECT * FROM groups ORDER BY id').all();
export const getGroup = (id) => db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
export function createGroup(g) {
  const r = db.prepare('INSERT INTO groups (name, close_time, timezone, delay_min, days, enabled) VALUES (?,?,?,?,?,?)')
    .run(g.name, g.close_time, g.timezone, g.delay_min ?? 15, g.days ?? '1,2,3,4,5', g.enabled === false ? 0 : 1);
  return getGroup(Number(r.lastInsertRowid));
}
export function updateGroup(id, g) {
  const cur = getGroup(id);
  if (!cur) return null;
  const n = { ...cur, ...g };
  db.prepare('UPDATE groups SET name=?, close_time=?, timezone=?, delay_min=?, days=?, enabled=? WHERE id=?')
    .run(n.name, n.close_time, n.timezone, n.delay_min, n.days, n.enabled ? 1 : 0, id);
  return getGroup(id);
}
export function deleteGroup(id) {
  const used = db.prepare('SELECT COUNT(*) n FROM instruments WHERE group_id = ?').get(id).n;
  if (used > 0) throw new Error('err.groupInUse');
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}
export function markGroupRun(id, date, status) {
  db.prepare('UPDATE groups SET last_run_date=?, last_run_at=?, last_status=? WHERE id=?')
    .run(date, new Date().toISOString(), status, id);
}

// ---------- instruments ----------
const parseInst = (r) => r && ({ ...r, enabled: !!r.enabled, symbols: safeJson(r.symbols, {}) });
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
/**
 * The instrument catalogue. With a user: `enabled` is that user's choice (their own switch, or the catalogue
 * default when they have not chosen). Without: `enabled` means "used by at least one user" – what must be downloaded.
 */
export function listInstruments(userId = null) {
  const rows = userId
    ? db.prepare(`SELECT i.*, COALESCE(ui.enabled, i.enabled) AS enabled FROM instruments i
        LEFT JOIN user_instruments ui ON ui.instrument_id = i.id AND ui.user_id = ? ORDER BY i.sort, i.id`).all(userId)
    : db.prepare(`SELECT i.*, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN i.enabled ELSE EXISTS(
          SELECT 1 FROM users u LEFT JOIN user_instruments ui ON ui.user_id = u.id AND ui.instrument_id = i.id
          WHERE COALESCE(ui.enabled, i.enabled) = 1) END AS enabled FROM instruments i ORDER BY i.sort, i.id`).all();
  return rows.map(parseInst);
}
export function setUserInstrument(userId, id, enabled) {
  db.prepare(`INSERT INTO user_instruments (user_id, instrument_id, enabled) VALUES (?,?,?)
    ON CONFLICT(user_id, instrument_id) DO UPDATE SET enabled = excluded.enabled`).run(userId, id, enabled ? 1 : 0);
}
export function setUserCategory(userId, category, enabled) {
  const ids = db.prepare('SELECT id FROM instruments WHERE category = ?').all(category);
  for (const r of ids) setUserInstrument(userId, r.id, enabled);
  return ids.length;
}
export const countOwnInstruments = (userId) => db.prepare('SELECT COUNT(*) n FROM instruments WHERE owner_id = ?').get(userId).n;
export const positionsOfOthers = (id, userId) => db.prepare('SELECT COUNT(*) n FROM positions WHERE instrument_id = ? AND user_id != ?').get(id, userId).n;
export const getInstrument = (id) => parseInst(db.prepare('SELECT * FROM instruments WHERE id = ?').get(id));
export function upsertInstrument(it) {
  const cur = getInstrument(it.id);
  const n = { class: 'other', enabled: true, symbols: {}, sort: cur ? cur.sort : 1000, ...cur, ...it };
  db.prepare(`INSERT INTO instruments (id, name, class, category, base, quote, group_id, enabled, provider, symbols, sort, owner_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, class=excluded.class, category=excluded.category, base=excluded.base, quote=excluded.quote,
      group_id=excluded.group_id, enabled=excluded.enabled, provider=excluded.provider, symbols=excluded.symbols, sort=excluded.sort`)
    .run(n.id, n.name, n.class, n.category || n.class || 'other', n.base || null, n.quote || null, n.group_id ?? null, n.enabled ? 1 : 0,
      n.provider || null, JSON.stringify(n.symbols || {}), n.sort, n.owner_id ?? null);
  return getInstrument(n.id);
}
export function setCategoryEnabled(category, enabled) {
  return db.prepare('UPDATE instruments SET enabled = ? WHERE category = ?').run(enabled ? 1 : 0, category).changes;
}
export function deleteInstrument(id) {
  db.prepare('DELETE FROM candles WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM h4 WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM h1 WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM positions WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM user_instruments WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM stage_log WHERE instrument_id = ?').run(id);
  db.prepare('DELETE FROM instruments WHERE id = ?').run(id);
}
export function markFetch(id, error) {
  db.prepare('UPDATE instruments SET last_fetch_at=?, last_error=? WHERE id=?').run(new Date().toISOString(), error || null, id);
}

// ---------- candles ----------
export function saveCandles(id, bars) {
  const up = db.prepare(`INSERT INTO candles (instrument_id, date, o, h, l, c, v) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(instrument_id, date) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v`);
  db.exec('BEGIN');
  try {
    // fresh data is the source of truth for its date range (removes e.g. stale weekend candles)
    if (bars.length) db.prepare('DELETE FROM candles WHERE instrument_id = ? AND date >= ?').run(id, bars[0].date);
    for (const b of bars) up.run(id, b.date, b.o, b.h, b.l, b.c, b.v ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getCandles = (id) => db.prepare('SELECT date, o, h, l, c, v FROM candles WHERE instrument_id = ? ORDER BY date').all(id);

// ---------- H4 candles ----------
export function saveH4(id, bars) {
  const up = db.prepare(`INSERT INTO h4 (instrument_id, ts, o, h, l, c) VALUES (?,?,?,?,?,?)
    ON CONFLICT(instrument_id, ts) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c`);
  db.exec('BEGIN');
  try {
    if (bars.length) db.prepare('DELETE FROM h4 WHERE instrument_id = ? AND (ts >= ? OR ts < ?)').run(id, bars[0].ts, bars[0].ts - 400 * 86400);
    for (const b of bars) up.run(id, b.ts, b.o, b.h, b.l, b.c);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getH4 = (id) => db.prepare('SELECT ts, o, h, l, c FROM h4 WHERE instrument_id = ? ORDER BY ts').all(id);

// ---------- hourly candles (sessions) ----------
export function saveH1(id, bars) {
  const up = db.prepare(`INSERT INTO h1 (instrument_id, ts, o, h, l, c) VALUES (?,?,?,?,?,?)
    ON CONFLICT(instrument_id, ts) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c`);
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM h1 WHERE instrument_id = ? AND ts < ?').run(id, Math.floor(Date.now() / 1000) - 10 * 86400);
    for (const b of bars) up.run(id, b.ts, b.o, b.h, b.l, b.c);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getH1 = (id) => db.prepare('SELECT ts, o, h, l, c FROM h1 WHERE instrument_id = ? ORDER BY ts').all(id);

// ---------- positions ----------
const parsePos = (p) => ({ ...p, advice: p.advice ? safeJson(p.advice, null) : null });
/** One user's positions; without an argument – everyone's (H4 scheduler). */
export const listPositions = (userId = null) => (userId == null
  ? db.prepare('SELECT * FROM positions ORDER BY id').all()
  : db.prepare('SELECT * FROM positions WHERE user_id = ? ORDER BY id').all(userId)).map(parsePos);
export function saveAdvice(id, advice) {
  db.prepare('UPDATE positions SET advice = ?, advice_at = ? WHERE id = ?').run(JSON.stringify(advice), new Date().toISOString(), id);
}
export const getPosition = (id) => { const p = db.prepare('SELECT * FROM positions WHERE id = ?').get(Number(id)); return p ? parsePos(p) : null; };
export function savePosition(p) {
  if (p.id) {
    // the initial stop (for the result in R) is fixed once – when a stop is first entered
    db.prepare(`UPDATE positions SET instrument_id=?, direction=?, risk_pct=?, entry=?, stop=?, opened=?, note=?,
      stop_initial = COALESCE(stop_initial, ?) WHERE id=?`)
      .run(p.instrument_id, p.direction, p.risk_pct, p.entry ?? null, p.stop ?? null, p.opened ?? null, p.note ?? null, p.stop ?? null, p.id);
    return p.id;
  }
  return Number(db.prepare('INSERT INTO positions (user_id, instrument_id, direction, risk_pct, entry, stop, stop_initial, opened, note) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(p.user_id ?? null, p.instrument_id, p.direction, p.risk_pct, p.entry ?? null, p.stop ?? null, p.stop ?? null, p.opened ?? null, p.note ?? null).lastInsertRowid);
}
export const deletePosition = (id) => db.prepare('DELETE FROM positions WHERE id = ?').run(id);

// ---------- trade history ----------
export const listTrades = (userId) => db.prepare('SELECT * FROM trades WHERE user_id = ? ORDER BY closed, id').all(userId);
export const getTrade = (id) => db.prepare('SELECT * FROM trades WHERE id = ?').get(Number(id)) || null;
export function addTrade(t) {
  return Number(db.prepare(`INSERT INTO trades (user_id, instrument_id, direction, risk_pct, entry, stop_initial, exit, opened, closed, r, pnl_manual, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(t.user_id ?? null, t.instrument_id, t.direction, t.risk_pct, t.entry ?? null, t.stop_initial ?? null, t.exit ?? null,
    t.opened ?? null, t.closed, t.r ?? null, t.pnl_manual ?? null, t.note ?? null).lastInsertRowid);
}
export const deleteTrade = (id) => db.prepare('DELETE FROM trades WHERE id = ?').run(id);

// ---------- snapshots and alerts ----------
export function saveSnapshot(s) {
  db.prepare('INSERT INTO snapshots (ts, trigger, group_id, matrix_score, regime, exec_state, summary, user_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), s.trigger, s.group_id ?? null, s.matrix_score, s.regime, s.exec_state, JSON.stringify(s.summary), s.user_id ?? null);
  db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 20000)');
}
// Snapshots are per user; ones from before that (no owner) count for everyone.
export function lastSnapshot(userId = null) {
  const r = db.prepare('SELECT * FROM snapshots WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT 1').get(userId);
  return r ? { ...r, summary: safeJson(r.summary, {}) } : null;
}
export const listSnapshots = (limit = 200, userId = null) =>
  db.prepare('SELECT * FROM snapshots WHERE user_id = ? OR user_id IS NULL ORDER BY id DESC LIMIT ?').all(userId, limit).map((r) => ({ ...r, summary: safeJson(r.summary, {}) }));
export function saveAlerts(list) {
  const ins = db.prepare('INSERT INTO alerts (ts, type, severity, instrument_id, message, user_id) VALUES (?,?,?,?,?,?)');
  const ts = new Date().toISOString();
  for (const a of list) ins.run(ts, a.type, a.severity, a.instrument_id ?? null, a.message, a.user_id ?? null);
  db.exec('DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 5000)');
}
// An alert without an owner is about the market and visible to everyone; one with an owner (positions) only to them.
export const countAlertsAfter = (id, userId) => db.prepare('SELECT COUNT(*) n FROM alerts WHERE id > ? AND (user_id IS NULL OR user_id = ?)').get(id, userId).n;
export const listAlerts = (limit, userId) => db.prepare('SELECT * FROM alerts WHERE user_id IS NULL OR user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);

// ---------- users and sessions ----------
// the first account (the one that set the server up) is the super administrator
const USERS = 'SELECT u.*, EXISTS(SELECT 1 FROM invites i WHERE i.user_id = u.id) AS invited, (u.id = (SELECT MIN(id) FROM users)) AS super FROM users u';
const pubUser = (u) => u && ({ id: u.id, username: u.username, role: u.role, email: u.email || '', created: u.created, lang: u.lang || null, invited: !!u.invited, super: !!u.super,
  twofa: { enabled: !!u.totp_enabled, required: !!u.totp_required, recoveryLeft: safeJson(u.recovery, []).length } });
export const countUsers = () => db.prepare('SELECT COUNT(*) n FROM users').get().n;
export const countAdmins = () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n;
export const listUsers = () => db.prepare(`${USERS} ORDER BY u.username`).all().map(pubUser);
export const getUser = (id) => pubUser(db.prepare(`${USERS} WHERE u.id = ?`).get(Number(id)));
export const getUserAuth = (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
/** Account for signing in: by username, or by e-mail address when exactly one account uses it. */
export function getUserByLogin(login) {
  const v = String(login || '').trim();
  const u = getUserAuth(v);
  if (u || !v.includes('@')) return u;
  const rows = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').all(v);
  return rows.length === 1 ? rows[0] : undefined;
}
export const getUserAuthById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
export function createUser({ username, pass_hash, role, email, lang }) {
  const first = countUsers() === 0;
  // new accounts must set up two-factor authentication
  const id = Number(db.prepare('INSERT INTO users (username, pass_hash, role, email, created, totp_required) VALUES (?,?,?,?,?,1)')
    .run(username, pass_hash, role, email || null, new Date().toISOString()).lastInsertRowid);
  // a new account does not get notifications from before it existed
  if (lang) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id);
  if (!first) db.prepare('UPDATE users SET bell_seen = (SELECT COALESCE(MAX(id), 0) FROM alerts) WHERE id = ?').run(id);
  if (first) {
    // data from before accounts existed (positions, trades, capital, limits) goes to the first administrator
    db.prepare('UPDATE positions SET user_id = ? WHERE user_id IS NULL').run(id);
    db.prepare('UPDATE trades SET user_id = ? WHERE user_id IS NULL').run(id);
    const g = getSettings();
    db.prepare('UPDATE users SET settings = ?, bell_seen = ? WHERE id = ?').run(JSON.stringify({ capital: g.capital, risk: g.risk }), Number(getMeta('bellSeen') || 0), id);
  }
  return getUser(id);
}
export function updateUser(id, { role, email, pass_hash, lang, username }) {
  if (username) db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id);
  if (lang) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang, id);
  if (role != null) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (email !== undefined) db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email || null, id);
  if (pass_hash) { db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(pass_hash, id); db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id); db.prepare('DELETE FROM invites WHERE user_id = ?').run(id); }
  return getUser(id);
}
/** Stores a new invitation for the account (replacing older ones); only the token's hash is kept. */
export function createInvite(userId, tokenHash, expires) {
  db.prepare('DELETE FROM invites WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO invites (token_hash, user_id, expires) VALUES (?,?,?)').run(tokenHash, userId, expires);
}
export const getInvite = (tokenHash) => db.prepare('SELECT * FROM invites WHERE token_hash = ? AND expires > ?').get(String(tokenHash), Date.now());
export function deleteUser(id) {
  for (const t of ['positions', 'trades']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
  db.prepare('DELETE FROM alerts WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM invites WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM user_instruments WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM stage_log WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM snapshots WHERE user_id = ?').run(id);
  db.prepare('UPDATE instruments SET owner_id = NULL WHERE owner_id = ?').run(id);
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM portfolio_shares WHERE owner_id = ? OR viewer_id = ?').run(id, id);
  db.prepare('DELETE FROM messages WHERE from_id = ? OR to_id = ?').run(id, id);
  db.prepare('DELETE FROM room_members WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM push_subs WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM files WHERE owner_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
export const getBellSeen = (userId) => db.prepare('SELECT bell_seen FROM users WHERE id = ?').get(userId)?.bell_seen || 0;
export const setBellSeen = (userId, v) => db.prepare('UPDATE users SET bell_seen = ? WHERE id = ?').run(v, userId);

export function createSession(tokenHash, userId, ttlMs) {
  db.prepare('DELETE FROM auth_sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created, expires) VALUES (?,?,?,?)').run(tokenHash, userId, new Date().toISOString(), Date.now() + ttlMs);
}
export function sessionUser(tokenHash) {
  const r = db.prepare('SELECT user_id, expires FROM auth_sessions WHERE token_hash = ?').get(tokenHash);
  if (!r || r.expires < Date.now()) return null;
  return getUser(r.user_id);
}
export const deleteSession = (tokenHash) => db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash);

// ---------- portfolio sharing ----------
export const sharesOf = (ownerId) => db.prepare('SELECT viewer_id FROM portfolio_shares WHERE owner_id = ?').all(ownerId).map((r) => r.viewer_id);
export const sharedWith = (viewerId) => db.prepare('SELECT u.id, u.username FROM portfolio_shares s JOIN users u ON u.id = s.owner_id WHERE s.viewer_id = ? ORDER BY u.username').all(viewerId);
export const canView = (ownerId, viewerId) => ownerId === viewerId || !!db.prepare('SELECT 1 FROM portfolio_shares WHERE owner_id = ? AND viewer_id = ?').get(ownerId, viewerId);
export function setShares(ownerId, viewerIds) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM portfolio_shares WHERE owner_id = ?').run(ownerId);
    const ins = db.prepare('INSERT OR IGNORE INTO portfolio_shares (owner_id, viewer_id) VALUES (?,?)');
    for (const v of viewerIds) if (v !== ownerId && getUser(v)) ins.run(ownerId, v);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ---------- messages ----------
const parseMsg = (m) => {
  if (!m) return m;
  const out = { ...m, trade: m.trade ? safeJson(m.trade, null) : null, file: null };
  if (m.file_id) { const f = db.prepare('SELECT id, name, type, size FROM files WHERE id = ?').get(m.file_id); if (f) out.file = { ...f, image: f.type.startsWith('image/') }; }
  return out;
};
export function addMessage({ from_id, to_id = 0, room_id = null, body, trade, file_id = null }) {
  return Number(db.prepare('INSERT INTO messages (from_id, to_id, room_id, ts, body, trade, file_id) VALUES (?,?,?,?,?,?,?)')
    .run(from_id, to_id, room_id, new Date().toISOString(), body || '', trade ? JSON.stringify(trade) : null, file_id).lastInsertRowid);
}
export const unreadDirect = (userId) => db.prepare('SELECT COUNT(*) n FROM messages WHERE to_id = ? AND room_id IS NULL AND read_at IS NULL').get(userId).n;
export const unreadRooms = (userId) => db.prepare(`SELECT COUNT(*) n FROM messages m JOIN room_members rm ON rm.room_id = m.room_id
  WHERE rm.user_id = ? AND m.id > rm.last_read AND m.from_id != ?`).get(userId, userId).n;
export const unreadMessages = (userId) => unreadDirect(userId) + unreadRooms(userId);
export const thread = (a, b) => db.prepare('SELECT * FROM messages WHERE room_id IS NULL AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)) ORDER BY id DESC LIMIT 200').all(a, b, b, a).reverse().map(parseMsg);
export const markThreadRead = (me, other) => db.prepare('UPDATE messages SET read_at = ? WHERE room_id IS NULL AND to_id = ? AND from_id = ? AND read_at IS NULL').run(new Date().toISOString(), me, other);
export function threadSummaries(me) {
  const rows = db.prepare(`SELECT CASE WHEN from_id = ? THEN to_id ELSE from_id END other, MAX(id) last_id,
    SUM(CASE WHEN to_id = ? AND read_at IS NULL THEN 1 ELSE 0 END) unread
    FROM messages WHERE room_id IS NULL AND (from_id = ? OR to_id = ?) GROUP BY other`).all(me, me, me, me);
  return rows.map((r) => ({ other: r.other, unread: r.unread, last: parseMsg(db.prepare('SELECT * FROM messages WHERE id = ?').get(r.last_id)) }));
}

// ---------- group chat ----------
export const getRoom = (id) => db.prepare('SELECT * FROM rooms WHERE id = ?').get(Number(id)) || null;
export const roomMembers = (roomId) => db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId).map((r) => r.user_id);
export const isMember = (roomId, userId) => !!db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
export function saveRoom({ id = null, name, members, created_by = null }) {
  db.exec('BEGIN');
  try {
    if (id) db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(name, id);
    else id = Number(db.prepare('INSERT INTO rooms (name, created_by, created) VALUES (?,?,?)').run(name, created_by, new Date().toISOString()).lastInsertRowid);
    const keep = new Set(members);
    for (const u of roomMembers(id)) if (!keep.has(u)) db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(id, u);
    const ins = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, last_read) VALUES (?,?,(SELECT COALESCE(MAX(id),0) FROM messages))');
    for (const u of keep) if (getUser(u)) ins.run(id, u);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return getRoom(id);
}
export function deleteRoom(id) {
  db.prepare('DELETE FROM messages WHERE room_id = ?').run(id);
  db.prepare('DELETE FROM room_members WHERE room_id = ?').run(id);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(id);
}
/** A user's rooms (an administrator with all=true sees every room) with the last message and unread count. */
export function listRooms(userId, all = false) {
  const rooms = all ? db.prepare('SELECT * FROM rooms ORDER BY name').all()
    : db.prepare('SELECT r.* FROM rooms r JOIN room_members m ON m.room_id = r.id WHERE m.user_id = ? ORDER BY r.name').all(userId);
  return rooms.map((r) => {
    const mem = db.prepare('SELECT last_read FROM room_members WHERE room_id = ? AND user_id = ?').get(r.id, userId);
    return { id: r.id, name: r.name, members: roomMembers(r.id), member: !!mem,
      unread: mem ? db.prepare('SELECT COUNT(*) n FROM messages WHERE room_id = ? AND id > ? AND from_id != ?').get(r.id, mem.last_read, userId).n : 0,
      last: parseMsg(db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 1').get(r.id)) || null };
  });
}
export const roomThread = (roomId) => db.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY id DESC LIMIT 300').all(roomId).reverse().map(parseMsg);
export const markRoomRead = (roomId, userId) => db.prepare('UPDATE room_members SET last_read = (SELECT COALESCE(MAX(id),0) FROM messages WHERE room_id = ?) WHERE room_id = ? AND user_id = ?').run(roomId, roomId, userId);

// ---------- attachments ----------
export const addFile = ({ owner_id, name, type, size }) => Number(db.prepare('INSERT INTO files (owner_id, name, type, size, created) VALUES (?,?,?,?,?)').run(owner_id, name, type, size, new Date().toISOString()).lastInsertRowid);
export const getFile = (id) => db.prepare('SELECT * FROM files WHERE id = ?').get(Number(id)) || null;
/** A file is visible to its uploader and to participants of the conversation it was sent in. */
export function canSeeFile(fileId, userId) {
  const f = getFile(fileId);
  if (!f) return false;
  if (f.owner_id === userId) return true;
  return !!db.prepare(`SELECT 1 FROM messages m LEFT JOIN room_members rm ON rm.room_id = m.room_id AND rm.user_id = ?
    WHERE m.file_id = ? AND ((m.room_id IS NULL AND (m.to_id = ? OR m.from_id = ?)) OR rm.user_id IS NOT NULL) LIMIT 1`).get(userId, fileId, userId, userId);
}
export const filesOfUser = (userId) => db.prepare('SELECT id FROM files WHERE owner_id = ?').all(userId).map((r) => r.id);

// ---------- push notifications ----------
export function addPushSub({ user_id, endpoint, p256dh, auth, lang }) {
  db.prepare(`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, lang, created) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`).run(user_id, endpoint, p256dh, auth, lang || 'en', new Date().toISOString());
}
export const removePushSub = (endpoint) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
export const pushSubs = (userId = null) => (userId == null ? db.prepare('SELECT * FROM push_subs').all() : db.prepare('SELECT * FROM push_subs WHERE user_id = ?').all(userId));

// ---------- two-factor authentication ----------
export const setTotpPending = (id, secret) => db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, id);
export function enableTotp(id, secret, counter, recoveryHashes) {
  db.prepare('UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, totp_last = ?, recovery = ? WHERE id = ?').run(secret, counter, JSON.stringify(recoveryHashes), id);
}
export function disableTotp(id) {
  db.prepare("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, totp_last = -1, recovery = '[]' WHERE id = ?").run(id);
  db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(id);
}
export const setTotpLast = (id, counter) => db.prepare('UPDATE users SET totp_last = ? WHERE id = ?').run(counter, id);
export const setRecovery = (id, hashes) => db.prepare('UPDATE users SET recovery = ? WHERE id = ?').run(JSON.stringify(hashes), id);
export const markNagged = (id) => db.prepare('UPDATE users SET totp_nagged = 1 WHERE id = ?').run(id);
export function trustDevice(tokenHash, userId, label, ttlMs) {
  db.prepare('DELETE FROM trusted_devices WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO trusted_devices (token_hash, user_id, label, created, expires) VALUES (?,?,?,?,?)').run(tokenHash, userId, label || null, new Date().toISOString(), Date.now() + ttlMs);
}
export const deviceTrusted = (tokenHash, userId) => !!db.prepare('SELECT 1 FROM trusted_devices WHERE token_hash = ? AND user_id = ? AND expires > ?').get(tokenHash, userId, Date.now());
export const listDevices = (userId) => db.prepare('SELECT label, created, expires FROM trusted_devices WHERE user_id = ? AND expires > ? ORDER BY created DESC').all(userId, Date.now());
export const forgetDevices = (userId) => db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId);

// ---------- logs ----------
export function addLog({ user_id = null, category, level = 'info', code, params = {}, ip = null }) {
  try {
    db.prepare('INSERT INTO logs (ts, user_id, category, level, code, params, ip) VALUES (?,?,?,?,?,?,?)').run(new Date().toISOString(), user_id, category, level, code, JSON.stringify(params), ip);
    if (Math.random() < 0.01) db.exec('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 20000)');
  } catch (e) { console.error('[log]', e.message); }
}
/** scope: { all: true } for an administrator (optionally userId), otherwise only the given user's entries. */
export function listLogs({ all = false, userId = null, category = null, before = null, limit = 100 }) {
  const where = [], args = [];
  if (!all) { where.push('user_id = ?'); args.push(userId); }
  else if (userId === 0) where.push('user_id IS NULL');
  else if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (category) { where.push('category = ?'); args.push(category); }
  if (before) { where.push('id < ?'); args.push(before); }
  const sql = `SELECT l.*, u.username FROM logs l LEFT JOIN users u ON u.id = l.user_id ${where.length ? 'WHERE ' + where.map((w) => 'l.' + w).join(' AND ') : ''} ORDER BY l.id DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Math.min(500, limit)).map((r) => ({ ...r, params: safeJson(r.params, {}) }));
}

// ---------- signals (algorithm accuracy) ----------
export const openSignals = () => db.prepare('SELECT * FROM signals WHERE closed IS NULL').all();
export const openSignal = (x) => Number(db.prepare('INSERT INTO signals (instrument_id, dir, grade, opened, entry, stop) VALUES (?,?,?,?,?,?)').run(x.instrument_id, x.dir, x.grade ?? null, x.opened, x.entry, x.stop).lastInsertRowid);
export const closeSignal = (id, x) => db.prepare('UPDATE signals SET closed = ?, exit = ?, r = ?, reason = ? WHERE id = ?').run(x.closed, x.exit, x.r, x.reason, id);
export const listSignals = (since) => db.prepare('SELECT * FROM signals WHERE opened >= ? ORDER BY COALESCE(closed, opened) DESC, id DESC').all(since);
/**
 * Remembers when every funnel stage of every instrument last changed its status for this user.
 * The first time a stage is seen its real start is unknown, so it is marked `initial`.
 */
export function recordStages(userId, instruments, ts = new Date().toISOString()) {
  const known = new Map(db.prepare('SELECT instrument_id, stage, status FROM stage_log WHERE user_id = ?').all(userId).map((r) => [`${r.instrument_id}|${r.stage}`, r.status]));
  const ins = db.prepare('INSERT INTO stage_log (user_id, instrument_id, stage, status, since, initial) VALUES (?,?,?,?,?,1)');
  const upd = db.prepare('UPDATE stage_log SET status = ?, since = ?, initial = 0 WHERE user_id = ? AND instrument_id = ? AND stage = ?');
  db.exec('BEGIN');
  try {
    for (const a of instruments) for (const st of a.funnel || []) {
      const prev = known.get(`${a.id}|${st.key}`);
      if (prev === undefined) ins.run(userId, a.id, st.key, st.status, ts);
      else if (prev !== st.status) upd.run(st.status, ts, userId, a.id, st.key);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const stagesOf = (userId, id) => db.prepare('SELECT stage, status, since, initial FROM stage_log WHERE user_id = ? AND instrument_id = ?').all(userId, id);
export const signalsOf = (id) => db.prepare('SELECT opened AS date, dir, grade FROM signals WHERE instrument_id = ? ORDER BY opened').all(id);
export function resetSignals() { db.exec('DELETE FROM signals'); db.prepare("DELETE FROM meta WHERE key = 'signalsThrough'").run(); }
