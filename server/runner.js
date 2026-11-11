// Pobieranie danych, przeliczanie rynku, migawki, alerty i wysyłka raportów.
import * as db from './db.js';
import { fetchInstrument, fetchInstrumentH4, fetchInstrumentH1 } from './providers/index.js';
import { computeSessions } from './sessions.js';
import { analyzeMarket, summarize, diffAlerts } from './analysis.js';
import { sendReport, sendPositionsReport, smtpConfigured, smtpReady } from './mailer.js';
import { advisePosition, closedH4, ACTION_RANK } from './positions.js';

// Obraz rynku zależy od portfela i limitów użytkownika, więc pamięć podręczna jest osobna dla każdego.
// Klucz 0 = sam rynek, bez pozycji (migawki, raporty grup, alerty wspólne).
const cache = new Map();
export const invalidate = () => cache.clear();

export const job = { running: false, trigger: null, group: null, total: 0, done: 0, current: null, errors: [], startedAt: null, finishedAt: null };

/** Aktualny obraz rynku liczony z danych w bazie (z pamięcią podręczną na 60 s). */
export function getMarket(userId = null) {
  const key = userId || 0, now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < 60000) return hit.market;
  const instruments = db.listInstruments();
  const settings = db.getSettings(userId);
  const candlesById = {};
  for (const i of instruments) if (i.enabled) candlesById[i.id] = db.getCandles(i.id);
  const groupsById = Object.fromEntries(db.listGroups().map((g) => [g.id, g]));
  let sessions = null;
  if (settings.sessions.enabled) {
    const pairs = instruments.filter((i) => i.enabled && i.class === 'fx' && i.base && i.quote);
    const h1 = {};
    for (const p of pairs) h1[p.id] = db.getH1(p.id);
    if (pairs.some((p) => h1[p.id].length)) sessions = computeSessions(h1, pairs);
  }
  const market = analyzeMarket({ instruments, candlesById, groupsById, positions: userId ? db.listPositions(userId) : [], settings, sessions });
  cache.set(key, { at: now, market });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return market;
}

/**
 * Odświeża dane grupy (lub wszystkich instrumentów), zapisuje migawkę i alerty.
 * trigger: 'manual' | 'schedule'. Zwraca { ok, fetched, errors, alerts, mail }.
 */
export async function refresh({ groupId = null, trigger = 'manual' } = {}) {
  if (job.running) throw new Error('BUSY');
  const settings = db.getSettings();
  const group = groupId != null ? db.getGroup(groupId) : null;
  const list = db.listInstruments().filter((i) => i.enabled && (groupId == null || i.group_id === groupId));
  // dane godzinowe par walutowych do analizy sesji – razem z grupą, w której są waluty
  const hourly = settings.sessions.enabled ? list.filter((i) => i.class === 'fx') : [];
  Object.assign(job, { running: true, trigger, group: group?.name || null, total: list.length + hourly.length, done: 0, current: null, errors: [], startedAt: new Date().toISOString(), finishedAt: null });
  let fetched = 0;
  try {
    for (const inst of list) {
      job.current = inst.id;
      try {
        const { bars } = await fetchInstrument(inst, settings);
        db.saveCandles(inst.id, bars);
        db.markFetch(inst.id, null);
        fetched++;
      } catch (e) {
        db.markFetch(inst.id, e.message);
        job.errors.push({ id: inst.id, error: e.message });
      }
      job.done++;
    }
    for (const inst of hourly) {
      job.current = `${inst.id} · H1`;
      try { db.saveH1(inst.id, await fetchInstrumentH1(inst, settings)); }
      catch (e) { job.errors.push({ id: `${inst.id} (H1)`, error: e.message }); }
      job.done++;
    }
    invalidate();
    const market = getMarket();
    const summary = summarize(market);
    const prev = db.lastSnapshot();
    const alerts = diffAlerts(prev?.summary, summary, { minGrade: settings.notify.minGrade, groupId });
    db.saveSnapshot({ trigger: trigger === 'schedule' ? `schedule:${group?.name || ''}` : 'manual', group_id: groupId, matrix_score: market.matrix.score, regime: market.regime.state, exec_state: market.exec, summary });
    // powiadomienie „analiza gotowa” – odpowiednik raportu e-mail po analizie grupy
    const done = [];
    if (trigger === 'schedule' && fetched > 0) {
      const plays = market.ranking.map((id) => market.instruments.find((x) => x.id === id)).filter((x) => x && x.action === 'PLAY' && (groupId == null || x.group_id === groupId));
      done.push({ type: 'ANALYSIS', severity: plays.length ? 'MED' : 'LOW', instrument_id: plays[0]?.id ?? null,
        code: plays.length ? 'alert.analysis' : 'alert.analysisNone',
        params: { group: group?.name || '', exec: market.exec, matrix: market.matrix.score, n: plays.length, top: plays.slice(0, 3).map((x) => `${x.id} ${x.dir}`).join(', ') } });
    }
    const toSave = [...done, ...alerts];
    if (toSave.length) db.saveAlerts(toSave.map((a) => ({ ...a, message: JSON.stringify({ code: a.code, params: a.params }) })));

    let mail = null;
    const mode = settings.notify.mode;
    if (trigger === 'schedule' && fetched > 0 && smtpConfigured(settings) && (mode === 'report' || (mode === 'alerts' && alerts.length))) {
      try { await sendReport({ market, alerts, group, settings, errors: job.errors }); mail = 'sent'; }
      catch (e) { mail = `error: ${e.message}`; console.error('[mail]', e.message); }
    }
    return { ok: fetched > 0 || list.length === 0, fetched, total: list.length, errors: job.errors, alerts: alerts.length, mail };
  } finally {
    Object.assign(job, { running: false, current: null, finishedAt: new Date().toISOString() });
  }
}

