import { prepare, run, type DataSet, type Prepared } from "./backtest";
import type { Metrics, Result, Strategy, Trade } from "./types";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const sd = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(q * (b.length - 1))))]; };

export function metrics(trades: Trade[], equity: { t: number; v: number }[], capital: number, exposurePct = 0): Metrics {
  const r = trades.map((t) => t.r);
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const gains = trades.reduce((s, t) => s + Math.max(t.pnlUsd, 0), 0), losses = -trades.reduce((s, t) => s + Math.min(t.pnlUsd, 0), 0);
  const se = r.length ? sd(r) / Math.sqrt(r.length) : 0;
  let peak = capital, dd = 0;
  for (const p of equity) { peak = Math.max(peak, p.v); dd = Math.max(dd, peak > 0 ? (peak - p.v) / peak : 0); }
  const last = equity.length ? equity[equity.length - 1].v : capital;
  const years = equity.length > 1 ? (equity[equity.length - 1].t - equity[0].t) / (365.25 * 86400) : 0;
  const daily: number[] = [];
  for (let i = 1; i < equity.length; i++) if (equity[i - 1].v > 0) daily.push(equity[i].v / equity[i - 1].v - 1);
  let streak = 0, worst = 0;
  for (const t of trades) { streak = t.pnlUsd < 0 ? streak + 1 : 0; worst = Math.max(worst, streak); }
  const net = trades.reduce((s, t) => s + t.pnlUsd, 0);
  return {
    trades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    avgR: mean(r), ciLow: mean(r) - 1.96 * se, ciHigh: mean(r) + 1.96 * se,
    totalR: r.reduce((s, x) => s + x, 0),
    profitFactor: losses > 0 ? gains / losses : gains > 0 ? Infinity : 0,
    netUsd: net,
    returnPct: ((last - capital) / capital) * 100,
    cagrPct: years > 0.1 && last > 0 ? ((last / capital) ** (1 / years) - 1) * 100 : NaN,
    maxDdPct: dd * 100,
    sharpe: sd(daily) > 0 ? (mean(daily) / sd(daily)) * Math.sqrt(365) : 0,
    feesUsd: trades.reduce((s, t) => s + t.feesUsd, 0),
    grossUsd: trades.reduce((s, t) => s + t.grossUsd, 0),
    avgBars: mean(trades.map((t) => t.bars)),
    expectancyUsd: trades.length ? net / trades.length : 0,
    bestR: r.length ? Math.max(...r) : 0,
    worstR: r.length ? Math.min(...r) : 0,
    maxLosingStreak: worst,
    exposurePct,
  };
}

/** Curva aproximada a partir das operações (para recortes de período e por par). */
function curveFrom(trades: Trade[], capital: number) {
  let v = capital;
  return trades.map((t) => ({ t: t.exitTime, v: (v += t.pnlUsd) }));
}

/** Backtest completo de uma vez (usado nos testes e no bench). No navegador, use summarize + randomBaseline. */
export function backtest(st: Strategy, data: DataSet): Result {
  const t0 = performance.now();
  const prepared = prepare(st, data);
  if (!prepared.length) throw new Error("nenhum par com dados no período");
  const res = summarize(st, prepared, t0);
  res.random = randomBaseline(st, prepared, res);
  addRandomWarning(res);
  res.ms = performance.now() - t0;
  return res;
}

/** Entradas aleatórias com a mesma frequência de sinais e as mesmas saídas, custos e banca. */
export function randomBaseline(st: Strategy, prepared: Prepared[], res: Result, start?: number): Result["random"] {
  const runs = Math.max(0, Math.min(st.validation.randomRuns, 200));
  const s0 = start ?? -Infinity;
  const bars = prepared.reduce((s, p) => s + p.s.t.filter((t) => t >= s0).length, 0);
  if (runs === 0 || res.signals === 0 || bars === 0) return undefined;
  const prob = res.signals / bars;
  const avgs: number[] = [];
  for (let k = 0; k < runs; k++) {
    const rr = run(st, prepared, { randomEntries: { prob, seed: st.validation.seed + k * 7919 }, start });
    if (rr.trades.length) avgs.push(mean(rr.trades.map((t) => t.r)));
  }
  const mine = res.metrics.avgR;
  return { avgR: mean(avgs), p5: pct(avgs, 0.05), p95: pct(avgs, 0.95), runs: avgs.length, beatPct: avgs.length ? (avgs.filter((a) => mine > a).length / avgs.length) * 100 : NaN };
}

