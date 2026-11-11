// KumoDesk – interfejs (bez etapu budowania; czyste moduły ES).
import { t, has, fmtPrice, detectLang, resolveLang } from './i18n.js';
import { drawIchimoku } from './chart.js';
import { HELP } from './help.js';

// ---------- język ----------
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* brak */ } } };
let langPref = store.get('kd.lang') || 'auto';
let lang = langPref === 'auto' ? detectLang(navigator.languages || [navigator.language]) : resolveLang(langPref);
const T = (k, p) => t(lang, k, p);
const TE = (msg) => (has(msg) ? T(msg) : msg); // tłumaczy kody błędów z serwera

// ---------- tryb widoku: pro (pełny, domyślny) albo basic (uproszczony) ----------
let uiMode = store.get('kd.mode') === 'basic' ? 'basic' : 'pro';

// ---------- pomocnicze ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const $ = (s, r = document) => r.querySelector(s);
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/') && me) { me = null; showAuth(); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
let me = null;            // zalogowany użytkownik
let lookCfg = { theme: 'normal', loginBg: 'aurora', appBg: 'default', custom: {} };
// Postaci boczne motywów: proste sylwetki w stylu wycinanki (ubrane, bez szczegółów).
const FIG = {
  anime: '<svg viewBox="0 0 200 420" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M62 70c-16 30-22 78-10 120l14-4c-6-34-4-70 6-98zM138 70c16 30 22 78 10 120l-14-4c6-34 4-70-6-98z" opacity=".75"/><circle cx="100" cy="62" r="34"/><path d="M66 58c2-30 22-44 36-44s34 12 34 44c-10-16-22-22-36-22s-26 8-34 22z" opacity=".55"/><path d="M78 100h44l14 96H64z"/><path d="M58 196h84l22 84H36z" opacity=".85"/><path d="M74 280h20l-4 118H78zM106 280h20l-4 118h-12z"/><path d="M70 398h26v12H66zM104 398h26l4 12h-30z"/><path d="M124 112l34 46-10 8-30-36zM76 112l-30 52 10 6 26-40z" opacity=".9"/></g><path d="M150 150l22-30 6 4-20 32z" fill="currentColor" opacity=".6"/></svg>',
  cosplay: '<svg viewBox="0 0 200 420" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M70 36l-6-30 28 18zM130 36l6-30-28 18z"/><circle cx="100" cy="62" r="32"/><path d="M68 64c0-22 14-40 32-40s32 18 32 40c-8-10-20-16-32-16s-24 6-32 16z" opacity=".55"/><path d="M60 100h80l40 190c-26 10-54-6-80-6s-54 16-80 6z" opacity=".45"/><path d="M78 100h44l10 100H68z"/><path d="M68 200h64l10 70H58z" opacity=".9"/><path d="M76 270h18l-2 126H80zM106 270h18l-4 126h-12z"/><path d="M68 396h28v14H64zM104 396h28l4 14h-32z"/><path d="M124 112l40-34 6 8-34 44z" opacity=".9"/></g><path d="M166 30l6 190h-6z" fill="currentColor"/><path d="M169 6l12 20-12 14-12-14z" fill="currentColor" opacity=".8"/></svg>',
};
/** Ustawia motyw, tło i dekoracje (spadające płatki, iskry, napisy mangi, postaci boczne). */
function applyLook() {
  const th = lookCfg.theme || 'normal';
  document.body.dataset.theme = th; document.body.dataset.bg = th === 'normal' ? lookCfg.appBg : 'theme';
  const d = $('#decor'); d.replaceChildren();
  const img = (slot) => (lookCfg.custom?.[slot] ? `/api/auth/theme/${slot}?v=${lookCfg.custom[slot].v}` : null);
  d.style.backgroundImage = th === 'custom' && img('bg') ? `url(${img('bg')})` : '';
  if (th === 'anime' || th === 'cosplay') {
    d.append(h('div', { class: 'fig left', html: FIG[th] }), h('div', { class: 'fig right', html: FIG[th] }));
    const bits = th === 'anime' ? ['petal', 'petal', 'petal', 'petal', 'petal', 'petal', 'spark', 'spark', 'word:ドキドキ', 'word:キラキラ', 'petal', 'petal']
      : ['spark', 'spark', 'spark', 'star', 'star', 'word:ゴゴゴ', 'word:シャキーン', 'spark', 'star', 'spark'];
    bits.forEach((b, i) => { const [kind, text] = b.split(':'); d.append(h('i', { class: `bit ${kind}`, style: `left:${(i * 83 + 7) % 100}%;animation-delay:-${(i * 2.7) % 19}s;animation-duration:${14 + (i * 5) % 13}s` }, text || '')); });
  } else if (th === 'custom') {
    if (img('left')) d.append(h('img', { class: 'fig left', src: img('left'), alt: '' }));
    if (img('right')) d.append(h('img', { class: 'fig right', src: img('right'), alt: '' }));
  }
}
const isAdmin = () => me?.role === 'admin';
let toastTimer;
function toast(msg, badTone = false) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast' + (badTone ? ' bad' : ''); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, badTone ? 7000 : 3500);
}
const fmtTs = (iso) => (iso ? new Date(iso).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' }) : '–');
const signed = (v, d = 1) => (v == null ? '–' : (v > 0 ? '+' : '') + Number(v).toFixed(d));
const instName = (a) => (has(`inst.${a.id}`) ? T(`inst.${a.id}`) : a.name);
const planText = (a) => {
  const p = {};
  for (const [k, v] of Object.entries(a.plan.params)) p[k] = k === 'ext' ? v.toFixed(1) : fmtPrice(v);
  return T(a.plan.code, p);
};

const catName = (c) => (has(`cat.${c}`) ? T(`cat.${c}`) : c);
const ADVICE_TONE = { HOLD: 'good', TRAIL: 'info', PARTIAL: 'info', TIGHTEN: 'warn', REDUCE: 'crit', EXIT: 'crit', NO_DATA: 'none' };
const adviceBadge = (a) => h('span', { class: `advice tone-${ADVICE_TONE[a?.action] || 'none'}` }, h('span', { class: 'dot' }), a ? T('advice.' + a.action) : T('advice.PENDING'));
function adviceText(a) {
  if (!a) return T('advice.pending.text');
  if (a.action === 'NO_DATA') return T('advice.reason.noH4');
  return T('advice.reason.' + a.reason, { kijun: fmtPrice(a.levels?.kijun), ext: a.ext != null ? Math.abs(a.ext).toFixed(1) : '–' })
    + (a.suggestedStop != null ? ' ' + T('advice.newStop', { stop: fmtPrice(a.suggestedStop) }) : '');
}
const adviceResult = (a) => (a?.r != null ? `${signed(a.r, 2)} R` : a?.pnlPct != null ? `${signed(a.pnlPct, 2)}%` : '–');
function positionsCard(positions, compact) {
  const card = h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', null, T('panel.positions'),
    h('span', { class: 'muted small' }, status?.h4?.next ? T('h4.next', { ts: fmtTs(status.h4.next) }) : '')));
  card.append(h('div', { class: 'poslist' }, positions.map((p) => h('a', { class: 'pos', href: `#/i/${p.instrument_id}?tf=h4` },
    h('div', { class: 'pos-head' }, h('b', null, p.instrument_id), dirBadge(p.direction), adviceBadge(p.advice),
      h('span', { class: 'muted small num' }, adviceResult(p.advice)), p.advice?.h4Score != null ? h('span', { class: 'muted small' }, 'H4 ', miniBar(p.advice.h4Score)) : null),
    h('div', { class: 'pos-text' }, adviceText(p.advice))))));
  if (!compact) card.append(h('p', { class: 'hint' }, T('h4.hint')));
  return card;
}

