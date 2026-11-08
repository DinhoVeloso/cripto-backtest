// Roda no navegador, fora da tela (Web Worker): baixa os dados, calcula e devolve o resultado.
import { loadSeries, type Manifest, type Series } from "./data";
import { prepare, TF, type DataSet } from "./backtest";
import { CATALOG } from "./catalog";
import { addRandomWarning, randomBaseline, summarize } from "./stats";
import type { Strategy } from "./types";

export type WorkerIn =
  | { type: "run"; id: number; strategy: Strategy; dataUrl: string }
  | { type: "window"; id: number; strategy: Strategy; dataUrl: string; symbol: string; from: number; to: number };

export type WorkerOut =
  | { type: "progress"; id: number; msg: string }
  | { type: "result"; id: number; result: import("./types").Result }
  | { type: "random"; id: number; random: import("./types").Result["random"]; warnings: string[] }
  | { type: "window"; id: number; candles: { t: number; o: number; h: number; l: number; c: number }[]; overlays: { name: string; values: (number | null)[] }[] }
  | { type: "error"; id: number; error: string };

const post = (m: WorkerOut) => (self as unknown as Worker).postMessage(m);
let manifest: { url: string; m: Manifest } | null = null;
const seriesCache = new Map<string, Series>();

async function getManifest(url: string): Promise<Manifest> {
  if (manifest?.url === url) return manifest.m;
  const res = await fetch(`${url.replace(/\/$/, "")}/manifest.json?t=${Math.floor(Date.now() / 600000)}`);
  if (!res.ok) throw new Error("não foi possível ler a lista de dados");
  manifest = { url, m: await res.json() };
  return manifest.m;
}

const toSec = (d: string, end = false) => Math.floor(Date.parse(d + "T00:00:00Z") / 1000) + (end ? 86400 : 0);

/** Período de aquecimento para os indicadores (candles antes do início, para não começar com NaN). */
function warmup(st: Strategy, tf: string): number {
  let maxP = 50;
  for (const d of st.indicators) for (const v of Object.values(d.params)) if (typeof v === "number") maxP = Math.max(maxP, v);
  return Math.min(maxP * 3, 2000) * TF[tf];
}

async function loadAll(st: Strategy, url: string, onMsg: (m: string) => void): Promise<DataSet> {
  const m = await getManifest(url);
  const from = toSec(st.from), to = toSec(st.to, true);
  const need = new Map<string, Set<string>>();
  const add = (sym: string, tf: string) => { if (!need.has(sym)) need.set(sym, new Set()); need.get(sym)!.add(tf); };
  for (const s of st.symbols) add(s, st.tf);
  for (const d of st.indicators) for (const s of d.symbol ? [d.symbol] : st.symbols) add(s, d.tf || st.tf);
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    const x = o as Record<string, unknown>;
    if (x.kind === "price" && (x.tf || x.symbol)) for (const s of x.symbol ? [String(x.symbol)] : st.symbols) add(s, String(x.tf || st.tf));
    for (const v of Object.values(x)) if (typeof v === "object") walk(v);
  };
  walk(st.entry); walk(st.exit); walk(st.stop); walk(st.target);
  const data: DataSet = {};
  let done = 0;
  const total = [...need.values()].reduce((a, s) => a + s.size, 0);
  await Promise.all([...need].flatMap(([sym, tfs]) => [...tfs].map(async (tf) => {
    if (TF[tf] < TF[st.tf]) throw new Error(`o tempo ${tf} é menor que o da estratégia (${st.tf})`);
    if (!m.symbols[sym]) throw new Error(`não há dados de ${sym}`);
    const key = `${sym}|${tf}|${from}|${to}`;
    let s = seriesCache.get(key);
    if (!s) {
      s = await loadSeries(url, m, sym, tf, from - warmup(st, tf), to);
      seriesCache.set(key, s);
      if (seriesCache.size > 40) seriesCache.delete(seriesCache.keys().next().value!);
    }
    (data[sym] ??= {})[tf] = s;
    onMsg(`dados ${++done}/${total}`);
  })));
  return data;
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  try {
    const data = await loadAll(msg.strategy, msg.dataUrl, (m) => post({ type: "progress", id: msg.id, msg: m }));
    if (msg.type === "window") {
      const s = data[msg.symbol]?.[msg.strategy.tf];
      if (!s) throw new Error("sem dados");
      let a = 0; while (a < s.t.length && s.t[a] < msg.from) a++;
      let b = a; while (b < s.t.length && s.t[b] <= msg.to) b++;
      const candles = [];
      for (let i = a; i < b; i++) candles.push({ t: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i] });
      const overlays: { name: string; values: (number | null)[] }[] = [];
      for (const d of msg.strategy.indicators) {
        const item = CATALOG[d.type];
        if (!item?.overlay || (d.tf && d.tf !== msg.strategy.tf) || d.symbol) continue;
        const outs = item.calc(s, d.params);
        for (const o of item.outputs) {
          if (o.key === "pctb" || o.key === "width" || o.key === "dir") continue;
          overlays.push({ name: `${d.id} ${o.label}`, values: Array.from(outs[o.key].subarray(a, b), (v) => (Number.isFinite(v) ? v : null)) });
        }
      }
      post({ type: "window", id: msg.id, candles, overlays });
      return;
    }
    post({ type: "progress", id: msg.id, msg: "calculando" });
    // o aquecimento entra no cálculo dos indicadores, mas as operações só começam no início escolhido
    const st = msg.strategy;
    const from = toSec(st.from);
    const t0 = performance.now();
    const prepared = prepare(st, data);
    if (!prepared.length) throw new Error("nenhum par com dados no período escolhido");
    const result = summarize(st, prepared, t0, from);
    post({ type: "result", id: msg.id, result });
    if (st.validation.randomRuns > 0) {
      post({ type: "progress", id: msg.id, msg: "comparando com entradas aleatórias" });
      result.random = randomBaseline(st, prepared, result, from);
      const before = result.warnings.length;
      addRandomWarning(result);
      post({ type: "random", id: msg.id, random: result.random, warnings: result.warnings.slice(before) });
    }
  } catch (e) {
    post({ type: "error", id: msg.id, error: e instanceof Error ? e.message : String(e) });
  }
};
