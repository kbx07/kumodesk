// Ichimoku chart on <canvas>: candles, Tenkan, Kijun, Chikou, cloud (including the future cloud) + crosshair.
import { fmtPrice } from './i18n.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function drawIchimoku(canvas, tip, data, labels, visible = 150) {
  const { bars, tenkan, kijun, cloudA, cloudB, shift, openBar } = data;
  const n = bars.length;
  const from = Math.max(0, n - visible);
  const slots = n - from + shift;
  const pad = { l: 8, r: 66, t: 10, b: 24 };
  let hover = null;

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function render() {
    const { ctx, w, h } = layout();
    const C = {
      grid: css('--grid'), axis: css('--axis'), muted: css('--muted'), ink: css('--ink-2'),
      up: css('--up'), down: css('--down'), tenkan: css('--line-tenkan'), kijun: css('--line-kijun'),
      chikou: css('--line-chikou'), cloudUp: css('--cloud-up'), cloudDown: css('--cloud-down'), surface: css('--surface'),
    };
    ctx.clearRect(0, 0, w, h);
    if (!n) return;
    let lo = Infinity, hi = -Infinity;
    const see = (v) => { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } };
    for (let i = from; i < n; i++) { see(bars[i].h); see(bars[i].l); see(tenkan[i]); see(kijun[i]); }
    for (let i = from; i < n + shift; i++) { see(cloudA[i]); see(cloudB[i]); }
    const m = (hi - lo) * 0.04 || 1; lo -= m; hi += m;
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const step = pw / slots;
    const x = (i) => pad.l + (i - from + 0.5) * step;
    const y = (v) => pad.t + (hi - v) / (hi - lo) * ph;

    // horizontal grid + price axis
    ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    const ticks = 6;
    for (let k = 0; k <= ticks; k++) {
      const v = lo + (hi - lo) * k / ticks, yy = y(v);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(w - pad.r, yy); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.fillText(fmtPrice(v), w - pad.r + 6, yy);
    }
    // time axis (month starts)
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    let lastLabelX = -100;
    const intraday = bars[0].date.length > 10; // H4: day labels, D1: month labels
    const keyLen = intraday ? 10 : 7, minGap = intraday ? 64 : 46;
    for (let i = from + 1; i < n; i++) {
      if (bars[i].date.slice(0, keyLen) !== bars[i - 1].date.slice(0, keyLen) && x(i) - lastLabelX > minGap) {
        ctx.fillStyle = C.muted; ctx.fillText(intraday ? bars[i].date.slice(5, 10) : bars[i].date.slice(0, 7), x(i), h - pad.b + 6);
        lastLabelX = x(i);
      }
    }
    // "today" boundary
    ctx.strokeStyle = C.axis; ctx.setLineDash([3, 4]); ctx.beginPath();
    ctx.moveTo(x(n - 1) + step / 2, pad.t); ctx.lineTo(x(n - 1) + step / 2, h - pad.b); ctx.stroke(); ctx.setLineDash([]);

    // cloud: filled segment by segment, coloured by which line is on top
    for (let i = from; i < n + shift - 1; i++) {
      const a0 = cloudA[i], b0 = cloudB[i], a1 = cloudA[i + 1], b1 = cloudB[i + 1];
      if (a0 == null || b0 == null || a1 == null || b1 == null) continue;
      ctx.fillStyle = (a0 + a1) >= (b0 + b1) ? C.cloudUp : C.cloudDown;
      ctx.beginPath(); ctx.moveTo(x(i), y(a0)); ctx.lineTo(x(i + 1), y(a1)); ctx.lineTo(x(i + 1), y(b1)); ctx.lineTo(x(i), y(b0)); ctx.closePath(); ctx.fill();
    }
    const line = (arr, color, width, len, offset = 0, get = (v) => v) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      for (let i = Math.max(from, offset); i < len; i++) {
        const v = get(arr[i - offset]);
        if (v == null || i < from) { continue; }
        if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v));
      }
      ctx.stroke();
    };
    line(cloudA, C.up, 1, n + shift); line(cloudB, C.down, 1, n + shift);

    // candles
    const bw = Math.max(1, Math.min(9, step * 0.64));
    for (let i = from; i < n; i++) {
      const b = bars[i], col = b.c >= b.o ? C.up : C.down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x(i), y(b.h)); ctx.lineTo(x(i), y(b.l)); ctx.stroke();
      const top = y(Math.max(b.o, b.c)), bh = Math.max(1, Math.abs(y(b.o) - y(b.c)));
      if (openBar && i === n - 1) {
        // candle in progress: outline only, to tell it apart from closed ones
        ctx.fillStyle = C.surface; ctx.fillRect(x(i) - bw / 2, top, bw, bh);
        ctx.strokeRect(x(i) - bw / 2 + 0.5, top + 0.5, Math.max(1, bw - 1), Math.max(1, bh - 1));
      } else ctx.fillRect(x(i) - bw / 2, top, bw, bh);
    }
    line(tenkan, C.tenkan, 2, n); line(kijun, C.kijun, 2, n);
    // Chikou: the close shifted back by `shift`
    ctx.strokeStyle = C.chikou; ctx.lineWidth = 1.5; ctx.beginPath();
    let st = false;
    for (let i = from + shift; i < n; i++) { const xx = x(i - shift), yy = y(bars[i].c); if (!st) { ctx.moveTo(xx, yy); st = true; } else ctx.lineTo(xx, yy); }
    ctx.stroke();

    // crosshair
    if (hover != null) {
      const i = hover;
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(x(i), pad.t); ctx.lineTo(x(i), h - pad.b); ctx.stroke(); ctx.setLineDash([]);
    }
    render.geom = { x, step, w, h };
  }

  function onMove(ev) {
    const r = canvas.getBoundingClientRect();
    const g = render.geom; if (!g) return;
    const i = Math.round((ev.clientX - r.left - pad.l) / g.step - 0.5) + from;
    if (i < from || i >= n + shift) return onLeave();
    hover = i; render();
    const b = bars[i];
    const rows = [];
    const row = (k, v, color) => rows.push(`<div class="r"><span>${color ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:5px"></i>` : ''}${k}</span><b>${v == null ? '–' : fmtPrice(v)}</b></div>`);
    if (b) {
      rows.push(`<div><b>${b.date}</b>${openBar && i === n - 1 ? ` · ${labels.open_candle}` : ''}</div>`);
      row(labels.open, b.o); row(labels.high, b.h); row(labels.low, b.l); row(labels.close, b.c);
      row('Tenkan', tenkan[i], css('--line-tenkan')); row('Kijun', kijun[i], css('--line-kijun'));
    } else rows.push(`<div><b>+${i - n + 1} ${labels.ahead}</b></div>`);
    row('Senkou A', cloudA[i], css('--up')); row('Senkou B', cloudB[i], css('--down'));
    tip.innerHTML = rows.join(''); tip.hidden = false;
    const tx = g.x(i) + 14, tw = tip.offsetWidth;
    tip.style.left = (tx + tw > g.w - 4 ? g.x(i) - tw - 14 : tx) + 'px';
    tip.style.top = '14px';
  }
  function onLeave() { hover = null; tip.hidden = true; render(); }

  canvas.onmousemove = onMove; canvas.onmouseleave = onLeave;
  canvas.ontouchstart = canvas.ontouchmove = (e) => { if (e.touches[0]) onMove(e.touches[0]); };
  render();
  return render;
}