const F_ICON = { PASS: '✓', WARN: '!', FAIL: '✕', NA: '–' };
const stageNo = (i) => String(i + 1).padStart(2, '0');
function funnelCard(m) {
  const total = m.funnel[0]?.in || 1;
  const card = h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', null, T('funnel.title'), h('span', { class: 'muted small' }, T('funnel.hint'))));
  card.append(h('div', { class: 'funnel' }, m.funnel.map((st, i) => h('button', {
    class: 'fstep' + (funnelFilter === st.key ? ' on' : ''), title: T('funnel.step.tip', { dropped: st.dropped, warned: st.warned }),
    onclick: () => { funnelFilter = funnelFilter === st.key ? null : st.key; render(); },
  },
    h('div', { class: 'fno' }, stageNo(i), ' ', h('b', null, T('funnel.stage.' + st.key))),
    h('div', { class: 'fcount num' }, st.out, h('span', { class: 'muted small' }, st.dropped ? ` −${st.dropped}` : '')),
    h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(2, st.out / total * 100)}%` }))))));
  if (funnelFilter) card.append(h('p', { class: 'hint' }, T('funnel.filtered', { stage: T('funnel.stage.' + funnelFilter) }), ' ', h('button', { class: 'chip', onclick: () => { funnelFilter = null; render(); } }, T('funnel.clear'))));
  return card;
}
function funnelList(a) {
  const card = h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', null, T('funnel.path'), h('span', { class: 'muted small' }, a.failedAt ? T('funnel.stoppedAt', { stage: T('funnel.stage.' + a.failedAt) }) : T('funnel.reached'))));
  card.append(h('div', { class: 'fpath' }, a.funnel.map((st, i) => h('div', { class: `frow f-${st.status}` },
    h('span', { class: 'ficon', title: T('fstatus.' + st.status) }, F_ICON[st.status]),
    h('span', { class: 'fname' }, stageNo(i), ' ', T('funnel.stage.' + st.key)),
    h('span', { class: 'ftext' }, T(st.code, { ...st.params, ext: st.params?.ext != null ? Number(st.params.ext).toFixed(1) : undefined }))))));
  return card;
}
function sessionsCard(m) {
  const card = h('div', { class: 'card' }, h('h3', null, T('panel.sessions'), h('span', { class: 'muted small' }, m.sessions?.summary ? T('smood.' + m.sessions.summary.mood) : '')));
  const list = m.sessions?.sessions.filter((s) => s.ok) || [];
  if (!list.length) { card.append(h('p', { class: 'muted' }, T('sessions.none'))); return card; }
  const hm = (iso) => new Date(iso).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  card.append(h('div', { class: 'sess' }, m.sessions.sessions.map((s) => (s.ok
    ? h('div', { class: 'srow', title: s.strength.map((x) => `${x.currency} ${signed(x.value, 2)}%`).join('  ') },
      h('div', null, h('b', null, T('session.' + s.key)), h('div', { class: 'muted small' }, `${s.date.slice(5)} · ${hm(s.start)}–${hm(s.end)}`)),
      h('div', { class: 'smood' }, T('smood.' + s.mood)),
      h('div', { class: 'small nowrap' }, h('span', { class: 'dot', style: 'display:inline-block;background:var(--pos);margin-right:5px' }), `${s.best.currency} ${signed(s.best.value, 2)}%`,
        h('br'), h('span', { class: 'dot', style: 'display:inline-block;background:var(--neg);margin-right:5px' }), `${s.worst.currency} ${signed(s.worst.value, 2)}%`))
    : h('div', { class: 'srow' }, h('div', null, h('b', null, T('session.' + s.key))), h('div', { class: 'muted small' }, T('sessions.nodata')), h('div'))))));
  if (m.sessions.summary) card.append(h('p', { class: 'hint' }, T('sessions.summary', { best: m.sessions.summary.best, worst: m.sessions.summary.worst })));
  return card;
}
let funnelFilter = null;

const dirBadge = (d) => h('span', { class: `badge ${d === 'LONG' ? 'long' : d === 'SHORT' ? 'short' : 'neutral'}` }, T('dir.' + d));
const gradeBox = (g, big) => h('span', { class: `grade ${g}${big ? ' big' : ''}`, title: T('grade.' + g) }, g);
function miniBar(v, max = 10) {
  if (v == null) return h('span', { class: 'muted' }, '–');
  const pct = Math.min(50, Math.abs(v) / max * 50);
  return h('span', { class: 'nowrap num' },
    h('span', { class: 'mini' }, h('i', { class: v < 0 ? 'neg' : '', style: v < 0 ? `right:50%;width:${pct}%` : `left:50%;width:${pct}%` })),
    signed(v, 0));
}
function divergingRow(label, v, max, title) {
  const pct = Math.min(50, Math.abs(v) / max * 50);
  return h('div', { class: 'bar-row', title },
    h('span', { class: 'lbl' }, label),
    h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (v < 0 ? ' neg' : ''), style: v < 0 ? `right:50%;width:${pct}%` : `left:50%;width:${pct}%` })),
    h('span', { class: 'num right' }, signed(v)));
}

// ---------- okna dialogowe ----------
function openDialog(title, form, onSave, { hint, saveLabel, cls } = {}) {
  const dlg = h('dialog', { class: cls || '' }, h('h2', null, title), form, hint ? h('p', { class: 'hint' }, hint) : null);
  const errEl = h('span', { class: 'err small' });
  const saveBtn = h('button', { class: 'btn primary' }, saveLabel || T('save'));
  form.append(h('div', { class: 'wide actions' }, saveBtn, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('cancel')), errEl));
  form.onsubmit = async (e) => {
    e.preventDefault(); saveBtn.disabled = true; errEl.textContent = '';
    try { await onSave(); dlg.close(); } catch (err) { errEl.textContent = TE(err.message); }
    saveBtn.disabled = false;
  };
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  return dlg;
}
let capitalCfg = { start: 0, currency: 'EUR', defaultRisk: 1 };
const money = (v, d = 2) => (v == null ? '–' : `${Number(v).toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d })} ${capitalCfg.currency}`);

/** „Zlecenie” w stylu brokera – ale tylko wpis na listę otwartych pozycji. */
function positionTicket(inst, a) {
  let dir = a?.dir === 'SHORT' ? 'SHORT' : 'LONG', price = a?.close ?? null, stopTouched = false, live = false;
  const L = a?.levels;
  const suggest = () => (L ? (dir === 'LONG' ? L.kijun - 0.5 * L.atr : L.kijun + 0.5 * L.atr) : null);
  const priceEl = h('div', { class: 'tk-price num' }, '…'), priceSub = h('div', { class: 'muted small' }, T('ticket.loadingPrice'));
  const sellBtn = h('button', { type: 'button', class: 'tk-side short' }, h('span', null, T('ticket.sell')), h('b', null, 'SHORT'));
  const buyBtn = h('button', { type: 'button', class: 'tk-side long' }, h('span', null, T('ticket.buy')), h('b', null, 'LONG'));
  const risk = h('input', { type: 'number', name: 'risk_pct', step: '0.05', min: '0.05', max: '100', value: capitalCfg.defaultRisk || 1, required: true });
  const stop = h('input', { type: 'number', name: 'stop', step: 'any', required: true });
  const note = h('input', { type: 'text', name: 'note', maxlength: 300 });
  const calc = h('div', { class: 'tk-calc' });
  const validStop = () => { const sv = Number(stop.value); return price != null && stop.value !== '' && (dir === 'LONG' ? sv < price : sv > price); };
  const update = () => {
    sellBtn.classList.toggle('on', dir === 'SHORT'); buyBtn.classList.toggle('on', dir === 'LONG');
    if (!stopTouched) { const sg = suggest(); if (sg != null && price != null && (dir === 'LONG' ? sg < price : sg > price)) stop.value = fmtPrice(sg); else stop.value = ''; }
    const sv = Number(stop.value), rp = Number(risk.value);
    const dist = validStop() ? Math.abs(price - sv) : null;
    const amount = capitalCfg.start > 0 && rp > 0 ? (currentEquity ?? capitalCfg.start) * rp / 100 : null;
    calc.replaceChildren(
      kv('ticket.stopDist', dist != null ? `${fmtPrice(dist)} (${(dist / price * 100).toFixed(2)}%)` : '–'),
      kv('ticket.riskAmount', amount != null ? money(amount) : T('ticket.noCapital')),
      kv('ticket.size', amount != null && dist ? (amount / dist).toLocaleString(lang, { maximumFractionDigits: 2 }) : '–'),
      kv('ticket.oneR', dist != null ? fmtPrice(dir === 'LONG' ? price + dist : price - dist) : '–'));
    stop.setCustomValidity(stop.value !== '' && price != null && !validStop() ? T('err.stopSide') : '');
  };
  sellBtn.onclick = () => { dir = 'SHORT'; update(); }; buyBtn.onclick = () => { dir = 'LONG'; update(); };
  stop.oninput = () => { stopTouched = true; update(); }; risk.oninput = update;
  const form = h('form', { class: 'ticket' },
    h('div', { class: 'tk-head' }, h('div', null, h('div', { class: 'tk-sym' }, inst.id), h('div', { class: 'muted small' }, instName(inst))), h('div', { class: 'right' }, priceEl, priceSub)),
    h('div', { class: 'tk-sides' }, sellBtn, buyBtn),
    h('div', { class: 'form' },
      h('label', null, T('pf.risk'), risk),
      h('label', null, T('ticket.stop'), stop, h('span', { class: 'muted' }, T('ticket.stop.hint'))),
      h('label', { class: 'wide' }, T('pf.note'), note)),
    calc,
    h('div', { class: 'tk-notice' }, T('ticket.notice')));
  openDialog(T('ticket.title'), form, async () => {
    const r = await api('/positions', { method: 'POST', body: { instrument_id: inst.id, direction: dir, risk_pct: Number(risk.value), stop: Number(stop.value), note: note.value, market: true } });
    await loadMarket(); wasRunning = true; poll();
    toast(T('ticket.added', { id: inst.id, dir: T('dir.' + dir), price: fmtPrice(r.entry) }));
    render();
  }, { saveLabel: T('ticket.submit'), cls: 'ticket-dlg' });
  update();
  api(`/quote/${encodeURIComponent(inst.id)}`).then((q) => {
    price = q.price; live = q.live;
    priceEl.textContent = fmtPrice(q.price);
    priceSub.textContent = q.live ? T('ticket.livePrice', { ts: fmtTs(q.time) }) : T('ticket.stalePrice', { date: q.time });
    update();
  }).catch(() => { priceEl.textContent = price != null ? fmtPrice(price) : '–'; priceSub.textContent = T('ticket.stalePrice', { date: a?.date ?? '–' }); });
}
let currentEquity = null;

/** Zamknięcie pozycji: zapis wyniku do historii zagrań. */
function closeDialog(p) {
  const stop0 = p.stop_initial ?? p.stop;
  const canR = p.entry != null && stop0 != null && stop0 !== p.entry;
  const exit = h('input', { type: 'number', name: 'exit', step: 'any', required: canR });
  const pnl = h('input', { type: 'number', name: 'pnl', step: 'any', required: !canR, placeholder: canR ? T('close.pnl.auto') : '' });
  const date = h('input', { type: 'date', name: 'closed', value: new Date().toISOString().slice(0, 10), required: true });
  const preview = h('div', { class: 'tk-calc' });
  const update = () => {
    const ex = Number(exit.value);
    const r = canR && exit.value !== '' ? ((p.direction === 'LONG' ? 1 : -1) * (ex - p.entry)) / Math.abs(p.entry - stop0) : null;
    const base = currentEquity ?? capitalCfg.start;
    const amount = pnl.value !== '' ? Number(pnl.value) : r != null && base > 0 ? base * p.risk_pct / 100 * r : null;
    preview.replaceChildren(kv('pf.entry', p.entry != null ? fmtPrice(p.entry) : '–'), kv('close.stop0', stop0 != null ? fmtPrice(stop0) : '–'),
      kv('close.resultR', r != null ? `${signed(r, 2)} R` : '–'), kv('close.resultMoney', amount != null ? money(amount) : '–'));
  };
  exit.oninput = pnl.oninput = update;
  const form = h('form', { class: 'ticket' },
    h('div', { class: 'tk-head' }, h('div', null, h('div', { class: 'tk-sym' }, p.instrument_id), dirBadge(p.direction)), h('div', { class: 'right muted small' }, T('pf.risk') + ': ' + p.risk_pct + '%')),
    h('div', { class: 'form' },
      h('label', null, T('close.exit'), exit, h('span', { class: 'muted' }, T('close.exit.hint'))),
      h('label', null, T('close.date'), date),
      h('label', { class: 'wide' }, T('close.pnl', { cur: capitalCfg.currency }), pnl, h('span', { class: 'muted' }, canR ? T('close.pnl.hint') : T('close.pnl.required')))),
    preview,
    h('div', { class: 'tk-notice' }, T('close.notice')));
  openDialog(T('close.title', { id: p.instrument_id }), form, async () => {
    await api(`/positions/${p.id}/close`, { method: 'POST', body: { exit: exit.value, pnl: pnl.value, closed: date.value } });
    await loadMarket(); toast(T('close.done')); render();
  }, { saveLabel: T('close.submit'), cls: 'ticket-dlg' });
  update();
  api(`/quote/${encodeURIComponent(p.instrument_id)}`).then((q) => { if (exit.value === '') { exit.value = fmtPrice(q.price); update(); } }).catch(() => {});
}

// ---------- wykresy kapitału (SVG) ----------
function equityChart(curve, start) {
  const W = 640, H = 220, pad = { l: 8, r: 70, t: 12, b: 22 };
  const ys = curve.map((p) => p.equity);
  let lo = Math.min(...ys, start), hi = Math.max(...ys, start);
  const m = (hi - lo) * 0.08 || Math.max(1, hi * 0.01); lo -= m; hi += m;
  const x = (i) => pad.l + (curve.length > 1 ? i / (curve.length - 1) : 0.5) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b);
  const pts = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const ticks = [lo + m, start, hi - m].filter((v, i, a) => a.findIndex((z) => Math.abs(y(z) - y(v)) < 14) === i);
  const lastP = curve.at(-1);
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img">
    ${ticks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${W - pad.r + 6}" y="${y(v) + 4}" fill="var(--muted)" font-size="11">${Math.round(v).toLocaleString(lang)}</text>`).join('')}
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(start)}" y2="${y(start)}" stroke="var(--axis)" stroke-dasharray="4 4"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${curve.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.equity).toFixed(1)}" r="${i === curve.length - 1 ? 4.5 : 3}" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"><title>${p.date ?? T('cap.startPoint')}: ${money(p.equity)}</title></circle>`).join('')}
    <text x="${pad.l}" y="${H - 5}" fill="var(--muted)" font-size="11">${T('cap.startPoint')}</text>
    <text x="${W - pad.r}" y="${H - 5}" fill="var(--muted)" font-size="11" text-anchor="end">${lastP.date ?? ''}</text>
  </svg>`;
}
function tradeBars(trades) {
  const W = 640, H = 220, pad = { l: 8, r: 70, t: 12, b: 22 };
  const max = Math.max(...trades.map((t) => Math.abs(t.pnl)), 1);
  const mid = pad.t + (H - pad.t - pad.b) / 2, half = (H - pad.t - pad.b) / 2;
  const step = (W - pad.l - pad.r) / trades.length, bw = Math.min(26, Math.max(2, step - 2));
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img">
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${mid}" y2="${mid}" stroke="var(--axis)"/>
    <text x="${W - pad.r + 6}" y="${pad.t + 8}" fill="var(--muted)" font-size="11">+${Math.round(max).toLocaleString(lang)}</text>
    <text x="${W - pad.r + 6}" y="${mid + 4}" fill="var(--muted)" font-size="11">0</text>
    <text x="${W - pad.r + 6}" y="${H - pad.b}" fill="var(--muted)" font-size="11">−${Math.round(max).toLocaleString(lang)}</text>
    ${trades.map((t, i) => { const hh = Math.max(1, Math.abs(t.pnl) / max * half); const cx = pad.l + i * step + (step - bw) / 2;
      return `<rect x="${cx.toFixed(1)}" width="${bw.toFixed(1)}" y="${(t.pnl >= 0 ? mid - hh : mid).toFixed(1)}" height="${hh.toFixed(1)}" rx="2" fill="${t.pnl >= 0 ? 'var(--pos)' : 'var(--neg)'}"><title>${t.closed} · ${t.instrument_id} ${T('dir.' + t.direction)}: ${money(t.pnl)}${t.r != null ? ` (${signed(t.r, 2)} R)` : ''}</title></rect>`; }).join('')}
    <text x="${pad.l}" y="${H - 5}" fill="var(--muted)" font-size="11">${trades[0].closed}</text>
    <text x="${W - pad.r}" y="${H - 5}" fill="var(--muted)" font-size="11" text-anchor="end">${trades.at(-1).closed}</text>
  </svg>`;
}

// ---------- stan globalny ----------
let market = null, status = null, route = '', pollTimer = null, wasRunning = false;

const TONE = {
  regime: { TREND: 'good', ROTATIONAL: 'warn', RANGE: 'none' },
  quality: { HIGH: 'good', MEDIUM: 'warn', LOW: 'crit' },
  exec: { OFFENSIVE: 'good', SELECTIVE: 'warn', DEFENSIVE: 'crit' },
  tf: { ALIGNED: 'good', PARTIAL: 'warn', CONFLICT: 'crit' },
  sym: { CLEAN: 'good', MIXED: 'warn', WEAK: 'crit', NA: 'none' },
  pstate: { OK: 'good', CAUTION: 'warn', BLOCK: 'crit' },
};

function tile(key, value, sub, tone, pct, extra) {
  return h('div', { class: `card tile tone-${tone || 'none'}${extra?.hero ? ' hero' : ''}`, title: extra?.title },
    h('div', { class: 'k' }, h('span', { class: 'dot' }), T(key)),
    h('div', { class: 'v' }, value),
    h('div', { class: 's' }, sub),
    pct != null ? h('div', { class: 'meter' }, h('i', { style: `width:${Math.max(3, Math.min(100, pct))}%` })) : null);
}

// ---------- WIDOK BASIC ----------
function basicPicks(m) {
  const byId = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  return m.ranking.map((id) => byId[id]).filter((a) => a.action === 'PLAY' && !a.correlated && !a.inPortfolio).slice(0, 3);
}
function basicWhy(a) {
  if (a.class === 'fx') return T('basic.why.fx', a.dir === 'LONG' ? { strong: a.base, weak: a.quote } : { strong: a.quote, weak: a.base });
  return T(a.dir === 'LONG' ? 'basic.why.up' : 'basic.why.down');
}
function viewBasic() {
  if (!market) return h('div', { class: 'muted' }, T('loading'));
  if (market.empty) return viewDashboard();
  const m = market, picks = basicPicks(m);
  const tone = { ATTACK: 'good', SELECTIVE: 'warn', PROTECT: 'crit' }[m.mode];
  const root = h('div', { class: 'basic' });
  root.append(h('div', { class: `card bstatus tone-${tone}` }, h('span', { class: 'dot' }), h('div', null, h('div', { class: 'bhead' }, T('basic.today.' + m.mode)), h('div', { class: 'muted' }, T('basic.today.sub', { ts: fmtTs(m.generatedAt) })))));
  if (!picks.length) root.append(h('div', { class: 'card empty' }, h('h2', null, T('basic.none')), h('p', { class: 'muted' }, T('basic.none.sub'))));
  else root.append(h('div', { class: 'bpicks' }, picks.map((a, i) => h('div', { class: 'card bpick' + (i === 0 ? ' main' : '') },
    h('div', { class: 'k muted small' }, T(i === 0 ? 'basic.pick.main' : 'basic.pick.alt')),
    h('a', { class: 'bsym', href: `#/i/${encodeURIComponent(a.id)}` }, a.id, a.class === 'fx' ? null : h('span', { class: 'muted' }, ' ' + instName(a))),
    h('div', { class: `bdir ${a.dir === 'LONG' ? 'long' : 'short'}` }, T(a.dir === 'LONG' ? 'basic.buy' : 'basic.sell')),
    h('p', { class: 'bwhy' }, basicWhy(a)),
    h('div', { class: 'kv', style: 'grid-template-columns:1fr 1fr' }, kv('basic.price', fmtPrice(a.close)), kv('basic.stop', fmtPrice(a.plan.params.stop))),
    h('button', { class: 'btn primary', onclick: async () => { try { const d = await api(`/instrument/${encodeURIComponent(a.id)}`); positionTicket(d.instrument, d.analysis); } catch (e) { toast(TE(e.message), true); } } }, '+ ' + T('ticket.open'))))));
  if (m.portfolio.positions.length) root.append(h('div', { class: 'card', style: 'margin-top:14px' }, h('h3', null, T('basic.positions')),
    h('div', { class: 'poslist' }, m.portfolio.positions.map((p) => h('a', { class: 'pos', href: `#/i/${encodeURIComponent(p.instrument_id)}?tf=h4` },
      h('div', { class: 'pos-head' }, h('b', null, p.instrument_id), dirBadge(p.direction), adviceBadge(p.advice)), h('div', { class: 'pos-text' }, adviceText(p.advice)))))));
  root.append(h('p', { class: 'hint', style: 'text-align:center;margin-top:16px' }, T('basic.footer'), ' ', h('button', { class: 'chip', onclick: () => setMode('pro') }, T('basic.toPro'))));
  return root;
}

// ---------- DASHBOARD ----------
let tableFilter = store.get('kd.filter') || 'all', tableSort = { key: 'rank', dir: 1 }, onlySetups = false;

