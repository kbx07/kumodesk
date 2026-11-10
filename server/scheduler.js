// Harmonogram: każda grupa czasowa jest sprawdzana raz dziennie po swoim zamknięciu.
import * as db from './db.js';
import { groupDue, localParts } from './timeutil.js';
import { refresh, checkPositions, job } from './runner.js';

const attempts = new Map(); // `${groupId}:${date}` -> { n, next }
const MAX_ATTEMPTS = 3, RETRY_MS = 10 * 60 * 1000;

export async function tick(now = new Date()) {
  if (job.running) return;
  for (const g of db.listGroups()) {
    if (!groupDue(g, now)) continue;
    const date = localParts(g.timezone, now).date;
    const key = `${g.id}:${date}`;
    const a = attempts.get(key) || { n: 0, next: 0 };
    if (a.next > now.getTime()) continue;
    a.n++;
    console.log(`[scheduler] ${g.name}: zamknięcie ${g.close_time} ${g.timezone}, próba ${a.n}`);
    let status;
    try {
      const r = await refresh({ groupId: g.id, trigger: 'schedule' });
      if (!r.ok && a.n < MAX_ATTEMPTS) {
        a.next = Date.now() + RETRY_MS;
        attempts.set(key, a);
        console.warn(`[scheduler] ${g.name}: brak danych, ponowię za 10 min`);
        return;
      }
      status = r.ok ? (r.errors.length ? `partial:${r.errors.length}/${r.total}` : 'ok') : 'error';
      if (r.mail) status += ` mail:${r.mail}`;
    } catch (e) {
      if (e.message === 'BUSY') return;
      status = `error:${e.message}`;
      console.error('[scheduler]', e);
    }
    db.markGroupRun(g.id, date, status);
    attempts.delete(key);
    return; // jedna grupa na takt; kolejna przy następnym
  }
}

/** Numer bieżącego okna 4-godzinnego (UTC), gdy minęło już opóźnienie; inaczej null. */
export function h4Slot(now, delayMin) {
  const sec = now.getTime() / 1000;
  const slot = Math.floor(sec / 14400);
  return sec - slot * 14400 >= delayMin * 60 ? slot : null;
}

/** Co 4 godziny (00, 04, 08… UTC + opóźnienie) sprawdza otwarte pozycje na świecach H4. */
export async function tickH4(now = new Date()) {
  if (job.running) return;
  const s = db.getSettings();
  if (!s.h4.enabled) return;
  const slot = h4Slot(now, s.h4.delay_min ?? 5);
  if (slot == null || String(slot) === db.getMeta('h4slot')) return;
  if (!db.listPositions().length) { db.setMeta('h4slot', slot); return; }
  console.log(`[scheduler] H4: analiza otwartych pozycji (${now.toISOString().slice(0, 16)}Z)`);
  try {
    const r = await checkPositions({ trigger: 'schedule' });
    db.setMeta('h4slot', slot);
    db.setMeta('h4status', `${now.toISOString()}|${r.errors.length ? 'partial' : 'ok'}${r.mail ? ' mail:' + r.mail : ''}`);
  } catch (e) {
    if (e.message !== 'BUSY') { console.error('[scheduler] H4', e); db.setMeta('h4slot', slot); }
  }
}

export function startScheduler() {
  const run = () => tick().then(() => tickH4()).catch((e) => console.error('[scheduler]', e));
  setTimeout(run, 5000);
  return setInterval(run, 30000);
}
