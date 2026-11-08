// Estratégia padrão, modelos prontos e tabelas de custo das corretoras.
import type { Cond, Operand, Strategy } from "./types";

export const FEE_PRESETS: Record<string, { label: string; takerPct: number; makerPct: number; slippagePct: number }> = {
  binance_spot: { label: "Binance spot (0,1%)", takerPct: 0.1, makerPct: 0.1, slippagePct: 0.01 },
  binance_spot_bnb: { label: "Binance spot pagando em BNB (0,075%)", takerPct: 0.075, makerPct: 0.075, slippagePct: 0.01 },
  hyperliquid_spot: { label: "Hyperliquid spot", takerPct: 0.07, makerPct: 0.04, slippagePct: 0.02 },
  okx_spot: { label: "OKX spot", takerPct: 0.1, makerPct: 0.08, slippagePct: 0.01 },
  bybit_spot: { label: "Bybit spot", takerPct: 0.1, makerPct: 0.1, slippagePct: 0.01 },
  mercado_bitcoin: { label: "Mercado Bitcoin", takerPct: 0.7, makerPct: 0.3, slippagePct: 0.05 },
  zero: { label: "Sem custos (só para comparar)", takerPct: 0, makerPct: 0, slippagePct: 0 },
};

const ind = (ref: string, out = "value", shift = 0): Operand => ({ kind: "ind", ref, out, ...(shift ? { shift } : {}) });
const close: Operand = { kind: "price", field: "close" };
const n = (value: number): Operand => ({ kind: "num", value });
const c = (left: Operand, op: Cond["op"], right: Operand, k?: number): Cond => ({ left, op, right, ...(k ? { n: k } : {}) });

const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const yearsAgo = (y: number) => { const d = new Date(today); d.setUTCFullYear(d.getUTCFullYear() - y); return iso(d); };

export const BASE: Strategy = {
  name: "Nova estratégia",
  symbols: ["BTCUSDT"],
  tf: "1h",
  from: yearsAgo(5),
  to: iso(today),
  side: "long",
  indicators: [],
  entry: { order: "market", offsetPct: 0, validBars: 3, cooldownBars: 0, long: { mode: "all", items: [] } },
  stop: { type: "percent", value: 2, atrPeriod: 14, lookback: 5, bufferPct: 0, minPct: 0.3, maxPct: 10 },
  target: { type: "rr", value: 2 },
  exit: { maxBars: 0, trailing: { type: "none", value: 0 }, breakevenAtR: 0, partial: { atR: 0, fraction: 0.5 } },
  risk: { capital: 100, riskPct: 1, maxPositionPct: 75, cashBufferPct: 10, maxOpen: 3, maxTradesDay: 0, maxLossDayPct: 0, minNotional: 5 },
  costs: { preset: "binance_spot", ...pick(FEE_PRESETS.binance_spot) },
  validation: { testPct: 30, randomRuns: 30, monteCarloRuns: 1000, seed: 42 },
};

function pick(p: { takerPct: number; makerPct: number; slippagePct: number }) {
  return { takerPct: p.takerPct, makerPct: p.makerPct, slippagePct: p.slippagePct };
}

const make = (over: Partial<Strategy>): Strategy => ({ ...structuredClone(BASE), ...over });