function viewDashboard() {
  const root = h('div');
  if (!market) return h('div', { class: 'muted' }, T('loading'));
  if (market.empty) {
    return h('div', { class: 'card empty' },
      h('h2', null, T('empty.title')), h('p', { class: 'muted' }, T('empty.text')),
      h('button', { class: 'btn primary', onclick: () => startRefresh() }, T('empty.button')));
  }
  const m = market, byId = Object.fromEntries(m.instruments.map((a) => [a.id, a]));
  const c = m.climate;

  root.append(h('div', { class: 'grid tiles' },
    tile('tile.regime', T('regime.' + m.regime.state), T('tile.regime.sub', { trend: m.regime.trendShare, disp: m.regime.dispersion }), TONE.regime[m.regime.state], m.regime.trendShare),
    tile('tile.climate', T('mood.' + c.mood), T('tile.climate.sub', { q: T('quality.' + c.quality) }), TONE.quality[c.quality], { HIGH: 100, MEDIUM: 60, LOW: 25 }[c.quality]),
    tile('tile.exec', T('exec.' + m.exec), T('execsub.' + m.exec), TONE.exec[m.exec], m.matrix.score),
    tile('tile.tf', T('tfstate.' + m.tf.state), T('tile.tf.sub', { n: m.tf.aligned }), TONE.tf[m.tf.state], m.tf.aligned),
    tile('tile.sym', T('sym.' + m.symmetry.state), m.symmetry.state === 'NA' ? '' : T('tile.sym.sub', { n: m.symmetry.clean }), TONE.sym[m.symmetry.state], m.symmetry.state === 'NA' ? null : m.symmetry.clean),
    tile('tile.portfolio', T('pstate.' + m.portfolio.state), T('tile.portfolio.sub', { total: m.portfolio.total, limit: m.portfolio.limits.maxTotal }), TONE.pstate[m.portfolio.state], m.portfolio.total / m.portfolio.limits.maxTotal * 100),
    tile('tile.matrix', `${m.matrix.score} / 100`, T('tile.matrix.sub', { a: m.counts.A, b: m.counts.B }), TONE.exec[m.exec], m.matrix.score,
      { hero: true, title: ['structure', 'trend', 'setups', 'climate', 'portfolio'].map((k) => `${T('matrix.' + k)}: ${m.matrix.parts[k]}`).join('\n') }),
  ));

  root.append(h('div', { class: `card banner tone-${TONE.exec[m.exec]}` },
    h('span', { class: 'k muted small' }, T('banner.mode')),
    h('span', { class: 'mode' }, T('mode.' + m.mode)),
    h('span', { class: 'txt' }, T('modetext.' + m.mode)),
    h('span', { class: 'muted small' }, T('banner.updated', { ts: fmtTs(m.generatedAt), n: m.counts.analyzed, total: m.counts.total }))));

  root.append(funnelCard(m));
  if (m.portfolio.positions.length) root.append(positionsCard(m.portfolio.positions, true));

  // --- główny cel ---
  const p = m.primary ? byId[m.primary] : null;
  const primaryCard = h('div', { class: 'card' }, h('h3', null, T('panel.primary')));
  if (!p) primaryCard.append(h('p', { class: 'muted' }, T('primary.none')));
  else {
    primaryCard.append(
      h('a', { class: 'primary-head', href: `#/i/${p.id}` },
        h('span', { class: 'sym' }, p.id), dirBadge(p.dir), gradeBox(p.grade, true),
        h('span', { class: 'badge' }, T('action.' + p.action))),
      h('div', { class: 'kv' },
        kv('col.op', `${p.op} / 10`), kv('col.tf', T('align.' + p.align)), kv('col.sym', T('sym.' + p.sym)), kv('col.risk', T('risk.' + p.risk)),
        kv('col.close', fmtPrice(p.close)), kv('lvl.kijun', fmtPrice(p.levels.kijun)), kv('col.d1w1', `${signed(p.d1, 0)} / ${signed(p.w1, 0)}`), kv('col.held', T('held.n', { n: p.held }))),
      h('div', { class: 'plan' }, h('div', { class: 'k' }, T('plan.title')), planText(p)),
      p.concentration ? h('p', { class: 'hint' }, '⚠ ' + T('concentration', { cur: p.concentration })) : '');
  }

  // --- top setupy ---
  const top = m.ranking.map((id) => byId[id]).filter((a) => a.grade !== 'D').slice(0, 8);
  const topCard = h('div', { class: 'card' }, h('h3', null, T('panel.top'), h('span', { class: 'muted small' }, T('panel.top.legend'))));
  if (!top.length) topCard.append(h('p', { class: 'muted' }, T('top.none')));
  else topCard.append(h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, ['#', T('col.instrument'), T('col.dir'), T('col.action'), T('col.op'), T('col.sym'), T('col.grade')].map((x) => h('th', null, x)))),
    h('tbody', null, top.map((a, i) => h('tr', { class: 'click', onclick: () => { location.hash = `#/i/${encodeURIComponent(a.id)}`; } },
      h('td', { class: 'muted num' }, i + 1), h('td', { class: 'nowrap' }, h('b', null, a.id), a.correlated ? h('span', { class: 'name', title: T('correlated', a.correlated) }, '≈ ' + a.correlated.with) : null), h('td', null, dirBadge(a.dir)),
      h('td', null, T('action.' + a.action)), h('td', { class: 'num' }, a.op),
      h('td', null, T('sym.' + a.sym)), h('td', null, gradeBox(a.grade))))))));

  // --- zagrożenia ---
  const threats = [...m.portfolio.threats];
  if (m.tf.state === 'CONFLICT') threats.push({ code: 'threat.tfConflict', level: 'MED', params: { n: m.tf.conflict } });
  if (c.mood === 'DIVERGENT') threats.push({ code: 'threat.divergent', level: 'MED', params: {} });
  if (m.regime.state === 'RANGE') threats.push({ code: 'threat.range', level: 'LOW', params: {} });
  const threatCard = h('div', { class: `card tone-${TONE.pstate[m.portfolio.state]}` }, h('h3', null, T('panel.threats'), h('span', null, T('pstate.' + m.portfolio.state))));
  if (!threats.length) threatCard.append(h('p', { class: 'muted' }, T('threats.none')));
  else threats.forEach((x) => threatCard.append(h('div', { class: 'threat' }, h('span', { class: `lv ${x.level}` }, T('level.' + x.level)), h('span', null, T(x.code, x.params)))));

  root.append(h('div', { class: 'grid row-main' }, primaryCard, topCard, threatCard));

  // --- kontekst ---
  const strengthCard = h('div', { class: 'card' }, h('h3', null, T('panel.strength'), h('span', { class: 'muted small' }, '−10 … +10')));
  if (!m.strength.length) strengthCard.append(h('p', { class: 'muted' }, T('strength.none')));
  else strengthCard.append(h('div', { class: 'bars' }, m.strength.map((s) => divergingRow(s.currency, s.value, 10, T('strength.tip', { n: s.pairs })))));

  const climateCard = h('div', { class: 'card' }, h('h3', null, T('panel.climate'), h('span', null, c.dominant ? T('basket.' + c.dominant) : '')));
  const bk = h('div', { class: 'bars' });
  for (const k of ['SAFE', 'CORE', 'CARRY']) if (c.basket[k] != null) bk.append(divergingRow(T('basket.' + k), c.basket[k], 10, T('basket.tip.' + k)));
  if (c.indices != null) bk.append(divergingRow(T('basket.INDICES'), c.indices, 10, T('basket.tip.INDICES')));
  climateCard.append(bk, h('p', { class: 'hint' }, T('climate.summary', { mood: T('mood.' + c.mood), appetite: signed(c.appetite) })));

  const st = m.structure;
  const structCard = h('div', { class: 'card' }, h('h3', null, T('panel.structure'), h('span', { class: 'num' }, `${st.quality} / 10`)));
  const plainRow = (label, v, color) => h('div', { class: 'bar-row', style: 'grid-template-columns:70px 1fr 50px' }, h('span', { class: 'lbl' }, label),
    h('div', { class: 'bar-track plain' }, h('div', { class: 'bar-fill', style: `left:0;width:${v}%;background:${color}` })), h('span', { class: 'num right' }, v + '%'));
  structCard.append(h('div', { class: 'bars' }, plainRow(T('struct.CLEAN'), st.clean, 'var(--good)'), plainRow(T('struct.MIXED'), st.mixed, 'var(--warn)'), plainRow(T('struct.WEAK'), st.weak, 'var(--crit)')),
    h('p', { class: 'hint' }, T('struct.hint')));

  const notesCard = h('div', { class: 'card' }, h('h3', null, T('panel.notes')), h('ul', { class: 'notes' }, m.notes.map((x) => h('li', null, T(x.code, x.params)))));
  root.append(h('div', { class: 'grid row-ctx' }, strengthCard, climateCard, sessionsCard(m), structCard, notesCard));

  root.append(allTable(m));
  return root;
}
const kv = (k, v) => h('div', null, h('div', { class: 'k' }, T(k)), h('div', { class: 'v' }, v));

function allTable(m) {
  const card = h('div', { class: 'card' });
  const classes = ['all', ...new Set(m.instruments.map((a) => a.category))];
  if (!classes.includes(tableFilter)) tableFilter = 'all';
  const rank = Object.fromEntries(m.ranking.map((id, i) => [id, i]));
  const cols = [
    ['id', 'col.instrument'], ['close', 'col.close'], ['changePct', 'col.change'], ['d1', 'col.d1'], ['w1', 'col.w1'], ['dir', 'col.dir'],
    ['align', 'col.tf'], ['sym', 'col.sym'], ['op', 'col.op'], ['grade', 'col.grade'], ['action', 'col.action'], ['failedAt', 'col.stage'], ['held', 'col.held'],
  ];
  const draw = () => {
    let rows = m.instruments.filter((a) => (tableFilter === 'all' || a.category === tableFilter) && (!onlySetups || (a.ok && a.grade !== 'D')) && (!funnelFilter || a.failedAt === funnelFilter));
    const k = tableSort.key;
    rows = [...rows].sort((x, y) => {
      if (x.ok !== y.ok) return x.ok ? -1 : 1;
      let a, b;
      if (k === 'rank') { a = rank[x.id] ?? 999; b = rank[y.id] ?? 999; }
      else { a = x[k]; b = y[k]; }
      if (a == null) return 1; if (b == null) return -1;
      return (typeof a === 'string' ? a.localeCompare(b) : a - b) * tableSort.dir;
    });
    card.replaceChildren(
      h('h3', null, T('panel.all'), h('span', { class: 'chips' },
        classes.map((cl) => h('button', { class: 'chip' + (tableFilter === cl ? ' on' : ''), onclick: () => { tableFilter = cl; store.set('kd.filter', cl); draw(); } }, cl === 'all' ? T('class.all') : catName(cl))),
        h('button', { class: 'chip' + (onlySetups ? ' on' : ''), onclick: () => { onlySetups = !onlySetups; draw(); } }, T('filter.setups')))),
      h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, cols.map(([key, label]) => h('th', { class: 'sortable', onclick: () => { tableSort = { key, dir: tableSort.key === key ? -tableSort.dir : (['id', 'dir', 'align', 'sym', 'grade', 'action', 'failedAt'].includes(key) ? 1 : -1) }; draw(); } },
          T(label) + (tableSort.key === key ? (tableSort.dir > 0 ? ' ↑' : ' ↓') : ''))))),
        h('tbody', null, rows.map((a) => a.ok
          ? h('tr', { class: 'click', onclick: () => { location.hash = `#/i/${a.id}`; } },
            h('td', { class: 'nowrap' }, h('b', null, a.id), h('span', { class: 'name' }, a.class === 'fx' ? '' : instName(a)), a.inPortfolio ? h('span', { class: 'name', title: T('inPortfolio') }, '●') : null),
            h('td', { class: 'num' }, fmtPrice(a.close)), h('td', { class: 'num' }, signed(a.changePct, 2) + '%'),
            h('td', null, miniBar(a.d1)), h('td', null, miniBar(a.w1)), h('td', null, dirBadge(a.dir)),
            h('td', null, T('align.' + a.align)), h('td', null, T('sym.' + a.sym)), h('td', { class: 'num' }, a.op),
            h('td', null, gradeBox(a.grade)), h('td', null, T('action.' + a.action)),
            h('td', { class: 'small ' + (a.failedAt ? 'muted' : '') }, a.failedAt ? `${stageNo(a.funnel.findIndex((x) => x.key === a.failedAt))} ${T('funnel.stage.' + a.failedAt)}` : '✓ ' + T('funnel.stage.decision')), h('td', { class: 'num' }, a.held))
          : h('tr', { class: 'click', onclick: () => { location.hash = `#/i/${a.id}`; } }, h('td', null, h('b', null, a.id), h('span', { class: 'name' }, instName(a))),
            h('td', { colspan: 12, class: 'muted' }, T('nodata.row', { bars: a.bars, needed: a.needed }))))))));
  };
  draw();
  return card;
}