export function addRandomWarning(res: Result) {
  const r = res.random;
  if (r && res.metrics.trades && r.beatPct < 95) res.warnings.push(`A estratégia superou só ${r.beatPct.toFixed(0)}% das rodadas com entradas aleatórias (o ideal é 95% ou mais).`);
}

export function summarize(st: Strategy, prepared: Prepared[], t0 = performance.now(), start?: number): Result {
  const main = run(st, prepared, { start });
  const trades = main.trades;
  const cap = st.risk.capital;
  const first = main.equity[0]?.t ?? 0, lastT = main.equity[main.equity.length - 1]?.t ?? 0;
  const splitTime = first + (lastT - first) * (1 - Math.min(Math.max(st.validation.testPct, 0), 90) / 100);
  const trainTr = trades.filter((t) => t.entryTime < splitTime), testTr = trades.filter((t) => t.entryTime >= splitTime);

  const months: Record<string, number> = {};
  let startV = cap, lastV = cap, key = "";
  for (const p of main.equity) {
    const k = new Date(p.t * 1000).toISOString().slice(0, 7);
    if (k !== key) { if (key) months[key] = ((lastV - startV) / startV) * 100; key = k; startV = lastV; }
    lastV = p.v;
  }
  if (key) months[key] = ((lastV - startV) / startV) * 100;

  const bySymbol: Record<string, Metrics> = {};
  for (const sym of new Set(trades.map((t) => t.symbol))) {
    const tr = trades.filter((t) => t.symbol === sym);
    bySymbol[sym] = metrics(tr, curveFrom(tr, cap), cap);
  }

  // Monte Carlo: embaralha a ordem das operações (em % da banca) e mede queda máxima e resultado final
  let monteCarlo: Result["monteCarlo"];
  const mc = Math.max(0, Math.min(st.validation.monteCarloRuns, 5000));
  if (mc > 0 && trades.length >= 10) {
    const rets = trades.map((t) => t.pnlUsd / Math.max(t.equityAfter - t.pnlUsd, 1e-9));
    let seed = st.validation.seed >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const dds: number[] = [], finals: number[] = [];
    let ruin = 0;
    for (let k = 0; k < mc; k++) {
      let v = 1, peak = 1, dd = 0;
      for (let j = 0; j < rets.length; j++) { v *= 1 + rets[Math.floor(rnd() * rets.length)]; peak = Math.max(peak, v); dd = Math.max(dd, (peak - v) / peak); }
      dds.push(dd * 100); finals.push((v - 1) * 100);
      if (dd >= 0.5) ruin++;
    }
    monteCarlo = { ddP50: pct(dds, 0.5), ddP95: pct(dds, 0.95), finalP5: pct(finals, 0.05), finalP50: pct(finals, 0.5), finalP95: pct(finals, 0.95), ruinPct: (ruin / mc) * 100 };
  }

  const m = metrics(trades, main.equity, cap, main.exposurePct);
  const warnings: string[] = [];
  if (trades.length < 30) warnings.push(`Só ${trades.length} operações: amostra pequena demais para conclusões.`);
  if (m.trades && m.ciLow < 0 && m.ciHigh > 0) warnings.push("O intervalo de confiança do resultado por operação inclui zero: não dá para distinguir de sorte.");
  if (m.maxDdPct >= 50) warnings.push(`A banca chegou a cair ${m.maxDdPct.toFixed(0)}% — depois disso muitas entradas ficam abaixo da compra mínima.`);
  const brl = st.symbols.filter((s) => s.endsWith("BRL"));
  if (brl.length && brl.length < st.symbols.length) warnings.push(`${brl.join(", ")} tem preço em reais e os outros pares em dólar: a banca soma as duas moedas como se fossem iguais. Rode os pares em reais separados.`);
  else if (brl.length) warnings.push("Pares em reais: banca, lucro e taxas deste relatório estão em R$, não em US$.");
  if (m.grossUsd > 0 && m.netUsd < 0) warnings.push("Ganha antes dos custos e perde depois: o problema são as taxas e o slippage.");
  const trainM = metrics(trainTr, curveFrom(trainTr, cap), cap), testM = metrics(testTr, curveFrom(testTr, cap), cap);
  if (trainM.avgR > 0 && testM.trades >= 10 && testM.avgR < 0) warnings.push("Positiva no treino e negativa na validação: sinal clássico de ajuste excessivo.");

  return {
    strategy: st, trades, equity: main.equity, metrics: m, train: trainM, test: testM, splitTime,
    monthly: months, bySymbol, monteCarlo, signals: main.signals, skipped: main.skipped, warnings, ms: performance.now() - t0,
  };
}