export const TEMPLATES: Record<string, { label: string; about: string; strategy: Strategy }> = {
  pctb: {
    label: "%B 20/2: volta para dentro da banda",
    about: "Compra quando o %B fecha abaixo de 0 e o candle seguinte fecha de volta acima de 0. Stop na mínima dos últimos 5 candles; alvo na média de 20. Já testamos: sem filtro, perde em 5m.",
    strategy: make({
      name: "%B reentrada", tf: "5m",
      indicators: [{ id: "bb", type: "bollinger", params: { period: 20, mult: 2, source: "close" } }],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(ind("bb", "pctb"), "crossAbove", n(0))] } },
      stop: { ...BASE.stop, type: "swing", lookback: 5, minPct: 0.6, maxPct: 5 },
      target: { type: "indicator", value: 0, operand: ind("bb", "mid") },
      exit: { ...BASE.exit, maxBars: 288 },
    }),
  },
  pctb_trend: {
    label: "%B com tendência de 1h e ADX",
    about: "O %B acima, só quando o gráfico de 1h está em alta (EMA50 > EMA200) e o ADX de 5m está abaixo de 25 — a melhor combinação dos nossos testes.",
    strategy: make({
      name: "%B + tendência 1h + ADX", tf: "5m",
      indicators: [
        { id: "bb", type: "bollinger", params: { period: 20, mult: 2, source: "close" } },
        { id: "ema50h", type: "ema", params: { period: 50, source: "close" }, tf: "1h" },
        { id: "ema200h", type: "ema", params: { period: 200, source: "close" }, tf: "1h" },
        { id: "adx", type: "adx", params: { period: 14 } },
      ],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(ind("bb", "pctb"), "crossAbove", n(0)), c(ind("ema50h"), ">", ind("ema200h")), c(ind("adx", "adx"), "<", n(25))] } },
      stop: { ...BASE.stop, type: "swing", lookback: 5, minPct: 0.6, maxPct: 5 },
      target: { type: "indicator", value: 0, operand: ind("bb", "mid") },
      exit: { ...BASE.exit, maxBars: 288 },
    }),
  },
  bb3: {
    label: "Bollinger 3 desvios (reversão à média)",
    about: "Candle fecha abaixo da banda inferior de 3 desvios; compra no rompimento da máxima desse candle (ordem stop válida por 5 candles). Stop na mínima recente; alvo na média.",
    strategy: make({
      name: "Bollinger 3σ", tf: "1h",
      indicators: [{ id: "bb", type: "bollinger", params: { period: 20, mult: 3, source: "close" } }],
      entry: { ...BASE.entry, order: "stop", validBars: 5, long: { mode: "all", items: [c(close, "<", ind("bb", "lower"))] } },
      stop: { ...BASE.stop, type: "swing", lookback: 3, minPct: 0.6, maxPct: 10 },
      target: { type: "indicator", value: 0, operand: ind("bb", "mid") },
      exit: { ...BASE.exit, maxBars: 72 },
    }),
  },
  orb: {
    label: "Rompimento da faixa de abertura (ORB)",
    about: "Faixa dos primeiros 15 minutos do dia (UTC). Compra quando um candle fecha acima da máxima da faixa; stop na mínima da faixa; alvo 2R.",
    strategy: make({
      name: "ORB 15 min", tf: "5m",
      indicators: [{ id: "or", type: "sessionRange", params: { minutes: 15 } }],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(close, "crossAbove", ind("or", "high"))] } },
      stop: { ...BASE.stop, type: "indicator", operand: ind("or", "low"), minPct: 0.6, maxPct: 3 },
      target: { type: "rr", value: 2 },
      exit: { ...BASE.exit, maxBars: 48 },
      risk: { ...BASE.risk, maxTradesDay: 5 },
    }),
  },
  donchian: {
    label: "Rompimento de 20 candles com filtro",
    about: "Fecha acima da máxima dos 20 candles anteriores, com preço acima da EMA200 e volume 1,5x a média. Stop na mínima dos últimos 5; alvo 2R.",
    strategy: make({
      name: "Rompe 20 + EMA200 + volume", tf: "15m",
      indicators: [
        { id: "dc", type: "donchian", params: { period: 20 } },
        { id: "ema200", type: "ema", params: { period: 200, source: "close" } },
        { id: "vol", type: "volsma", params: { period: 20 } },
      ],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(close, ">", ind("dc", "upper")), c(close, ">", ind("ema200")), c(ind("vol", "ratio"), ">=", n(1.5))] } },
      stop: { ...BASE.stop, type: "swing", lookback: 5, minPct: 0.6, maxPct: 3 },
      target: { type: "rr", value: 2 },
      exit: { ...BASE.exit, maxBars: 96 },
    }),
  },
  trend_rsi: {
    label: "Recuo em tendência (IFR) no 4h",
    about: "Em tendência de alta diária (preço acima da EMA200 do diário), compra quando o IFR(14) de 4h cruza 35 para cima. Stop de 2 ATR; saída móvel de 3 ATR.",
    strategy: make({
      name: "Recuo em tendência", tf: "4h",
      indicators: [
        { id: "rsi", type: "rsi", params: { period: 14, source: "close" } },
        { id: "ema200d", type: "ema", params: { period: 200, source: "close" }, tf: "1d" },
      ],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(ind("rsi"), "crossAbove", n(35)), c(close, ">", ind("ema200d"))] } },
      stop: { ...BASE.stop, type: "atr", value: 2, atrPeriod: 14, minPct: 0.5, maxPct: 20 },
      target: { type: "none", value: 0 },
      exit: { ...BASE.exit, trailing: { type: "atr", value: 3 } },
    }),
  },
  supertrend: {
    label: "Supertrend no diário (seguidor de tendência)",
    about: "Compra quando o Supertrend(10, 3) vira para alta e vende quando vira para baixa. Stop inicial de 3 ATR.",
    strategy: make({
      name: "Supertrend", tf: "1d",
      indicators: [{ id: "st", type: "supertrend", params: { period: 10, mult: 3 } }],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(ind("st", "dir"), "crossAbove", n(0))] } },
      stop: { ...BASE.stop, type: "atr", value: 3, atrPeriod: 10, minPct: 0.5, maxPct: 40 },
      target: { type: "none", value: 0 },
      exit: { ...BASE.exit, long: { mode: "all", items: [c(ind("st", "dir"), "crossBelow", n(0))] } },
    }),
  },
  macd: {
    label: "Cruzamento do MACD acima da EMA200",
    about: "Linha do MACD cruza a linha de sinal para cima abaixo de zero, com preço acima da EMA200. Stop de 1,5 ATR; alvo 2R.",
    strategy: make({
      name: "MACD + EMA200", tf: "1h",
      indicators: [
        { id: "macd", type: "macd", params: { fast: 12, slow: 26, signal: 9, source: "close" } },
        { id: "ema200", type: "ema", params: { period: 200, source: "close" } },
      ],
      entry: { ...BASE.entry, long: { mode: "all", items: [c(ind("macd", "line"), "crossAbove", ind("macd", "signal")), c(ind("macd", "line"), "<", n(0)), c(close, ">", ind("ema200"))] } },
      stop: { ...BASE.stop, type: "atr", value: 1.5, atrPeriod: 14, minPct: 0.4, maxPct: 10 },
      target: { type: "rr", value: 2 },
    }),
  },
};