/**
 * Analiza otwartych pozycji na świecach H4 – wszystkich użytkowników albo jednego (userId).
 * Pobiera H4 tylko dla instrumentów z pozycjami, wylicza poradę, zapisuje ją przy pozycji
 * i zgłasza zmiany właścicielowi pozycji (dzwonek, e-mail).
 */
export async function checkPositions({ trigger = 'manual', userId = null } = {}) {
  if (job.running) throw new Error('BUSY');
  const global = db.getSettings();
  const positions = db.listPositions(userId);
  if (!positions.length) return { checked: 0, changed: [], errors: [], mail: null };
  const ids = [...new Set(positions.map((p) => p.instrument_id))];
  Object.assign(job, { running: true, trigger: `h4:${trigger}`, group: 'H4', total: ids.length, done: 0, current: null, errors: [], startedAt: new Date().toISOString(), finishedAt: null });
  try {
    for (const id of ids) {
      job.current = id;
      const inst = db.getInstrument(id);
      try {
        if (!inst) throw new Error('unknown instrument');
        const { bars } = await fetchInstrumentH4(inst, global);
        db.saveH4(id, bars);
      } catch (e) { job.errors.push({ id, error: e.message }); }
      job.done++;
    }
    const now = new Date();
    const owners = [...new Set(positions.map((p) => p.user_id))];
    const all = [], allChanged = [];
    const mails = [];
    for (const owner of owners) {
      const settings = db.getSettings(owner);
      const market = getMarket(owner);
      const byId = Object.fromEntries(market.instruments.map((a) => [a.id, a]));
      const results = [], changed = [];
      for (const pos of positions.filter((p) => p.user_id === owner)) {
        const advice = advisePosition(pos, byId[pos.instrument_id], closedH4(db.getH4(pos.instrument_id), now), settings);
        const prev = pos.advice?.action ?? null;
        db.saveAdvice(pos.id, advice);
        const row = { ...pos, advice, previous: prev };
        results.push(row);
        if (advice.action !== 'NO_DATA' && prev !== advice.action && !(prev == null && advice.action === 'HOLD')) changed.push(row);
      }
      all.push(...results); allChanged.push(...changed);
      if (changed.length) {
        db.saveAlerts(changed.map((c) => ({
          type: 'POSITION_H4', severity: ACTION_RANK[c.advice.action] >= 4 ? 'HIGH' : ACTION_RANK[c.advice.action] >= 2 ? 'MED' : 'LOW',
          instrument_id: c.instrument_id, user_id: owner,
          message: JSON.stringify({ code: 'alert.h4', params: { id: c.instrument_id, dir: c.direction, action: c.advice.action, reason: c.advice.reason } }),
        })));
      }
      // e-mail do właściciela pozycji; administrator bez własnego adresu dostaje go na adres ogólny
      const user = owner ? db.getUser(owner) : null;
      const to = user?.email || (!user || user.role === 'admin' ? global.smtp.to : null);
      const mode = global.notify.positions;
      if (trigger === 'schedule' && to && smtpReady(global) && (mode === 'always' || (mode === 'changes' && changed.length))) {
        try { await sendPositionsReport({ results, changed, settings, to }); mails.push('sent'); }
        catch (e) { mails.push(`error: ${e.message}`); console.error('[mail]', e.message); }
      }
    }
    invalidate();
    return { checked: all.length, changed: allChanged.map((c) => `${c.instrument_id}:${c.advice.action}`), errors: job.errors, mail: mails.length ? mails.join(',') : null };
  } finally {
    Object.assign(job, { running: false, current: null, finishedAt: new Date().toISOString() });
  }
}
