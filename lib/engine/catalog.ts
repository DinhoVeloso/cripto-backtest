// Catálogo de indicadores: o painel monta os formulários a partir daqui e o motor calcula por aqui.
import type { Series } from "./data";
import * as I from "./indicators";
import type { Source } from "./types";

type Arr = Float64Array;
export type Param = { key: string; label: string; default: number | string; min?: number; max?: number; step?: number; options?: string[] };
export type CatalogItem = {
  label: string;
  group: "Tendência" | "Osciladores" | "Volatilidade" | "Volume" | "Preço";
  params: Param[];
  outputs: { key: string; label: string }[];
  overlay: boolean; // desenha sobre o preço?
  calc: (s: Series, p: Record<string, number | string>) => Record<string, Arr>;
};

const SOURCES: Source[] = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"];
const src: Param = { key: "source", label: "Fonte", default: "close", options: SOURCES };
const period = (d: number, label = "Período"): Param => ({ key: "period", label, default: d, min: 1, max: 1000, step: 1 });
const num = (p: Record<string, number | string>, k: string) => Number(p[k]);

export function source(s: Series, f: Source | string): Arr {
  const n = s.c.length;
  switch (f) {
    case "open": return s.o;
    case "high": return s.h;
    case "low": return s.l;
    case "volume": return s.v;
    case "hl2": { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = (s.h[i] + s.l[i]) / 2; return o; }
    case "hlc3": { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = (s.h[i] + s.l[i] + s.c[i]) / 3; return o; }
    case "ohlc4": { const o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = (s.o[i] + s.h[i] + s.l[i] + s.c[i]) / 4; return o; }
    default: return s.c;
  }
}

