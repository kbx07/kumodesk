import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword, verifyPassword, validUsername, validPassword } from '../server/auth.js';
import * as totp from '../server/totp.js';

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

test('TOTP: wektory RFC 6238, tolerancja okna, blokada ponownego użycia', () => {
  const sec = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(sec, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp.base32Decode(sec).toString(), '12345678901234567890');
  assert.equal(totp.codeAt(sec, Math.floor(59 / 30)), '287082');            // RFC: 94287082
  assert.equal(totp.codeAt(sec, Math.floor(1111111109 / 30)), '081804');    // RFC: 07081804
  assert.equal(totp.codeAt(sec, Math.floor(2000000000 / 30)), '279037');    // RFC: 69279037
  const now = 1111111109000, cur = Math.floor(now / 30000);
  assert.equal(totp.verify(sec, '081804', { now }), cur);
  assert.equal(totp.verify(sec, totp.codeAt(sec, cur - 1), { now }), cur - 1);   // poprzednie okno jeszcze ważne
  assert.equal(totp.verify(sec, totp.codeAt(sec, cur - 2), { now }), null);      // starsze już nie
  assert.equal(totp.verify(sec, '081804', { now, lastCounter: cur }), null);     // ten sam kod drugi raz
  assert.equal(totp.verify(sec, '000000', { now }), null); assert.equal(totp.verify(sec, 'abc', { now }), null);
  const codes = totp.newRecoveryCodes();
  assert.equal(codes.length, 10); assert.match(codes[0], /^[0-9a-f]{4}-[0-9a-f]{4}$/);
  assert.equal(totp.hashCode(codes[0]), totp.hashCode(codes[0].replace('-', '').toUpperCase()));
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
    const call = async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})), setCookie: sc };
    };
    call.cookie = () => cookie;
    return call;
  };
  const anon = client(), alice = client(), bob = client(), carol = client();
  // konfiguracja weryfikacji dwuetapowej: pobierz sekret, potwierdź kodem; zwraca sekret i kody zapasowe
  const enrol = async (c) => {
    const b1 = await c('POST', '/auth/2fa/begin', {});
    assert.equal(b1.status, 200); assert.match(b1.body.qr, /<svg/); assert.match(b1.body.url, /^otpauth:\/\/totp\//);
    assert.equal((await c('POST', '/auth/2fa/enable', { code: '000000' })).status, 400);
    const e = await c('POST', '/auth/2fa/enable', { code: totp.codeAt(b1.body.secret, Math.floor(Date.now() / 30000)) });
    assert.equal(e.status, 200); assert.equal(e.body.user.twofa.enabled, true); assert.equal(e.body.recovery.length, 10);
    return { secret: b1.body.secret, recovery: e.body.recovery };
  };

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
  // nowe konto musi najpierw włączyć 2FA – do tego czasu API jest zamknięte
  assert.equal((await alice('GET', '/dashboard')).status, 403);
  assert.equal((await alice('GET', '/dashboard')).body.error, 'err.twofaRequired');
  const aliceTotp = await enrol(alice);
  assert.equal((await alice('GET', '/dashboard')).status, 200);
  assert.equal((await alice('POST', '/auth/2fa/disable', { password: 'alice-password' })).status, 400); // obowiązkowej nie da się wyłączyć

  // złe hasło, nieistniejący login, potem poprawne logowanie
  assert.equal((await anon('POST', '/auth/login', { username: 'alice', password: 'nope-nope' })).status, 401);
  assert.equal((await anon('POST', '/auth/login', { username: 'ghost', password: 'whatever1' })).status, 401);

  // administrator zakłada konta
  assert.equal((await alice('POST', '/users', { username: 'bob', password: 'bob-password', role: 'user' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'carol', password: 'carol-password', role: 'admin' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'BOB', password: 'bob-password' })).status, 400); // login bez rozróżniania wielkości liter
  assert.equal((await bob('POST', '/auth/login', { username: 'bob', password: 'bob-password' })).status, 200);
  assert.equal((await carol('POST', '/auth/login', { username: 'Carol', password: 'carol-password' })).status, 200);
  const bobTotp = await enrol(bob); await enrol(carol);

  // logowanie z 2FA: samo hasło nie wystarcza; zły kod odrzucony; kod zapasowy działa raz; zapamiętane urządzenie pomija kod
  const dev = client();
  const step1 = await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password' });
  assert.equal(step1.body.twofa, true); assert.equal(step1.setCookie, null);
  assert.equal((await dev('GET', '/dashboard')).status, 401);
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: '123456' })).status, 401);
  const rec = aliceTotp.recovery[0];
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: rec })).status, 200);
  await dev('POST', '/auth/logout');
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: rec })).status, 401); // zużyty
  const dev2 = client();
  let cookies = [];
  const raw = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice-password', code: aliceTotp.recovery[1], remember: true }) });
  cookies = raw.headers.getSetCookie().map((x) => x.split(';')[0]);
  assert.equal(raw.status, 200); assert.ok(cookies.some((x) => x.startsWith('kd_device=')));
  const deviceCookie = cookies.find((x) => x.startsWith('kd_device='));
  const again = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: deviceCookie }, body: JSON.stringify({ username: 'alice', password: 'alice-password' }) });
  assert.equal(again.status, 200); assert.equal((await again.json()).user.username, 'alice');           // bez kodu na zapamiętanym urządzeniu
  const other = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: deviceCookie }, body: JSON.stringify({ username: 'bob', password: 'bob-password' }) });
  assert.equal((await other.json()).twofa, true);                                                       // ciasteczko alice nie działa dla boba
  void dev2; void bobTotp;

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
  assert.equal((await alice('GET', '/messages')).body.threads[0].unread, 1);

  // czat grupowy: grupy zakłada administrator, czytają i piszą tylko członkowie
  assert.equal((await bob('POST', '/rooms', { name: 'x', members: [2] })).status, 403);
  const room = await alice('POST', '/rooms', { name: 'Ichimoku team', members: [1, 2] });
  assert.equal(room.status, 201);
  assert.equal((await bob('POST', `/rooms/${room.body.id}/messages`, { body: 'Cześć grupo' })).status, 201);
  assert.equal((await carol('GET', `/rooms/${room.body.id}/messages`)).status, 403);
  assert.equal((await carol('POST', `/rooms/${room.body.id}/messages`, { body: 'wchodzę' })).status, 403);
  assert.equal((await alice('GET', '/status')).body.mail.unread, 2);                 // 1 prywatna + 1 w grupie
  const rt = await alice('GET', `/rooms/${room.body.id}/messages`);
  assert.equal(rt.body.messages[0].from, 'bob'); assert.equal(rt.body.room.members.length, 2);
  assert.equal((await alice('GET', '/status')).body.mail.unread, 1);
  assert.equal((await bob('GET', '/messages')).body.rooms.length, 1);
  assert.equal((await carol('GET', '/messages')).body.rooms.filter((r) => r.member).length, 0);

  // załączniki: obraz rozpoznany po treści, inne pliki tylko do pobrania, dostęp wyłącznie dla uczestników
  const up = async (c, bytes, name) => { const st = await c('GET', '/auth/state'); void st; return c; };
  void up;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const rawUpload = async (cookieClient, body, name) => {
    // klient testowy wysyła JSON, więc plik wgrywamy bezpośrednio z ciasteczkiem sesji
    const probe = await cookieClient('GET', '/auth/state'); void probe;
    return fetch(base + '/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name), Cookie: cookieClient.cookie() }, body });
  };
  const f1 = await rawUpload(bob, png, 'wykres ąę.png'); const f1b = await f1.json();
  assert.equal(f1.status, 201); assert.equal(f1b.type, 'image/png'); assert.equal(f1b.image, true); assert.equal(f1b.name, 'wykres ąę.png');
  const f2 = await (await rawUpload(bob, Buffer.from('<script>alert(1)</script>'), 'evil.html')).json();
  assert.equal(f2.type, 'application/octet-stream'); assert.equal(f2.image, false);
  assert.equal((await rawUpload(bob, Buffer.alloc(5 * 1024 * 1024 + 10), 'big.bin')).status, 413);
  assert.equal((await alice('POST', '/messages', { to: 2, file_id: f1b.id })).status, 400);              // cudzy plik
  assert.equal((await bob('POST', '/messages', { to: 1, file_id: f1b.id })).status, 201);
  assert.equal((await bob('POST', `/rooms/${room.body.id}/messages`, { body: 'plik', file_id: f2.id })).status, 201);
  const getFile = (c, id) => fetch(base + '/files/' + id, { headers: { Cookie: c.cookie() } });
  const g1 = await getFile(alice, f1b.id);
  assert.equal(g1.status, 200); assert.equal(g1.headers.get('content-type'), 'image/png'); assert.match(g1.headers.get('content-disposition'), /^inline/);
  assert.equal(Buffer.from(await g1.arrayBuffer()).equals(png), true);
  const g2 = await getFile(alice, f2.id);
  assert.match(g2.headers.get('content-disposition'), /^attachment/); assert.equal(g2.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await getFile(carol, f1b.id)).status, 404);                                               // osoba spoza rozmowy
  assert.equal((await getFile(carol, f2.id)).status, 404);                                                // i spoza grupy
  assert.equal((await fetch(base + '/files/' + f1b.id)).status, 401);

  // push: klucz publiczny i subskrypcja (sama wysyłka wymaga usługi push przeglądarki)
  assert.match((await bob('GET', '/push/key')).body.key, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await bob('POST', '/push/subscribe', { subscription: { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);
  assert.equal((await bob('POST', '/push/test')).status, 400);

  // logi: użytkownik widzi tylko swoje wpisy, administrator wszystkie
  const bobLogs = (await bob('GET', '/logs')).body.rows;
  assert.ok(bobLogs.length > 0); assert.ok(bobLogs.every((r) => r.user === 'bob')); assert.ok(bobLogs.some((r) => r.code === 'auth.login'));
  assert.equal(bobLogs[0].ip, undefined);
  const allLogs = (await alice('GET', '/logs?limit=500')).body.rows;
  assert.ok(allLogs.some((r) => r.user === 'bob')); assert.ok(allLogs.some((r) => r.code === 'system.start' && r.user === null));
  assert.ok(allLogs.some((r) => r.code === 'trade.close')); assert.ok(allLogs.some((r) => r.code === 'auth.loginFailed'));
  assert.ok((await alice('GET', '/logs?category=trade')).body.rows.every((r) => r.category === 'trade'));
  assert.ok((await alice('GET', '/logs?user=2')).body.rows.every((r) => r.user === 'bob'));
  assert.ok((await bob('GET', '/logs?user=1')).body.rows.every((r) => r.user === 'bob')); // filtr użytkownika nie działa dla zwykłego konta

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