// ---------- SZCZEGÓŁY INSTRUMENTU ----------
async function viewInstrument(id, tf, view) {
  const root = h('div', null, h('div', { class: 'muted' }, T('loading')));
  let d;
  try { d = await api(`/instrument/${encodeURIComponent(id)}?tf=${tf === 'h4' ? 'h4' : 'd1'}&view=${view === 'live' ? 'live' : 'analysis'}`); }
  catch (e) { root.replaceChildren(h('div', { class: 'card err' }, TE(e.message))); return root; }
  const a = d.analysis, inst = d.instrument;
  root.replaceChildren();
  root.append(h('div', { class: 'detail-head' },
    h('a', { class: 'btn', href: '#/' }, '← ' + T('nav.dashboard')),
    h('h1', null, inst.id), h('span', { class: 'muted' }, instName(inst)),
    a?.ok ? [dirBadge(a.dir), gradeBox(a.grade), h('span', { class: 'badge' }, T('action.' + a.action))] : null,
    a?.ok ? h('button', { class: 'btn primary', onclick: () => positionTicket(inst, a) }, '+ ' + T('ticket.open')) : null,
    h('span', { class: 'muted small' }, d.group ? T('detail.group', { name: d.group.name, time: d.group.close_time, tz: d.group.timezone }) : '')));
  if (inst.last_error) root.append(h('div', { class: 'card err', style: 'margin-bottom:14px' }, T('detail.fetchError') + ' ' + inst.last_error));
  if (!a?.ok) {
    root.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, T('nodata.row', { bars: a?.bars ?? 0, needed: a?.needed ?? '–' }))));
    return root;
  }
  const link = (tfv, vw) => `#/i/${encodeURIComponent(inst.id)}?tf=${tfv}&view=${vw}`;
  const tip = h('div', { class: 'tip', hidden: true });
  const canvas = h('canvas', { role: 'img', 'aria-label': `Ichimoku ${inst.id}` });
  const chartCard = h('div', { class: 'card', style: 'margin-bottom:14px' },
    h('h3', null, h('span', { class: 'chips' }, d.tf === 'h4' ? T('detail.chartH4') : T('detail.chart'),
      d.hasH4 ? [h('a', { class: 'chip' + (d.tf === 'd1' ? ' on' : ''), href: link('d1', d.view) }, 'D1'), h('a', { class: 'chip' + (d.tf === 'h4' ? ' on' : ''), href: link('h4', d.view) }, 'H4')] : null),
      h('span', { class: 'muted small' }, d.view === 'live'
        ? (d.openBar ? T('detail.openCandle', { date: d.chart.bars.at(-1)?.date ?? '–', ts: fmtTs(d.updatedAt) }) : T('detail.noOpenCandle', { date: d.chart.bars.at(-1)?.date ?? '–' }))
        : T('detail.lastCandle', { date: d.chart.bars.at(-1)?.date ?? a.date }))),
    h('div', { class: 'viewswitch' },
      h('a', { class: 'vbtn' + (d.view === 'analysis' ? ' on' : ''), href: link(d.tf, 'analysis') }, h('b', null, T('view.analysis')), h('span', null, T(d.tf === 'h4' ? 'view.analysis.subH4' : 'view.analysis.sub'))),
      h('a', { class: 'vbtn' + (d.view === 'live' ? ' on' : ''), href: link(d.tf, 'live') }, h('b', null, T('view.live')), h('span', null, T('view.live.sub')))),
    h('div', { class: 'legend' },
      h('span', null, h('i', { style: 'background:var(--line-tenkan)' }), 'Tenkan-sen'),
      h('span', null, h('i', { style: 'background:var(--line-kijun)' }), 'Kijun-sen'),
      h('span', null, h('i', { style: 'background:var(--line-chikou)' }), 'Chikou Span'),
      h('span', null, h('i', { class: 'box', style: 'background:var(--cloud-up);outline:1px solid var(--up)' }), T('legend.cloudUp')),
      h('span', null, h('i', { class: 'box', style: 'background:var(--cloud-down);outline:1px solid var(--down)' }), T('legend.cloudDown'))),
    h('div', { class: 'chartbox' }, canvas, tip));
  root.append(chartCard);
  if (uiMode === 'pro') root.append(funnelList(a));
  if (d.positions.length) root.append(positionsCard(d.positions, false));
  const redraw = () => drawIchimoku(canvas, tip, { ...d.chart, openBar: d.openBar }, { open: T('ohlc.o'), high: T('ohlc.h'), low: T('ohlc.l'), close: T('ohlc.c'), ahead: T('chart.ahead'), open_candle: T('chart.openCandle') });
  requestAnimationFrame(redraw);
  window.onresize = () => { if (canvas.isConnected) redraw(); };

  const comp = (list, total, title) => {
    const box = h('div', { class: 'card' }, h('h3', null, title, h('span', { class: 'num' }, `${signed(total, 0)} / 10`)));
    if (!list) { box.append(h('p', { class: 'muted' }, T('detail.noWeekly'))); return box; }
    const g = h('div', { class: 'comp' });
    for (const x of list) {
      g.append(h('span', null, T('comp.' + x.key), ' ', h('span', { class: 'muted small' }, T('comp.state.' + (x.value > 0 ? 'bull' : x.value < 0 ? 'bear' : 'flat')))),
        h('span', { class: 'pts' }, miniBar(x.value * x.weight, 3)));
    }
    g.append(h('span', { class: 'total' }, T('comp.total')), h('span', { class: 'pts total' }, signed(total, 0)));
    box.append(g);
    return box;
  };
  const L = a.levels;
  const planCard = h('div', { class: 'card' }, h('h3', null, T('plan.title')),
    h('div', { class: 'plan', style: 'margin-bottom:12px' }, planText(a)),
    h('div', { class: 'kv' },
      kv('col.close', fmtPrice(a.close)), kv('lvl.tenkan', fmtPrice(L.tenkan)), kv('lvl.kijun', fmtPrice(L.kijun)), kv('lvl.atr', fmtPrice(L.atr)),
      kv('lvl.cloudTop', fmtPrice(L.cloudTop)), kv('lvl.cloudBottom', fmtPrice(L.cloudBottom)), kv('lvl.ext', `${signed(a.ext)} ATR`), kv('lvl.thick', `${a.thick} ATR`),
      kv('col.op', `${a.op} / 10`), kv('col.tf', T('align.' + a.align)), kv('col.sym', T('sym.' + a.sym) + (a.spread != null ? ` (${signed(a.spread)})` : '')), kv('col.risk', T('risk.' + a.risk))),
    h('p', { class: 'hint' }, T('grade.' + a.grade)),
    a.over !== 'OK' ? h('p', { class: 'hint' }, '⚠ ' + T('over.' + a.over, { ext: Math.abs(a.ext).toFixed(1) })) : null,
    a.concentration ? h('p', { class: 'hint' }, '⚠ ' + T('concentration', { cur: a.concentration })) : null,
    a.correlated ? h('p', { class: 'hint' }, '≈ ' + T('correlated', a.correlated)) : null);

  // historia wyniku D1
  const hist = a.history, hw = 100 / hist.length;
  const histCard = h('div', { class: 'card' }, h('h3', null, T('detail.history'), h('span', { class: 'muted small' }, T('held.n', { n: a.held }))));
  const svg = `<svg viewBox="0 0 100 44" preserveAspectRatio="none" style="width:100%;height:120px;display:block">
    <line x1="0" x2="100" y1="22" y2="22" stroke="var(--axis)" stroke-width="0.3"/>
    ${hist.map((p, i) => { const hh = Math.abs(p.score) * 2; return `<rect x="${(i * hw + hw * 0.12).toFixed(2)}" width="${(hw * 0.76).toFixed(2)}" y="${p.score >= 0 ? 22 - hh : 22}" height="${Math.max(0.3, hh)}" fill="${p.score >= 0 ? 'var(--pos)' : 'var(--neg)'}"><title>${p.date}: ${signed(p.score, 0)}</title></rect>`; }).join('')}
  </svg>`;
  histCard.append(h('div', { html: svg }), h('p', { class: 'hint' }, T('detail.history.hint', { from: hist[0].date, to: hist.at(-1).date })));

  if (uiMode === 'basic') {
    root.append(h('div', { class: 'card' }, h('h3', null, T('plan.title')),
      h('div', { class: `bdir ${a.dir === 'LONG' ? 'long' : a.dir === 'SHORT' ? 'short' : ''}`, style: 'margin-bottom:10px' }, a.dir === 'NEUTRAL' ? T('action.WAIT') : `${T(a.dir === 'LONG' ? 'basic.buy' : 'basic.sell')} · ${T('action.' + a.action)}`),
      h('div', { class: 'plan' }, planText(a)),
      h('p', { class: 'hint' }, T('basic.footer'), ' ', h('button', { class: 'chip', onclick: () => setMode('pro') }, T('basic.toPro')))));
    return root;
  }
  root.append(h('div', { class: 'grid two', style: 'margin-bottom:14px' }, planCard, histCard),
    h('div', { class: 'grid two' }, comp(a.components, a.d1, T('detail.d1')), comp(a.w1components, a.w1, T('detail.w1'))));
  return root;
}

// ---------- PORTFEL ----------
async function viewPortfolio() {
  const root = h('div');
  if (!market) return h('div', { class: 'muted' }, T('loading'));
  const pf = market.portfolio;
  const instruments = market.instruments;
  const form = h('form', { class: 'form' },
    h('label', null, T('col.instrument'), h('select', { name: 'instrument_id' }, instruments.map((a) => h('option', { value: a.id }, a.class === 'fx' ? a.id : `${a.id} – ${instName(a)}`)))),
    h('label', null, T('col.dir'), h('select', { name: 'direction' }, h('option', { value: 'LONG' }, T('dir.LONG')), h('option', { value: 'SHORT' }, T('dir.SHORT')))),
    h('label', null, T('pf.risk'), h('input', { type: 'number', name: 'risk_pct', step: '0.05', min: '0.05', value: '1', required: true })),
    h('label', null, T('pf.entry'), h('input', { type: 'number', name: 'entry', step: 'any' })),
    h('label', null, T('pf.stop'), h('input', { type: 'number', name: 'stop', step: 'any' })),
    h('label', null, T('pf.opened'), h('input', { type: 'date', name: 'opened', value: new Date().toISOString().slice(0, 10) })),
    h('label', null, T('pf.note'), h('input', { type: 'text', name: 'note', maxlength: 300 })),
    h('div', null, h('button', { class: 'btn primary', type: 'submit' }, T('pf.add'))));
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/positions', { method: 'POST', body: Object.fromEntries(new FormData(form)) }); await loadMarket(); render(); toast(T('saved')); }
    catch (err) { toast(TE(err.message), true); }
  };
  const table = pf.positions.length ? h('div', { class: 'tablewrap' }, h('table', null,
    h('thead', null, h('tr', null, [T('col.instrument'), T('col.dir'), T('pf.risk'), T('pf.entry'), T('pf.stop'), T('col.close'), T('pf.signal'), T('pf.status'), T('pf.advice'), T('pf.note'), ''].map((x) => h('th', null, x)))),
    h('tbody', null, pf.positions.map((p) => h('tr', null,
      h('td', null, h('a', { href: `#/i/${p.instrument_id}` }, h('b', null, p.instrument_id))), h('td', null, dirBadge(p.direction)),
      h('td', { class: 'num' }, p.risk_pct + '%'), h('td', { class: 'num' }, p.entry != null ? fmtPrice(p.entry) : '–'), h('td', { class: 'num' }, p.stop != null ? fmtPrice(p.stop) : '–'),
      h('td', { class: 'num' }, p.close != null ? fmtPrice(p.close) : '–'),
      h('td', null, p.signalDir ? [dirBadge(p.signalDir), ' ', gradeBox(p.signalGrade)] : '–'),
      h('td', null, h('span', { class: 'nowrap' }, h('span', { class: `dot ${p.status === 'OK' ? 'good' : p.status === 'REVERSED' || p.stopHit ? 'crit' : 'warn'}`, style: 'display:inline-block;margin-right:6px' }), T('pos.' + (p.stopHit ? 'STOP' : p.status)))),
      h('td', null, adviceBadge(p.advice)),
      h('td', { class: 'muted' }, p.note || ''),
      h('td', { class: 'nowrap' }, p.advice?.suggestedStop != null ? [h('button', { class: 'btn sm', title: T('pf.applyStop.hint'), onclick: async () => { try { await api(`/positions/${p.id}`, { method: 'PUT', body: { ...p, stop: Number(fmtPrice(p.advice.suggestedStop)) } }); await loadMarket(); render(); toast(T('saved')); } catch (e) { toast(TE(e.message), true); } } }, T('pf.applyStop')), ' '] : null,
        h('button', { class: 'btn sm', onclick: () => closeDialog(p) }, T('close.button')), ' ',
        h('button', { class: 'btn sm danger', title: T('pf.delete.hint'), onclick: async () => { if (!confirm(T('pf.confirmDelete', { id: p.instrument_id }))) return; await api(`/positions/${p.id}`, { method: 'DELETE' }); await loadMarket(); render(); } }, T('delete')))))))) : h('p', { class: 'muted' }, T('pf.none'));

  const exp = Object.entries(pf.exposure).sort((a, b) => b[1] - a[1]);
  const expCard = h('div', { class: 'card' }, h('h3', null, T('pf.exposure'), h('span', { class: 'muted small' }, T('pf.exposure.limit', { limit: pf.limits.maxCurrency }))));
  expCard.append(exp.length ? h('div', { class: 'bars' }, exp.map(([cur, v]) => divergingRow(cur, v, Math.max(pf.limits.maxCurrency, ...exp.map((x) => Math.abs(x[1]))), ''))) : h('p', { class: 'muted' }, T('pf.exposure.none')));
  const thr = h('div', { class: `card tone-${TONE.pstate[pf.state]}` }, h('h3', null, T('panel.threats'), h('span', null, T('pstate.' + pf.state))));
  thr.append(h('p', null, T('tile.portfolio.sub', { total: pf.total, limit: pf.limits.maxTotal })));
  if (!pf.threats.length) thr.append(h('p', { class: 'muted' }, T('threats.none')));
  pf.threats.forEach((x) => thr.append(h('div', { class: 'threat' }, h('span', { class: `lv ${x.level}` }, T('level.' + x.level)), h('span', null, T(x.code, x.params)))));

  try { root.append(await shareBox()); } catch { /* sekcja udostępniania jest opcjonalna */ }
  if (pf.positions.length) root.append(positionsCard(pf.positions, false));
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', null, T('pf.positions'),
      pf.positions.length ? h('button', { class: 'btn sm', onclick: async () => { try { await api('/positions/check', { method: 'POST' }); wasRunning = true; poll(); } catch (e) { toast(e.message === 'BUSY' ? T('refresh.busy') : TE(e.message), true); } } }, T('h4.checkNow')) : null), table),
    h('div', { class: 'grid two', style: 'margin-bottom:14px' }, expCard, thr),
    h('div', { class: 'card' }, h('h3', null, T('pf.addTitle')), form, h('p', { class: 'hint' }, T('pf.hint'))));
  return root;
}

// ---------- HISTORIA ----------
async function viewHistory() {
  const root = h('div', null, h('div', { class: 'muted' }, T('loading')));
  const [hist, alerts] = await Promise.all([api('/history'), api('/alerts')]);
  const trig = (s) => (s.trigger === 'manual' ? T('hist.manual') : s.trigger.replace(/^schedule:/, ''));
  root.replaceChildren(h('div', { class: 'grid two' },
    h('div', { class: 'card' }, h('h3', null, T('hist.alerts')),
      alerts.length ? h('div', { class: 'tablewrap' }, h('table', null, h('tbody', null, alerts.map((a) => h('tr', null,
        h('td', { class: 'muted nowrap small' }, fmtTs(a.ts)), h('td', null, h('span', { class: `threat` }, h('span', { class: `lv ${a.severity}` }, T('level.' + a.severity)))),
        h('td', null, a.instrument_id ? h('a', { href: `#/i/${a.instrument_id}` }, T(a.code, a.params)) : T(a.code, a.params))))))) : h('p', { class: 'muted' }, T('hist.noAlerts'))),
    h('div', { class: 'card' }, h('h3', null, T('hist.runs')),
      hist.length ? h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, [T('hist.when'), T('hist.trigger'), T('tile.matrix'), T('tile.exec'), T('tile.regime'), T('panel.primary')].map((x) => h('th', null, x)))),
        h('tbody', null, hist.map((s) => h('tr', null, h('td', { class: 'muted nowrap small' }, fmtTs(s.ts)), h('td', null, trig(s)), h('td', { class: 'num' }, s.matrix),
          h('td', null, T('exec.' + s.exec)), h('td', null, T('regime.' + s.regime)),
          h('td', null, s.primary ? [h('b', null, s.primary), ' ', s.primaryDir ? dirBadge(s.primaryDir) : ''] : '–')))))) : h('p', { class: 'muted' }, T('hist.noRuns')))));
  return root;
}

