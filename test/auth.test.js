import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { recipientsByLang } from '../server/mailer.js';
import { hashPassword, verifyPassword, validUsername, validPassword } from '../server/auth.js';
import * as totp from '../server/totp.js';

test('passwords: salted scrypt, verification, validation', () => {
  const h = hashPassword('correct horse');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(h, hashPassword('correct horse'));              // a different salt every time
  assert.equal(verifyPassword('correct horse', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', 'garbage'), false);
  assert.equal(validUsername('kuba.n-1'), true); assert.equal(validUsername('ab'), false); assert.equal(validUsername('a b c'), false);
  assert.equal(validPassword('1234567'), false); assert.equal(validPassword('12345678'), true);
});

test('TOTP: RFC 6238 vectors, window tolerance, reuse protection', () => {
  const sec = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(sec, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(totp.base32Decode(sec).toString(), '12345678901234567890');
  assert.equal(totp.codeAt(sec, Math.floor(59 / 30)), '287082');            // RFC: 94287082
  assert.equal(totp.codeAt(sec, Math.floor(1111111109 / 30)), '081804');    // RFC: 07081804
  assert.equal(totp.codeAt(sec, Math.floor(2000000000 / 30)), '279037');    // RFC: 69279037
  const now = 1111111109000, cur = Math.floor(now / 30000);
  assert.equal(totp.verify(sec, '081804', { now }), cur);
  assert.equal(totp.verify(sec, totp.codeAt(sec, cur - 1), { now }), cur - 1);   // the previous window is still valid
  assert.equal(totp.verify(sec, totp.codeAt(sec, cur - 2), { now }), null);      // older ones are not
  assert.equal(totp.verify(sec, '081804', { now, lastCounter: cur }), null);     // the same code a second time
  assert.equal(totp.verify(sec, '000000', { now }), null); assert.equal(totp.verify(sec, 'abc', { now }), null);
  const codes = totp.newRecoveryCodes();
  assert.equal(codes.length, 10); assert.match(codes[0], /^[0-9a-f]{4}-[0-9a-f]{4}$/);
  assert.equal(totp.hashCode(codes[0]), totp.hashCode(codes[0].replace('-', '').toUpperCase()));
});

// Full run against a real server: first launch, sign-in, roles, data isolation, sharing, messages.
test('server: setup, sign-in, roles, portfolio isolation, sharing, messages', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-auth-'));
  const port = 39000 + Math.floor(Math.random() * 900);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir, KUMODESK_NO_SCHEDULER: '1', KUMODESK_NO_SIGNALS: '1' }, stdio: 'ignore',
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
  // two-factor setup: fetch the secret, confirm with a code; returns the secret and recovery codes
  const enrol = async (c) => {
    const b1 = await c('POST', '/auth/2fa/begin', {});
    assert.equal(b1.status, 200); assert.match(b1.body.qr, /<svg/); assert.match(b1.body.url, /^otpauth:\/\/totp\//);
    assert.equal((await c('POST', '/auth/2fa/enable', { code: '000000' })).status, 400);
    const e = await c('POST', '/auth/2fa/enable', { code: totp.codeAt(b1.body.secret, Math.floor(Date.now() / 30000)) });
    assert.equal(e.status, 200); assert.equal(e.body.user.twofa.enabled, true); assert.equal(e.body.recovery.length, 10);
    return { secret: b1.body.secret, recovery: e.body.recovery };
  };

  // before setup: the API is closed and the state says "setup"
  assert.equal((await anon('GET', '/auth/state')).body.setup, true);
  assert.equal((await anon('GET', '/dashboard')).status, 401);
  assert.equal((await anon('GET', '/positions')).status, 401);
  assert.equal((await anon('POST', '/auth/setup', { username: 'alice', password: 'short' })).status, 400);

  // the first account is the administrator; setup is closed afterwards
  const setup = await alice('POST', '/auth/setup', { username: 'alice', password: 'alice-password', email: 'alice@example.com' });
  assert.equal(setup.status, 201); assert.equal(setup.body.user.role, 'admin');
  assert.match(setup.setCookie, /HttpOnly/); assert.match(setup.setCookie, /SameSite=Lax/);
  assert.equal((await anon('POST', '/auth/setup', { username: 'mallory', password: 'mallory-pass' })).status, 409);
  assert.equal((await anon('GET', '/auth/state')).body.setup, false);
  assert.equal((await alice('GET', '/auth/state')).body.user.username, 'alice');
  // a new account must enable 2FA first – until then the API is closed
  assert.equal((await alice('GET', '/dashboard')).status, 403);
  assert.equal((await alice('GET', '/dashboard')).body.error, 'err.twofaRequired');
  const aliceTotp = await enrol(alice);
  assert.equal((await alice('GET', '/dashboard')).status, 200);
  assert.equal((await alice('POST', '/auth/2fa/disable', { password: 'alice-password' })).status, 400); // a mandatory second factor cannot be turned off

  // wrong password, unknown username, then a correct sign-in
  assert.equal((await anon('POST', '/auth/login', { username: 'alice', password: 'nope-nope' })).status, 401);
  assert.equal((await anon('POST', '/auth/login', { username: 'ghost', password: 'whatever1' })).status, 401);

  // the administrator creates accounts
  assert.equal((await alice('POST', '/users', { username: 'bob', password: 'bob-password', role: 'user' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'carol', password: 'carol-password', role: 'admin' })).status, 201);
  assert.equal((await alice('POST', '/users', { username: 'BOB', password: 'bob-password' })).status, 400); // usernames are case-insensitive
  assert.equal((await bob('POST', '/auth/login', { username: 'bob', password: 'bob-password' })).status, 200);
  assert.equal((await carol('POST', '/auth/login', { username: 'Carol', password: 'carol-password' })).status, 200);
  const bobTotp = await enrol(bob); await enrol(carol);

  // sign-in with 2FA: the password alone is not enough; a wrong code is rejected; a recovery code works once; a remembered device skips the code
  const dev = client();
  const step1 = await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password' });
  assert.equal(step1.body.twofa, true); assert.equal(step1.setCookie, null);
  assert.equal((await dev('GET', '/dashboard')).status, 401);
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: '123456' })).status, 401);
  const rec = aliceTotp.recovery[0];
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: rec })).status, 200);
  await dev('POST', '/auth/logout');
  assert.equal((await dev('POST', '/auth/login', { username: 'alice', password: 'alice-password', code: rec })).status, 401); // already used
  const dev2 = client();
  let cookies = [];
  const raw = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'alice-password', code: aliceTotp.recovery[1], remember: true }) });
  cookies = raw.headers.getSetCookie().map((x) => x.split(';')[0]);
  assert.equal(raw.status, 200); assert.ok(cookies.some((x) => x.startsWith('kd_device=')));
  const deviceCookie = cookies.find((x) => x.startsWith('kd_device='));
  const again = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: deviceCookie }, body: JSON.stringify({ username: 'alice', password: 'alice-password' }) });
  assert.equal(again.status, 200); assert.equal((await again.json()).user.username, 'alice');           // no code on a remembered device
  const other = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: deviceCookie }, body: JSON.stringify({ username: 'bob', password: 'bob-password' }) });
  assert.equal((await other.json()).twofa, true);                                                       // alice's cookie does not work for bob
  void dev2; void bobTotp;

  // a regular user cannot change server settings or accounts, but can change their own settings
  assert.equal((await bob('POST', '/users', { username: 'eve', password: 'eve-password' })).status, 403);
  assert.equal((await bob('PUT', '/settings', { smtp: { host: 'evil' } })).status, 403);
  assert.equal((await bob('POST', '/categories/toggle', { category: 'fx', enabled: false })).status, 403);
  assert.equal((await bob('PUT', '/settings', { capital: { start: 5000, currency: 'EUR' } })).status, 200);
  assert.equal((await bob('GET', '/settings')).body.settings.capital.start, 5000);
  assert.equal((await alice('GET', '/settings')).body.settings.capital.start, 0);   // capital is personal
  assert.equal((await bob('GET', '/settings')).body.settings.smtp.host, '');         // server data is hidden
  assert.equal((await bob('GET', '/users')).body[0].email, undefined);

  // positions are private
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

  // sharing a whole portfolio
  assert.equal((await bob('GET', '/portfolio/1')).status, 403);
  assert.deepEqual((await alice('PUT', '/shares', { viewers: [2, 999, 1] })).body.viewers, [2]);
  const shared = await bob('GET', '/portfolio/1');
  assert.equal(shared.status, 200); assert.equal(shared.body.owner.username, 'alice'); assert.equal(shared.body.trades.length, 1);
  assert.deepEqual((await bob('GET', '/shares')).body.sharedWithMe, [{ id: 1, username: 'alice' }]);
  assert.equal((await carol('GET', '/portfolio/1')).status, 403);                    // carol was not given access
  await alice('PUT', '/shares', { viewers: [] });
  assert.equal((await bob('GET', '/portfolio/1')).status, 403);

  // messages and sharing a single trade
  assert.equal((await alice('POST', '/messages', { to: 2, body: '' })).status, 400);
  assert.equal((await alice('POST', '/messages', { to: 1, body: 'to myself' })).status, 400);
  assert.equal((await bob('POST', '/messages', { to: 1, body: 'x', trade_id: closed.body.tradeId })).status, 400); // someone else's trade
  assert.equal((await alice('POST', '/messages', { to: 2, body: 'Look at this trade', trade_id: closed.body.tradeId })).status, 201);
  assert.equal((await bob('GET', '/status')).body.mail.unread, 1);
  assert.equal((await carol('GET', '/status')).body.mail.unread, 0);
  const th = await bob('GET', '/messages/1');
  assert.equal(th.body.messages.length, 1); assert.equal(th.body.messages[0].trade.instrument_id, 'EURUSD'); assert.equal(th.body.messages[0].trade.r, closed.body.r);
  assert.equal((await bob('GET', '/status')).body.mail.unread, 0);                   // opening the thread marks it read
  assert.equal((await carol('GET', '/messages/1')).body.messages.length, 0);        // a third person cannot see the conversation
  assert.equal((await bob('POST', '/messages', { to: 1, body: 'Thanks!' })).status, 201);
  assert.equal((await alice('GET', '/messages')).body.threads[0].unread, 1);

  // group chat: groups are created by an administrator; only members read and write
  assert.equal((await bob('POST', '/rooms', { name: 'x', members: [2] })).status, 403);
  const room = await alice('POST', '/rooms', { name: 'Ichimoku team', members: [1, 2] });
  assert.equal(room.status, 201);
  assert.equal((await bob('POST', `/rooms/${room.body.id}/messages`, { body: 'Hello group' })).status, 201);
  assert.equal((await carol('GET', `/rooms/${room.body.id}/messages`)).status, 403);
  assert.equal((await carol('POST', `/rooms/${room.body.id}/messages`, { body: 'let me in' })).status, 403);
  assert.equal((await alice('GET', '/status')).body.mail.unread, 2);                 // 1 direct + 1 in the group
  const rt = await alice('GET', `/rooms/${room.body.id}/messages`);
  assert.equal(rt.body.messages[0].from, 'bob'); assert.equal(rt.body.room.members.length, 2);
  assert.equal((await alice('GET', '/status')).body.mail.unread, 1);
  assert.equal((await bob('GET', '/messages')).body.rooms.length, 1);
  assert.equal((await carol('GET', '/messages')).body.rooms.filter((r) => r.member).length, 0);

  // attachments: images detected by content, other files download-only, access for participants only
  const up = async (c, bytes, name) => { const st = await c('GET', '/auth/state'); void st; return c; };
  void up;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const rawUpload = async (cookieClient, body, name) => {
    // the test client sends JSON, so the file is uploaded directly with the session cookie
    const probe = await cookieClient('GET', '/auth/state'); void probe;
    return fetch(base + '/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(name), Cookie: cookieClient.cookie() }, body });
  };
  const f1 = await rawUpload(bob, png, 'chart äö.png'); const f1b = await f1.json();
  assert.equal(f1.status, 201); assert.equal(f1b.type, 'image/png'); assert.equal(f1b.image, true); assert.equal(f1b.name, 'chart äö.png');
  const f2 = await (await rawUpload(bob, Buffer.from('<script>alert(1)</script>'), 'evil.html')).json();
  assert.equal(f2.type, 'application/octet-stream'); assert.equal(f2.image, false);
  assert.equal((await rawUpload(bob, Buffer.alloc(5 * 1024 * 1024 + 10), 'big.bin')).status, 413);
  assert.equal((await alice('POST', '/messages', { to: 2, file_id: f1b.id })).status, 400);              // someone else's file
  assert.equal((await bob('POST', '/messages', { to: 1, file_id: f1b.id })).status, 201);
  assert.equal((await bob('POST', `/rooms/${room.body.id}/messages`, { body: 'a file', file_id: f2.id })).status, 201);
  const getFile = (c, id) => fetch(base + '/files/' + id, { headers: { Cookie: c.cookie() } });
  const g1 = await getFile(alice, f1b.id);
  assert.equal(g1.status, 200); assert.equal(g1.headers.get('content-type'), 'image/png'); assert.match(g1.headers.get('content-disposition'), /^inline/);
  assert.equal(Buffer.from(await g1.arrayBuffer()).equals(png), true);
  const g2 = await getFile(alice, f2.id);
  assert.match(g2.headers.get('content-disposition'), /^attachment/); assert.equal(g2.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await getFile(carol, f1b.id)).status, 404);                                               // a person outside the conversation
  assert.equal((await getFile(carol, f2.id)).status, 404);                                                // and outside the group
  assert.equal((await fetch(base + '/files/' + f1b.id)).status, 401);

  // push: public key and subscription (actual delivery needs the browser's push service)
  assert.match((await bob('GET', '/push/key')).body.key, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await bob('POST', '/push/subscribe', { subscription: { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);
  assert.equal((await bob('POST', '/push/test')).status, 400);

  // logs: a user sees only their own entries, an administrator sees all
  const bobLogs = (await bob('GET', '/logs')).body.rows;
  assert.ok(bobLogs.length > 0); assert.ok(bobLogs.every((r) => r.user === 'bob')); assert.ok(bobLogs.some((r) => r.code === 'auth.login'));
  assert.equal(bobLogs[0].ip, undefined);
  const allLogs = (await alice('GET', '/logs?limit=500')).body.rows;
  assert.ok(allLogs.some((r) => r.user === 'bob')); assert.ok(allLogs.some((r) => r.code === 'system.start' && r.user === null));
  assert.ok(allLogs.some((r) => r.code === 'trade.close')); assert.ok(allLogs.some((r) => r.code === 'auth.loginFailed'));
  assert.ok((await alice('GET', '/logs?category=trade')).body.rows.every((r) => r.category === 'trade'));
  assert.ok((await alice('GET', '/logs?user=2')).body.rows.every((r) => r.user === 'bob'));
  assert.ok((await bob('GET', '/logs?user=1')).body.rows.every((r) => r.user === 'bob')); // the user filter has no effect for a regular account

  // account: changing the password needs the current one; the last administrator cannot be deleted or demoted
  assert.equal((await bob('PUT', '/account', { current: 'wrong-one', password: 'new-password-1' })).status, 400);
  assert.equal((await bob('PUT', '/account', { current: 'bob-password', password: 'new-password-1' })).status, 200);
  assert.equal((await anon('POST', '/auth/login', { username: 'bob', password: 'bob-password' })).status, 401);
  assert.equal((await alice('DELETE', '/users/1')).status, 400);                     // oneself
  assert.equal((await alice('DELETE', '/users/3')).status, 200);                     // carol
  assert.equal((await alice('PUT', '/users/1', { role: 'user' })).status, 400);      // the last administrator
  assert.equal((await carol('GET', '/dashboard')).status, 401);                      // a deleted account's session no longer works

  // invitations: the administrator sends a link by e-mail and the person sets their own password
  assert.equal((await alice('POST', '/users', { username: 'dave', email: 'dave@example.test', invite: true })).body.error, 'err.inviteSmtp');
  const mails = [];
  const smtp = net.createServer((sock) => { // a minimal SMTP server that only records messages
    let buf = '', data = null;
    sock.write('220 test\r\n');
    sock.on('data', (chunk) => {
      buf += chunk;
      for (let i; (i = buf.indexOf('\r\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data != null) { if (line === '.') { mails.push(data); data = null; sock.write('250 ok\r\n'); } else data += line + '\r\n'; continue; }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'DATA') { data = ''; sock.write('354 go\r\n'); } else if (cmd === 'QUIT') { sock.end('221 bye\r\n'); } else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  t.after(() => smtp.close());
  assert.equal((await alice('PUT', '/settings', { smtp: { host: '127.0.0.1', port: smtp.address().port, security: 'none', from: 'kumodesk@example.test' } })).status, 200);
  assert.equal((await alice('POST', '/users', { username: 'dave', invite: true })).body.error, 'err.inviteEmail');
  const inv = await alice('POST', '/users', { username: 'dave', email: 'dave@example.test', invite: true, lang: 'de' });
  assert.equal(inv.status, 201); assert.equal(inv.body.invited, true); assert.equal(inv.body.lang, 'de');
  assert.equal(mails.length, 1);
  const decoded = mails[0].replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, x) => String.fromCharCode(parseInt(x, 16)));
  assert.match(decoded, /To: dave@example\.test/); assert.match(decoded, /Subject: \[KumoDesk\] Einladung/); // in the invited person's language
  const token = /#\/invite\/([\w-]+)/.exec(decoded)[1];
  const dave = client();
  assert.equal((await dave('GET', '/auth/invite/not-a-real-token-0000000000')).status, 404);
  assert.equal((await dave('GET', `/auth/invite/${token}`)).body.username, 'dave');
  assert.equal((await dave('POST', `/auth/invite/${token}`, { password: 'short' })).status, 400);
  const accepted = await dave('POST', `/auth/invite/${token}`, { password: 'dave-password' });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.user.invited, false); assert.equal(accepted.body.user.twofa.required, true);
  assert.equal((await dave('GET', '/dashboard')).status, 403);                       // signed in, but 2FA comes first
  assert.equal((await anon('GET', `/auth/invite/${token}`)).status, 404);            // the link works once
  assert.equal((await alice('POST', `/users/${inv.body.id}/invite`)).body.error, 'err.inviteDone');
  assert.equal((await client()('POST', '/auth/login', { username: 'dave', password: 'dave-password' })).status, 200);
  // a resent invitation replaces the previous link
  const inv2 = await alice('POST', '/users', { username: 'erin', email: 'erin@example.test', invite: true });
  const firstToken = /#\/invite\/([\w-]+)/.exec(mails[1].replace(/=\r\n/g, ''))[1];
  assert.equal((await alice('POST', `/users/${inv2.body.id}/invite`)).status, 200);
  assert.equal(mails.length, 3);
  assert.equal((await anon('GET', `/auth/invite/${firstToken}`)).status, 404);
  // setting a password by hand cancels the invitation
  assert.equal((await alice('PUT', `/users/${inv2.body.id}`, { password: 'erin-password' })).body.invited, false);
  // the interface language is stored on the account
  assert.equal((await alice('PUT', '/account', { lang: 'pl' })).body.user.lang, 'pl');
  assert.equal((await alice('PUT', '/account', { lang: 'xx' })).body.user.lang, 'pl');

  // sign-out
  assert.equal((await alice('POST', '/auth/logout')).status, 200);
  assert.equal((await alice('GET', '/dashboard')).status, 401);
});

test('e-mail language: recipients with an account get their own language, others the default', () => {
  const settings = { smtp: { to: 'a@x.test, Bob <b@x.test>; c@x.test' }, notify: { lang: 'pl' } };
  const users = [{ email: 'A@x.test', lang: 'de' }, { email: 'b@x.test', lang: 'en' }, { email: 'nobody@x.test', lang: 'de' }];
  assert.deepEqual(recipientsByLang(settings, users), [['de', 'a@x.test'], ['en', 'Bob <b@x.test>'], ['pl', 'c@x.test']]);
  assert.deepEqual(recipientsByLang({ smtp: { to: '' }, notify: { lang: 'pl' } }, users), []);
});

test('update: version comparison and update mode', async () => {
  const { compareVersions, updateMode, VERSION } = await import('../server/update.js');
  assert.ok(compareVersions('2.10.0', '2.9.3') > 0); assert.ok(compareVersions('2.6.0', '2.6.1') < 0); assert.equal(compareVersions('3.0.0', '3.0.0'), 0);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.notEqual(updateMode(), 'self'); // a development checkout never updates itself
});
