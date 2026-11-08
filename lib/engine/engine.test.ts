import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decode, type Series } from "./data";
import { align, prepare, run } from "./backtest";
import { backtest } from "./stats";
import { sma, ema, rsi, highest } from "./indicators";
import type { Strategy } from "./types";

function series(rows: [number, number, number, number][], tf = 300, t0 = 1_700_000_000 - (1_700_000_000 % 86400)): Series {
  const n = rows.length;
  const s: Series = { tf, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n).fill(1) };
  rows.forEach(([o, h, l, c], i) => { s.t[i] = t0 + i * tf; s.o[i] = o; s.h[i] = h; s.l[i] = l; s.c[i] = c; });
  return s;
}

function strat(over: Partial<Strategy> = {}): Strategy {
  return {
    name: "t", symbols: ["X"], tf: "5m", from: "", to: "", side: "long",
    indicators: [],
    entry: { order: "market", offsetPct: 0, validBars: 1, cooldownBars: 0,
      long: { mode: "all", items: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "num", value: 100.5 } }] } },
    stop: { type: "percent", value: 1, atrPeriod: 14, lookback: 5, bufferPct: 0, minPct: 0, maxPct: 50 },
    target: { type: "rr", value: 2 },
    exit: { maxBars: 0, trailing: { type: "none", value: 0 }, breakevenAtR: 0, partial: { atR: 0, fraction: 0.5 } },
    risk: { capital: 1000, riskPct: 1, maxPositionPct: 100, cashBufferPct: 0, maxOpen: 1, maxTradesDay: 0, maxLossDayPct: 0, minNotional: 1 },
    costs: { preset: "zero", takerPct: 0, makerPct: 0, slippagePct: 0 },
    validation: { testPct: 30, randomRuns: 0, monteCarloRuns: 0, seed: 1 },
    ...over,
  };
}

const flat = (k: number): [number, number, number, number][] => Array.from({ length: k }, () => [100, 100.2, 99.8, 100] as [number, number, number, number]);

test("indicadores básicos", () => {
  const x = Float64Array.from([1, 2, 3, 4, 5]);
  assert.deepEqual([...sma(x, 3)].slice(2), [2, 3, 4]);
  assert.ok(Number.isNaN(sma(x, 3)[1]));
  assert.equal(ema(x, 3)[2], 2);
  assert.equal(ema(x, 3)[3], 3);
  assert.deepEqual([...highest(Float64Array.from([3, 1, 2, 5, 4]), 2)].slice(1), [3, 2, 5, 5]);
  const up = rsi(Float64Array.from(Array.from({ length: 30 }, (_, i) => i)), 14);
  assert.equal(up[29], 100);
});

test("entrada a mercado na abertura seguinte e alvo de 2R", () => {
  // sinal no candle 3 (fecha 101); entra na abertura do 4 (101); stop 1% = 99.99; alvo 2R = 103.02
  const rows = [...flat(3), [100, 101, 100, 101], [101, 101.5, 100.5, 101.2], [101.2, 103.5, 101, 103]] as [number, number, number, number][];
  const s = series(rows);
  const st = strat();
  const r = run(st, prepare(st, { X: { "5m": s } }));
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.entryPrice, 101);
  assert.equal(t.reason, "target");
  assert.ok(Math.abs(t.exitPrice - 103.02) < 1e-9);
  assert.ok(Math.abs(t.r - 2) < 1e-9);
  assert.ok(Math.abs(t.riskUsd - 10) < 1e-9); // 1% de 1000
});

test("stop e alvo no mesmo candle: conta o stop", () => {
  const rows = [...flat(3), [100, 101, 100, 101], [101, 104, 99, 101]] as [number, number, number, number][];
  const st = strat();
  const r = run(st, prepare(st, { X: { "5m": series(rows) } }));
  assert.equal(r.trades[0].reason, "stop");
  assert.ok(Math.abs(r.trades[0].r + 1) < 1e-9);
});

test("abertura além do stop sai na abertura (perde mais que 1R)", () => {
  const rows = [...flat(3), [100, 101, 100, 101], [101, 101, 100.9, 101], [98, 99, 97, 98]] as [number, number, number, number][];
  const st = strat();
  const r = run(st, prepare(st, { X: { "5m": series(rows) } }));
  assert.equal(r.trades[0].exitPrice, 98);
  assert.ok(r.trades[0].r < -1);
});

test("taxas e slippage reduzem o resultado", () => {
  const rows = [...flat(3), [100, 101, 100, 101], [101, 101.5, 100.5, 101.2], [101.2, 103.5, 101, 103]] as [number, number, number, number][];
  const st = strat({ costs: { preset: "x", takerPct: 0.1, makerPct: 0.05, slippagePct: 0.02 } });
  const t = run(st, prepare(st, { X: { "5m": series(rows) } })).trades[0];
  assert.ok(Math.abs(t.entryPrice - 101 * 1.0002) < 1e-9);
  const expectedFees = t.qty * t.entryPrice * 0.001 + t.qty * t.exitPrice * 0.0005;
  assert.ok(Math.abs(t.feesUsd - expectedFees) < 1e-9);
  assert.ok(t.pnlUsd < t.grossUsd);
});

