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

test('siła walut i symetria: EUR silne, JPY słabe', () => {
  const m = run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], { EURUSD: up(), USDJPY: up(), EURJPY: up() });
  const s = Object.fromEntries(m.strength.map((x) => [x.currency, x.value]));
  assert.equal(s.EUR, 10); assert.equal(s.JPY, -10); assert.equal(s.USD, 0);
  const by = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  assert.equal(by.EURJPY.dir, 'LONG'); assert.equal(by.EURJPY.sym, 'CLEAN'); assert.equal(by.EURJPY.align, 'FULL');
  assert.equal(by.EURUSD.sym, 'MIXED'); // USD jest neutralny, więc symetria tylko częściowa
  assert.equal(m.primary, 'EURJPY');
  assert.equal(m.regime.state, 'TREND');
});

test('rynek bez kierunku: brak setupów, tryb defensywny', () => {
  const m = run([fx('EURUSD'), fx('USDJPY')], { EURUSD: flat(), USDJPY: flat() });
  assert.equal(m.primary, null);
  assert.equal(m.exec, 'DEFENSIVE');
  assert.equal(m.regime.state, 'RANGE');
  assert.ok(m.instruments.every((a) => a.grade === 'D' && a.action === 'WAIT'));
});

test('za mało danych nie wywraca analizy', () => {
  const m = run([fx('EURUSD'), fx('USDJPY')], { EURUSD: up(40), USDJPY: up() });
  const e = m.instruments.find((a) => a.id === 'EURUSD');
  assert.equal(e.ok, false); assert.equal(e.reason, 'NO_DATA');
  assert.ok(m.notes.some((n) => n.code === 'note.nodata'));
  assert.equal(run([], {}).empty, true);
});

test('portfel: limit waluty blokuje nowe wejścia, odwrócony sygnał jest zagrożeniem', () => {
  const inst = [fx('EURUSD'), fx('USDJPY'), fx('EURJPY')], c = { EURUSD: up(), USDJPY: up(), EURJPY: up() };
  const m = run(inst, c, [{ id: 1, instrument_id: 'EURJPY', direction: 'LONG', risk_pct: 3 }]);
  assert.equal(m.portfolio.state, 'BLOCK');          // EUR +3% > limit 2,5%
  assert.equal(m.portfolio.exposure.EUR, 3); assert.equal(m.portfolio.exposure.JPY, -3);
  assert.equal(m.exec, 'DEFENSIVE');
  assert.ok(m.instruments.every((a) => a.action !== 'PLAY'));
  const m2 = run(inst, c, [{ id: 1, instrument_id: 'EURJPY', direction: 'SHORT', risk_pct: 0.5 }]);
  assert.ok(m2.portfolio.threats.some((x) => x.code === 'threat.reversed'));
  assert.equal(m2.portfolio.positions[0].status, 'REVERSED');
});

test('przegrzanie obniża klasę setupu', () => {
  // łagodny trend + gwałtowny skok na końcu => cena daleko od Kijun
  const bars = series(600, (i) => (i < 590 ? 1 * 1.0005 ** i : 1 * 1.0005 ** 590 * 1.02 ** (i - 589)));
  const m = run([{ id: 'XAUUSD', name: 'Gold', class: 'metal', group_id: 1, enabled: true }], { XAUUSD: bars });
  const a = m.instruments[0];
  assert.equal(a.over, 'HOT'); assert.notEqual(a.grade, 'A'); assert.equal(a.plan.code, 'plan.long.pullback');
});

