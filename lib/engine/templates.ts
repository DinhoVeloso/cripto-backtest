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
const monthsAgo = (m: number) => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - m); return iso(d); };

export const BASE: Strategy = {
  name: "Nova estratégia",
  symbols: ["BTCUSDT"],
  tf: "5m",
  from: monthsAgo(6),
  to: iso(today),
  side: "both",
  indicators: [],
  entry: { order: "market", offsetPct: 0, validBars: 3, cooldownBars: 0, long: { mode: "all", items: [] } },
  stop: { type: "percent", value: 2, atrPeriod: 14, lookback: 5, bufferPct: 0, minPct: 0.3, maxPct: 10 },
  target: { type: "rr", value: 2 },
  exit: { maxBars: 0, trailing: { type: "none", value: 0 }, breakevenAtR: 0, partial: { atR: 0, fraction: 0.5 } },
  risk: { capital: 100, riskPct: 1, maxPositionPct: 75, cashBufferPct: 10, maxOpen: 3, maxTradesDay: 0, maxLossDayPct: 0, minNotional: 5 },
  costs: { preset: "binance_spot", ...pick(FEE_PRESETS.binance_spot) },
  validation: { testPct: 30, randomRuns: 30, monteCarloRuns: 1000, seed: 42 },
  binary: { payoutPct: 85, stakeMode: "fixed", stake: 2, allowOverlap: false },
};

function pick(p: { takerPct: number; makerPct: number; slippagePct: number }) {
  return { takerPct: p.takerPct, makerPct: p.makerPct, slippagePct: p.slippagePct };
}

const make = (over: Partial<Strategy>): Strategy => ({ ...structuredClone(BASE), ...over });

const px = (field: "open" | "high" | "low" | "close"): Operand => ({ kind: "price", field });
const grp = (...items: Cond[]) => ({ mode: "all" as const, items });

// Todas as estratégias são de opções binárias: entry.long = "sobe", entry.short = "desce".
export const TEMPLATES: Record<string, { label: string; about: string; strategy: Strategy }> = {
  donchian_touch: {
    label: "Donchian: toque nas bordas (reversão)",
    about: "Toca a borda superior do canal de Donchian(20) -> desce; toca a inferior -> sobe. A aposta vale pela cor do candle seguinte. Se errar, para de apostar até o preço voltar ao meio do canal e tocar uma borda de novo.",
    strategy: make({
      name: "Donchian toque", tf: "5m",
      indicators: [{ id: "dc", type: "donchian", params: { period: 20 } }],
      entry: { ...BASE.entry, long: grp(c(px("low"), "<=", ind("dc", "lower"))), short: grp(c(px("high"), ">=", ind("dc", "upper"))) },
      binary: {
        ...BASE.binary,
        rearm: grp(c(px("low"), "<=", ind("dc", "mid")), c(px("high"), ">=", ind("dc", "mid"))),
      },
    }),
  },
  donchian_touch_free: {
    label: "Donchian: toque nas bordas (sem pausa após perda)",
    about: "Igual ao anterior, mas continua apostando depois de uma perda. Serve para ver quanto a regra de pausa ajuda ou atrapalha.",
    strategy: make({
      name: "Donchian toque sem pausa", tf: "5m",
      indicators: [{ id: "dc", type: "donchian", params: { period: 20 } }],
      entry: { ...BASE.entry, long: grp(c(px("low"), "<=", ind("dc", "lower"))), short: grp(c(px("high"), ">=", ind("dc", "upper"))) },
    }),
  },
  bb_touch: {
    label: "Bollinger 20/2: toque nas bandas (reversão)",
    about: "Toca a banda superior -> desce; toca a inferior -> sobe. Usa a banda do candle anterior (a do candle atual já conteria o fechamento dele). Pausa depois de uma perda até tocar a média.",
    strategy: make({
      name: "Bollinger toque", tf: "5m",
      indicators: [{ id: "bb", type: "bollinger", params: { period: 20, mult: 2, source: "close" } }],
      entry: { ...BASE.entry, long: grp(c(px("low"), "<=", ind("bb", "lower", 1))), short: grp(c(px("high"), ">=", ind("bb", "upper", 1))) },
      binary: {
        ...BASE.binary,
        rearm: grp(c(px("low"), "<=", ind("bb", "mid", 1)), c(px("high"), ">=", ind("bb", "mid", 1))),
      },
    }),
  },
  rsi_extreme: {
    label: "IFR extremo: sobe abaixo de 30, desce acima de 70",
    about: "Avalia no fechamento do candle: IFR(14) abaixo de 30 -> sobe; acima de 70 -> desce.",
    strategy: make({
      name: "IFR extremo", tf: "5m",
      indicators: [{ id: "rsi", type: "rsi", params: { period: 14, source: "close" } }],
      entry: { ...BASE.entry, long: grp(c(ind("rsi"), "<", n(30))), short: grp(c(ind("rsi"), ">", n(70))) },
    }),
  },
  streak3: {
    label: "3 candles seguidos na mesma direção (reversão)",
    about: "Depois de 3 fechamentos seguidos de queda -> sobe; depois de 3 de alta -> desce. Entra no fechamento.",
    strategy: make({
      name: "Sequência de 3", tf: "1m",
      entry: { ...BASE.entry, long: grp(c(close, "fallingFor", close, 3)), short: grp(c(close, "risingFor", close, 3)) },
    }),
  },
};