test("ordem limitada só executa se o preço passar do valor", () => {
  // sinal no 3 (fecha 101), limitada 0,5% abaixo = 100.495, válida 2 candles
  const st = strat({ entry: { ...strat().entry, order: "limit", offsetPct: 0.5, validBars: 2 } });
  const touch = [...flat(3), [100, 101, 100, 101], [101, 101, 100.495, 101], [101, 101, 100.6, 101]] as [number, number, number, number][];
  assert.equal(run(st, prepare(st, { X: { "5m": series(touch) } })).trades.length, 0);
  const through = [...flat(3), [100, 101, 100, 101], [101, 101, 100.4, 101], [101, 110, 100.6, 101]] as [number, number, number, number][];
  const tr = run(st, prepare(st, { X: { "5m": series(through) } })).trades;
  assert.equal(tr.length, 1);
  assert.ok(Math.abs(tr[0].entryPrice - 100.495) < 1e-9);
});

test("saída por condição executa na abertura seguinte", () => {
  const st = strat({ target: { type: "none", value: 0 },
    exit: { ...strat().exit, long: { mode: "all", items: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "num", value: 101.4 } }] } } });
  const rows = [...flat(3), [100, 101, 100, 101], [101, 101.6, 100.9, 101.5], [101.7, 102, 101.6, 101.8]] as [number, number, number, number][];
  const t = run(st, prepare(st, { X: { "5m": series(rows) } })).trades[0];
  assert.equal(t.reason, "exit");
  assert.equal(t.exitPrice, 101.7);
});

test("outro tempo gráfico: só usa o candle de 1h já fechado", () => {
  const base = series(Array.from({ length: 24 }, (_, i) => [i, i, i, i] as [number, number, number, number]), 300);
  const h1 = series([[0, 0, 0, 10], [0, 0, 0, 20]], 3600, base.t[0]);
  const a = align(base, h1, h1.c);
  assert.ok(Number.isNaN(a[10])); // a 1ª hora ainda não fechou no candle 10 (fecha às 55min)
  assert.equal(a[11], 10); // candle 11 fecha às 60min, junto com a 1ª hora
  assert.equal(a[23], 20);
});

test("banca: teto por posição limita o tamanho", () => {
  const rows = [...flat(3), [100, 101, 100, 101], [101, 101.5, 100.5, 101.2], [101.2, 103.5, 101, 103]] as [number, number, number, number][];
  const st = strat({ stop: { ...strat().stop, value: 0.2 }, risk: { ...strat().risk, maxPositionPct: 50 } });
  const t = run(st, prepare(st, { X: { "5m": series(rows) } })).trades[0];
  assert.ok(Math.abs(t.qty * t.entryPrice - 500) < 1e-6); // risco de 1% pediria US$ 5050; o teto de 50% corta para US$ 500
});

test("relatório completo roda e entradas aleatórias usam a mesma frequência", () => {
  const rows: [number, number, number, number][] = [];
  let p = 100;
  let seed = 3;
  for (let i = 0; i < 3000; i++) { seed = (seed * 16807) % 2147483647; const d = (seed / 2147483647 - 0.5) * 0.8; const o = p; p = p * (1 + d / 100); rows.push([o, Math.max(o, p) * 1.001, Math.min(o, p) * 0.999, p]); }
  const st = strat({ validation: { testPct: 30, randomRuns: 20, monteCarloRuns: 200, seed: 1 },
    entry: { ...strat().entry, long: { mode: "all", items: [{ left: { kind: "price", field: "close" }, op: "risingFor", right: { kind: "num", value: 0 }, n: 3 }] } } });
  const res = backtest(st, { X: { "5m": series(rows) } });
  assert.ok(res.metrics.trades > 20);
  assert.equal(res.train.trades + res.test.trades, res.metrics.trades);
  assert.ok(res.random && res.random.runs > 0);
  assert.ok(res.monteCarlo && res.monteCarlo.ddP95 >= res.monteCarlo.ddP50);
});

test("arquivo real gerado pelo pipeline decodifica com candles válidos", { skip: !existsSync("out/spot/BTCUSDT/1d/2024.bin.gz") }, () => {
  const raw = gunzipSync(readFileSync("out/spot/BTCUSDT/1d/2024.bin.gz"));
  const s = decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  assert.equal(s.t.length, 366);
  assert.equal(new Date(s.t[0] * 1000).toISOString(), "2024-01-01T00:00:00.000Z");
  for (let i = 0; i < s.t.length; i++) assert.ok(s.h[i] >= Math.max(s.o[i], s.c[i]) && s.l[i] <= Math.min(s.o[i], s.c[i]));
  assert.equal(s.o[0], 42283.58); // abertura oficial do BTCUSDT em 01/01/2024
});