// ---------- USTAWIENIA ----------
let settingsTab = 'general';
async function viewSettings() {
  const root = h('div', null, h('div', { class: 'muted' }, T('loading')));
  const [{ settings: s, providers, classes, loginBgs, appBgs, themes }, groups, instruments] = await Promise.all([api('/settings'), api('/groups'), api('/instruments')]);
  usersCache = null;
  const save = async (patch, msg = T('saved')) => {
    try { await api('/settings', { method: 'PUT', body: patch }); toast(msg); await loadMarket(); return true; }
    catch (e) { toast(TE(e.message), true); return false; }
  };
  const field = (label, input, hint) => h('label', null, label, input, hint ? h('span', { class: 'muted' }, hint) : null);
  const num = (name, value, attrs = {}) => h('input', { type: 'number', name, value, step: 'any', ...attrs });
  const formData = (f) => Object.fromEntries(new FormData(f));
  const provOptions = (sel, allowEmpty, emptyLabel) => [allowEmpty ? h('option', { value: '', selected: !sel }, emptyLabel) : null, ...providers.map((p) => h('option', { value: p.id, selected: p.id === sel }, p.name))];
  const tzList = h('datalist', { id: 'tzlist' }, (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []).map((z) => h('option', { value: z })));

  const panes = {
    general() {
      const f = h('form', { class: 'form' },
        field(T('set.uiLang'), h('select', { name: 'ui' }, ['auto', 'pl', 'de', 'en'].map((l) => h('option', { value: l, selected: l === langPref }, l === 'auto' ? T('set.auto') : T('lang.' + l)))), T('set.uiLang.hint')),
        isAdmin() ? field(T('set.mailLang'), h('select', { name: 'mail' }, ['pl', 'de', 'en'].map((l) => h('option', { value: l, selected: l === (s.notify.lang || lang) }, T('lang.' + l))))) : null,
        h('div', null, h('button', { class: 'btn primary' }, T('save'))));
      f.onsubmit = async (e) => { e.preventDefault(); const d = formData(f); if (isAdmin()) await save({ notify: { lang: d.mail } }); setLang(d.ui); };
      // konto: e-mail i zmiana hasła
      const acc = h('form', { class: 'form' },
        field(T('auth.username'), h('input', { type: 'text', value: me.username, disabled: true })),
        field(T('acc.email'), h('input', { type: 'email', name: 'email', value: me.email || '', autocomplete: 'email' }), T('acc.email.hint')),
        field(T('acc.current'), h('input', { type: 'password', name: 'current', autocomplete: 'current-password' })),
        field(T('acc.new'), h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: 8 }), T('auth.rules')),
        h('div', null, h('button', { class: 'btn primary' }, T('save'))));
      acc.onsubmit = async (e) => {
        e.preventDefault(); const d = formData(acc);
        try { const r = await api('/account', { method: 'PUT', body: { email: d.email, ...(d.password ? { current: d.current, password: d.password } : {}) } }); me = r.user; toast(T('saved')); render(); }
        catch (ex) { toast(TE(ex.message), true); }
      };
      // wygląd: motyw, tła i obrazki własnego motywu (dla wszystkich)
      let look = null;
      if (isAdmin()) {
        const ap = s.appearance;
        const preview = (kind, id) => h('span', { class: `bgprev ${kind}-${id}` }, kind === 'lbg' ? h('span', { class: 'authbg' }, h('i'), h('i'), h('i')) : null);
        const radios = (name, list, cur, kind) => h('div', { class: 'bgpick' }, list.map((id) => h('label', { class: 'bgopt' }, h('input', { type: 'radio', name, value: id, checked: id === cur }), preview(kind, id), h('span', null, T((kind === 'thm' ? 'theme.' : 'bg.') + id)))));
        const normalBox = h('div', { hidden: ap.theme !== 'normal' }, h('div', { class: 'k muted small', style: 'margin:14px 0 6px' }, T('look.loginBg')), radios('loginBg', loginBgs, ap.loginBg, 'lbg'),
          h('div', { class: 'k muted small', style: 'margin:14px 0 6px' }, T('look.appBg')), radios('appBg', appBgs, ap.appBg, 'abg'));
        const slotRow = (slot) => {
          const has = ap.custom?.[slot];
          const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: 'height:auto;padding:5px', onchange: async (e) => {
            const fl = e.target.files[0]; if (!fl) return;
            if (fl.size > 5 * 1024 * 1024) { toast(T('err.fileTooBig'), true); return; }
            try { const r = await fetch(`/api/theme/${slot}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: fl }); const dd = await r.json(); if (!r.ok) throw new Error(dd.error); lookCfg = dd.appearance; applyLook(); toast(T('saved')); render(); }
            catch (ex) { toast(TE(ex.message), true); }
          } });
          return h('label', null, T('theme.slot.' + slot), file, has ? h('span', { class: 'sharerow' }, h('img', { src: `/api/auth/theme/${slot}?v=${has.v}`, alt: '', style: 'height:44px;border-radius:4px' }),
            h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { const r = await api(`/theme/${slot}`, { method: 'DELETE' }); lookCfg = r.appearance; applyLook(); render(); } }, T('delete'))) : null);
        };
        const customBox = h('div', { class: 'form', style: 'margin-top:14px', hidden: ap.theme !== 'custom' }, slotRow('left'), slotRow('right'), slotRow('bg'), h('p', { class: 'hint wide' }, T('theme.custom.hint')));
        look = h('form', null, h('div', { class: 'k muted small', style: 'margin-bottom:6px' }, T('theme.title')), radios('theme', themes, ap.theme, 'thm'), normalBox, customBox,
          h('div', { class: 'actions' }, h('button', { class: 'btn primary' }, T('save'))));
        look.onchange = (e) => { if (e.target.name === 'theme') { normalBox.hidden = e.target.value !== 'normal'; customBox.hidden = e.target.value !== 'custom'; } };
        look.onsubmit = async (e) => { e.preventDefault(); const d = formData(look); if (await save({ appearance: { theme: d.theme, loginBg: d.loginBg || ap.loginBg, appBg: d.appBg || ap.appBg } })) { lookCfg = { ...lookCfg, ...d }; applyLook(); render(); } };
      }
      return h('div', null,
        h('div', { class: 'card' }, h('h3', null, T('set.tab.general')), f, h('p', { class: 'hint' }, `KumoDesk ${status?.version || ''}`)),
        h('div', { class: 'card section-gap' }, h('h3', null, T('acc.title'), h('span', { class: 'muted small' }, T('user.role.' + me.role))), acc),
        look ? h('div', { class: 'card section-gap' }, h('h3', null, T('look.title')), look, h('p', { class: 'hint' }, T('look.hint'))) : '');
    },
    users() {
      const box = h('div', null, h('div', { class: 'muted' }, T('loading')));
      const userDialog = (u) => {
        const f = h('form', { class: 'form' },
          field(T('auth.username'), h('input', { type: 'text', name: 'username', value: u?.username || '', required: true, disabled: !!u, minlength: 3, maxlength: 32, autocomplete: 'off' })),
          field(T('usr.role'), h('select', { name: 'role' }, ['user', 'admin'].map((r) => h('option', { value: r, selected: r === (u?.role || 'user') }, T('user.role.' + r))))),
          field(T('acc.email'), h('input', { type: 'email', name: 'email', value: u?.email || '', autocomplete: 'off' })),
          field(T('auth.password'), h('input', { type: 'password', name: 'password', required: !u, minlength: 8, autocomplete: 'new-password', placeholder: u ? T('usr.password.keep') : '' }), T('auth.rules')));
        dialog(u ? T('usr.edit', { name: u.username }) : T('usr.add'), f, async () => {
          const d = formData(f);
          await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: u ? { role: d.role, email: d.email, ...(d.password ? { password: d.password } : {}) } : d });
        }, T('usr.hint'));
      };
      api('/users').then((list) => {
        box.replaceChildren(h('div', { class: 'card' }, h('h3', null, T('set.tab.users'), h('button', { class: 'btn sm', onclick: () => userDialog(null) }, '+ ' + T('usr.add'))),
          h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, [T('auth.username'), T('usr.role'), T('acc.email'), T('usr.created'), ''].map((x) => h('th', null, x)))),
            h('tbody', null, list.map((u) => h('tr', null,
              h('td', null, h('span', { class: 'nowrap' }, h('span', { class: 'avatar', style: 'margin-right:8px' }, u.username.slice(0, 1).toUpperCase()), h('b', null, u.username), u.id === me.id ? h('span', { class: 'name' }, T('usr.you')) : null)),
              h('td', null, T('user.role.' + u.role)), h('td', { class: 'muted' }, u.email || '–'), h('td', { class: 'muted small' }, fmtTs(u.created)),
              h('td', { class: 'nowrap' }, h('button', { class: 'btn sm', onclick: () => userDialog(u) }, T('edit')), ' ',
                u.id !== me.id ? h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(T('usr.confirmDelete', { name: u.username }))) return; try { await api(`/users/${u.id}`, { method: 'DELETE' }); render(); } catch (e) { toast(TE(e.message), true); } } }, T('delete')) : null)))))),
          h('p', { class: 'hint' }, T('usr.info'))));
      }).catch((e) => box.replaceChildren(h('div', { class: 'card err' }, TE(e.message))));
      return box;
    },
    data() {
      const f = h('form', { class: 'form' },
        field(T('set.provider'), h('select', { name: 'provider' }, provOptions(s.data.provider))),
        field(T('set.fallback'), h('select', { name: 'fallbackProvider' }, provOptions(s.data.fallbackProvider, true, T('set.none')))),
        field(T('set.tdKey'), h('input', { type: 'text', name: 'twelvedataKey', value: s.data.twelvedataKey, autocomplete: 'off' })),
        field(T('set.stooqKey'), h('input', { type: 'text', name: 'stooqKey', value: s.data.stooqKey, autocomplete: 'off' })),
        field(T('set.years'), num('historyYears', s.data.historyYears, { min: 2, max: 10, step: 1 }), T('set.years.hint')),
        h('div', null, h('button', { class: 'btn primary' }, T('save'))));
      f.onsubmit = async (e) => { e.preventDefault(); const d = formData(f); d.historyYears = Number(d.historyYears); if (await save({ data: d })) render(); };
      const tf = h('form', { class: 'form' },
        field(T('set.provider'), h('select', { name: 'provider' }, provOptions(s.data.provider))),
        field(T('set.symbol'), h('input', { type: 'text', name: 'symbol', value: 'EURUSD=X', required: true })),
        h('div', null, h('button', { class: 'btn' }, T('set.testFetch'))));
      const out = h('p', { class: 'hint' });
      tf.onsubmit = async (e) => {
        e.preventDefault(); out.textContent = '…';
        try { const r = await api('/providers/test', { method: 'POST', body: formData(tf) }); out.textContent = T('set.testOk', { n: r.bars, date: r.last?.date, close: fmtPrice(r.last?.c) }); }
        catch (err) { out.textContent = T('set.testFail') + ' ' + TE(err.message); }
      };
      return h('div', null,
        h('div', { class: 'card' }, h('h3', null, T('set.tab.data')), f,
          h('ul', { class: 'hint' }, providers.map((p) => h('li', null, h('b', null, p.name), ' – ', T('provider.' + p.id))))),
        h('div', { class: 'card section-gap' }, h('h3', null, T('set.testTitle')), tf, out));
    },
    analysis() {
      const f = h('form', { class: 'form' },
        field('Tenkan-sen', num('tenkan', s.ichimoku.tenkan, { min: 2, step: 1 })), field('Kijun-sen', num('kijun', s.ichimoku.kijun, { min: 2, step: 1 })),
        field('Senkou Span B', num('senkou', s.ichimoku.senkou, { min: 2, step: 1 })), field(T('set.shift'), num('shift', s.ichimoku.shift, { min: 2, step: 1 })),
        field('ATR', num('atr', s.ichimoku.atr, { min: 2, step: 1 })),
        field(T('set.dirThreshold'), num('dirThreshold', s.scoring.dirThreshold, { min: 1, max: 9, step: 1 }), T('set.dirThreshold.hint')),
        field(T('set.strongCurrency'), num('strongCurrency', s.scoring.strongCurrency, { min: 0.5, max: 8, step: 0.5 }), T('set.strongCurrency.hint')),
        field(T('set.h4'), h('select', { name: 'h4enabled' }, h('option', { value: '1', selected: s.h4.enabled }, T('set.h4.on')), h('option', { value: '0', selected: !s.h4.enabled }, T('set.h4.off'))), T('set.h4.hint')),
        field(T('set.sessions'), h('select', { name: 'sessionsEnabled' }, h('option', { value: '1', selected: s.sessions.enabled }, T('set.h4.on')), h('option', { value: '0', selected: !s.sessions.enabled }, T('set.h4.off'))), T('set.sessions.hint')),
        field(T('set.extWarn'), num('extWarn', s.scoring.extWarn, { min: 0.5, step: 0.1 })), field(T('set.extMax'), num('extMax', s.scoring.extMax, { min: 0.5, step: 0.1 })),
        h('div', null, h('button', { class: 'btn primary' }, T('save')), ' ',
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (await save({ ichimoku: { tenkan: 9, kijun: 26, senkou: 52, shift: 26, atr: 14 }, scoring: { dirThreshold: 4, strongCurrency: 2, extWarn: 2, extMax: 3 } })) render(); } }, T('set.defaults'))));
      f.onsubmit = async (e) => {
        e.preventDefault(); const d = formData(f); for (const k in d) d[k] = Number(d[k]);
        const { dirThreshold, strongCurrency, extWarn, extMax, h4enabled, sessionsEnabled, ...ich } = d;
        if (await save({ ichimoku: ich, scoring: { dirThreshold, strongCurrency, extWarn, extMax }, h4: { enabled: h4enabled === 1 }, sessions: { enabled: sessionsEnabled === 1 } })) render();
      };
      return h('div', { class: 'card' }, h('h3', null, T('set.tab.analysis')), f, h('p', { class: 'hint' }, T('set.analysis.hint')));
    },
    groups() {
      const st = Object.fromEntries((status?.groups || []).map((g) => [g.id, g]));
      const table = h('div', { class: 'tablewrap' }, h('table', null,
        h('thead', null, h('tr', null, [T('grp.name'), T('grp.close'), T('grp.tz'), T('grp.delay'), T('grp.count'), T('grp.next'), T('grp.last'), ''].map((x) => h('th', null, x)))),
        h('tbody', null, groups.map((g) => h('tr', null,
          h('td', null, h('b', null, g.name), g.enabled ? '' : h('span', { class: 'name' }, T('disabled'))),
          h('td', { class: 'num' }, g.close_time), h('td', null, g.timezone, h('span', { class: 'name' }, st[g.id]?.localTime || '')), h('td', { class: 'num' }, g.delay_min + ' min'),
          h('td', { class: 'num' }, instruments.filter((i) => i.group_id === g.id && i.enabled).length),
          h('td', { class: 'small' }, fmtTs(st[g.id]?.nextRun)), h('td', { class: 'small muted' }, g.last_run_at ? `${fmtTs(g.last_run_at)} · ${g.last_status}` : '–'),
          h('td', { class: 'nowrap' },
            h('button', { class: 'btn sm', onclick: () => startRefresh(g.id) }, T('grp.runNow')), ' ',
            h('button', { class: 'btn sm', onclick: () => groupDialog(g) }, T('edit')), ' ',
            h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(T('grp.confirmDelete', { name: g.name }))) return; try { await api(`/groups/${g.id}`, { method: 'DELETE' }); render(); } catch (e) { toast(TE(e.message), true); } } }, T('delete'))))))));
      return h('div', { class: 'card' }, h('h3', null, T('set.tab.groups'), h('button', { class: 'btn sm', onclick: () => groupDialog(null) }, '+ ' + T('grp.add'))), table, h('p', { class: 'hint' }, T('grp.hint')));
    },
    instruments() {
      const gname = Object.fromEntries(groups.map((g) => [g.id, g]));
      const cats = [...new Set(instruments.map((i) => i.category))];
      const collapsed = JSON.parse(store.get('kd.catClosed') || '[]');
      const wrap = h('div');
      const toggleCat = async (cat, enabled) => {
        try { await api('/categories/toggle', { method: 'POST', body: { category: cat, enabled } }); await loadMarket(); toast(T('saved')); render(); }
        catch (e) { toast(TE(e.message), true); }
      };
      for (const cat of cats) {
        const list = instruments.filter((i) => i.category === cat), on = list.filter((i) => i.enabled).length;
        const closed = collapsed.includes(cat);
        const table = h('div', { class: 'tablewrap', hidden: closed }, h('table', null,
          h('thead', null, h('tr', null, ['ID', T('ins.name'), T('ins.group'), T('ins.symbol'), T('ins.lastFetch'), T('ins.active'), ''].map((x) => h('th', null, x)))),
          h('tbody', null, list.map((i) => {
            const prov = i.provider || s.data.provider;
            return h('tr', null, h('td', null, h('b', null, i.id)), h('td', null, instName(i)),
              h('td', null, gname[i.group_id] ? `${gname[i.group_id].name} (${gname[i.group_id].close_time})` : '–'),
              h('td', { class: 'small' }, `${i.symbols[prov] || '—'}`, h('span', { class: 'name' }, prov)),
              h('td', { class: 'small ' + (i.last_error ? 'err' : 'muted'), title: i.last_error || '' }, i.last_error ? T('ins.error') : fmtTs(i.last_fetch_at)),
              h('td', null, h('input', { type: 'checkbox', checked: i.enabled, onchange: async (e) => { try { await api(`/instruments/${encodeURIComponent(i.id)}`, { method: 'PUT', body: { enabled: e.target.checked } }); await loadMarket(); render(); } catch (err) { toast(TE(err.message), true); } } })),
              h('td', { class: 'nowrap' }, h('button', { class: 'btn sm', onclick: () => instrumentDialog(i) }, T('edit')), ' ',
                h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(T('ins.confirmDelete', { id: i.id }))) return; await api(`/instruments/${encodeURIComponent(i.id)}`, { method: 'DELETE' }); await loadMarket(); render(); } }, T('delete'))));
          }))));
        wrap.append(h('div', { class: 'card catcard' },
          h('div', { class: 'cathead' },
            h('button', { class: 'catname', 'aria-expanded': String(!closed), onclick: () => { const c = new Set(collapsed); closed ? c.delete(cat) : c.add(cat); store.set('kd.catClosed', JSON.stringify([...c])); render(); } },
              h('span', { class: 'caret' }, closed ? '▸' : '▾'), catName(cat)),
            h('span', { class: 'muted small' }, T('cat.count', { on, total: list.length })),
            h('span', { class: 'chips' },
              h('button', { class: 'chip' + (on === list.length ? ' on' : ''), onclick: () => toggleCat(cat, true) }, T('cat.enableAll')),
              h('button', { class: 'chip' + (on === 0 ? ' on' : ''), onclick: () => toggleCat(cat, false) }, T('cat.disableAll')))),
          table));
      }
      return h('div', null,
        h('div', { class: 'actions', style: 'margin:0 0 12px' }, h('button', { class: 'btn primary', onclick: () => instrumentDialog(null) }, '+ ' + T('ins.add')), h('button', { class: 'btn', onclick: () => importDialog() }, T('ins.import')), h('span', { class: 'hint', style: 'margin:0' }, T('ins.hint'))),
        wrap);
    },
    notify() {
      const f = h('form', { class: 'form' },
        field(T('ntf.mode'), h('select', { name: 'mode' }, ['off', 'alerts', 'report'].map((m) => h('option', { value: m, selected: m === s.notify.mode }, T('ntf.mode.' + m))))),
        field(T('ntf.positions'), h('select', { name: 'positions' }, ['off', 'changes', 'always'].map((m) => h('option', { value: m, selected: m === s.notify.positions }, T('ntf.positions.' + m))))),
        field(T('ntf.minGrade'), h('select', { name: 'minGrade' }, ['A', 'B', 'C'].map((g) => h('option', { value: g, selected: g === s.notify.minGrade }, g)))),
        field(T('smtp.host'), h('input', { type: 'text', name: 'host', value: s.smtp.host, placeholder: 'smtp.example.com' })),
        field(T('smtp.port'), num('port', s.smtp.port, { min: 1, max: 65535, step: 1 })),
        field(T('smtp.security'), h('select', { name: 'security' }, ['starttls', 'tls', 'none'].map((m) => h('option', { value: m, selected: m === s.smtp.security }, T('smtp.security.' + m))))),
        field(T('smtp.user'), h('input', { type: 'text', name: 'user', value: s.smtp.user, autocomplete: 'off' })),
        field(T('smtp.pass'), h('input', { type: 'password', name: 'pass', placeholder: s.smtp.passSet ? T('smtp.pass.keep') : '', autocomplete: 'new-password' })),
        field(T('smtp.from'), h('input', { type: 'text', name: 'from', value: s.smtp.from, placeholder: 'KumoDesk <kumodesk@example.com>' })),
        h('label', { class: 'wide' }, T('smtp.to'), h('input', { type: 'text', name: 'to', value: s.smtp.to, placeholder: 'me@example.com, other@example.com' })),
        h('div', { class: 'wide actions' }, h('button', { class: 'btn primary' }, T('save')),
          h('button', { class: 'btn', type: 'button', onclick: async (e) => {
            if (!(await submit())) return;
            e.target.disabled = true;
            try { await api('/settings/test-smtp', { method: 'POST', body: { lang: s.notify.lang || lang } }); toast(T('smtp.testOk')); }
            catch (err) { toast(T('smtp.testFail') + ' ' + TE(err.message), true); }
            e.target.disabled = false;
          } }, T('smtp.test'))));
      const submit = async () => {
        const d = formData(f); const { mode, minGrade, positions, ...smtp } = d; smtp.port = Number(smtp.port);
        return save({ notify: { mode, minGrade, positions }, smtp });
      };
      f.onsubmit = async (e) => { e.preventDefault(); if (await submit()) render(); };
      return h('div', { class: 'card' }, h('h3', null, T('set.tab.notify')), f, h('p', { class: 'hint' }, T('ntf.hint')));
    },
    capital() {
      const box = h('div', null, h('div', { class: 'muted' }, T('loading')));
      api('/capital').then((c) => {
        capitalCfg = c.capital; currentEquity = c.stats.equity;
        const st = c.stats;
        const f = h('form', { class: 'form' },
          field(T('cap.start'), num('start', c.capital.start, { min: 0, step: 'any' }), T('cap.start.hint')),
          field(T('cap.currency'), h('input', { type: 'text', name: 'currency', value: c.capital.currency, maxlength: 6 })),
          field(T('cap.defaultRisk'), num('defaultRisk', c.capital.defaultRisk, { min: 0.05, max: 100, step: 0.05 })),
          h('div', null, h('button', { class: 'btn primary' }, T('save'))));
        f.onsubmit = async (e) => { e.preventDefault(); const d = formData(f); if (await save({ capital: { start: Number(d.start), currency: d.currency, defaultRisk: Number(d.defaultRisk) } })) render(); };
        const tone = (v) => (v == null || v === 0 ? 'none' : v > 0 ? 'good' : 'crit');
        const stat = (k, v, sub, tn) => h('div', { class: `card tile tone-${tn || 'none'}` }, h('div', { class: 'k' }, h('span', { class: 'dot' }), T(k)), h('div', { class: 'v' }, v), h('div', { class: 's' }, sub || ''));
        const tiles = h('div', { class: 'grid captiles' },
          stat('cap.t.start', money(st.start, 0)),
          stat('cap.t.equity', money(st.equity, 0), st.returnPct != null ? `${signed(st.returnPct, 2)}%` : '', tone(st.profit)),
          stat('cap.t.profit', (st.profit > 0 ? '+' : '') + money(st.profit, 0), T('cap.t.profit.sub', { n: st.trades }), tone(st.profit)),
          stat('cap.t.avg', st.avgPnl != null ? (st.avgPnl > 0 ? '+' : '') + money(st.avgPnl) : '–', st.avgR != null ? T('cap.t.avg.sub', { r: signed(st.avgR, 2) }) : '', tone(st.avgPnl)),
          stat('cap.t.winRate', st.winRate != null ? st.winRate + '%' : '–', T('cap.t.winRate.sub', { w: st.wins, l: st.losses })),
          stat('cap.t.pf', st.profitFactor != null ? String(st.profitFactor) : '–', T('cap.t.pf.sub', { win: st.avgWin != null ? money(st.avgWin, 0) : '–', loss: st.avgLoss != null ? money(st.avgLoss, 0) : '–' })),
          stat('cap.t.dd', st.maxDrawdownPct + '%', T('cap.t.dd.sub', { best: st.best != null ? money(st.best, 0) : '–', worst: st.worst != null ? money(st.worst, 0) : '–' }), st.maxDrawdownPct > 10 ? 'warn' : 'none'),
          stat('cap.t.open', c.openRisk + '%', T('cap.t.open.sub', { n: c.openPositions })));
        const charts = c.trades.length ? h('div', { class: 'grid two section-gap' },
          h('div', { class: 'card' }, h('h3', null, T('cap.chart.equity'), h('span', { class: 'muted small' }, capitalCfg.currency)), h('div', { html: equityChart(c.curve, st.start) }), h('p', { class: 'hint' }, T('cap.chart.equity.hint'))),
          h('div', { class: 'card' }, h('h3', null, T('cap.chart.trades'), h('span', { class: 'muted small' }, capitalCfg.currency)), h('div', { html: tradeBars(c.trades) }), h('p', { class: 'hint' }, T('cap.chart.trades.hint'))),
          h('div', { class: 'card', style: 'grid-column:1/-1' }, h('h3', null, T('cap.chart.instruments'), h('span', { class: 'muted small' }, capitalCfg.currency)),
            h('div', { class: 'bars' }, c.byInstrument.slice(0, 14).map((b) => { const mx = Math.max(...c.byInstrument.map((z) => Math.abs(z.pnl)), 1); const pct = Math.min(50, Math.abs(b.pnl) / mx * 50);
              return h('div', { class: 'bar-row', style: 'grid-template-columns:90px 1fr 130px', title: T('cap.nTrades', { n: b.trades }) }, h('span', { class: 'lbl' }, b.id),
                h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill' + (b.pnl < 0 ? ' neg' : ''), style: b.pnl < 0 ? `right:50%;width:${pct}%` : `left:50%;width:${pct}%` })), h('span', { class: 'num right' }, money(b.pnl, 0))); }))))
          : h('div', { class: 'card section-gap' }, h('p', { class: 'muted' }, T('cap.noTrades')));
        const table = c.trades.length ? h('div', { class: 'card section-gap' }, h('h3', null, T('cap.table'), h('span', { class: 'muted small' }, T('cap.nTrades', { n: c.trades.length }))),
          h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, [T('pf.opened'), T('close.date'), T('col.instrument'), T('col.dir'), T('pf.risk'), T('pf.entry'), T('close.stop0'), T('close.exit'), T('close.resultR'), T('close.resultMoney'), '%', T('cap.equityAfter'), ''].map((x) => h('th', null, x)))),
            h('tbody', null, [...c.trades].reverse().map((t) => h('tr', null,
              h('td', { class: 'muted small nowrap' }, t.opened || '–'), h('td', { class: 'small nowrap' }, t.closed), h('td', null, h('a', { href: `#/i/${encodeURIComponent(t.instrument_id)}` }, h('b', null, t.instrument_id))), h('td', null, dirBadge(t.direction)),
              h('td', { class: 'num' }, t.risk_pct + '%'), h('td', { class: 'num' }, t.entry != null ? fmtPrice(t.entry) : '–'), h('td', { class: 'num' }, t.stop_initial != null ? fmtPrice(t.stop_initial) : '–'), h('td', { class: 'num' }, t.exit != null ? fmtPrice(t.exit) : '–'),
              h('td', { class: 'num' }, t.r != null ? signed(t.r, 2) + ' R' : '–'),
              h('td', { class: 'num nowrap' }, h('span', { class: `dot ${t.pnl > 0 ? 'good' : t.pnl < 0 ? 'crit' : ''}`, style: 'display:inline-block;margin-right:6px' }), (t.pnl > 0 ? '+' : '') + money(t.pnl)),
              h('td', { class: 'num' }, t.pnlPct != null ? signed(t.pnlPct, 2) + '%' : '–'), h('td', { class: 'num' }, money(t.equity, 0)),
              h('td', { class: 'nowrap' }, h('button', { class: 'btn sm iconbtn', title: T('share.trade'), 'aria-label': T('share.trade'), onclick: () => shareTradeDialog(t),
                html: '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.8-4 3 3 0 0 0 0 1.6L8.6 9.2a3 3 0 1 0 0 5.6l6.6 3.6A3 3 0 1 0 16 16.7l-6.5-3.6a3 3 0 0 0 0-2.2L16 7.3A3 3 0 0 0 18 8z" fill="currentColor"/></svg>' }), ' ',
                h('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(T('cap.confirmDelete', { id: t.instrument_id }))) return; await api(`/trades/${t.id}`, { method: 'DELETE' }); render(); } }, T('delete'))))))))) : null;
        box.replaceChildren(h('div', { class: 'card' }, h('h3', null, T('set.tab.capital')), f, h('p', { class: 'hint' }, T('cap.hint'))), h('div', { class: 'section-gap' }, tiles), charts, table || '');
      }).catch((e) => box.replaceChildren(h('div', { class: 'card err' }, TE(e.message))));
      return box;
    },
    risk() {
      const f = h('form', { class: 'form' },
        field(T('risk.maxTotal'), num('maxTotal', s.risk.maxTotal, { min: 0.1, step: 0.1 })),
        field(T('risk.maxCurrency'), num('maxCurrency', s.risk.maxCurrency, { min: 0.1, step: 0.1 })),
        field(T('risk.maxPosition'), num('maxPosition', s.risk.maxPosition, { min: 0.05, step: 0.05 })),
        h('div', null, h('button', { class: 'btn primary' }, T('save'))));
      f.onsubmit = async (e) => { e.preventDefault(); const d = formData(f); for (const k in d) d[k] = Number(d[k]); if (await save({ risk: d })) render(); };
      return h('div', { class: 'card' }, h('h3', null, T('set.tab.risk')), f, h('p', { class: 'hint' }, T('risk.hint')));
    },
  };

  function groupDialog(g) {
    const days = String(g?.days || '1,2,3,4,5').split(',');
    const f = h('form', { class: 'form' },
      field(T('grp.name'), h('input', { type: 'text', name: 'name', value: g?.name || '', required: true })),
      field(T('grp.close'), h('input', { type: 'time', name: 'close_time', value: g?.close_time || '17:00', required: true })),
      field(T('grp.tz'), h('input', { type: 'text', name: 'timezone', value: g?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, list: 'tzlist', required: true })),
      field(T('grp.delay'), num('delay_min', g?.delay_min ?? 15, { min: 0, max: 600, step: 1 }), T('grp.delay.hint')),
      h('label', { class: 'wide' }, T('grp.days'), h('div', { class: 'days' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('label', null, h('input', { type: 'checkbox', name: 'day', value: d, checked: days.includes(String(d)), style: 'width:auto' }), T('day.' + d))))),
      h('label', { class: 'inline-check' }, h('input', { type: 'checkbox', name: 'enabled', checked: g ? g.enabled : true }), T('grp.enabled')));
    dialog(g ? T('grp.edit') : T('grp.add'), f, async () => {
      const fd = new FormData(f);
      const body = { name: fd.get('name'), close_time: fd.get('close_time'), timezone: fd.get('timezone'), delay_min: Number(fd.get('delay_min')), days: fd.getAll('day').join(','), enabled: fd.get('enabled') === 'on' };
      await api(g ? `/groups/${g.id}` : '/groups', { method: g ? 'PUT' : 'POST', body });
    });
  }

  function instrumentDialog(i) {
    const f = h('form', { class: 'form' },
      field('ID', h('input', { type: 'text', name: 'id', value: i?.id || '', required: true, disabled: !!i, placeholder: 'BTCUSD' })),
      field(T('ins.name'), h('input', { type: 'text', name: 'name', value: i?.name || '' })),
      field(T('ins.class'), h('select', { name: 'class' }, classes.map((c) => h('option', { value: c, selected: c === (i?.class || 'other') }, T('class.' + c))))),
      field(T('ins.category'), h('input', { type: 'text', name: 'category', value: i?.category || '', list: 'catlist', maxlength: 30, placeholder: 'crypto' }), T('ins.category.hint')),
      field(T('ins.group'), h('select', { name: 'group_id' }, groups.map((g) => h('option', { value: g.id, selected: g.id === i?.group_id }, `${g.name} – ${g.close_time} ${g.timezone}`))), T('ins.group.hint')),
      field(T('ins.base'), h('input', { type: 'text', name: 'base', value: i?.base || '', maxlength: 5 })),
      field(T('ins.quote'), h('input', { type: 'text', name: 'quote', value: i?.quote || '', maxlength: 5 }), T('ins.fx.hint')),
      field(T('ins.provider'), h('select', { name: 'provider' }, provOptions(i?.provider, true, T('ins.provider.default')))),
      ...providers.map((p) => field(T('ins.symbolFor', { name: p.name }), h('input', { type: 'text', name: 'sym_' + p.id, value: i?.symbols?.[p.id] || '' }))),
      h('label', { class: 'inline-check' }, h('input', { type: 'checkbox', name: 'enabled', checked: i ? i.enabled : true }), T('ins.active')));
    dialog(i ? T('ins.edit', { id: i.id }) : T('ins.add'), f, async () => {
      const fd = new FormData(f);
      const body = { id: fd.get('id'), name: fd.get('name'), class: fd.get('class'), category: fd.get('category') || fd.get('class'), group_id: Number(fd.get('group_id')), base: fd.get('base'), quote: fd.get('quote'), provider: fd.get('provider'), enabled: fd.get('enabled') === 'on', symbols: Object.fromEntries(providers.map((p) => [p.id, fd.get('sym_' + p.id)])) };
      await api(i ? `/instruments/${encodeURIComponent(i.id)}` : '/instruments', { method: i ? 'PUT' : 'POST', body });
      await loadMarket();
    }, T('ins.dialog.hint'));
  }

  function importDialog() {
    const f = h('form', { class: 'form' },
      h('label', { class: 'wide' }, T('imp.text'), h('textarea', { name: 'text', rows: 9, required: true, placeholder: 'VWCE.DE;Vanguard FTSE All-World\nBTC-EUR;Bitcoin\nAAPL' })),
      field(T('ins.category'), h('input', { type: 'text', name: 'category', list: 'catlist', required: true, maxlength: 30, value: 'scalable' })),
      field(T('ins.class'), h('select', { name: 'class' }, classes.filter((c) => c !== 'fx').map((c) => h('option', { value: c, selected: c === 'stock' }, T('class.' + c))))),
      field(T('ins.group'), h('select', { name: 'group_id' }, groups.map((g) => h('option', { value: g.id }, `${g.name} – ${g.close_time} ${g.timezone}`)))),
      field(T('set.provider'), h('select', { name: 'provider' }, provOptions(s.data.provider))),
      h('label', { class: 'inline-check' }, h('input', { type: 'checkbox', name: 'enabled', checked: true }), T('ins.active')));
    dialog(T('ins.import'), f, async () => {
      const fd = new FormData(f);
      const r = await api('/instruments/import', { method: 'POST', body: { text: fd.get('text'), category: fd.get('category'), class: fd.get('class'), group_id: Number(fd.get('group_id')), provider: fd.get('provider'), enabled: fd.get('enabled') === 'on' } });
      await loadMarket();
      setTimeout(() => toast(T('imp.done', { added: r.added, skipped: r.skipped, invalid: r.invalid.length })), 50);
    }, T('imp.hint'));
  }

  function dialog(title, form, onSave, hint) {
    const dlg = h('dialog', null, h('h2', null, title), form, hint ? h('p', { class: 'hint' }, hint) : null);
    const errEl = h('span', { class: 'err small' });
    form.append(h('div', { class: 'wide actions' }, h('button', { class: 'btn primary' }, T('save')), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, T('cancel')), errEl));
    form.onsubmit = async (e) => { e.preventDefault(); try { await onSave(); dlg.close(); toast(T('saved')); render(); } catch (err) { errEl.textContent = TE(err.message); } };
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  const tabs = isAdmin() ? ['general', 'users', 'capital', 'data', 'analysis', 'groups', 'instruments', 'notify', 'risk'] : ['general', 'capital', 'risk'];
  if (!tabs.includes(settingsTab)) settingsTab = 'general';
  const body = h('div');
  const tabBar = h('div', { class: 'tabs' }, tabs.map((k) => h('button', { class: k === settingsTab ? 'on' : '', onclick: () => { settingsTab = k; render(); } }, T('set.tab.' + k))));
  body.append(panes[settingsTab]());
  const catList = h('datalist', { id: 'catlist' }, [...new Set(instruments.map((x) => x.category))].map((c) => h('option', { value: c })));
  root.replaceChildren(tzList, catList, tabBar, body);
  return root;
}

// ---------- JAK UŻYWAĆ ----------
function viewHelp() {
  const sections = HELP[lang] || HELP.en;
  // **pogrubienie** -> <b>; tekst pochodzi wyłącznie z pliku help.js
  const rich = (text) => { const el = h('span'); text.split(/\*\*(.+?)\*\*/g).forEach((part, i) => el.append(i % 2 ? h('b', null, part) : part)); return el; };
  const root = h('div', { class: 'help' });
  root.append(h('div', { class: 'card', style: 'margin-bottom:14px' }, h('h3', null, T('help.title')),
    h('div', { class: 'chips' }, sections.map((sec, i) => h('button', { class: 'chip', onclick: () => document.getElementById('help-' + sec.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, `${i + 1}. ${sec.title}`)))));
  sections.forEach((sec, i) => root.append(h('section', { class: 'card helpsec', id: 'help-' + sec.id },
    h('h2', null, `${i + 1}. ${sec.title}`),
    sec.body.map((b) => (Array.isArray(b) ? h('ul', null, b.map((li) => h('li', null, rich(li)))) : h('p', null, rich(b)))))));
  return root;
}

// ---------- LOGOWANIE ----------
async function showAuth() {
  let st;
  try { st = await api('/auth/state'); } catch { st = { setup: false, user: null, appearance: lookCfg }; }
  lookCfg = st.appearance || lookCfg;
  applyLook();
  if (st.user) { me = st.user; $('#auth').hidden = true; document.body.classList.remove('locked'); return true; }
  const setup = st.setup;
  const err = h('div', { class: 'err small', role: 'alert' });
  const user = h('input', { type: 'text', name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 32, autofocus: true });
  const pass = h('input', { type: 'password', name: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true, minlength: setup ? 8 : 1 });
  const pass2 = h('input', { type: 'password', name: 'password2', autocomplete: 'new-password', required: true, minlength: 8 });
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email' });
  const btn = h('button', { class: 'btn primary' }, T(setup ? 'auth.submit.setup' : 'auth.submit.login'));
  const form = h('form', { class: 'authform' },
    h('label', null, T('auth.username'), user),
    h('label', null, T('auth.password'), pass),
    setup ? h('label', null, T('auth.password2'), pass2) : null,
    setup ? h('label', null, T('auth.email'), email, h('span', { class: 'muted' }, T('auth.email.hint'))) : null,
    err, btn,
    setup ? h('p', { class: 'hint' }, T('auth.rules')) : null);
  form.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    if (setup && pass.value !== pass2.value) { err.textContent = T('auth.mismatch'); return; }
    btn.disabled = true;
    try {
      const r = await api(setup ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username: user.value.trim(), password: pass.value, email: email.value.trim() } });
      me = r.user; $('#auth').hidden = true; document.body.classList.remove('locked');
      startApp();
    } catch (ex) { err.textContent = TE(ex.message); pass.value = ''; pass.focus(); }
    btn.disabled = false;
  };
  const langSel = h('select', { class: 'lang', 'aria-label': 'Language', onchange: (e) => { langPref = e.target.value; store.set('kd.lang', langPref); lang = langPref === 'auto' ? detectLang(navigator.languages || [navigator.language]) : resolveLang(langPref); showAuth(); } },
    ['auto', 'pl', 'de', 'en'].map((l) => h('option', { value: l, selected: l === langPref }, l === 'auto' ? 'Auto' : t(l, 'lang.' + l))));
  const el = $('#auth');
  el.className = `auth lbg-${(lookCfg.theme || 'normal') === 'normal' ? lookCfg.loginBg : 'theme'}`;
  el.replaceChildren(
    h('div', { class: 'authbg', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'authcard' },
      h('div', { class: 'authbrand', html: '<svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><path d="M3 21c5-9 9 2 13-6s7-6 13-8" fill="none" stroke="var(--line-tenkan)" stroke-width="3" stroke-linecap="round"/><path d="M3 27c6-5 10 1 14-3s7-3 12-5" fill="none" stroke="var(--line-kijun)" stroke-width="3" stroke-linecap="round"/></svg><span>KumoDesk</span>' }),
      h('h1', null, T(setup ? 'auth.setup.title' : 'auth.login.title')),
      h('p', { class: 'muted' }, T(setup ? 'auth.setup.sub' : 'auth.login.sub')),
      form,
      h('div', { class: 'authfoot' }, langSel, h('span', { class: 'muted small' }, st.version ? `v${st.version}` : ''))));
  el.hidden = false; document.body.classList.add('locked');
  setTimeout(() => user.focus(), 30);
  return false;
}
async function logout() { try { await api('/auth/logout', { method: 'POST' }); } catch { /* i tak wylogowujemy */ } me = null; market = null; status = null; location.hash = '#/'; showAuth(); }

// ---------- UDOSTĘPNIANIE ZAGRAŃ I WIADOMOŚCI ----------
let usersCache = null;
async function otherUsers() { if (!usersCache) usersCache = await api('/users'); return usersCache.filter((u) => u.id !== me.id); }
function tradeCard(tr) {
  const cur = tr.currency || '';
  return h('div', { class: 'tradecard' },
    h('div', { class: 'pos-head' }, h('b', null, tr.instrument_id), dirBadge(tr.direction), tr.r != null ? h('span', { class: 'badge' }, `${signed(tr.r, 2)} R`) : null,
      tr.pnl != null ? h('span', { class: 'num' }, `${tr.pnl > 0 ? '+' : ''}${Number(tr.pnl).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`) : null,
      tr.pnlPct != null ? h('span', { class: 'muted small' }, `${signed(tr.pnlPct, 2)}%`) : null),
    h('div', { class: 'muted small' }, `${tr.opened || '–'} → ${tr.closed} · ${T('pf.entry')} ${tr.entry != null ? fmtPrice(tr.entry) : '–'} · ${T('close.exit')} ${tr.exit != null ? fmtPrice(tr.exit) : '–'} · ${T('pf.risk')} ${tr.risk_pct}%`));
}
async function shareTradeDialog(tr) {
  const users = await otherUsers();
  if (!users.length) { toast(T('share.noUsers'), true); return; }
  const to = h('select', { name: 'to', required: true }, users.map((u) => h('option', { value: u.id }, u.username)));
  const body = h('textarea', { name: 'body', rows: 3, maxlength: 2000, placeholder: T('msg.placeholder'), style: 'font:inherit' });
  const form = h('form', { class: 'ticket' }, tradeCard({ ...tr, currency: capitalCfg.currency }),
    h('div', { class: 'form' }, h('label', null, T('share.to'), to), h('label', { class: 'wide' }, T('share.message'), body)));
  openDialog(T('share.trade.title'), form, async () => {
    await api('/messages', { method: 'POST', body: { to: Number(to.value), body: body.value, trade_id: tr.id } });
    toast(T('share.sent', { name: to.selectedOptions[0].textContent }));
  }, { saveLabel: T('share.send'), cls: 'ticket-dlg' });
}
async function viewMessages(otherId) {
  const root = h('div', null, h('div', { class: 'muted' }, T('loading')));
  const [threads, users] = await Promise.all([api('/messages'), otherUsers()]);
  const byUser = Object.fromEntries(threads.map((x) => [x.user.id, x]));
  const order = [...threads.map((x) => x.user), ...users.filter((u) => !byUser[u.id]).map((u) => ({ id: u.id, username: u.username }))];
  if (!otherId && order.length) otherId = order[0].id;
  const list = h('div', { class: 'card msglist' }, h('h3', null, T('msg.title')),
    order.length ? order.map((u) => h('a', { class: 'msguser' + (u.id === otherId ? ' on' : ''), href: `#/messages?u=${u.id}` },
      h('span', { class: 'avatar' }, u.username.slice(0, 1).toUpperCase()), h('span', { class: 'grow' }, h('b', null, u.username),
        h('div', { class: 'muted small clip' }, byUser[u.id] ? (byUser[u.id].last.body || (byUser[u.id].last.trade ? T('msg.trade') : '')) : T('msg.new'))),
      byUser[u.id]?.unread && u.id !== otherId ? h('span', { class: 'bellcount', style: 'position:static' }, byUser[u.id].unread) : null))
      : h('p', { class: 'muted' }, T('share.noUsers')));
  const panel = h('div', { class: 'card msgpanel' });
  if (otherId) {
    const d = await api(`/messages/${otherId}`);
    const box = h('div', { class: 'msgs' }, d.messages.length ? d.messages.map((m) => h('div', { class: 'msg' + (m.from_id === me.id ? ' mine' : '') },
      m.trade ? tradeCard(m.trade) : null, m.body ? h('div', { class: 'msgbody' }, m.body) : null,
      h('div', { class: 'muted small' }, `${m.from_id === me.id ? T('msg.you') : d.user.username} · ${fmtTs(m.ts)}`))) : h('p', { class: 'muted' }, T('msg.empty')));
    const input = h('textarea', { rows: 2, maxlength: 2000, placeholder: T('msg.placeholder'), required: true, style: 'font:inherit' });
    const form = h('form', { class: 'msgform' }, input, h('button', { class: 'btn primary' }, T('msg.send')));
    form.onsubmit = async (e) => { e.preventDefault(); try { await api('/messages', { method: 'POST', body: { to: otherId, body: input.value } }); render(); } catch (ex) { toast(TE(ex.message), true); } };
    input.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); };
    panel.append(h('h3', null, d.user.username), box, form);
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    if (status?.mail) { status.mail.unread = Math.max(0, status.mail.unread - (byUser[otherId]?.unread || 0)); updateBell(); }
  } else panel.append(h('p', { class: 'muted' }, T('msg.pick')));
  root.replaceChildren(h('div', { class: 'msggrid' }, list, panel));
  return root;
}

