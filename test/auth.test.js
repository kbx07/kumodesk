import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, verifyPassword, validUsername, validPassword } from '../server/auth.js';

test('hasła: scrypt z solą, weryfikacja, walidacja', () => {
  const h = hashPassword('correct horse');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(h, hashPassword('correct horse'));              // inna sól za każdym razem
  assert.equal(verifyPassword('correct horse', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(validUsername('kuba.n-1'), true); assert.equal(validUsername('ab'), false); assert.equal(validUsername('a b c'), false);
  assert.equal(validPassword('1234567'), false); assert.equal(validPassword('12345678'), true);
});

// Pełny przebieg na prawdziwym serwerze: pierwsze uruchomienie, logowanie, role, izolacja danych, udostępnianie, wiadomości.
test('serwer: konfiguracja, logowanie, role, izolacja portfeli, udostępnianie, wiadomości', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-auth-'));
  const port = 39000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, KUMODESK_NO_SCHEDULER: '1' }, stdio: 'ignore',
  });
  t.after(() => { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}/api`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/auth/state'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

  const client = () => {
    let cookie = '';
    return async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})), setCookie: sc };
    };
  };
  const anon = client(), alice = client(), bob = client(), carol = client();

  // przed konfiguracją: API zamknięte, stan mówi „setup”
  assert.equal((await anon('GET', '/auth/state')).body.setup, true);
  assert.equal((await anon('GET', '/dashboard')).status, 401);
  assert.equal((await anon('GET', '/positions')).status, 401);
  assert.equal((await anon('POST', '/auth/setup', { username: 'alice', password: 'short' })).status, 400);

  // pierwsze konto = administrator; drugi raz konfiguracja jest zamknięta
  const setup = await alice('POST', '/auth/setup', { username: 'alice', password: 'alice-password', email: 'alice@example.com' });
  assert.equal(setup.status, 201); assert.equal(setup.body.user.role, 'admin');
  assert.match(setup.setCookie, /HttpOnly/); assert.match(setup.setCookie, /SameSite=Lax/);
  assert.equal((await anon('POST', '/auth/setup', { username: 'mallory', password: 'mallory-pass' })).status, 409);
  assert.equal((await anon('GET', '/auth/state')).body.setup, false);
  assert.equal((await alice('GET', '/auth/state')).body.user.username, 'alice');

  // złe hasło, nieistniejący login, potem poprawne logowanie
  assert.equal((await anon('POST', '/auth/login', { username: 'alice', password: 'nope-nope' })).status, 401);
  assert.equal((await anon('POST', '/auth/login', { username: 'ghost', password: 'whatever1' })).status, 401);

  // administrator zakłada konta
  assert.equal((await alice('POST', '/users', { username: 'bob', password: 'bob-password', role: 'user' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'carol', password: 'carol-password', role: 'admin' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'BOB', password: 'bob-password' })).status, 400); // login bez rozróżniania wielkości liter
  assert.equal((await bob('POST', '/auth/login', { username: 'bob', password: 'bob-password' })).status, 200);
  assert.equal((await carol('POST', '/auth/login', { username: 'Carol', password: 'carol-password' })).status, 200);

  // zwykły użytkownik nie zmienia ustawień serwera ani kont, ale swoje ustawienia tak
  assert.equal((await bob('POST', '/users', { username: 'eve', password: 'eve-password' })).status, 403);
  assert.equal((await bob('PUT', '/settings', { smtp: { host: 'evil' } })).status, 403);
  assert.equal((await bob('POST', '/categories/toggle', { category: 'fx', enabled: false })).status, 403);
  assert.equal((await bob('PUT', '/settings', { capital: { start: 5000, currency: 'EUR' } })).status, 200);
  assert.equal((await bob('GET', '/settings')).body.settings.capital.start, 5000);
  assert.equal((await alice('GET', '/settings')).body.settings.capital.start, 0);   // kapitał jest osobisty
  assert.equal((await bob('GET', '/settings')).body.settings.smtp.host, '');         // dane serwera ukryte
  assert.equal((await bob('GET', '/users')).body[0].email, undefined);

  // pozycje są prywatne
  const pos = await alice('POST', '/positions', { instrument_id: 'EURUSD', direction: 'LONG', risk_pct: 1, entry: 1.1, stop: 1.09 });
  assert.equal(pos.status, 201);
  assert.equal((await alice('GET', '/positions')).body.length, 1);
  assert.equal((await bob('GET', '/positions')).body.length, 0);
  assert.equal((await bob('DELETE', `/positions/${pos.body.id}`)).status, 404);
  assert.equal((await bob('POST', `/positions/${pos.body.id}/close`, { exit: 1.2 })).status, 404);
  const closed = await alice('POST', `/positions/${pos.body.id}/close`, { exit: 1.12, closed: '2026-01-05' });
  assert.equal(Math.round(closed.body.r * 100) / 100, 2);
  assert.equal((await bob('DELETE', `/trades/${closed.body.tradeId}`)).status, 404);
  assert.equal((await bob('GET', '/capital')).body.trades.length, 0);
  assert.equal((await alice('GET', '/capital')).body.trades.length, 1);

  // udostępnianie całego portfela
  assert.equal((await bob('GET', '/portfolio/1')).status, 403);
  assert.deepEqual((await alice('PUT', '/shares', { viewers: [2, 999, 1] })).body.viewers, [2]);
  const shared = await bob('GET', '/portfolio/1');
  assert.equal(shared.status, 200); assert.equal(shared.body.owner.username, 'alice'); assert.equal(shared.body.trades.length, 1);
  assert.deepEqual((await bob('GET', '/shares')).body.sharedWithMe, [{ id: 1, username: 'alice' }]);
  assert.equal((await carol('GET', '/portfolio/1')).status, 403);                    // carol nie dostała dostępu
  await alice('PUT', '/shares', { viewers: [] });
  assert.equal((await bob('GET', '/portfolio/1')).status, 403);

  // wiadomości i udostępnienie pojedynczego zagrania
  assert.equal((await alice('POST', '/messages', { to: 2, body: '' })).status, 400);
  assert.equal((await alice('POST', '/messages', { to: 1, body: 'do siebie' })).status, 400);
  assert.equal((await bob('POST', '/messages', { to: 1, body: 'x', trade_id: closed.body.tradeId })).status, 400); // cudze zagranie
  assert.equal((await alice('POST', '/messages', { to: 2, body: 'Zobacz to zagranie', trade_id: closed.body.tradeId })).status, 201);
  assert.equal((await bob('GET', '/status')).body.mail.unread, 1);
  assert.equal((await carol('GET', '/status')).body.mail.unread, 0);
  const th = await bob('GET', '/messages/1');
  assert.equal(th.body.messages.length, 1); assert.equal(th.body.messages[0].trade.instrument_id, 'EURUSD'); assert.equal(th.body.messages[0].trade.r, closed.body.r);
  assert.equal((await bob('GET', '/status')).body.mail.unread, 0);                   // otwarcie wątku oznacza jako przeczytane
  assert.equal((await carol('GET', '/messages/1')).body.messages.length, 0);        // osoba trzecia nie widzi rozmowy
  assert.equal((await bob('POST', '/messages', { to: 1, body: 'Dzięki!' })).status, 201);
  assert.equal((await alice('GET', '/messages')).body[0].unread, 1);

  // konto: zmiana hasła wymaga obecnego; ostatniego administratora nie da się usunąć ani zdegradować
  assert.equal((await bob('PUT', '/account', { current: 'wrong-one', password: 'new-password-1' })).status, 400);
  assert.equal((await bob('PUT', '/account', { current: 'bob-password', password: 'new-password-1' })).status, 200);
  assert.equal((await anon('POST', '/auth/login', { username: 'bob', password: 'bob-password' })).status, 401);
  assert.equal((await alice('DELETE', '/users/1')).status, 400);                     // samego siebie
  assert.equal((await alice('DELETE', '/users/3')).status, 200);                     // carol
  assert.equal((await alice('PUT', '/users/1', { role: 'user' })).status, 400);      // ostatni administrator
  assert.equal((await carol('GET', '/dashboard')).status, 401);                      // sesja usuniętego konta nie działa

  // wylogowanie
  assert.equal((await alice('POST', '/auth/logout')).status, 200);
  assert.equal((await alice('GET', '/dashboard')).status, 401);
});