export const CATALOG: Record<string, CatalogItem> = {
  sma: { label: "Média simples (MMS)", group: "Tendência", overlay: true, params: [period(20), src], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.sma(source(s, String(p.source)), num(p, "period")) }) },
  ema: { label: "Média exponencial (MME)", group: "Tendência", overlay: true, params: [period(20), src], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.ema(source(s, String(p.source)), num(p, "period")) }) },
  wma: { label: "Média ponderada (WMA)", group: "Tendência", overlay: true, params: [period(20), src], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.wma(source(s, String(p.source)), num(p, "period")) }) },
  bollinger: { label: "Bandas de Bollinger / %B", group: "Volatilidade", overlay: true,
    params: [period(20), { key: "mult", label: "Desvios", default: 2, min: 0.1, max: 10, step: 0.1 }, src],
    outputs: [{ key: "mid", label: "média" }, { key: "upper", label: "banda superior" }, { key: "lower", label: "banda inferior" }, { key: "pctb", label: "%B" }, { key: "width", label: "largura %" }],
    calc: (s, p) => I.bollinger(source(s, String(p.source)), num(p, "period"), num(p, "mult")) },
  keltner: { label: "Canal de Keltner", group: "Volatilidade", overlay: true,
    params: [period(20), { key: "mult", label: "Múltiplo ATR", default: 2, min: 0.1, max: 10, step: 0.1 }, { key: "atr", label: "Período ATR", default: 10, min: 1, max: 500, step: 1 }],
    outputs: [{ key: "mid", label: "média" }, { key: "upper", label: "superior" }, { key: "lower", label: "inferior" }],
    calc: (s, p) => I.keltner(s, num(p, "period"), num(p, "mult"), num(p, "atr")) },
  donchian: { label: "Canal de Donchian (rompimento)", group: "Tendência", overlay: true, params: [period(20)],
    outputs: [{ key: "upper", label: "máxima dos N anteriores" }, { key: "lower", label: "mínima dos N anteriores" }, { key: "mid", label: "meio" }],
    calc: (s, p) => I.donchian(s, num(p, "period")) },
  supertrend: { label: "Supertrend", group: "Tendência", overlay: true,
    params: [period(10, "Período ATR"), { key: "mult", label: "Múltiplo", default: 3, min: 0.1, max: 20, step: 0.1 }],
    outputs: [{ key: "line", label: "linha" }, { key: "dir", label: "direção (1 alta, -1 baixa)" }],
    calc: (s, p) => I.supertrend(s, num(p, "period"), num(p, "mult")) },
  ichimoku: { label: "Ichimoku", group: "Tendência", overlay: true,
    params: [{ key: "conv", label: "Tenkan", default: 9, min: 1, max: 500 }, { key: "base", label: "Kijun", default: 26, min: 1, max: 500 }, { key: "spanB", label: "Senkou B", default: 52, min: 1, max: 500 }, { key: "disp", label: "Deslocamento", default: 26, min: 0, max: 500 }],
    outputs: [{ key: "tenkan", label: "tenkan" }, { key: "kijun", label: "kijun" }, { key: "spanA", label: "nuvem A" }, { key: "spanB", label: "nuvem B" }],
    calc: (s, p) => I.ichimoku(s, num(p, "conv"), num(p, "base"), num(p, "spanB"), num(p, "disp")) },
  vwap: { label: "VWAP diária (com bandas)", group: "Volume", overlay: true, params: [{ key: "mult", label: "Desvios das bandas", default: 2, min: 0, max: 10, step: 0.1 }],
    outputs: [{ key: "vwap", label: "VWAP" }, { key: "upper", label: "banda superior" }, { key: "lower", label: "banda inferior" }],
    calc: (s, p) => I.vwap(s, num(p, "mult")) },
  highest: { label: "Máxima de N candles", group: "Preço", overlay: true, params: [period(20), { ...src, default: "high" }], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.highest(source(s, String(p.source)), num(p, "period")) }) },
  lowest: { label: "Mínima de N candles", group: "Preço", overlay: true, params: [period(20), { ...src, default: "low" }], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.lowest(source(s, String(p.source)), num(p, "period")) }) },
  rsi: { label: "IFR (RSI)", group: "Osciladores", overlay: false, params: [period(14), src], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.rsi(source(s, String(p.source)), num(p, "period")) }) },
  macd: { label: "MACD", group: "Osciladores", overlay: false,
    params: [{ key: "fast", label: "Rápida", default: 12, min: 1, max: 500 }, { key: "slow", label: "Lenta", default: 26, min: 1, max: 500 }, { key: "signal", label: "Sinal", default: 9, min: 1, max: 500 }, src],
    outputs: [{ key: "line", label: "linha" }, { key: "signal", label: "sinal" }, { key: "hist", label: "histograma" }],
    calc: (s, p) => I.macd(source(s, String(p.source)), num(p, "fast"), num(p, "slow"), num(p, "signal")) },
  stoch: { label: "Estocástico", group: "Osciladores", overlay: false,
    params: [period(14, "%K"), { key: "smooth", label: "Suavização", default: 3, min: 1, max: 100 }, { key: "d", label: "%D", default: 3, min: 1, max: 100 }],
    outputs: [{ key: "k", label: "%K" }, { key: "d", label: "%D" }],
    calc: (s, p) => I.stochastic(s, num(p, "period"), num(p, "smooth"), num(p, "d")) },
  adx: { label: "ADX / DMI", group: "Tendência", overlay: false, params: [period(14)],
    outputs: [{ key: "adx", label: "ADX" }, { key: "pdi", label: "+DI" }, { key: "mdi", label: "-DI" }],
    calc: (s, p) => I.adx(s, num(p, "period")) },
  cci: { label: "CCI", group: "Osciladores", overlay: false, params: [period(20)], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.cci(s, num(p, "period")) }) },
  willr: { label: "Williams %R", group: "Osciladores", overlay: false, params: [period(14)], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.williamsR(s, num(p, "period")) }) },
  mfi: { label: "MFI (fluxo de dinheiro)", group: "Volume", overlay: false, params: [period(14)], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.mfi(s, num(p, "period")) }) },
  roc: { label: "Variação % (ROC)", group: "Osciladores", overlay: false, params: [period(12), src], outputs: [{ key: "value", label: "%" }],
    calc: (s, p) => ({ value: I.roc(source(s, String(p.source)), num(p, "period")) }) },
  atr: { label: "ATR", group: "Volatilidade", overlay: false, params: [period(14)],
    outputs: [{ key: "value", label: "valor" }, { key: "pct", label: "% do preço" }],
    calc: (s, p) => { const a = I.atr(s, num(p, "period")); const pct = new Float64Array(a.length); for (let i = 0; i < a.length; i++) pct[i] = (a[i] / s.c[i]) * 100; return { value: a, pct }; } },
  stdev: { label: "Desvio padrão", group: "Volatilidade", overlay: false, params: [period(20), src], outputs: [{ key: "value", label: "valor" }],
    calc: (s, p) => ({ value: I.stdev(source(s, String(p.source)), num(p, "period")) }) },
  volsma: { label: "Volume e média de volume", group: "Volume", overlay: false, params: [period(20)],
    outputs: [{ key: "volume", label: "volume" }, { key: "avg", label: "média" }, { key: "ratio", label: "volume / média" }],
    calc: (s, p) => {
      const n = s.v.length, per = num(p, "period"), avg = new Float64Array(n).fill(NaN), ratio = new Float64Array(n).fill(NaN);
      const m = I.sma(s.v, per);
      for (let i = 1; i < n; i++) { avg[i] = m[i - 1]; ratio[i] = avg[i] > 0 ? s.v[i] / avg[i] : NaN; } // média dos N ANTERIORES
      return { volume: s.v, avg, ratio };
    } },
  obv: { label: "OBV", group: "Volume", overlay: false, params: [], outputs: [{ key: "value", label: "valor" }], calc: (s) => ({ value: I.obv(s) }) },
  candle: { label: "Candle (corpo, pavios, cor)", group: "Preço", overlay: false, params: [],
    outputs: [{ key: "bodyPct", label: "corpo % do preço" }, { key: "rangePct", label: "amplitude %" }, { key: "upperWickPct", label: "pavio superior % da amplitude" }, { key: "lowerWickPct", label: "pavio inferior % da amplitude" }, { key: "color", label: "cor (1 alta, -1 baixa)" }, { key: "haClose", label: "fechamento Heikin-Ashi" }],
    calc: (s) => {
      const n = s.c.length, bodyPct = new Float64Array(n), rangePct = new Float64Array(n), up = new Float64Array(n), lo = new Float64Array(n), color = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const rng = s.h[i] - s.l[i];
        bodyPct[i] = (Math.abs(s.c[i] - s.o[i]) / s.o[i]) * 100;
        rangePct[i] = (rng / s.o[i]) * 100;
        up[i] = rng ? ((s.h[i] - Math.max(s.o[i], s.c[i])) / rng) * 100 : 0;
        lo[i] = rng ? ((Math.min(s.o[i], s.c[i]) - s.l[i]) / rng) * 100 : 0;
        color[i] = s.c[i] > s.o[i] ? 1 : s.c[i] < s.o[i] ? -1 : 0;
      }
      return { bodyPct, rangePct, upperWickPct: up, lowerWickPct: lo, color, haClose: I.heikinAshiClose(s) };
    } },
  sessionRange: { label: "Faixa do início do dia (ORB)", group: "Preço", overlay: true,
    params: [{ key: "minutes", label: "Minutos após 00:00 UTC", default: 15, min: 1, max: 1440 }],
    outputs: [{ key: "high", label: "máxima da faixa" }, { key: "low", label: "mínima da faixa" }],
    calc: (s, p) => {
      const n = s.c.length, mins = num(p, "minutes") * 60, high = new Float64Array(n).fill(NaN), low = new Float64Array(n).fill(NaN);
      let day = -1, hi = -Infinity, lo = Infinity, done = false;
      for (let i = 0; i < n; i++) {
        const d = Math.floor(s.t[i] / 86400);
        if (d !== day) { day = d; hi = -Infinity; lo = Infinity; done = false; }
        const closeIn = s.t[i] + s.tf - d * 86400; // fim do candle, em segundos do dia
        if (!done && s.t[i] - d * 86400 < mins) { hi = Math.max(hi, s.h[i]); lo = Math.min(lo, s.l[i]); if (closeIn >= mins) done = true; continue; }
        if (done) { high[i] = hi; low[i] = lo; }
      }
      return { high, low };
    } },
};

export function defaultParams(type: string): Record<string, number | string> {
  return Object.fromEntries(CATALOG[type].params.map((p) => [p.key, p.default]));
}
