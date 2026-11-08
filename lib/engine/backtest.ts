// Motor do backtest. Regras de honestidade:
//  - sinais usam só candles fechados; a ordem nasce no candle seguinte ao sinal
//  - outro tempo gráfico/par: usa o último candle desse tempo já FECHADO no fechamento do candle atual
//  - stop e alvo no mesmo candle: conta o stop
//  - ordem limitada só executa se o preço passar do valor (toque não basta)
//  - stop móvel / breakeven só valem a partir do candle seguinte ao que os ativou
import type { Series } from "./data";
import { CATALOG, source } from "./catalog";
import { atr as atrCalc, lowest, highest } from "./indicators";
import type { Cond, Group, Operand, Strategy, Trade } from "./types";

type Arr = Float64Array;
export type DataSet = Record<string, Record<string, Series>>; // par -> tempo -> série
export const TF: Record<string, number> = { "3m": 180, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

/** Alinha uma série de outro tempo/par à série base: valor do último candle fechado até o fechamento do candle base. */
export function align(base: Series, other: Series, values: Arr): Arr {
  if (other === base) return values;
  const n = base.t.length, out = new Float64Array(n).fill(NaN);
  let j = -1;
  for (let i = 0; i < n; i++) {
    const closeTime = base.t[i] + base.tf;
    while (j + 1 < other.t.length && other.t[j + 1] + other.tf <= closeTime) j++;
    if (j >= 0) out[i] = values[j];
  }
  return out;
}

class Compiler {
  private cache = new Map<string, Arr>();
  private indCache = new Map<string, Record<string, Arr>>();
  constructor(private st: Strategy, private data: DataSet, private symbol: string, readonly base: Series) {}

  private series(symbol: string | undefined, tf: string | undefined): Series {
    const sym = symbol || this.symbol, t = tf || this.st.tf;
    const s = this.data[sym]?.[t];
    if (!s) throw new Error(`faltam dados de ${sym} ${t}`);
    return s;
  }

  operand(op: Operand): Arr {
    const key = JSON.stringify(op);
    const hit = this.cache.get(key);
    if (hit) return hit;
    let arr: Arr;
    const n = this.base.t.length;
    if (op.kind === "num") arr = new Float64Array(n).fill(op.value);
    else if (op.kind === "time") {
      arr = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const d = new Date(this.base.t[i] * 1000);
        arr[i] = op.field === "hour" ? d.getUTCHours() : op.field === "minute" ? d.getUTCMinutes() : d.getUTCDay();
      }
    } else if (op.kind === "price") {
      const s = this.series(op.symbol, op.tf);
      arr = align(this.base, s, source(s, op.field));
    } else {
      const def = this.st.indicators.find((d) => d.id === op.ref);
      if (!def) throw new Error(`indicador "${op.ref}" não existe`);
      const item = CATALOG[def.type];
      if (!item) throw new Error(`tipo de indicador desconhecido: ${def.type}`);
      const s = this.series(def.symbol, def.tf);
      const ikey = `${def.id}`;
      let outs = this.indCache.get(ikey);
      if (!outs) { outs = item.calc(s, def.params); this.indCache.set(ikey, outs); }
      const v = outs[op.out];
      if (!v) throw new Error(`"${op.ref}" não tem a saída "${op.out}"`);
      arr = align(this.base, s, v);
    }
    const shift = op.kind === "ind" || op.kind === "price" ? op.shift ?? 0 : 0;
    if (shift > 0) {
      const sh = new Float64Array(n).fill(NaN);
      for (let i = shift; i < n; i++) sh[i] = arr[i - shift];
      arr = sh;
    }
    this.cache.set(key, arr);
    return arr;
  }

  cond(c: Cond): Uint8Array {
    const a = this.operand(c.left), b = this.operand(c.right), n = a.length, out = new Uint8Array(n);
    const k = Math.max(1, c.n ?? 1);
    for (let i = 0; i < n; i++) {
      const x = a[i], y = b[i];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      switch (c.op) {
        case ">": out[i] = x > y ? 1 : 0; break;
        case "<": out[i] = x < y ? 1 : 0; break;
        case ">=": out[i] = x >= y ? 1 : 0; break;
        case "<=": out[i] = x <= y ? 1 : 0; break;
        case "crossAbove": out[i] = i > 0 && a[i - 1] <= b[i - 1] && x > y ? 1 : 0; break;
        case "crossBelow": out[i] = i > 0 && a[i - 1] >= b[i - 1] && x < y ? 1 : 0; break;
        case "risingFor": case "fallingFor": {
          if (i < k) break;
          let ok = 1;
          for (let j = i - k + 1; j <= i && ok; j++) if (!(c.op === "risingFor" ? a[j] > a[j - 1] : a[j] < a[j - 1])) ok = 0;
          out[i] = ok;
        }
      }
    }
    return out;
  }

  group(g: Group | undefined): Uint8Array | null {
    if (!g || !g.items.length) return null;
    const n = this.base.t.length;
    const parts = g.items.map((it) => ("mode" in it ? this.group(it) : this.cond(it))).filter((x): x is Uint8Array => x !== null);
    if (!parts.length) return null;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let v = g.mode === "all" ? 1 : 0;
      for (const p of parts) { if (g.mode === "all") { if (!p[i]) { v = 0; break; } } else if (p[i]) { v = 1; break; } }
      out[i] = v;
    }
    return out;
  }
}