/** Portfel innego użytkownika, który go udostępnił – tylko do odczytu. */
async function viewSharedPortfolio(ownerId) {
  const root = h('div', null, h('div', { class: 'muted' }, T('loading')));
  let d;
  try { d = await api(`/portfolio/${ownerId}`); } catch (e) { return h('div', { class: 'card err' }, TE(e.message)); }
  const pf = d.portfolio, st = d.stats, cur = d.capital.currency;
  const mny = (v, dg = 0) => (v == null ? '–' : `${Number(v).toLocaleString(lang, { minimumFractionDigits: dg, maximumFractionDigits: dg })} ${cur}`);
  const stat = (k, v, sub) => h('div', { class: 'card tile tone-none' }, h('div', { class: 'k' }, T(k)), h('div', { class: 'v' }, v), h('div', { class: 's' }, sub || ''));
  const prev = capitalCfg; capitalCfg = { ...capitalCfg, currency: cur }; // wykresy opisują walutę właściciela
  root.replaceChildren(
    h('div', { class: 'card banner' }, h('a', { class: 'btn', href: '#/portfolio' }, '← ' + T('share.mine')), h('span', { class: 'mode' }, T('share.viewing', { name: d.owner.username })), h('span', { class: 'txt' }, T('share.readonly'))),
    pf.positions.length ? positionsCard(pf.positions, true) : h('div', { class: 'card', style: 'margin-bottom:14px' }, h('p', { class: 'muted' }, T('pf.none'))),
    h('div', { class: 'grid captiles', style: 'margin-bottom:14px' },
      stat('cap.t.equity', mny(st.equity), st.returnPct != null ? `${signed(st.returnPct, 2)}%` : ''), stat('cap.t.profit', (st.profit > 0 ? '+' : '') + mny(st.profit), T('cap.t.profit.sub', { n: st.trades })),
      stat('cap.t.winRate', st.winRate != null ? st.winRate + '%' : '–', T('cap.t.winRate.sub', { w: st.wins, l: st.losses })), stat('cap.t.avg', st.avgR != null ? `${signed(st.avgR, 2)} R` : '–', T('cap.t.open.sub', { n: pf.positions.length }))),
    d.trades.length ? h('div', { class: 'grid two', style: 'margin-bottom:14px' },
      h('div', { class: 'card' }, h('h3', null, T('cap.chart.equity'), h('span', { class: 'muted small' }, cur)), h('div', { html: equityChart(d.curve, st.start) })),
      h('div', { class: 'card' }, h('h3', null, T('cap.chart.trades'), h('span', { class: 'muted small' }, cur)), h('div', { html: tradeBars(d.trades) }))) : '',
    d.trades.length ? h('div', { class: 'card' }, h('h3', null, T('cap.table')), h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, [T('close.date'), T('col.instrument'), T('col.dir'), T('pf.risk'), T('pf.entry'), T('close.exit'), T('close.resultR'), T('close.resultMoney'), '%'].map((x) => h('th', null, x)))),
      h('tbody', null, [...d.trades].reverse().map((t2) => h('tr', null, h('td', { class: 'small nowrap' }, t2.closed), h('td', null, h('b', null, t2.instrument_id)), h('td', null, dirBadge(t2.direction)), h('td', { class: 'num' }, t2.risk_pct + '%'),
        h('td', { class: 'num' }, t2.entry != null ? fmtPrice(t2.entry) : '–'), h('td', { class: 'num' }, t2.exit != null ? fmtPrice(t2.exit) : '–'), h('td', { class: 'num' }, t2.r != null ? signed(t2.r, 2) + ' R' : '–'),
        h('td', { class: 'num nowrap' }, (t2.pnl > 0 ? '+' : '') + mny(t2.pnl, 2)), h('td', { class: 'num' }, t2.pnlPct != null ? signed(t2.pnlPct, 2) + '%' : '–'))))))) : '');
  capitalCfg = prev;
  return root;
}
/** Sekcja „Udostępnij” na stronie portfela. */
async function shareBox() {
  const [sh, users] = await Promise.all([api('/shares'), otherUsers()]);
  const card = h('div', { class: 'card', style: 'margin-bottom:14px' });
  const chosen = new Set(sh.viewers);
  const saveShares = async () => { try { await api('/shares', { method: 'PUT', body: { viewers: [...chosen] } }); toast(T('share.saved')); } catch (e) { toast(TE(e.message), true); } };
  const pick = h('div', { class: 'chips', hidden: !chosen.size }, users.map((u) => { const b = h('button', { type: 'button', class: 'chip' + (chosen.has(u.id) ? ' on' : ''), onclick: () => { chosen.has(u.id) ? chosen.delete(u.id) : chosen.add(u.id); b.classList.toggle('on'); saveShares(); } }, u.username); return b; }));
  const toggle = h('input', { type: 'checkbox', checked: chosen.size > 0, disabled: !users.length, onchange: (e) => { pick.hidden = !e.target.checked; if (!e.target.checked && chosen.size) { chosen.clear(); pick.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); saveShares(); } } });
  card.append(h('div', { class: 'sharerow' },
    h('label', { class: 'inline-check' }, toggle, h('b', null, T('share.portfolio'))), h('span', { class: 'muted small' }, users.length ? T('share.portfolio.hint') : T('share.noUsers')), pick));
  if (sh.sharedWithMe.length) card.append(h('div', { class: 'sharerow', style: 'margin-top:10px' }, h('span', { class: 'muted small' }, T('share.withMe')),
    h('span', { class: 'chips' }, sh.sharedWithMe.map((u) => h('a', { class: 'chip', href: `#/portfolio?u=${u.id}` }, u.username)))));
  return card;
}

