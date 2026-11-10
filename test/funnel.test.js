import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarket, climateFit, FUNNEL_STAGES } from '../server/analysis.js';
import { computeSessions, sessionSupport } from '../server/sessions.js';
import { DEFAULT_SETTINGS as S } from '../server/defaults.js';
import { MESSAGES } from '../public/i18n.js';

function series(n, f) {
  const out = []; let d = new Date('2023-01-02T00:00:00Z'), i = 0;
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) { const c = f(i++); out.push({ date: d.toISOString().slice(0, 10), o: c * 0.999, h: c * 1.004, l: c * 0.996, c }); }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}
const group = { id: 1, name: 'G', close_time: '17:00', timezone: 'America/New_York', delay_min: 10, days: '1,2,3,4,5', enabled: 1 };
const fx = (id) => ({ id, name: id, class: 'fx', base: id.slice(0, 3), quote: id.slice(3), group_id: 1, enabled: true });
const up = series(600, (i) => 1.002 ** i), flat = series(600, () => 1);
const run = (instruments, candlesById, extra = {}) => analyzeMarket({ instruments, candlesById, groupsById: { 1: group }, positions: [], settings: S, now: new Date('2026-01-01T00:00:00Z'), ...extra });

test('lejek: dziewięć etapów, liczniki maleją, na końcu zostają tylko „graj”', () => {
  const m = run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY'), fx('GBPCHF'), fx('AUDNZD')],
    { EURUSD: up, USDJPY: up, EURJPY: up, GBPCHF: flat, AUDNZD: up.slice(0, 40) });
  assert.deepEqual(m.funnel.map((s) => s.key), FUNNEL_STAGES);
  assert.equal(m.funnel[0].in, 5); assert.equal(m.funnel[0].out, 4); // AUDNZD bez danych
  for (let i = 1; i < 9; i++) { assert.equal(m.funnel[i].in, m.funnel[i - 1].out); assert.ok(m.funnel[i].out <= m.funnel[i].in); }
  const by = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  assert.equal(by.AUDNZD.failedAt, 'input'); assert.equal(by.GBPCHF.failedAt, 'selection');
  assert.equal(by.EURJPY.failedAt, null); assert.equal(by.EURJPY.action, 'PLAY');
  // spójność: przeżywa cały lejek dokładnie ten, kto ma decyzję „graj”
  for (const a of m.instruments) assert.equal(a.failedAt === null, a.action === 'PLAY', a.id);
  assert.equal(m.funnel.at(-1).out, m.instruments.filter((a) => a.action === 'PLAY').length);
  for (const a of m.instruments) for (const s of a.funnel) assert.ok(s.code in MESSAGES.pl, s.code);
});

test('słaba symetria zatrzymuje parę na etapie symetrii', () => {
  // wszystkie pary rosną jednakowo => siły walut się znoszą dla par „środkowych”
  const m = run([fx('EURUSD'), fx('USDJPY'), fx('EURJPY'), fx('EURGBP'), fx('GBPUSD'), fx('GBPJPY')],
    { EURUSD: up, USDJPY: up, EURJPY: up, EURGBP: flat, GBPUSD: up, GBPJPY: up });
  const weak = m.instruments.filter((a) => a.ok && a.sym === 'WEAK' && a.dir !== 'NEUTRAL');
  for (const a of weak) { assert.equal(a.failedAt, 'symmetry'); assert.ok(['C', 'D'].includes(a.grade)); assert.notEqual(a.action, 'PLAY'); }
});

test('spółka przeciw swojemu indeksowi odpada na symetrii', () => {
  const down = series(600, (i) => 0.998 ** i);
  const idx = { id: 'DAX', name: 'DAX', class: 'index', category: 'index', group_id: 1, enabled: true };
  const st = (id) => ({ id, name: id, class: 'stock', category: 'dax', group_id: 1, enabled: true });
  const m = run([idx, st('SAP.DE'), st('BMW.DE')], { DAX: up, 'SAP.DE': up, 'BMW.DE': down });
  const by = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  assert.equal(by['SAP.DE'].sym, 'CLEAN'); assert.equal(by['SAP.DE'].failedAt, null);
  assert.equal(by['BMW.DE'].sym, 'WEAK'); assert.equal(by['BMW.DE'].failedAt, 'symmetry'); assert.notEqual(by['BMW.DE'].action, 'PLAY');
  for (const a of m.instruments) for (const s of a.funnel) assert.ok(s.code in MESSAGES.de, s.code);
});