test('alerty: nowy setup, utrata setupu, zmiana reżimu', () => {
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

test('niezamknięta świeca dnia bieżącego jest pomijana', () => {
  const bars = up();
  const last = bars.at(-1).date;
  const before = new Date(last + 'T15:00:00Z'); // 10:00 w Nowym Jorku – przed zamknięciem
  const m = analyzeMarket({ instruments: [fx('EURUSD')], candlesById: { EURUSD: bars }, groupsById: { 1: group }, positions: [], settings: DEFAULT_SETTINGS, now: before });
  assert.equal(m.instruments[0].date, bars.at(-2).date);
  assert.equal(isBarClosed(last, group, new Date(last + 'T23:00:00Z')), true);
});

test('harmonogram grup: strefy czasowe, opóźnienie, raz dziennie', () => {
  const g = { ...group }; // 17:00 NY + 10 min; 2026-01-07 to środa, NY = UTC−5
  assert.equal(groupDue(g, new Date('2026-01-07T22:05:00Z')), false);
  assert.equal(groupDue(g, new Date('2026-01-07T22:10:00Z')), true);
  assert.equal(groupDue({ ...g, last_run_date: '2026-01-07' }, new Date('2026-01-07T23:00:00Z')), false);
  assert.equal(groupDue(g, new Date('2026-01-10T23:00:00Z')), false); // sobota
  assert.equal(groupDue({ ...g, enabled: 0 }, new Date('2026-01-07T23:00:00Z')), false);
  // lato: NY = UTC−4, więc to samo 17:10 przypada o 21:10 UTC
  assert.equal(groupDue(g, new Date('2026-07-08T21:10:00Z')), true);
  assert.equal(localParts('Asia/Tokyo', new Date('2026-01-07T22:10:00Z')).date, '2026-01-08');
  assert.equal(nextRun(g, new Date('2026-01-07T12:00:00Z')).toISOString(), '2026-01-07T22:10:00.000Z');
  assert.equal(nextRun(g, new Date('2026-01-09T23:00:00Z')).toISOString(), '2026-01-12T22:10:00.000Z'); // piątek po zamknięciu -> poniedziałek
});

test('normalizacja świec: duplikaty i weekend dołączony do poniedziałku', () => {
  const out = normalizeBars([
    { date: '2026-01-09', o: 1, h: 2, l: 0.5, c: 1.5 },
    { date: '2026-01-11', o: 1.4, h: 1.9, l: 1.3, c: 1.6 }, // niedziela
    { date: '2026-01-12', o: 1.6, h: 1.8, l: 1.5, c: 1.7 },
    { date: '2026-01-12', o: 1.6, h: 1.85, l: 1.5, c: 1.75 },
  ]);
  assert.deepEqual(out.map((b) => b.date), ['2026-01-09', '2026-01-12']);
  assert.deepEqual(out[1], { date: '2026-01-12', o: 1.4, h: 1.9, l: 1.3, c: 1.75 });
});

test('tłumaczenia: trzy języki mają te same klucze, a kod używa tylko istniejących', () => {
  const keys = (l) => Object.keys(MESSAGES[l]).sort();
  assert.deepEqual(keys('pl'), keys('en')); assert.deepEqual(keys('de'), keys('en'));
  const src = ['public/app.js', 'server/mailer.js'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const used = [...src.matchAll(/\b(?:T|tt|t)\((?:L, |lang, )?'([^']+)'/g)].map((m) => m[1]).filter((k) => !k.endsWith('.'));
  assert.ok(used.length > 150);
  for (const k of used) assert.ok(k in MESSAGES.en, `brak klucza: ${k}`);
  const srv = ['server/index.js', 'server/db.js', 'server/analysis.js', 'server/runner.js'].map((f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  for (const m of srv.matchAll(/'((?:err|threat|alert|plan|note|advice)\.[A-Za-z.]+)'/g)) if (!m[1].endsWith('.')) assert.ok(m[1] in MESSAGES.en, `brak klucza: ${m[1]}`);
  assert.equal(detectLang(['pl-PL', 'en']), 'pl'); assert.equal(detectLang(['de-AT']), 'de'); assert.equal(detectLang(['fr-FR', 'pl']), 'en'); assert.equal(detectLang([]), 'en');
  assert.equal(t('de', 'alert.regime', { from: 'TREND', to: 'RANGE' }), 'Marktregime geändert: TREND → SEITWÄRTS.');
});
