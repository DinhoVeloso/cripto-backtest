// Indicadores. Todos recebem séries completas e devolvem Float64Array do mesmo tamanho,
// com NaN enquanto não há candles suficientes. O valor no índice i usa só candles até i (fechados).
import type { Series } from "./data";

type Arr = Float64Array;
const nan = (n: number) => new Float64Array(n).fill(NaN);

export function sma(x: Arr, p: number): Arr {
  const out = nan(x.length);
  let s = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) { s = 0; cnt = 0; continue; } // aquecimento de séries derivadas
    s += x[i]; cnt++;
    if (cnt > p) { s -= x[i - p]; cnt--; }
    if (cnt === p) out[i] = s / p;
  }
  return out;
}

export function ema(x: Arr, p: number): Arr {
  const out = nan(x.length);
  const k = 2 / (p + 1);
  let e = NaN, s = 0, start = -1;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (start < 0) start = i;
    if (i - start < p) { s += x[i]; if (i - start === p - 1) { e = s / p; out[i] = e; } continue; }
    e = e + k * (x[i] - e);
    out[i] = e;
  }
  return out;
}

/** Média de Wilder (usada no IFR, ATR e ADX). */
export function rma(x: Arr, p: number): Arr {
  const out = nan(x.length);
  let e = NaN, s = 0, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    if (Number.isNaN(x[i])) continue;
    if (cnt < p) { s += x[i]; cnt++; if (cnt === p) { e = s / p; out[i] = e; } continue; }
    e = (e * (p - 1) + x[i]) / p;
    out[i] = e;
  }
  return out;
}

export function wma(x: Arr, p: number): Arr {
  const out = nan(x.length);
  const den = (p * (p + 1)) / 2;
  for (let i = p - 1; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < p; k++) s += x[i - k] * (p - k);
    out[i] = s / den;
  }
  return out;
}

export function stdev(x: Arr, p: number): Arr {
  const out = nan(x.length);
  let s = 0, s2 = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i]; s2 += x[i] * x[i];
    if (i >= p) { s -= x[i - p]; s2 -= x[i - p] * x[i - p]; }
    if (i >= p - 1) { const m = s / p; out[i] = Math.sqrt(Math.max(s2 / p - m * m, 0)); }
  }
  return out;
}

export function highest(x: Arr, p: number): Arr {
  const out = nan(x.length);
  const dq: number[] = [];
  for (let i = 0; i < x.length; i++) {
    while (dq.length && x[dq[dq.length - 1]] <= x[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - p) dq.shift();
    if (i >= p - 1) out[i] = x[dq[0]];
  }
  return out;
}

export function lowest(x: Arr, p: number): Arr {
  const out = nan(x.length);
  const dq: number[] = [];
  for (let i = 0; i < x.length; i++) {
    while (dq.length && x[dq[dq.length - 1]] >= x[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - p) dq.shift();
    if (i >= p - 1) out[i] = x[dq[0]];
  }
  return out;
}

export function trueRange(s: Series): Arr {
  const n = s.c.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? s.c[i - 1] : s.c[i];
    out[i] = Math.max(s.h[i] - s.l[i], Math.abs(s.h[i] - pc), Math.abs(s.l[i] - pc));
  }
  return out;
}

export const atr = (s: Series, p: number) => rma(trueRange(s), p);

export function rsi(x: Arr, p: number): Arr {
  const n = x.length, up = new Float64Array(n), dn = new Float64Array(n);
  up[0] = NaN; dn[0] = NaN;
  for (let i = 1; i < n; i++) { const d = x[i] - x[i - 1]; up[i] = Math.max(d, 0); dn[i] = Math.max(-d, 0); }
  const au = rma(up, p), ad = rma(dn, p), out = nan(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(au[i])) out[i] = ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]);
  return out;
}