test('klimat: gra pod prąd nie jest setupem głównym', () => {
  const riskOff = { mood: 'RISK_OFF', quality: 'HIGH' };
  assert.equal(climateFit({ dir: 'LONG', class: 'fx', base: 'AUD', quote: 'JPY' }, riskOff), 'AGAINST');
  assert.equal(climateFit({ dir: 'SHORT', class: 'fx', base: 'AUD', quote: 'JPY' }, riskOff), 'WITH');
  assert.equal(climateFit({ dir: 'LONG', class: 'fx', base: 'USD', quote: 'JPY' }, riskOff), 'NA');  // obie bezpieczne
  assert.equal(climateFit({ dir: 'LONG', class: 'index' }, riskOff), 'AGAINST');
  assert.equal(climateFit({ dir: 'LONG', class: 'metal' }, riskOff), 'NA');
  assert.equal(climateFit({ dir: 'LONG', class: 'index' }, { mood: 'RISK_OFF', quality: 'LOW' }), 'NA');
});

test('sesje: siła walut i nastrój z danych godzinowych', () => {
  // środa 2026-01-07; EURUSD rośnie o 0,1% na godzinę w Londynie, USDJPY stoi
  const hours = (from, n, f) => Array.from({ length: n }, (_, i) => { const o = f(i), c = f(i + 1); return { ts: Date.parse(from) / 1000 + i * 3600, o, h: Math.max(o, c), l: Math.min(o, c), c }; });
  const h1 = {
    EURUSD: hours('2026-01-06T20:00:00Z', 30, (i) => (i >= 12 && i <= 21 ? 1 + (i - 12) * 0.001 : i < 12 ? 1 : 1.009)),
    USDJPY: hours('2026-01-06T20:00:00Z', 30, () => 150),
  };
  const r = computeSessions(h1, [fx('EURUSD'), fx('USDJPY')], new Date('2026-01-08T00:00:00Z'));
  const london = r.sessions.find((s) => s.key === 'LONDON');
  assert.equal(london.ok, true); assert.equal(london.date, '2026-01-07');
  assert.equal(london.start, '2026-01-07T08:00:00.000Z'); assert.equal(london.end, '2026-01-07T17:00:00.000Z');
  assert.equal(london.best.currency, 'EUR'); assert.equal(london.worst.currency, 'USD');
  assert.ok(london.moves.EURUSD > 0.8 && london.moves.EURUSD < 1);
  assert.equal(london.mood, 'SELECTIVE');            // brak walut carry w próbce, ale jedna waluta wyraźnie się wyróżnia
  assert.deepEqual(sessionSupport(r, 'EURUSD', 'NEUTRAL'), null);
  const sup = sessionSupport(r, 'EURUSD', 'LONG');
  assert.ok(sup.total >= 2 && sup.agree >= 1);
  assert.equal(computeSessions({}, [fx('EURUSD')]).sessions.every((s) => !s.ok), true);
});

test('instrukcja: trzy języki mają te same sekcje i tę samą budowę', async () => {
  const { HELP } = await import('../public/help.js');
  const shape = (l) => HELP[l].map((s) => [s.id, s.body.map((b) => (Array.isArray(b) ? b.length : 'p'))]);
  assert.deepEqual(shape('pl'), shape('en')); assert.deepEqual(shape('de'), shape('en'));
  assert.ok(HELP.en.length >= 8);
  for (const l of ['pl', 'de', 'en']) for (const s of HELP[l]) assert.ok(s.title && s.body.length, `${l}/${s.id}`);
});
