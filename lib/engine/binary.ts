// Motor de opções binárias. Cada aposta dura um candle:
//  - o sinal nasce no candle i (regras avaliadas com o candle i; "sobe" = entry.long, "desce" = entry.short);
//    a aposta é feita durante o candle i, antes dos 5 segundos finais
//  - o resultado é a COR do candle seguinte (i+1): verde (fechou acima da abertura) = "sobe" ganha, vermelho = "desce" ganha
//  - o preço de entrada não conta; candle sem corpo (fechamento = abertura) conta como perda
//  - acertou = ganha payout% do valor apostado; errou = perde o valor
//  - sem allowOverlap: uma aposta de cada vez (a anterior ainda está aberta durante o candle do sinal)
import type { Series } from "./data";
import { Compiler, type DataSet } from "./backtest";
import { metrics } from "./stats";
import type { Metrics, Result, Strategy, Trade } from "./types";


export type BinPrepared = {
  symbol: string;
  s: Series;
  call: Uint8Array | null; // sinal de "sobe"
  put: Uint8Array | null; // sinal de "desce"
  rearm: Uint8Array | null;
};

export type BinRunOptions = { start?: number; random?: { prob: number; seed: number } };

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.floor(q * (b.length - 1))))]; };
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Acerto mínimo (%) para não perder dinheiro com esse payout. */
export const breakEvenPct = (payoutPct: number) => 100 / (1 + Math.max(payoutPct, 0) / 100);

/** Só um par por vez: o primeiro da lista que tiver dados. */
export function prepareBinary(st: Strategy, data: DataSet): BinPrepared[] {
  const sym = st.symbols.find((x) => data[x]?.[st.tf]?.t.length);
  if (!sym) return [];
  const s = data[sym][st.tf];
  const c = new Compiler(st, data, sym, s);
  return [{
    symbol: sym, s,
    call: c.group(st.entry.long), put: c.group(st.entry.short),
    rearm: c.group(st.binary.rearm),
  }];
}

type Open = { side: 1 | -1; bar: number; stake: number; rb: number };

