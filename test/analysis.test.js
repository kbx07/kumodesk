import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarket, summarize, diffAlerts } from '../server/analysis.js';
import { DEFAULT_SETTINGS } from '../server/defaults.js';
import { normalizeBars } from '../server/providers/index.js';
import { isBarClosed, groupDue, localParts, nextRun } from '../server/timeutil.js';
import { MESSAGES, t, detectLang } from '../public/i18n.js';
import fs from 'node:fs';

function series(n, f) {
  const out = []; let d = new Date('2023-01-02T00:00:00Z'), i = 0;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(i++); out.push({ date: d.toISOString().slice(0, 10), o: c * 0.999, h: c * 1.004, l: c * 0.996, c }); }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
const group = { id: 1, name: 'G', close_time: '17:00', timezone: 'America/New_York', delay_min: 10, days: '1,2,3,4,5', enabled: 1, last_run_date: null };
const fx = (id) => ({ id, name: id, class: 'fx', base: id.slice(0, 3), quote: id.slice(3), group_id: 1, enabled: true });
const up = (n = 600) => series(n, (i) => 1 * 1.002 ** i);
const down = (n = 600) => series(n, (i) => 1 * 0.998 ** i);
const flat = (n = 600) => series(n, () => 1);
const run = (instruments, candlesById, positions = [], settings = DEFAULT_SETTINGS) =>
  analyzeMarket({ instruments, candlesById, groupsById: { 1: group }, positions, settings, now: new Date('2026-01-01T00:00:00Z') });

test('currency strength and symmetry: EUR strong, JPY weak', () => {
  const m = run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], { EURUSD: up(), USDJPY: up(), EURJPY: up() });
  const s = Object.fromEntries(m.strength.map((x) => [x.currency, x.value]));
  assert.equal(s.EUR, 10); assert.equal(s.JPY, -10); assert.equal(s.USD, 0);
  const by = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  assert.equal(by.EURJPY.dir, 'LONG'); assert.equal(by.EURJPY.sym, 'CLEAN'); assert.equal(by.EURJPY.align, 'FULL');
  assert.equal(by.EURUSD.sym, 'MIXED'); // USD is neutral, so symmetry is only partial
  assert.equal(m.primary, 'EURJPY');
  assert.equal(m.regime.state, 'TREND');
});

test('directionless market: no setups, defensive mode', () => {
  const m = run([fx('EURUSD'), fx('USDJPY')], { EURUSD: flat(), USDJPY: flat() });
  assert.equal(m.primary, null);
  assert.equal(m.exec, 'DEFENSIVE');
  assert.equal(m.regime.state, 'RANGE');
  assert.ok(m.instruments.every((a) => a.grade === 'D' && a.action === 'WAIT'));
});

test('too little data does not break the analysis', () => {
  const m = run([fx('EURUSD'), fx('USDJPY')], { EURUSD: up(40), USDJPY: up() });
  const e = m.instruments.find((a) => a.id === 'EURUSD');
  assert.equal(e.ok, false); assert.equal(e.reason, 'NO_DATA');
  assert.ok(m.notes.some((n) => n.code === 'note.nodata'));
  assert.equal(run([], {}).empty, true);
});

test('portfolio: a currency limit blocks new entries, a reversed signal is a threat', () => {
  const inst = [fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], c = { EURUSD: up(), USDJPY: up(), EURJPY: up() };
  const m = run(inst, c, [{ id: 1, instrument_id: 'EURJPY', direction: 'LONG', risk_pct: 3 }]);
  assert.equal(m.portfolio.state, 'BLOCK');          // EUR +3% > limit 2.5%
  assert.equal(m.portfolio.exposure.EUR, 3); assert.equal(m.portfolio.exposure.JPY, -3);
  assert.equal(m.exec, 'DEFENSIVE');
  assert.ok(m.instruments.every((a) => a.action !== 'PLAY'));
  const m2 = run(inst, c, [{ id: 1, instrument_id: 'EURJPY', direction: 'SHORT', risk_pct: 0.5 }]);
  assert.ok(m2.portfolio.threats.some((x) => x.code === 'threat.reversed'));
  assert.equal(m2.portfolio.positions[0].status, 'REVERSED');
});

test('overextension lowers the setup grade', () => {
  // gentle trend + sharp jump at the end => price far from Kijun
  const bars = series(600, (i) => (i < 590 ? 1 * 1.0005 ** i : 1 * 1.0005 ** 590 * 1.02 ** (i - 589)));
  const m = run([{ id: 'XAUUSD', name: 'Gold', class: 'metal', group_id: 1, enabled: true }], { XAUUSD: bars });
  const a = m.instruments[0];
  assert.equal(a.over, 'HOT'); assert.notEqual(a.grade, 'A'); assert.equal(a.plan.code, 'plan.long.pullback');
});

test('alerts: new setup, lost setup, regime change', () => {
  const trending = summarize(run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], { EURUSD: up(), USDJPY: up(), EURJPY: up() }));
  const quiet = summarize(run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], { EURUSD: flat(), USDJPY: flat(), EURJPY: flat() }));
  const a1 = diffAlerts(quiet, trending, { minGrade: 'B' });
  assert.ok(a1.some((a) => a.type === 'NEW_SETUP' && a.instrument_id === 'EURJPY'));
  assert.ok(a1.some((a) => a.type === 'REGIME'));
  const a2 = diffAlerts(trending, quiet, { minGrade: 'B' });
  assert.ok(a2.some((a) => a.type === 'SETUP_LOST' && a.instrument_id === 'EURJPY'));
  assert.deepEqual(diffAlerts(trending, trending), []);
  assert.deepEqual(diffAlerts(null, trending), []);
  assert.deepEqual(diffAlerts(quiet, trending, { groupId: 99 }).filter((a) => a.type === 'NEW_SETUP'), []);
});

