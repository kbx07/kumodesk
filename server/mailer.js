// E-mail notifications (SMTP) – report after a group's close, and alerts.
import nodemailer from 'nodemailer';
import { t, fmtPrice, resolveLang } from '../public/i18n.js';

export function smtpConfigured(s) {
  return !!(s.smtp.host && s.smtp.to && (s.smtp.from || s.smtp.user));
}

function transport(smtp) {
  const sec = smtp.security || 'starttls';
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: sec === 'tls',
    requireTLS: sec === 'starttls',
    ignoreTLS: sec === 'none',
    // Google: OAuth2 (XOAUTH2) with a refresh token, or a plain password / app password
    auth: smtp.auth === 'oauth2' && smtp.oauthRefreshToken
      ? { type: 'OAuth2', user: smtp.user, clientId: smtp.oauthClientId, clientSecret: smtp.oauthClientSecret, refreshToken: smtp.oauthRefreshToken }
      : smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
}

/** Whether anything can be sent (server and sender); the recipient can be passed separately. */
export function smtpReady(s) {
  return !!(s.smtp.host && (s.smtp.from || s.smtp.user));
}

async function send(settings, subject, html, text, to = null) {
  const s = settings.smtp;
  const rcpt = to || s.to;
  if (!smtpReady(settings) || !rcpt) throw new Error('err.smtp');
  await transport(s).sendMail({ from: s.from || s.user, to: rcpt, subject, html, text });
}