// ---------- DZWONEK ----------
const BELL_ICON = { ANALYSIS: '◎', NEW_SETUP: '▲', UPGRADE: '▲', SETUP_LOST: '▽', REGIME: '↻', EXEC: '↻', POSITION: '!', POSITION_H4: '!' };
function updateBell() {
  const n = status?.bell?.unread || 0, el = $('#bellcount');
  el.hidden = !n; el.textContent = n > 99 ? '99+' : String(n);
  $('#bell').title = n ? T('bell.unread', { n }) : T('bell.title');
  $('#bell').setAttribute('aria-label', $('#bell').title);
  const m = status?.mail?.unread || 0, mc = $('#mailcount');
  mc.hidden = !m; mc.textContent = m > 99 ? '99+' : String(m);
  $('#mailbtn').title = m ? T('msg.unread', { n: m }) : T('msg.title');
  $('#mailbtn').setAttribute('aria-label', $('#mailbtn').title);
}
function renderUserMenu() {
  if (!me) return;
  $('#userbtn').replaceChildren(h('span', { class: 'avatar' }, me.username.slice(0, 1).toUpperCase()), h('span', { class: 'uname' }, me.username));
  $('#usermenu').replaceChildren(
    h('div', { class: 'bellhead' }, h('b', null, me.username), h('span', { class: 'muted small' }, T('user.role.' + me.role))),
    h('a', { class: 'menuitem', href: '#/settings', onclick: () => { settingsTab = 'general'; $('#usermenu').hidden = true; } }, T('acc.title')),
    h('button', { class: 'menuitem', onclick: () => { $('#usermenu').hidden = true; logout(); } }, T('user.logout')));
}
async function toggleBell(force) {
  const panel = $('#bellpanel');
  const open = force ?? panel.hidden;
  if (!open) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.replaceChildren(h('div', { class: 'muted', style: 'padding:14px' }, T('loading')));
  try {
    const d = await api('/notifications');
    panel.replaceChildren(
      h('div', { class: 'bellhead' }, h('b', null, T('bell.title')), h('a', { href: '#/history', class: 'muted small', onclick: () => toggleBell(false) }, T('bell.all'))),
      d.items.length ? h('div', { class: 'belllist' }, d.items.map((a) => h(a.instrument_id ? 'a' : 'div', {
        class: `bellitem sev-${a.severity}${a.unread ? ' unread' : ''}`, href: a.instrument_id ? `#/i/${encodeURIComponent(a.instrument_id)}${a.type === 'POSITION_H4' ? '?tf=h4' : ''}` : null, onclick: () => toggleBell(false),
      }, h('span', { class: 'bellicon' }, BELL_ICON[a.type] || '•'), h('div', null, h('div', { class: 'belltext' }, T(a.code, a.params)), h('div', { class: 'muted small' }, fmtTs(a.ts))))))
        : h('div', { class: 'muted', style: 'padding:14px' }, T('bell.empty')));
    if (d.items[0]) { await api('/notifications/seen', { method: 'POST', body: { id: d.items[0].id } }); if (status?.bell) status.bell.unread = 0; updateBell(); }
  } catch (e) { panel.replaceChildren(h('div', { class: 'err', style: 'padding:14px' }, TE(e.message))); }
}