test('the unclosed candle of the current day is skipped', () => {
  const bars = up();
  const last = bars.at(-1).date;
  const before = new Date(last + 'T15:00:00Z'); // 10:00 in New York – before the close
  const m = analyzeMarket({ instruments: [fx('EURUSD')], candlesById: { EURUSD: bars }, groupsById: { 1: group }, positions: [], settings: DEFAULT_SETTINGS, now: before });
  assert.equal(m.instruments[0].date, bars.at(-2).date);
  assert.equal(isBarClosed(last, group, new Date(last + 'T23:00:00Z')), true);
});

test('group schedule: time zones, delay, once a day', () => {
  const g = { ...group }; // 17:00 NY + 10 min; 2026-01-07 is a Wednesday, NY = UTC−5
  assert.equal(groupDue(g, new Date('2026-01-07T22:05:00Z')), false);
  assert.equal(groupDue(g, new Date('2026-01-07T22:10:00Z')), true);
  assert.equal(groupDue({ ...g, last_run_date: '2026-01-07' }, new Date('2026-01-07T23:00:00Z')), false);
  assert.equal(groupDue(g, new Date('2026-01-10T23:00:00Z')), false); // Saturday
  assert.equal(groupDue({ ...g, enabled: 0 }, new Date('2026-01-07T23:00:00Z')), false);
  // summer: NY = UTC−4, so the same 17:10 falls at 21:10 UTC
  assert.equal(groupDue(g, new Date('2026-07-08T21:10:00Z')), true);
  assert.equal(localParts('Asia/Tokyo', new Date('2026-01-07T22:10:00Z')).date, '2026-01-08');
  assert.equal(nextRun(g, new Date('2026-01-07T12:00:00Z')).toISOString(), '2026-01-07T22:10:00.000Z');
  assert.equal(nextRun(g, new Date('2026-01-09T23:00:00Z')).toISOString(), '2026-01-12T22:10:00.000Z'); // Friday after the close -> Monday
});

test('round-the-clock market: end of trading 00:00 closes the candle only at midnight', () => {
  const g = { id: 9, name: 'Crypto', close_time: '00:00', timezone: 'UTC', delay_min: 10, days: '1,2,3,4,5,6,7', enabled: 1, last_run_date: null };
  assert.equal(isBarClosed('2026-01-07', g, new Date('2026-01-07T07:50:00Z')), false); // today's candle is still open
  assert.equal(isBarClosed('2026-01-06', g, new Date('2026-01-07T00:00:30Z')), true);  // yesterday's is closed
  assert.equal(groupDue(g, new Date('2026-01-07T00:05:00Z')), false);
  assert.equal(groupDue(g, new Date('2026-01-07T00:10:00Z')), true);
  assert.equal(groupDue(g, new Date('2026-01-10T00:10:00Z')), true);                  // Saturday too
});

test('candle normalisation: duplicates and the weekend merged into Monday', () => {
  const out = normalizeBars([
    { date: '2026-01-09', o: 1, h: 2, l: 0.5, c: 1.5 },
    { date: '2026-01-11', o: 1.4, h: 1.9, l: 1.3, c: 1.6 }, // Sunday
    { date: '2026-01-12', o: 1.6, h: 1.8, l: 1.5, c: 1.7 },
    { date: '2026-01-12', o: 1.6, h: 1.85, l: 1.5, c: 1.75 },
  ]);
  assert.deepEqual(out.map((b) => b.date), ['2026-01-09', '2026-01-12']);
  assert.deepEqual(out[1], { date: '2026-01-12', o: 1.4, h: 1.9, l: 1.3, c: 1.75 });
});

test('translations: three languages share the same keys and the code uses only existing ones', () => {
  const keys = (l) => Object.keys(MESSAGES[l]).sort();
  assert.deepEqual(keys('pl'), keys('en')); assert.deepEqual(keys('de'), keys('en'));
  const src = ['public/app.js', 'server/mailer.js'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const used = [...src.matchAll(/\b(?:T|tt|t)\((?:L, |lang, )?'([^']+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.'));
  assert.ok(used.length > 150);
  for (const k of used) assert.ok(k in MESSAGES.en, `missing key: ${k}`);
  const srv = ['server/index.js', 'server/db.js', 'server/analysis.js', 'server/runner.js'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  for (const m of srv.matchAll(/'((?:err|threat|alert|plan|note|advice)\.[A-Za-z.]+)'/g)) if (!m[1].endsWith('.')) assert.ok(m[1] in MESSAGES.en, `missing key: ${m[1]}`);
  assert.equal(detectLang(['pl-PL', 'en']), 'pl'); assert.equal(detectLang(['de-AT']), 'de'); assert.equal(detectLang(['fr-FR', 'pl']), 'en'); assert.equal(detectLang([]), 'en');
  assert.equal(t('de', 'alert.regime', { from: 'TREND', to: 'RANGE' }), 'Marktregime geändert: TREND → SEITWÄRTS.');
});
