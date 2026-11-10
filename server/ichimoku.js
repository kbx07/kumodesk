// Silnik Ichimoku Kinko Hyo: linie, chmura, ATR, punktacja −10..+10.

export const DEFAULT_PARAMS = { tenkan: 9, kijun: 26, senkou: 52, shift: 26, atr: 14 };

/** Środek zakresu (max high + min low) / 2 z n świec kończących się na i. */
export function midpoint(bars, i, n) {
  if (i < n - 1) return null;
  let hi = -Infinity, lo = Infinity;
  for (let j = i - n + 1; j <= i; j++) {
    if (bars[j].h > hi) hi = bars[j].h;
    if (bars[j].l < lo) lo = bars[j].l;
  }
  return (hi + lo) / 2;
}

/**
 * Zwraca tablice linii. cloudA/cloudB mają długość n + shift:
 * indeks i to wartość chmury WIDOCZNA na świecy i (policzona na świecy i − shift),
 * indeksy >= n to chmura przyszła.
 */
export function computeIchimoku(bars, params = DEFAULT_PARAMS) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const n = bars.length;
  const tenkan = new Array(n), kijun = new Array(n), rawA = new Array(n), rawB = new Array(n);
  for (let i = 0; i < n; i++) {
    tenkan[i] = midpoint(bars, i, p.tenkan);
    kijun[i] = midpoint(bars, i, p.kijun);
    rawA[i] = tenkan[i] != null && kijun[i] != null ? (tenkan[i] + kijun[i]) / 2 : null;
    rawB[i] = midpoint(bars, i, p.senkou);
  }
  const cloudA = new Array(n + p.shift).fill(null), cloudB = new Array(n + p.shift).fill(null);
  for (let i = 0; i < n; i++) {
    cloudA[i + p.shift] = rawA[i];
    cloudB[i + p.shift] = rawB[i];
  }
  return { tenkan, kijun, rawA, rawB, cloudA, cloudB, params: p };
}

/** ATR Wildera. */
export function computeATR(bars, n = 14) {
  const out = new Array(bars.length).fill(null);
  let sum = 0, prev = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tr = i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
    if (i < n) {
      sum += tr;
      if (i === n - 1) { prev = sum / n; out[i] = prev; }
    } else {
      prev = (prev * (n - 1) + tr) / n;
      out[i] = prev;
    }
  }
  return out;
}

const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

/**
 * Punktacja świecy i. Suma wag = 10.
 * Zwraca null, gdy historii jest za mało na pełną ocenę.
 */
export function scoreAt(bars, ich, i) {
  const p = ich.params;
  if (i < p.senkou + p.shift - 1 || i >= bars.length) return null;
  const c = bars[i].c;
  const t = ich.tenkan[i], k = ich.kijun[i];
  const a = ich.cloudA[i], b = ich.cloudB[i];
  if (t == null || k == null || a == null || b == null) return null;
  const top = Math.max(a, b), bottom = Math.min(a, b);
  const pos = c > top ? 1 : c < bottom ? -1 : 0;
  const past = bars[i - p.shift];
  const chikou = c > past.h ? 1 : c < past.l ? -1 : 0;
  const kPrev = ich.kijun[i - 5];
  const components = [
    { key: 'cloud', label: 'Cena względem chmury', weight: 3, value: pos },
    { key: 'tk', label: 'Tenkan względem Kijun', weight: 2, value: sgn(t - k) },
    { key: 'chikou', label: `Chikou względem ceny sprzed ${p.shift} świec`, weight: 2, value: chikou },
    { key: 'pk', label: 'Cena względem Kijun', weight: 1, value: sgn(c - k) },
    { key: 'future', label: 'Kolor chmury przyszłej', weight: 1, value: sgn(ich.rawA[i] - ich.rawB[i]) },
    { key: 'kslope', label: 'Nachylenie Kijun (5 świec)', weight: 1, value: kPrev == null ? 0 : sgn(k - kPrev) },
  ];
  const score = components.reduce((s, x) => s + x.weight * x.value, 0);
  return { score, components, cloudPos: pos, tenkan: t, kijun: k, cloudTop: top, cloudBottom: bottom, close: c };
}

/** Agregacja świec dziennych do tygodniowych (tydzień ISO, klucz = poniedziałek). */
export function toWeekly(bars) {
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    const d = new Date(b.date + 'T00:00:00Z');
    const dow = (d.getUTCDay() + 6) % 7; // pon = 0
    const key = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
    if (key !== curKey) {
      cur = { date: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 };
      curKey = key;
      out.push(cur);
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      cur.v += b.v || 0;
    }
  }
  return out;
}

export function direction(score, threshold) {
  if (score == null) return 'NEUTRAL';
  return score >= threshold ? 'LONG' : score <= -threshold ? 'SHORT' : 'NEUTRAL';
}