export type Prepared = {
  symbol: string;
  s: Series;
  sig: (Uint8Array | null)[]; // [compra, venda]
  exitSig: (Uint8Array | null)[];
  stopRef: Arr | null; // stop por indicador
  targetRef: Arr | null;
  atr: Arr;
  swingLow: Arr;
  swingHigh: Arr;
};

// start: segundos. Antes dele os candles só aquecem os indicadores (sem sinais e fora da curva).
export type RunOptions = { randomEntries?: { prob: number; seed: number }; start?: number };

const timelines = new WeakMap<Prepared[], Float64Array>();
/** Linha do tempo comum (aberturas de todos os pares, sem repetição), calculada uma vez por conjunto de dados. */
function timelineOf(prepared: Prepared[]): Float64Array {
  const hit = timelines.get(prepared);
  if (hit) return hit;
  let tl: Float64Array = prepared.length ? Float64Array.from(prepared[0].s.t) : new Float64Array(0);
  for (let k = 1; k < prepared.length; k++) { // intercala listas já ordenadas
    const b = prepared[k].s.t, out = new Float64Array(tl.length + b.length);
    let i = 0, j = 0, n = 0;
    while (i < tl.length || j < b.length) {
      const v = j >= b.length || (i < tl.length && tl[i] <= b[j]) ? tl[i++] : b[j++];
      if (n === 0 || out[n - 1] !== v) out[n++] = v;
    }
    tl = out.slice(0, n);
  }
  timelines.set(prepared, tl);
  return tl;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function prepare(st: Strategy, data: DataSet): Prepared[] {
  return st.symbols.filter((sym) => data[sym]?.[st.tf]?.t.length).map((sym) => {
    const s = data[sym][st.tf];
    const c = new Compiler(st, data, sym, s);
    const allowLong = st.side !== "short", allowShort = st.side !== "long";
    return {
      symbol: sym, s,
      sig: [allowLong ? c.group(st.entry.long) : null, allowShort ? c.group(st.entry.short) : null],
      exitSig: [c.group(st.exit.long), c.group(st.exit.short)],
      stopRef: st.stop.type === "indicator" && st.stop.operand ? c.operand(st.stop.operand) : null,
      targetRef: st.target.type === "indicator" && st.target.operand ? c.operand(st.target.operand) : null,
      atr: atrCalc(s, Math.max(1, st.stop.atrPeriod || 14)),
      swingLow: lowest(s.l, Math.max(1, st.stop.lookback || 5)),
      swingHigh: highest(s.h, Math.max(1, st.stop.lookback || 5)),
    };
  });
}

type Pending = { side: 1 | -1; signalBar: number; price: number; until: number; kind: "market" | "limit" | "stop" };
type Pos = {
  side: 1 | -1; entryBar: number; entryTime: number; entry: number; qty: number; qtyOpen: number; stop: number; stopInitial: number;
  riskUsd: number; feesUsd: number; slipUsd: number; realized: number; exitValue: number; best: number; partialDone: boolean; beDone: boolean;
  trailArmed: number; // stop calculado no fechamento, vale a partir do próximo candle
  exitNext: boolean; // condição de saída disparou no fechamento: sai na próxima abertura
};

/** Roda o backtest em todos os pares com uma banca única (eventos em ordem de tempo). */
export function run(st: Strategy, prepared: Prepared[], opt: RunOptions = {}) {
  const taker = st.costs.takerPct / 100, maker = st.costs.makerPct / 100, slip = st.costs.slippagePct / 100;
  const R = st.risk;
  let cash = R.capital; // dinheiro livre (inclui margem das vendas a descoberto como reserva)
  const trades: Trade[] = [];
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  let signals = 0;
  // entradas aleatórias: sorteia os candles de sinal antes (mesma probabilidade dos sinais reais)
  let sigs = prepared.map((p) => p.sig);
  if (opt.randomEntries) {
    const rnd = rng(opt.randomEntries.seed), prob = Math.min(Math.max(opt.randomEntries.prob, 1e-9), 1);
    const draw = (n: number) => {
      const a = new Uint8Array(n);
      for (let i = Math.floor(Math.log(1 - rnd()) / Math.log(1 - prob)); i < n; i += 1 + Math.floor(Math.log(1 - rnd()) / Math.log(1 - prob))) a[i] = 1;
      return a;
    };
    sigs = prepared.map((p) => p.sig.map((s) => (s ? draw(s.length) : null)));
  }
  const start = opt.start ?? -Infinity;
  if (Number.isFinite(start)) {
    sigs = sigs.map((pair, k) => {
      const t = prepared[k].s.t;
      let a = 0; while (a < t.length && t[a] < start) a++;
      return a === 0 ? pair : pair.map((s) => { if (!s) return s; const c = s.slice(); c.fill(0, 0, a); return c; });
    });
  }

  const state = prepared.map((p) => ({ p, i: 0, pos: null as Pos | null, pend: null as Pending | null, cool: -1 }));
  const timeline = timelineOf(prepared);
  const nState = state.length;
  let day = -1, dayTrades = 0, dayPnl = 0, dayStartEq = R.capital;
  const equity: { t: number; v: number }[] = [];
  let openCount = 0;
  let exposureBars = 0;

  const markValue = () => {
    let v = cash;
    for (const x of state) if (x.pos) { const px = x.p.s.c[Math.max(0, x.i - 1)]; v += x.pos.side === 1 ? x.pos.qtyOpen * px : x.pos.qtyOpen * (2 * x.pos.entry - px); }
    return v;
  };
  const realizedEquity = () => {
    let v = cash;
    for (const x of state) if (x.pos) v += x.pos.qtyOpen * x.pos.entry; // posição pelo custo
    return v;
  };

  const close = (x: (typeof state)[number], bar: number, px: number, reason: Trade["reason"], fee: number) => {
    const pos = x.pos!;
    const notional = pos.qtyOpen * px;
    const f = notional * fee;
    pos.feesUsd += f;
    pos.exitValue += notional;
    const pnlPart = pos.side * (px - pos.entry) * pos.qtyOpen;
    pos.realized += pnlPart;
    cash += pos.qtyOpen * pos.entry + pnlPart - f;
    const gross = pos.realized + pos.slipUsd; // bruto = antes do slippage e das taxas
    const pnl = pos.realized - pos.feesUsd;
    const t: Trade = {
      symbol: x.p.symbol, side: pos.side, entryTime: pos.entryTime, entryPrice: pos.entry, exitTime: x.p.s.t[bar], exitPrice: pos.exitValue / pos.qty,
      qty: pos.qty, stopInitial: pos.stopInitial, riskUsd: pos.riskUsd, grossUsd: gross, feesUsd: pos.feesUsd, slippageUsd: pos.slipUsd,
      pnlUsd: pnl, r: pos.riskUsd > 0 ? pnl / pos.riskUsd : 0, bars: bar - pos.entryBar + 1, reason, equityAfter: 0,
    };
    trades.push(t);
    dayPnl += pnl;
    x.pos = null;
    openCount--;
    x.cool = bar + Math.max(0, st.entry.cooldownBars);
    t.equityAfter = realizedEquity();
  };

  const partialExit = (x: (typeof state)[number], px: number, fraction: number, fee: number) => {
    const pos = x.pos!;
    const q = pos.qtyOpen * fraction;
    const f = q * px * fee;
    pos.feesUsd += f;
    pos.exitValue += q * px;
    const pnlPart = pos.side * (px - pos.entry) * q;
    pos.realized += pnlPart;
    cash += q * pos.entry + pnlPart - f;
    pos.qtyOpen -= q;
  };

  const stopFor = (p: Prepared, side: 1 | -1, i: number, e: number): number => {
    const S = st.stop, buf = S.bufferPct / 100;
    switch (S.type) {
      case "percent": return e * (1 - side * S.value / 100);
      case "atr": return e - side * S.value * p.atr[i];
      case "swing": return side === 1 ? p.swingLow[i] * (1 - buf) : p.swingHigh[i] * (1 + buf);
      case "indicator": return p.stopRef ? p.stopRef[i] * (1 - side * buf) : NaN;
      default: return NaN;
    }
  };

  const tryOpen = (x: (typeof state)[number], pend: Pending, bar: number, fill: number, isMaker: boolean) => {
    const p = x.p, side = pend.side, sb = pend.signalBar;
    const e = isMaker ? fill : fill * (1 + side * slip);
    let stop = stopFor(p, side, sb, e);
    const noStop = st.stop.type === "none";
    if (noStop) stop = e * (1 - side * Math.max(st.stop.maxPct, 1) / 100); // só para dimensionar o risco
    if (!(Number.isFinite(stop)) || (stop - e) * side >= 0) { skip("stop do lado errado do preço"); return; }
    const stopPct = (Math.abs(e - stop) / e) * 100;
    if (!noStop && stopPct < st.stop.minPct) { skip("stop menor que o mínimo"); return; }
    if (!noStop && st.stop.maxPct > 0 && stopPct > st.stop.maxPct) { skip("stop maior que o máximo"); return; }
    if (R.maxTradesDay > 0 && dayTrades >= R.maxTradesDay) { skip("limite de operações no dia"); return; }
    if (R.maxLossDayPct > 0 && -dayPnl >= dayStartEq * R.maxLossDayPct / 100) { skip("limite de perda no dia"); return; }
    if (openCount >= Math.max(1, R.maxOpen)) { skip("máximo de posições abertas"); return; }
    const eq = realizedEquity();
    const perUnit = Math.abs(e - stop);
    const fee = isMaker ? maker : taker;
    const free = cash - eq * R.cashBufferPct / 100;
    const qty = Math.min((eq * R.riskPct / 100) / perUnit, (eq * R.maxPositionPct / 100) / e, Math.max(free, 0) / (e * (1 + fee)));
    if (!(qty > 0) || qty * e < R.minNotional) { skip("banca insuficiente para a compra mínima"); return; }
    const feeUsd = qty * e * fee;
    cash -= qty * e + feeUsd;
    x.pos = {
      side, entryBar: bar, entryTime: p.s.t[bar], entry: e, qty, qtyOpen: qty, stop: noStop ? NaN : stop, stopInitial: stop,
      riskUsd: qty * perUnit, feesUsd: feeUsd, slipUsd: isMaker ? 0 : qty * Math.abs(e - fill), realized: 0, exitValue: 0,
      best: e, partialDone: false, beDone: false, trailArmed: NaN, exitNext: false,
    };
    openCount++; dayTrades++;
  };

  const nT = timeline.length;
  for (let ti = 0; ti < nT; ti++) {
    const t = timeline[ti];
    const d = Math.floor(t / 86400);
    if (d !== day) {
      if (day >= 0 && day * 86400 + 86400 > start) equity.push({ t: day * 86400, v: markValue() });
      day = d; dayTrades = 0; dayPnl = 0; dayStartEq = realizedEquity();
    }
    for (let si = 0; si < nState; si++) {
      const x = state[si];
      const p = x.p, s = p.s;
      if (x.i >= s.t.length || s.t[x.i] !== t) continue;
      const i = x.i++;
      // caminho rápido: sem posição, sem ordem e sem sinal neste candle -> nada acontece
      const sg = sigs[si];
      if (!x.pos && !x.pend) {
        const sl = sg[0], ss = sg[1];
        if (!(sl && sl[i]) && !(ss && ss[i])) continue;
      }
      const o = s.o[i], h = s.h[i], l = s.l[i], c = s.c[i];

      // 0) saída por condição marcada no fechamento anterior: executa nesta abertura
      if (x.pos?.exitNext) close(x, i, o * (1 - x.pos.side * slip), "exit", taker);

      // 1) ordem pendente
      if (x.pend && !x.pos) {
        const pd = x.pend;
        if (i > pd.until) x.pend = null;
        else if (pd.kind === "market") { x.pend = null; tryOpen(x, pd, i, o, false); }
        else if (pd.kind === "limit") {
          const hit = pd.side === 1 ? l < pd.price : h > pd.price;
          if (hit) { x.pend = null; tryOpen(x, pd, i, pd.side === 1 ? Math.min(pd.price, o) : Math.max(pd.price, o), true); }
        } else {
          const hit = pd.side === 1 ? h >= pd.price : l <= pd.price;
          if (hit) { x.pend = null; tryOpen(x, pd, i, pd.side === 1 ? Math.max(pd.price, o) : Math.min(pd.price, o), false); }
        }
      }

      // 2) posição aberta: stop, alvo, parcial, tempo
      const pos = x.pos;
      if (pos) {
        exposureBars++;
        const side = pos.side;
        if (!Number.isNaN(pos.trailArmed)) { pos.stop = Number.isNaN(pos.stop) ? pos.trailArmed : side === 1 ? Math.max(pos.stop, pos.trailArmed) : Math.min(pos.stop, pos.trailArmed); pos.trailArmed = NaN; }
        const risk0 = Math.abs(pos.entry - pos.stopInitial);
        let target = NaN;
        if (st.target.type === "rr") target = pos.entry + side * st.target.value * risk0;
        else if (st.target.type === "percent") target = pos.entry * (1 + side * st.target.value / 100);
        else if (st.target.type === "indicator" && p.targetRef) target = p.targetRef[i - 1]; // nível conhecido no fechamento anterior
        if (st.target.type === "indicator" && (target - pos.entry) * side <= 0) target = NaN; // alvo já ficou para trás: só stop/saída
        const stopHitAtOpen = !Number.isNaN(pos.stop) && (side === 1 ? o <= pos.stop : o >= pos.stop);
        const stopHit = !Number.isNaN(pos.stop) && (side === 1 ? l <= pos.stop : h >= pos.stop);
        const why: Trade["reason"] = pos.beDone && Math.abs(pos.stop - pos.entry) < 1e-12 ? "breakeven" : Number.isNaN(pos.stop) || pos.stop === pos.stopInitial ? "stop" : "trail";
        if (stopHitAtOpen) { close(x, i, o * (1 - side * slip), why, taker); } // abriu além do stop: sai na abertura
        else if (stopHit) { close(x, i, pos.stop * (1 - side * slip), why, taker); }
        else {
          // parcial
          if (!pos.partialDone && st.exit.partial.atR > 0) {
            const lvl = pos.entry + side * st.exit.partial.atR * risk0;
            if (side === 1 ? h > lvl : l < lvl) { partialExit(x, side === 1 ? Math.max(lvl, o) : Math.min(lvl, o), Math.min(Math.max(st.exit.partial.fraction, 0), 1), maker); pos.partialDone = true; }
          }
          const tgtHit = !Number.isNaN(target) && (side === 1 ? h > target : l < target);
          if (pos.qtyOpen <= 1e-12) close(x, i, c, "target", 0);
          else if (tgtHit) close(x, i, side === 1 ? Math.max(target, o) : Math.min(target, o), "target", maker);
          else if (st.exit.maxBars > 0 && i - pos.entryBar + 1 >= st.exit.maxBars) close(x, i, c * (1 - side * slip), "time", taker);
          else if (i === s.t.length - 1) close(x, i, c, "end", taker);
          else {
            // atualizações para o próximo candle
            pos.best = side === 1 ? Math.max(pos.best, h) : Math.min(pos.best, l);
            if (st.exit.breakevenAtR > 0 && !pos.beDone && (pos.best - pos.entry) * side >= st.exit.breakevenAtR * risk0) { pos.trailArmed = pos.entry; pos.beDone = true; }
            const tr = st.exit.trailing;
            if (tr.type !== "none" && tr.value > 0) {
              const lvl = tr.type === "percent" ? pos.best * (1 - side * tr.value / 100) : pos.best - side * tr.value * p.atr[i];
              if (Number.isFinite(lvl)) pos.trailArmed = Number.isNaN(pos.trailArmed) ? lvl : side === 1 ? Math.max(pos.trailArmed, lvl) : Math.min(pos.trailArmed, lvl);
            }
            const ex = p.exitSig[side === 1 ? 0 : 1];
            if (ex && ex[i]) pos.exitNext = true;
          }
        }
      }

      // 3) novo sinal no fechamento deste candle
      if (!x.pos && !x.pend && i > x.cool && i + 1 < s.t.length) {
        for (let k = 0; k < 2; k++) {
          const side: 1 | -1 = k === 0 ? 1 : -1;
          const sig = sg[k];
          if (!sig || !sig[i]) continue;
          signals++;
          const E = st.entry;
          const price = E.order === "market" ? NaN : E.order === "limit" ? c * (1 - side * E.offsetPct / 100) : (side === 1 ? h : l) * (1 + side * E.offsetPct / 100);
          x.pend = { side, signalBar: i, price, until: i + Math.max(1, E.order === "market" ? 1 : E.validBars), kind: E.order };
          break;
        }
      }
    }
  }
  if (day >= 0) equity.push({ t: day * 86400, v: markValue() });
  return { trades, equity, skipped, signals, exposurePct: timeline.length ? (exposureBars / (timeline.length * Math.max(1, prepared.length))) * 100 : 0 };
}