// ---------- routing / pętla ----------
const NAV = [['#/', 'nav.dashboard'], ['#/portfolio', 'nav.portfolio'], ['#/history', 'nav.history'], ['#/settings', 'nav.settings'], ['#/help', 'nav.help']];
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  route = location.hash || '#/';
  document.documentElement.lang = lang;
  $('#mode').replaceChildren(...['basic', 'pro'].map((mo) => h('button', { class: uiMode === mo ? 'on' : '', title: T('ui.' + mo + '.hint'), onclick: () => setMode(mo) }, T('ui.' + mo))));
  $('#nav').replaceChildren(...NAV.filter(([href]) => uiMode === 'pro' || href !== '#/history').map(([href, key]) => h('a', { href, class: (route === href || route.startsWith(href + '?') || (href === '#/' && route.startsWith('#/i/'))) ? 'active' : '' }, T(key))));
  $('#disclaimer').textContent = T('disclaimer');
  $('#lang').value = langPref;
  if (!me) return;
  updateJobInfo(); updateBell(); renderUserMenu();
  let node;
  try {
    if (route.startsWith('#/i/')) { const [rid, q] = route.slice(4).split('?'); const qp = new URLSearchParams(q || ''); node = await viewInstrument(decodeURIComponent(rid), qp.get('tf') === 'h4' ? 'h4' : 'd1', qp.get('view') === 'live' ? 'live' : 'analysis'); }
    else if (route.startsWith('#/portfolio')) { const u = Number(new URLSearchParams(route.split('?')[1] || '').get('u')); node = u && u !== me.id ? await viewSharedPortfolio(u) : await viewPortfolio(); }
    else if (route.startsWith('#/messages')) node = await viewMessages(Number(new URLSearchParams(route.split('?')[1] || '').get('u')) || null);
    else if (route === '#/history') node = await viewHistory();
    else if (route === '#/settings') node = await viewSettings();
    else if (route === '#/help') node = viewHelp();
    else node = uiMode === 'basic' ? viewBasic() : viewDashboard();
  } catch (e) { node = h('div', { class: 'card err' }, TE(e.message)); }
  if (seq === renderSeq) $('#view').replaceChildren(node);
}

function updateJobInfo() {
  const btn = $('#refresh'), info = $('#jobinfo');
  const j = status?.job;
  btn.disabled = !!j?.running;
  btn.textContent = j?.running ? T('refresh.running', { done: j.done, total: j.total }) : T('refresh');
  if (j?.running) info.textContent = j.current ? `${j.group ? j.group + ' · ' : ''}${j.current}` : '';
  else if (j?.finishedAt && j.errors?.length) info.textContent = T('refresh.errors', { n: j.errors.length });
  else {
    const next = (status?.groups || []).filter((g) => g.nextRun).sort((a, b) => a.nextRun.localeCompare(b.nextRun))[0];
    info.textContent = next ? T('next.run', { name: next.name, ts: fmtTs(next.nextRun) }) : '';
  }
  info.title = j?.errors?.length ? j.errors.map((e) => `${e.id}: ${e.error}`).join('\n') : '';
}

async function loadMarket() { market = await api('/dashboard'); }
async function poll() {
  clearTimeout(pollTimer);
  if (!me) return;
  try {
    status = await api('/status');
    const running = status.job.running;
    if (wasRunning && !running) {
      await loadMarket();
      toast(status.job.errors.length ? T('refresh.doneErrors', { n: status.job.errors.length }) : T('refresh.done'), status.job.errors.length > 0);
      if (!location.hash.startsWith('#/settings') || settingsTab === 'groups' || settingsTab === 'instruments') render();
    }
    wasRunning = running;
    updateJobInfo(); updateBell();
  } catch { /* serwer chwilowo niedostępny */ }
  pollTimer = setTimeout(poll, wasRunning ? 1500 : 20000);
}
async function startRefresh(groupId) {
  try { await api('/refresh', { method: 'POST', body: groupId != null ? { groupId } : {} }); wasRunning = true; poll(); }
  catch (e) { toast(e.message === 'BUSY' ? T('refresh.busy') : TE(e.message), true); }
}
function setMode(mo) { uiMode = mo; store.set('kd.mode', mo); render(); }
function setLang(pref) {
  langPref = pref; store.set('kd.lang', pref);
  lang = pref === 'auto' ? detectLang(navigator.languages || [navigator.language]) : resolveLang(pref);
  render();
}

$('#refresh').onclick = () => startRefresh();
$('#bell').onclick = (e) => { e.stopPropagation(); toggleBell(); };
document.addEventListener('click', (e) => { if (!$('#bellpanel').hidden && !e.target.closest('.bellwrap')) toggleBell(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleBell(false); $('#usermenu').hidden = true; } });
$('#userbtn').onclick = (e) => { e.stopPropagation(); $('#usermenu').hidden = !$('#usermenu').hidden; };
document.addEventListener('click', (e) => { if (!$('#usermenu').hidden && !e.target.closest('#usermenu') && !e.target.closest('#userbtn')) $('#usermenu').hidden = true; });
$('#lang').onchange = (e) => setLang(e.target.value);
window.addEventListener('hashchange', render);

let appStarted = false;
async function startApp() {
  usersCache = null;
  render();
  try {
    const [, st, cfg] = await Promise.all([loadMarket(), api('/status'), api('/settings')]);
    status = st; wasRunning = st.job.running;
    capitalCfg = cfg.settings.capital;
    api('/capital').then((c) => { currentEquity = c.stats.equity; }).catch(() => {});
    // pierwszy start: język e-maili = język przeglądarki
    if (isAdmin() && !cfg.settings.notify.lang) api('/settings', { method: 'PUT', body: { notify: { lang } } }).catch(() => {});
  } catch (e) { if (me) toast(TE(e.message), true); }
  render();
  poll();
  if (!appStarted) {
    appStarted = true;
    setInterval(async () => { if (me && !wasRunning && !document.hidden && !location.hash.startsWith('#/settings')) { try { await loadMarket(); if ((location.hash || '#/') === '#/') render(); } catch { /* pomiń */ } } }, 120000);
  }
}
(async function boot() { if (await showAuth()) startApp(); })();