export function runBinary(st: Strategy, p: BinPrepared, opt: BinRunOptions = {}) {
  const B = st.binary, s = p.s, n = s.t.length, tf = s.tf;
  const start = opt.start ?? -Infinity;
  const payout = Math.max(B.payoutPct, 0) / 100;
  const rnd = rng(opt.random?.seed ?? 1);
  const prob = opt.random ? Math.min(Math.max(opt.random.prob, 0), 1) : 0;
  const rearm = opt.random ? null : p.rearm;
  let bank = st.risk.capital, reserved = 0, signals = 0;
  let paused = false, pauseBar = -1;
  let open: Open[] = [];
  const trades: Trade[] = [];
  const equity: { t: number; v: number }[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let day = -1;

  for (let i = 0; i < n; i++) {
    const t = s.t[i], d = Math.floor(t / 86400);
    if (d !== day) {
      if (day >= 0 && day * 86400 + 86400 > start) equity.push({ t: day * 86400, v: bank });
      day = d;
    }
    const busyBefore = open.length > 0; // aposta ainda aberta durante este candle (resolve no fechamento dele)

    // 1) apostas que terminam no fechamento deste candle
    if (open.length) {
      const still: Open[] = [];
      for (const o of open) {
        if (o.rb !== i) { still.push(o); continue; }
        const open_ = s.o[i], px = s.c[i];
        const win = o.side === 1 ? px > open_ : px < open_; // cor do candle do resultado; sem corpo conta como perda
        const pnl = win ? o.stake * payout : -o.stake;
        bank += pnl; reserved -= o.stake;
        trades.push({
          symbol: p.symbol, side: o.side, entryTime: s.t[o.bar], entryPrice: open_, exitTime: t, exitPrice: px, // preços do candle do resultado (abre -> fecha)
          qty: o.stake / open_, stopInitial: open_, riskUsd: o.stake, grossUsd: pnl, feesUsd: 0, slippageUsd: 0,
          pnlUsd: pnl, r: pnl / o.stake, bars: 1, reason: win ? "win" : "loss", equityAfter: bank,
        });
        if (!win && rearm) { paused = true; pauseBar = i; }
      }
      open = still;
    }

    // 2) pausa depois de uma perda: espera um candle que cumpra a regra de rearme (só vale a partir do candle seguinte à perda)
    if (paused) {
      if (rearm && rearm[i] && i > pauseBar) paused = false;
      continue;
    }
    if (t < start) continue;

    // 3) sinal
    let side: 0 | 1 | -1 = 0;
    if (opt.random) { if (rnd() < prob) side = rnd() < 0.5 ? 1 : -1; }
    else {
      const a = p.call?.[i], b = p.put?.[i];
      if (a && b) { signals++; skip("sobe e desce no mesmo candle"); continue; }
      side = a ? 1 : b ? -1 : 0;
    }
    if (!side) continue;
    signals++;
    if (i + 1 >= n) { skip("sem candle seguinte"); continue; }
    if (s.t[i + 1] !== t + tf) { skip("buraco nos dados"); continue; }
    // a aposta anterior ainda está aberta durante o candle do sinal (ela termina no fechamento dele)
    if (!B.allowOverlap && busyBefore) { skip("aposta anterior ainda aberta"); continue; }

    const stake = Math.round((B.stakeMode === "percent" ? bank * B.stake / 100 : B.stake) * 100) / 100;
    if (!(stake >= 0.01)) { skip("valor da aposta menor que US$ 0,01"); continue; }
    if (B.stopWhenBroke && stake > bank - reserved + 1e-9) { skip("banca insuficiente"); continue; }
    open.push({ side, bar: i, stake, rb: i + 1 });
    reserved += stake;
  }
  if (day >= 0) equity.push({ t: day * 86400, v: bank });
  return { trades, equity, skipped, signals };
}

/** Queda máxima pela curva por aposta (a curva diária subestima). */
function maxDrawdownPct(trades: Trade[], capital: number) {
  let peak = capital, v = capital, dd = 0;
  for (const t of trades) { v += t.pnlUsd; peak = Math.max(peak, v); if (peak > 0) dd = Math.max(dd, Math.min((peak - v) / peak, 1)); }
  return dd * 100;
}
const curveFrom = (trades: Trade[], capital: number) => { let v = capital; return trades.map((t) => ({ t: t.exitTime, v: (v += t.pnlUsd) })); };
const metricsOf = (tr: Trade[], capital: number): Metrics => ({ ...metrics(tr, curveFrom(tr, capital), capital), maxDdPct: maxDrawdownPct(tr, capital) });

export function summarizeBinary(st: Strategy, prepared: BinPrepared[], t0 = performance.now(), start?: number): Result {
  const p = prepared[0];
  const main = runBinary(st, p, { start });
  const trades = main.trades, cap = st.risk.capital;
  const first = main.equity[0]?.t ?? 0, lastT = main.equity[main.equity.length - 1]?.t ?? 0;
  const splitTime = first + (lastT - first) * (1 - Math.min(Math.max(st.validation.testPct, 0), 90) / 100);
  const trainTr = trades.filter((t) => t.entryTime < splitTime), testTr = trades.filter((t) => t.entryTime >= splitTime);

  const months: Record<string, number> = {};
  let startV = cap, lastV = cap, key = "";
  for (const pt of main.equity) {
    const k = new Date(pt.t * 1000).toISOString().slice(0, 7);
    if (k !== key) { if (key) months[key] = ((lastV - startV) / startV) * 100; key = k; startV = lastV; }
    lastV = pt.v;
  }
  if (key) months[key] = ((lastV - startV) / startV) * 100;

  const m: Metrics = { ...metrics(trades, main.equity, cap), maxDdPct: maxDrawdownPct(trades, cap) };
  const trainM = metricsOf(trainTr, cap), testM = metricsOf(testTr, cap);

  // Monte Carlo: embaralha a ordem das apostas (em % da banca)
  let monteCarlo: Result["monteCarlo"];
  const mc = Math.max(0, Math.min(st.validation.monteCarloRuns, 5000));
  if (mc > 0 && trades.length >= 10) {
    const rets = trades.map((t) => t.pnlUsd / Math.max(t.equityAfter - t.pnlUsd, 1e-9));
    let seed = st.validation.seed >>> 0;
    const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const dds: number[] = [], finals: number[] = [];
    let ruin = 0;
    for (let k = 0; k < mc; k++) {
      let v = 1, peak = 1, dd = 0;
      for (let j = 0; j < rets.length; j++) { v *= 1 + rets[Math.floor(r() * rets.length)]; peak = Math.max(peak, v); dd = Math.max(dd, (peak - v) / peak); }
      dds.push(dd * 100); finals.push((v - 1) * 100);
      if (dd >= 0.5) ruin++;
    }
    monteCarlo = { ddP50: pct(dds, 0.5), ddP95: pct(dds, 0.95), finalP5: pct(finals, 0.05), finalP50: pct(finals, 0.5), finalP95: pct(finals, 0.95), ruinPct: (ruin / mc) * 100 };
  }

  const be = breakEvenPct(st.binary.payoutPct);
  const warnings: string[] = [];
  if (trades.length < 30) warnings.push(`Só ${trades.length} apostas: amostra pequena demais para conclusões.`);
  if (m.trades && m.winRate < be) warnings.push(`Acerto de ${m.winRate.toFixed(1)}% abaixo do mínimo de ${be.toFixed(1)}% para empatar com payout de ${st.binary.payoutPct}%: no longo prazo perde dinheiro.`);
  if (m.trades >= 30 && m.ciLow < 0 && m.ciHigh > 0) warnings.push("O intervalo de confiança do resultado por aposta inclui zero: não dá para distinguir de sorte.");
  if (m.maxDdPct >= 50) warnings.push(`A banca chegou a cair ${m.maxDdPct.toFixed(0)}%.`);
  if (trainM.avgR > 0 && testM.trades >= 10 && testM.avgR < 0) warnings.push("Positiva no treino e negativa na validação: sinal clássico de ajuste excessivo.");
  if (st.symbols.length > 1) warnings.push(`Só um par é simulado por vez: usei ${p.symbol}.`);
  if (/"field":"(high|low)"/.test(JSON.stringify(st.entry))) warnings.push("As regras usam a máxima/mínima do candle do sinal: o backtest assume que o toque aconteceu antes dos últimos 5 segundos, mas candles de 1 minuto não mostram isso.");

  return {
    strategy: st, trades, equity: main.equity, metrics: m, train: trainM, test: testM, splitTime,
    monthly: months, bySymbol: { [p.symbol]: m }, monteCarlo, signals: main.signals, skipped: main.skipped, warnings, ms: performance.now() - t0,
  };
}

/** Apostas aleatórias (direção sorteada) na mesma frequência dos sinais, com o mesmo payout, valor e banca. */
export function randomBaselineBinary(st: Strategy, prepared: BinPrepared[], res: Result, start?: number): Result["random"] {
  const p = prepared[0];
  const runs = Math.max(0, Math.min(st.validation.randomRuns, 200));
  const s0 = start ?? -Infinity;
  let bars = 0;
  for (let i = 0; i < p.s.t.length; i++) if (p.s.t[i] >= s0) bars++;
  if (runs === 0 || res.signals === 0 || bars === 0) return undefined;
  const prob = res.signals / bars;
  const avgs: number[] = [];
  for (let k = 0; k < runs; k++) {
    const rr = runBinary(st, p, { random: { prob, seed: st.validation.seed + k * 7919 }, start });
    if (rr.trades.length) avgs.push(mean(rr.trades.map((t) => t.r)));
  }
  const mine = res.metrics.avgR;
  return { avgR: mean(avgs), p5: pct(avgs, 0.05), p95: pct(avgs, 0.95), runs: avgs.length, beatPct: avgs.length ? (avgs.filter((a) => mine > a).length / avgs.length) * 100 : NaN };
}

export function addRandomWarningBinary(res: Result) {
  const r = res.random;
  if (r && res.metrics.trades && r.beatPct < 95) res.warnings.push(`A estratégia superou só ${r.beatPct.toFixed(0)}% das rodadas de apostas aleatórias (o ideal é 95% ou mais).`);
}
