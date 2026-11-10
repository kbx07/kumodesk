// Warstwa bazy danych (wbudowany node:sqlite – brak natywnych zależności).
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
  seed();
  return db;
}

function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export const getMeta = (key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
export const setMeta = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));

const SEED_VERSION = 2;

/**
 * Zasiewa dane startowe. Przy aktualizacji istniejącej bazy dokłada tylko to, czego brakuje
 * (nowe instrumenty, kategorie) i nie rusza ustawień użytkownika.
 */
function seed() {
  const version = Number(getMeta('seed') || 0);
  if (version >= SEED_VERSION) return;
  const fresh = db.prepare('SELECT COUNT(*) n FROM groups').get().n === 0;
  const groups = db.prepare('SELECT * FROM groups').all();
  const insG = db.prepare('INSERT INTO groups (name, close_time, timezone, delay_min) VALUES (?,?,?,?)');
  const gid = {};
  for (const g of DEFAULT_GROUPS) {
    const found = groups.find((x) => x.timezone === g.timezone && x.close_time === g.close_time);
    gid[g.key] = found ? found.id : Number(insG.run(g.name, g.close_time, g.timezone, g.delay_min).lastInsertRowid);
  }
  const existing = new Set(db.prepare('SELECT id FROM instruments').all().map((r) => r.id));
  const insI = db.prepare('INSERT INTO instruments (id, name, class, category, base, quote, group_id, symbols, sort, enabled) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const setCat = db.prepare("UPDATE instruments SET category = ? WHERE id = ? AND category = 'other'");
  DEFAULT_INSTRUMENTS.forEach((it, i) => {
    if (existing.has(it.id)) { setCat.run(it.category, it.id); return; }
    insI.run(it.id, it.name, it.class, it.category, it.base ?? null, it.quote ?? null, gid[it.group], JSON.stringify(it.symbols), i, it.enabled === false ? 0 : 1);
  });
  if (!fresh) {
    // instrumenty dodane ręcznie przed wprowadzeniem kategorii: kategoria = klasa
    db.exec("UPDATE instruments SET category = class WHERE category = 'other' AND class IN ('fx','metal','index','commodity','crypto')");
    // WIG20 był domyślnie wyłączony, bo źródło nie miało historii dziennej; teraz jest składany z danych godzinowych
    if (version < 2) db.exec("UPDATE instruments SET enabled = 1, last_error = NULL WHERE id = 'WIG20' AND last_fetch_at IS NULL");
  }
  setMeta('seed', SEED_VERSION);
}

// ---------- ustawienia ----------
function deepMerge(base, over) {
  if (over == null || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = {};
  for (const r of rows) { try { stored[r.key] = JSON.parse(r.value); } catch { /* ignoruj */ } }
  return deepMerge(structuredClone(DEFAULT_SETTINGS), stored);
}

export function saveSettings(patch) {
  const merged = deepMerge(getSettings(), patch);
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const k of Object.keys(DEFAULT_SETTINGS)) up.run(k, JSON.stringify(merged[k]));
  return merged;
}

// ---------- grupy ----------
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

// ---------- instrumenty ----------
const parseInst = (r) => r && ({ ...r, enabled: !!r.enabled, symbols: safeJson(r.symbols, {}) });
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
export const listInstruments = () => db.prepare('SELECT * FROM instruments ORDER BY sort, id').all().map(parseInst);
export const getInstrument = (id) => parseInst(db.prepare('SELECT * FROM instruments WHERE id = ?').get(id));
export function upsertInstrument(it) {
  const cur = getInstrument(it.id);
  const n = { class: 'other', enabled: true, symbols: {}, sort: cur ? cur.sort : 1000, ...cur, ...it };
  db.prepare(`INSERT INTO instruments (id, name, class, category, base, quote, group_id, enabled, provider, symbols, sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, class=excluded.class, category=excluded.category, base=excluded.base, quote=excluded.quote,
      group_id=excluded.group_id, enabled=excluded.enabled, provider=excluded.provider, symbols=excluded.symbols, sort=excluded.sort`)
    .run(n.id, n.name, n.class, n.category || n.class || 'other', n.base || null, n.quote || null, n.group_id ?? null, n.enabled ? 1 : 0,
      n.provider || null, JSON.stringify(n.symbols || {}), n.sort);
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
  db.prepare('DELETE FROM instruments WHERE id = ?').run(id);
}
export function markFetch(id, error) {
  db.prepare('UPDATE instruments SET last_fetch_at=?, last_error=? WHERE id=?').run(new Date().toISOString(), error || null, id);
}

// ---------- świece ----------
export function saveCandles(id, bars) {
  const up = db.prepare(`INSERT INTO candles (instrument_id, date, o, h, l, c, v) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(instrument_id, date) DO UPDATE SET o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, v=excluded.v`);
  db.exec('BEGIN');
  try {
    // świeże dane są źródłem prawdy dla swojego zakresu dat (usuwa np. stare świece weekendowe)
    if (bars.length) db.prepare('DELETE FROM candles WHERE instrument_id = ? AND date >= ?').run(id, bars[0].date);
    for (const b of bars) up.run(id, b.date, b.o, b.h, b.l, b.c, b.v ?? null);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
export const getCandles = (id) => db.prepare('SELECT date, o, h, l, c, v FROM candles WHERE instrument_id = ? ORDER BY date').all(id);

// ---------- świece H4 ----------
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

// ---------- świece godzinowe (sesje) ----------
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

// ---------- pozycje ----------
export const listPositions = () => db.prepare('SELECT * FROM positions ORDER BY id').all()
  .map((p) => ({ ...p, advice: p.advice ? safeJson(p.advice, null) : null }));
export function saveAdvice(id, advice) {
  db.prepare('UPDATE positions SET advice = ?, advice_at = ? WHERE id = ?').run(JSON.stringify(advice), new Date().toISOString(), id);
}
export const getPosition = (id) => listPositions().find((p) => p.id === Number(id)) || null;
export function savePosition(p) {
  if (p.id) {
    // stop początkowy (do liczenia wyniku w R) ustala się raz – przy pierwszym wpisaniu stopu
    db.prepare(`UPDATE positions SET instrument_id=?, direction=?, risk_pct=?, entry=?, stop=?, opened=?, note=?,
      stop_initial = COALESCE(stop_initial, ?) WHERE id=?`)
      .run(p.instrument_id, p.direction, p.risk_pct, p.entry ?? null, p.stop ?? null, p.opened ?? null, p.note ?? null, p.stop ?? null, p.id);
    return p.id;
  }
  return Number(db.prepare('INSERT INTO positions (instrument_id, direction, risk_pct, entry, stop, stop_initial, opened, note) VALUES (?,?,?,?,?,?,?,?)')
    .run(p.instrument_id, p.direction, p.risk_pct, p.entry ?? null, p.stop ?? null, p.stop ?? null, p.opened ?? null, p.note ?? null).lastInsertRowid);
}
export const deletePosition = (id) => db.prepare('DELETE FROM positions WHERE id = ?').run(id);

// ---------- historia zagrań ----------
export const listTrades = () => db.prepare('SELECT * FROM trades ORDER BY closed, id').all();
export function addTrade(t) {
  return Number(db.prepare(`INSERT INTO trades (instrument_id, direction, risk_pct, entry, stop_initial, exit, opened, closed, r, pnl_manual, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(t.instrument_id, t.direction, t.risk_pct, t.entry ?? null, t.stop_initial ?? null, t.exit ?? null,
    t.opened ?? null, t.closed, t.r ?? null, t.pnl_manual ?? null, t.note ?? null).lastInsertRowid);
}
export const deleteTrade = (id) => db.prepare('DELETE FROM trades WHERE id = ?').run(id);

// ---------- migawki i alerty ----------
export function saveSnapshot(s) {
  db.prepare('INSERT INTO snapshots (ts, trigger, group_id, matrix_score, regime, exec_state, summary) VALUES (?,?,?,?,?,?,?)')
    .run(new Date().toISOString(), s.trigger, s.group_id ?? null, s.matrix_score, s.regime, s.exec_state, JSON.stringify(s.summary));
  db.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT 2000)');
}
export function lastSnapshot() {
  const r = db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT 1').get();
  return r ? { ...r, summary: safeJson(r.summary, {}) } : null;
}
export const listSnapshots = (limit = 200) =>
  db.prepare('SELECT * FROM snapshots ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r, summary: safeJson(r.summary, {}) }));
export function saveAlerts(list) {
  const ins = db.prepare('INSERT INTO alerts (ts, type, severity, instrument_id, message) VALUES (?,?,?,?,?)');
  const ts = new Date().toISOString();
  for (const a of list) ins.run(ts, a.type, a.severity, a.instrument_id ?? null, a.message);
  db.exec('DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 2000)');
}
export const listAlerts = (limit = 200) => db.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT ?').all(limit);
