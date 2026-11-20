import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decode, type Series } from "./data";
import { align, prepare, run } from "./backtest";
import { backtest } from "./stats";
import { sma, ema, rsi, highest } from "./indicators";
import type { Strategy } from "./types";
import { breakEvenPct, prepareBinary, randomBaselineBinary, runBinary, summarizeBinary } from "./binary";
import { TEMPLATES } from "./templates";

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
    binary: { payoutPct: 80, stakeMode: "fixed", stake: 10, allowOverlap: false },
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

// ---------- opções binárias: resultado = cor do candle seguinte ----------
const num = (value: number) => ({ kind: "num" as const, value });
const px = (field: "open" | "high" | "low" | "close") => ({ kind: "price" as const, field });
const entryOf = (over: Partial<Strategy["entry"]>): Strategy["entry"] => ({ order: "market", offsetPct: 0, validBars: 1, cooldownBars: 0, ...over });
const bin = (rows: [number, number, number, number][], over: Partial<Strategy>) => {
  const st = strat({ side: "both", ...over });
  const prepared = prepareBinary(st, { X: { "5m": series(rows) } });
  return { st, prepared, res: runBinary(st, prepared[0]) };
};

test("binárias: 'sobe' ganha com candle verde; vermelho e candle sem corpo perdem; aposta aberta bloqueia a seguinte", () => {
  const rows: [number, number, number, number][] = [
    ...flat(3),
    [100, 101, 100, 101], // 3: sinal (fecha > 100.5) -> aposta vale para o candle 4
    [101, 102, 101, 101], // 4: abre 101 e fecha 101 (sem corpo): perde -10. Tem sinal, mas a aposta do 3 ainda estava aberta: ignorado
    [101, 101, 100, 100.2], // 5: sem sinal
    [100.2, 101.5, 100, 101.5], // 6: sinal -> candle 7
    [101.5, 101.6, 100.5, 101], // 7: vermelho: perde -10 (preço de fechamento do 7 ainda acima do 100.5 do sinal: o preço de entrada não conta)
    ...flat(1),
    [100, 101, 100, 101], // 9: sinal -> candle 10
    [101, 103, 101, 102.5], // 10: verde: ganha +8
    ...flat(1),
  ];
  const { res } = bin(rows, { entry: entryOf({ long: { mode: "all", items: [{ left: px("close"), op: ">", right: num(100.5) }] } }) });
  assert.deepEqual(res.trades.map((t) => t.reason), ["loss", "loss", "win"]);
  assert.deepEqual(res.trades.map((t) => t.pnlUsd), [-10, -10, 8]);
  assert.equal(res.trades[2].equityAfter, 988);
  assert.equal(res.skipped["aposta anterior ainda aberta"], 3);
});

test("binárias: 'desce' ganha com candle vermelho e perde com verde", () => {
  const rows: [number, number, number, number][] = [
    ...flat(2),
    [100, 106, 99, 103], // 2: máxima >= 105: aposta desce -> candle 3
    [104, 104, 103, 103.5], // 3: vermelho (fecha abaixo da abertura): ganha +8
    ...flat(1),
    [107, 108, 106, 107.5], // 5: aposta desce -> candle 6
    [107.5, 109, 107, 108.5], // 6: verde: perde -10
    ...flat(2),
  ];
  const { res } = bin(rows, { entry: entryOf({ short: { mode: "all", items: [{ left: px("high"), op: ">=", right: num(105) }] } }) });
  assert.deepEqual(res.trades.map((t) => [t.side, t.reason]), [[-1, "win"], [-1, "loss"]]);
  assert.deepEqual(res.trades.map((t) => [t.entryPrice, t.exitPrice]), [[104, 103.5], [107.5, 108.5]]); // abre -> fecha do candle do resultado
  assert.deepEqual(res.trades.map((t) => t.pnlUsd), [8, -10]);
});

test("binárias: depois de perder, só volta a apostar depois de cumprir a regra de rearme", () => {
  const rows: [number, number, number, number][] = [
    ...flat(1),
    [100, 100, 98.5, 99.5], // 1: mínima <= 99: aposta sobe -> candle 2
    [99.5, 99.6, 98, 98.5], // 2: vermelho: perde; pausa
    [98.5, 98.6, 98, 98.2], // 3: pausado (teria sinal)
    [98.2, 100.5, 98, 100.2], // 4: máxima >= 100: rearma (neste candle não aposta)
    [100, 100, 98.9, 99.5], // 5: mínima <= 99: aposta -> candle 6
    [99.5, 101, 99.4, 101], // 6: verde: ganha
    ...flat(2),
  ];
  const long = { mode: "all" as const, items: [{ left: px("low"), op: "<=" as const, right: num(99) }] };
  const rearm = { mode: "all" as const, items: [{ left: px("high"), op: ">=" as const, right: num(100) }] };
  const st = strat({ side: "both", entry: entryOf({ long }), binary: { payoutPct: 80, stakeMode: "fixed", stake: 10, allowOverlap: false, rearm } });
  const s = series(rows);
  const res = runBinary(st, prepareBinary(st, { X: { "5m": s } })[0]);
  assert.deepEqual(res.trades.map((t) => t.reason), ["loss", "win"]);
  assert.equal(res.trades[1].entryTime, s.t[5]);
  const free = { ...st, binary: { ...st.binary, rearm: undefined } };
  assert.ok(runBinary(free, prepareBinary(free, { X: { "5m": s } })[0]).trades.length > res.trades.length); // sem a pausa o candle 3 também teria aposta
});

test("binárias: acerto mínimo para empatar", () => {
  assert.ok(Math.abs(breakEvenPct(85) - 54.054) < 0.01);
  assert.equal(breakEvenPct(100), 50);
});

test("binárias: modelo Donchian roda de ponta a ponta e o resultado é sempre a cor do candle seguinte", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let p = 100;
  const rows: [number, number, number, number][] = Array.from({ length: 3000 }, () => {
    const o = p, c = o * (1 + (rnd() - 0.5) * 0.01), h = Math.max(o, c) * (1 + rnd() * 0.002), l = Math.min(o, c) * (1 - rnd() * 0.002);
    p = c; return [o, h, l, c];
  });
  const s = series(rows);
  const st = { ...structuredClone(TEMPLATES.donchian_touch.strategy), symbols: ["X"], tf: "5m" };
  st.validation = { testPct: 30, randomRuns: 20, monteCarloRuns: 200, seed: 3 };
  const prepared = prepareBinary(st, { X: { "5m": s } });
  const res = summarizeBinary(st, prepared);
  res.random = randomBaselineBinary(st, prepared, res);
  assert.ok(res.trades.length > 20, `apostas: ${res.trades.length}`);
  assert.ok(res.random && res.random.runs > 0);
  const idx = new Map(Array.from(s.t).map((t, i) => [t, i]));
  let bank = st.risk.capital;
  for (const t of res.trades) {
    const i = idx.get(t.entryTime)!; // candle do sinal; o resultado é o candle i+1
    const green = s.c[i + 1] > s.o[i + 1], red = s.c[i + 1] < s.o[i + 1];
    assert.equal(t.reason, (t.side === 1 && green) || (t.side === -1 && red) ? "win" : "loss");
    assert.equal(t.exitTime, s.t[i + 1]);
    bank += t.pnlUsd;
  }
  assert.ok(Math.abs(bank - res.trades[res.trades.length - 1].equityAfter) < 1e-6);
  assert.ok(Math.abs(res.metrics.winRate - (res.trades.filter((t) => t.pnlUsd > 0).length / res.trades.length) * 100) < 1e-9);
});