export function bollinger(x: Arr, p: number, k: number) {
  const mid = sma(x, p), sd = stdev(x, p), n = x.length;
  const upper = nan(n), lower = nan(n), pctb = nan(n), width = nan(n);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(mid[i])) continue;
    upper[i] = mid[i] + k * sd[i]; lower[i] = mid[i] - k * sd[i];
    pctb[i] = sd[i] === 0 ? 0.5 : (x[i] - lower[i]) / (upper[i] - lower[i]);
    width[i] = mid[i] === 0 ? NaN : ((upper[i] - lower[i]) / mid[i]) * 100;
  }
  return { mid, upper, lower, pctb, width };
}

export function macd(x: Arr, fast: number, slow: number, sig: number) {
  const f = ema(x, fast), sl = ema(x, slow), n = x.length, line = nan(n);
  for (let i = 0; i < n; i++) line[i] = f[i] - sl[i];
  const signal = ema(line, sig), hist = nan(n);
  for (let i = 0; i < n; i++) hist[i] = line[i] - signal[i];
  return { line, signal, hist };
}

export function adx(s: Series, p: number) {
  const n = s.c.length, pdm = new Float64Array(n), mdm = new Float64Array(n);
  pdm[0] = NaN; mdm[0] = NaN;
  for (let i = 1; i < n; i++) {
    const up = s.h[i] - s.h[i - 1], dn = s.l[i - 1] - s.l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
  }
  const tr = trueRange(s); tr[0] = NaN;
  const trs = rma(tr, p), ps = rma(pdm, p), ms = rma(mdm, p);
  const pdi = nan(n), mdi = nan(n), dx = nan(n);
  for (let i = 0; i < n; i++) {
    if (!(trs[i] > 0)) continue;
    pdi[i] = (100 * ps[i]) / trs[i]; mdi[i] = (100 * ms[i]) / trs[i];
    const sum = pdi[i] + mdi[i];
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi[i] - mdi[i])) / sum;
  }
  return { adx: rma(dx, p), pdi, mdi };
}

export function stochastic(s: Series, kp: number, smooth: number, dp: number) {
  const hh = highest(s.h, kp), ll = lowest(s.l, kp), n = s.c.length, raw = nan(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(hh[i])) raw[i] = hh[i] === ll[i] ? 50 : ((s.c[i] - ll[i]) / (hh[i] - ll[i])) * 100;
  const k = smooth > 1 ? sma(raw, smooth) : raw;
  return { k, d: sma(k, dp) };
}

/** VWAP que reinicia todo dia às 00:00 UTC, com bandas de desvio. */
export function vwap(s: Series, k: number) {
  const n = s.c.length, v = nan(n), up = nan(n), lo = nan(n);
  let day = -1, pv = 0, vv = 0, p2v = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.floor(s.t[i] / 86400);
    if (d !== day) { day = d; pv = vv = p2v = 0; }
    const tp = (s.h[i] + s.l[i] + s.c[i]) / 3;
    pv += tp * s.v[i]; vv += s.v[i]; p2v += tp * tp * s.v[i];
    if (vv > 0) {
      v[i] = pv / vv;
      const sd = Math.sqrt(Math.max(p2v / vv - v[i] * v[i], 0));
      up[i] = v[i] + k * sd; lo[i] = v[i] - k * sd;
    }
  }
  return { vwap: v, upper: up, lower: lo };
}

export function donchian(s: Series, p: number) {
  // canal dos N candles ANTERIORES (não inclui o atual), para servir de rompimento
  const hh = highest(s.h, p), ll = lowest(s.l, p), n = s.c.length, upper = nan(n), lower = nan(n), mid = nan(n);
  for (let i = 1; i < n; i++) { upper[i] = hh[i - 1]; lower[i] = ll[i - 1]; mid[i] = (upper[i] + lower[i]) / 2; }
  return { upper, lower, mid };
}