export async function sendTest(settings, lang) {
  const L = resolveLang(lang || settings.notify.lang);
  await send(settings, t(L, 'mail.testSubject'), `<p>${t(L, 'mail.testBody')}</p>`, t(L, 'mail.testBody'));
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLORS = { LONG: '#0a7d0a', SHORT: '#c62f2f', A: '#0a7d0a', B: '#1c5cab', C: '#8a6100', D: '#777' };

export function buildReport({ market, alerts, group, settings, errors = [], lang = null }) {
  const L = resolveLang(lang || settings.notify.lang);
  const tt = (k, p) => t(L, k, p);
  const byId = Object.fromEntries(market.instruments.map((a) => [a.id, a]));
  const inGroup = (a) => !group || a.group_id === group.id;
  const setups = market.ranking.map((id) => byId[id]).filter((a) => inGroup(a) && a.grade !== 'D').slice(0, 12);
  const subject = `[KumoDesk] ${group ? group.name + ' – ' : ''}${tt('exec.' + market.exec)} ${market.matrix.score}/100` +
    (alerts.length ? ` · ${tt('mail.alertsCount', { n: alerts.length })}` : '');

  const row = (a) => `<tr>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5"><b>${esc(a.id)}</b></td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;color:${COLORS[a.dir]}"><b>${esc(tt('dir.' + a.dir))}</b></td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;color:${COLORS[a.grade]}"><b>${a.grade}</b></td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${esc(tt('action.' + a.action))}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${a.op}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${esc(tt('align.' + a.align))}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${fmtPrice(a.close)}</td>
  </tr>
  <tr><td colspan="7" style="padding:2px 10px 10px;color:#555;font-size:13px;border-bottom:1px solid #ccc">${esc(planText(L, a))}</td></tr>`;

  const alertItems = alerts.map((a) => `<li>${esc(tt(a.code, a.params))}</li>`).join('');
  const notes = market.notes.map((n) => `<li>${esc(tt(n.code, n.params))}</li>`).join('');
  const threats = market.portfolio.threats.map((x) => `<li>${esc(tt(x.code, x.params))}</li>`).join('');
  const th = (k) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #333;font-size:12px">${esc(tt(k))}</th>`;

  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;max-width:760px">
  <h2 style="margin:0 0 4px">KumoDesk – ${esc(tt('mail.title'))}</h2>
  <div style="color:#555;margin-bottom:14px">${group ? esc(group.name) + ' · ' : ''}${esc(tt('mail.closedCandles'))}</div>
  <table style="border-collapse:collapse;margin-bottom:14px"><tr>
    <td style="padding:8px 14px;background:#f2f2f0"><div style="font-size:11px;color:#666">${esc(tt('tile.matrix'))}</div><b style="font-size:20px">${market.matrix.score}/100</b></td>
    <td style="padding:8px 14px;background:#f2f2f0"><div style="font-size:11px;color:#666">${esc(tt('tile.exec'))}</div><b>${esc(tt('exec.' + market.exec))}</b></td>
    <td style="padding:8px 14px;background:#f2f2f0"><div style="font-size:11px;color:#666">${esc(tt('tile.regime'))}</div><b>${esc(tt('regime.' + market.regime.state))}</b></td>
    <td style="padding:8px 14px;background:#f2f2f0"><div style="font-size:11px;color:#666">${esc(tt('tile.climate'))}</div><b>${esc(tt('mood.' + market.climate.mood))}</b></td>
    <td style="padding:8px 14px;background:#f2f2f0"><div style="font-size:11px;color:#666">${esc(tt('tile.portfolio'))}</div><b>${esc(tt('pstate.' + market.portfolio.state))}</b></td>
  </tr></table>
  ${alerts.length ? `<h3 style="margin:14px 0 6px">${esc(tt('mail.alerts'))}</h3><ul>${alertItems}</ul>` : ''}
  <h3 style="margin:14px 0 6px">${esc(tt('mail.setups'))}</h3>
  ${setups.length ? `<table style="border-collapse:collapse;width:100%"><tr>${th('col.instrument')}${th('col.dir')}${th('col.grade')}${th('col.action')}${th('col.op')}${th('col.tf')}${th('col.close')}</tr>${setups.map(row).join('')}</table>`
    : `<p>${esc(tt('mail.noSetups'))}</p>`}
  ${threats ? `<h3 style="margin:14px 0 6px">${esc(tt('panel.threats'))}</h3><ul>${threats}</ul>` : ''}
  <h3 style="margin:14px 0 6px">${esc(tt('panel.notes'))}</h3><ul>${notes}</ul>
  ${errors.length ? `<p style="color:#b00">${esc(tt('mail.errors', { n: errors.length, list: errors.slice(0, 8).map((e) => e.id).join(', ') }))}</p>` : ''}
  <p style="color:#888;font-size:12px;margin-top:18px">${esc(tt('disclaimer'))}</p>
  </div>`;

  const text = [
    `KumoDesk – ${tt('mail.title')}${group ? ' – ' + group.name : ''}`,
    `${tt('tile.matrix')}: ${market.matrix.score}/100 | ${tt('exec.' + market.exec)} | ${tt('regime.' + market.regime.state)}`,
    ...(alerts.length ? ['', tt('mail.alerts') + ':', ...alerts.map((a) => '- ' + tt(a.code, a.params))] : []),
    '', tt('mail.setups') + ':',
    ...(setups.length ? setups.map((a) => `- ${a.id} ${tt('dir.' + a.dir)} [${a.grade}] ${tt('action.' + a.action)} – ${planText(L, a)}`) : [tt('mail.noSetups')]),
    '', tt('disclaimer'),
  ].join('\n');
  return { subject, html, text };
}

export function planText(lang, a) {
  const p = {};
  for (const [k, v] of Object.entries(a.plan.params)) p[k] = k === 'ext' ? v.toFixed(1) : fmtPrice(v);
  return t(lang, a.plan.code, p);
}

/**
 * Splits the general recipients by language: an address that belongs to an account gets that account's
 * language, every other address the default e-mail language. Returns [[lang, 'a@x, b@y'], ...].
 */
export function recipientsByLang(settings, users = []) {
  const byMail = new Map(users.filter((u) => u.email && u.lang).map((u) => [u.email.toLowerCase(), u.lang]));
  const groups = new Map();
  for (const addr of String(settings.smtp.to || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)) {
    const m = /<([^>]+)>/.exec(addr);
    const L = resolveLang(byMail.get((m ? m[1] : addr).toLowerCase()) || settings.notify.lang);
    groups.set(L, [...(groups.get(L) || []), addr]);
  }
  return [...groups].map(([L, list]) => [L, list.join(', ')]);
}

/** Report after a group's close: one message per language of the recipients. */
export async function sendReport(ctx) {
  if (ctx.to) { // one user's own report, in their language
    const { subject, html, text } = buildReport(ctx);
    return send(ctx.settings, subject, html, text, ctx.to);
  }
  for (const [lang, to] of recipientsByLang(ctx.settings, ctx.users)) {
    const { subject, html, text } = buildReport({ ...ctx, lang });
    await send(ctx.settings, subject, html, text, to);
  }
}

/** Invitation: a link where the new user chooses their own password. */
export async function sendInvite(settings, { to, lang, username, link, days }) {
  const L = resolveLang(lang || settings.notify.lang);
  const tt = (k, p) => t(L, k, p);
  const p = { name: username, days };
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;max-width:560px">
  <h2 style="margin:0 0 10px">KumoDesk</h2>
  <p>${esc(tt('mail.invite.body', p))}</p>
  <p style="margin:22px 0"><a href="${esc(link)}" style="background:#1c5cab;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">${esc(tt('mail.invite.button'))}</a></p>
  <p style="color:#555;font-size:13px">${esc(tt('mail.invite.alt'))}<br><a href="${esc(link)}">${esc(link)}</a></p>
  <p style="color:#888;font-size:12px;margin-top:18px">${esc(tt('mail.invite.foot', p))}</p></div>`;
  const text = [tt('mail.invite.body', p), '', link, '', tt('mail.invite.foot', p)].join('\n');
  await send(settings, tt('mail.invite.subject'), html, text, to);
}

export function adviceText(lang, c) {
  const a = c.advice;
  return t(lang, `advice.reason.${a.reason}`, { stop: fmtPrice(a.suggestedStop), kijun: fmtPrice(a.levels?.kijun), ext: a.ext != null ? Math.abs(a.ext).toFixed(1) : '–' })
    + (a.suggestedStop != null ? ' ' + t(lang, 'advice.newStop', { stop: fmtPrice(a.suggestedStop) }) : '');
}

export function buildPositionsReport({ results, changed, settings, lang = null }) {
  const L = resolveLang(lang || settings.notify.lang);
  const tt = (k, p) => t(L, k, p);
  const rank = { EXIT: 5, REDUCE: 4, TIGHTEN: 3, PARTIAL: 2, TRAIL: 1, HOLD: 0, NO_DATA: 0 };
  const rows = [...results].sort((x, y) => rank[y.advice.action] - rank[x.advice.action]);
  const head = changed.length ? changed.map((c) => `${c.instrument_id} ${tt('advice.' + c.advice.action)}`).join(', ') : tt('mail.h4.noChange');
  const subject = `[KumoDesk] ${tt('mail.h4.title')}: ${head}`;
  const color = { EXIT: '#c62f2f', REDUCE: '#c62f2f', TIGHTEN: '#8a6100', PARTIAL: '#1c5cab', TRAIL: '#1c5cab', HOLD: '#0a7d0a', NO_DATA: '#777' };
  const cell = 'padding:6px 10px;border-bottom:1px solid #e5e5e5';
  const tr = (c) => `<tr>
    <td style="${cell}"><b>${esc(c.instrument_id)}</b> ${esc(tt('dir.' + c.direction))}</td>
    <td style="${cell};color:${color[c.advice.action]}"><b>${esc(tt('advice.' + c.advice.action))}</b>${c.previous && c.previous !== c.advice.action ? ` <span style="color:#888">(${esc(tt('advice.' + c.previous))} →)</span>` : ''}</td>
    <td style="${cell}">${c.advice.close != null ? fmtPrice(c.advice.close) : '–'}</td>
    <td style="${cell}">${c.advice.r != null ? c.advice.r + ' R' : c.advice.pnlPct != null ? c.advice.pnlPct + '%' : '–'}</td>
    <td style="${cell}">${c.advice.h4Score ?? '–'}</td></tr>
    <tr><td colspan="5" style="padding:2px 10px 10px;color:#555;font-size:13px;border-bottom:1px solid #ccc">${esc(c.advice.action === 'NO_DATA' ? tt('advice.reason.noH4') : adviceText(L, c))}</td></tr>`;
  const th = (k) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #333;font-size:12px">${esc(tt(k))}</th>`;
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;max-width:760px">
  <h2 style="margin:0 0 4px">KumoDesk – ${esc(tt('mail.h4.title'))}</h2>
  <div style="color:#555;margin-bottom:14px">${esc(tt('mail.h4.sub'))}</div>
  <table style="border-collapse:collapse;width:100%"><tr>${th('pf.position')}${th('pf.advice')}${th('col.close')}${th('pf.result')}${th('pf.h4score')}</tr>${rows.map(tr).join('')}</table>
  <p style="color:#888;font-size:12px;margin-top:18px">${esc(tt('disclaimer'))}</p></div>`;
  const text = [`KumoDesk – ${tt('mail.h4.title')}`, '',
    ...rows.map((c) => `- ${c.instrument_id} ${tt('dir.' + c.direction)}: ${tt('advice.' + c.advice.action)} – ${c.advice.action === 'NO_DATA' ? tt('advice.reason.noH4') : adviceText(L, c)}`),
    '', tt('disclaimer')].join('\n');
  return { subject, html, text };
}

export async function sendPositionsReport(ctx) {
  const { subject, html, text } = buildPositionsReport(ctx);
  await send(ctx.settings, subject, html, text, ctx.to || null);
}
