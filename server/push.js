// Powiadomienia push (Web Push, klucze VAPID generowane przy pierwszym użyciu).
import webpush from 'web-push';
import * as db from './db.js';
import { t, resolveLang } from '../public/i18n.js';

let ready = false;
export function vapidPublicKey() {
  let pub = db.getMeta('vapidPublic'), priv = db.getMeta('vapidPrivate');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    pub = k.publicKey; priv = k.privateKey;
    db.setMeta('vapidPublic', pub); db.setMeta('vapidPrivate', priv);
  }
  if (!ready) { webpush.setVapidDetails('mailto:kumodesk@localhost', pub, priv); ready = true; }
  return pub;
}

/** Wysyła do wszystkich urządzeń użytkownika; make(lang) -> { title, body, url }. Wygasłe subskrypcje usuwa. */
export async function pushToUser(userId, make) {
  const subs = db.pushSubs(userId);
  if (!subs.length) return 0;
  vapidPublicKey();
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(make(resolveLang(s.lang))), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.removePushSub(s.endpoint);
      else console.warn('[push]', e.statusCode || e.message);
    }
  }));
  if (sent) db.addLog({ user_id: userId, category: 'notify', code: 'notify.push', params: {} });
  return sent;
}

/** Te same zdarzenia co w dzwonku: alert bez właściciela idzie do wszystkich, z właścicielem tylko do niego. */
export function pushAlerts(alerts) {
  if (!alerts.length || !db.pushSubs().length) return;
  const users = [...new Set(db.pushSubs().map((s) => s.user_id))];
  for (const a of alerts) {
    const targets = a.user_id ? [a.user_id] : users;
    const url = a.instrument_id ? `/#/i/${encodeURIComponent(a.instrument_id)}` : '/#/';
    for (const u of targets) pushToUser(u, (lang) => ({ title: 'KumoDesk', body: t(lang, a.code, a.params), url })).catch(() => {});
  }
}