export function supertrend(s: Series, p: number, mult: number) {
  const a = atr(s, p), n = s.c.length, line = nan(n), dir = nan(n);
  let up = NaN, dn = NaN, d = 1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    const hl2 = (s.h[i] + s.l[i]) / 2;
    const bu = hl2 - mult * a[i], bd = hl2 + mult * a[i];
    const pc = i > 0 ? s.c[i - 1] : s.c[i];
    up = Number.isNaN(up) || pc <= up ? bu : Math.max(bu, up);
    dn = Number.isNaN(dn) || pc >= dn ? bd : Math.min(bd, dn);
    if (d === 1 && s.c[i] < up) d = -1;
    else if (d === -1 && s.c[i] > dn) d = 1;
    dir[i] = d;
    line[i] = d === 1 ? up : dn;
  }
  return { line, dir };
}

export function obv(s: Series): Arr {
  const n = s.c.length, out = new Float64Array(n);
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + (s.c[i] > s.c[i - 1] ? s.v[i] : s.c[i] < s.c[i - 1] ? -s.v[i] : 0);
  return out;
}

export function cci(s: Series, p: number): Arr {
  const n = s.c.length, tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (s.h[i] + s.l[i] + s.c[i]) / 3;
  const m = sma(tp, p), out = nan(n);
  for (let i = p - 1; i < n; i++) {
    let md = 0;
    for (let k = 0; k < p; k++) md += Math.abs(tp[i - k] - m[i]);
    md /= p;
    out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md);
  }
  return out;
}

export function williamsR(s: Series, p: number): Arr {
  const hh = highest(s.h, p), ll = lowest(s.l, p), n = s.c.length, out = nan(n);
  for (let i = 0; i < n; i++) if (!Number.isNaN(hh[i])) out[i] = hh[i] === ll[i] ? -50 : ((hh[i] - s.c[i]) / (hh[i] - ll[i])) * -100;
  return out;
}

export function mfi(s: Series, p: number): Arr {
  const n = s.c.length, out = nan(n), tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (s.h[i] + s.l[i] + s.c[i]) / 3;
  let pos = 0, neg = 0;
  const pf = new Float64Array(n), nf = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const f = tp[i] * s.v[i];
    if (tp[i] > tp[i - 1]) pf[i] = f; else if (tp[i] < tp[i - 1]) nf[i] = f;
    pos += pf[i]; neg += nf[i];
    if (i > p) { pos -= pf[i - p]; neg -= nf[i - p]; }
    if (i >= p) out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

export function roc(x: Arr, p: number): Arr {
  const out = nan(x.length);
  for (let i = p; i < x.length; i++) out[i] = ((x[i] - x[i - p]) / x[i - p]) * 100;
  return out;
}

export function keltner(s: Series, p: number, mult: number, atrP: number) {
  const mid = ema(s.c, p), a = atr(s, atrP), n = s.c.length, upper = nan(n), lower = nan(n);
  for (let i = 0; i < n; i++) { upper[i] = mid[i] + mult * a[i]; lower[i] = mid[i] - mult * a[i]; }
  return { mid, upper, lower };
}

export function ichimoku(s: Series, conv: number, base: number, spanB: number, disp: number) {
  const n = s.c.length;
  const mid = (p: number) => { const hh = highest(s.h, p), ll = lowest(s.l, p), out = nan(n); for (let i = 0; i < n; i++) out[i] = (hh[i] + ll[i]) / 2; return out; };
  const tenkan = mid(conv), kijun = mid(base), sb = mid(spanB);
  const spanA = nan(n), spanBOut = nan(n);
  // as nuvens são desenhadas "disp" candles à frente: no candle i vale o que foi calculado em i - disp
  for (let i = disp; i < n; i++) { spanA[i] = (tenkan[i - disp] + kijun[i - disp]) / 2; spanBOut[i] = sb[i - disp]; }
  return { tenkan, kijun, spanA, spanB: spanBOut };
}

export function heikinAshiClose(s: Series): Arr {
  const n = s.c.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (s.o[i] + s.h[i] + s.l[i] + s.c[i]) / 4;
  return out;
}
