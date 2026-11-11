// Session flow: how currencies behaved in the latest Sydney / Tokyo / London / New York session.
import { localParts } from './timeutil.js';
import { BASKETS } from './defaults.js';

export const SESSIONS = [
  { key: 'SYDNEY', timezone: 'Australia/Sydney', open: 7 * 60, close: 16 * 60 },
  { key: 'TOKYO', timezone: 'Asia/Tokyo', open: 9 * 60, close: 18 * 60 },
  { key: 'LONDON', timezone: 'Europe/London', open: 8 * 60, close: 17 * 60 },
  { key: 'NEWYORK', timezone: 'America/New_York', open: 8 * 60, close: 17 * 60 },
];

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/**
 * h1ById: { id: [{ts,o,h,l,c}] } – hourly candles of the currency pairs; pairs: [{id, base, quote}].
 * For each session takes its latest finished occurrence and computes each pair's move,
 * currency strength (mean % move across a currency's pairs) and the mood.
 */
export function computeSessions(h1ById, pairs, now = new Date()) {
  const nowSec = now.getTime() / 1000;
  const out = [];
  for (const sess of SESSIONS) {
    // assign hours to the session's local days (robust to daylight saving changes)
    const days = new Map(); // local date -> { id -> [bars] }
    for (const p of pairs) {
      for (const b of h1ById[p.id] || []) {
        const lp = localParts(sess.timezone, new Date(b.ts * 1000));
        if (lp.weekday > 5 || lp.minutes < sess.open || lp.minutes >= sess.close) continue;
        let d = days.get(lp.date);
        if (!d) { d = { bars: {}, first: b.ts, last: b.ts }; days.set(lp.date, d); }
        (d.bars[p.id] ||= []).push(b);
        if (b.ts < d.first) d.first = b.ts;
        if (b.ts > d.last) d.last = b.ts;
      }
    }
    const hours = (sess.close - sess.open) / 60;
    // the latest day on which the session has finished and has complete data
    const done = [...days.entries()].filter(([, d]) => d.last + 3600 <= nowSec && d.last - d.first >= (hours - 2) * 3600).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
    if (!done) { out.push({ key: sess.key, ok: false }); continue; }
    const [date, d] = done;
    const moves = {}, acc = {};
    for (const p of pairs) {
      const bars = d.bars[p.id];
      if (!bars || bars.length < hours - 2) continue;
      bars.sort((a, b) => a.ts - b.ts);
      const ret = ((bars.at(-1).c - bars[0].o) / bars[0].o) * 100;
      moves[p.id] = round(ret, 3);
      (acc[p.base] ||= []).push(ret);
      (acc[p.quote] ||= []).push(-ret);
    }
    const strength = Object.entries(acc).map(([currency, v]) => ({ currency, value: round(mean(v), 3) })).sort((a, b) => b.value - a.value);
    if (strength.length < 2) { out.push({ key: sess.key, ok: false }); continue; }
    const val = Object.fromEntries(strength.map((s) => [s.currency, s.value]));
    const basket = (k) => { const v = BASKETS[k].map((c) => val[c]).filter((x) => x != null); return v.length ? mean(v) : null; };
    const carry = basket('CARRY'), safe = basket('SAFE');
    const appetite = carry != null && safe != null ? carry - safe : 0;
    const spread = strength[0].value - strength.at(-1).value;
    let mood = 'QUIET';
    if (Math.abs(appetite) >= 0.1) mood = appetite > 0 ? 'RISK_ON' : 'RISK_OFF';
    else if (spread >= 0.25) mood = 'SELECTIVE';
    else if (spread >= 0.12) mood = 'MIXED';
    out.push({
      key: sess.key, ok: true, date,
      start: new Date(d.first * 1000).toISOString(), end: new Date((d.last + 3600) * 1000).toISOString(),
      mood, appetite: round(appetite, 3), spread: round(spread, 3),
      best: strength[0], worst: strength.at(-1), strength, moves,
    });
  }
  const valid = out.filter((s) => s.ok).sort((a, b) => (a.end < b.end ? -1 : 1));
  // summary: currencies that were strongest / weakest across the recent sessions
  const tally = {};
  for (const s of valid) for (const x of s.strength) tally[x.currency] = (tally[x.currency] || 0) + x.value;
  const total = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const moods = valid.map((s) => s.mood).filter((m) => m === 'RISK_ON' || m === 'RISK_OFF');
  return {
    sessions: out,
    order: valid.map((s) => s.key),
    summary: valid.length ? {
      best: total[0][0], worst: total.at(-1)[0],
      mood: moods.length >= 2 && moods.every((m) => m === moods[0]) ? moods[0] : moods.length ? 'MIXED' : 'QUIET',
    } : null,
  };
}

/** How many recent sessions supported the setup's direction on the given pair. */
export function sessionSupport(sessions, id, dir) {
  if (!sessions || dir === 'NEUTRAL') return null;
  const sign = dir === 'LONG' ? 1 : -1;
  const list = sessions.sessions.filter((s) => s.ok && s.moves[id] != null);
  if (list.length < 2) return null;
  return { agree: list.filter((s) => sign * s.moves[id] > 0).length, total: list.length };
}
