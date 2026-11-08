// Uso: npx tsx lib/engine/bench.ts  — roda uma estratégia de exemplo nos arquivos de out/ e mede o tempo.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { concat, decode, type Manifest, type Series } from "./data";
import { backtest } from "./stats";
import { TEMPLATES } from "./templates";

const manifest: Manifest = JSON.parse(readFileSync("out/spot/manifest.json", "utf8"));
const load = (sym: string, tf: string): Series =>
  concat(Object.keys(manifest.symbols[sym].files).filter((r) => r.split("/")[1] === tf).sort().map((r) => {
    const raw = gunzipSync(readFileSync(`out/spot/${r}`));
    return decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  }));

const name = process.argv[2] ?? "pctb";
const tf = process.argv[3] ?? "3m";
const syms = (process.argv[4] ?? "BTCUSDT,ETHUSDT").split(",");
const st = { ...structuredClone(TEMPLATES[name].strategy), symbols: syms, tf };
const t0 = performance.now();
const data: Record<string, Record<string, Series>> = {};
for (const s of new Set([...syms, ...st.indicators.map((d) => d.symbol).filter((x): x is string => !!x)])) {
  data[s] = {};
  for (const t of new Set([tf, ...st.indicators.map((d) => d.tf).filter((x): x is string => !!x)])) data[s][t] = load(s, t);
}
const t1 = performance.now();
const r = backtest(st, data);
const m = r.metrics;
console.log(`${name} ${tf} ${syms.join(",")}: leitura ${(t1 - t0).toFixed(0)} ms, backtest ${r.ms.toFixed(0)} ms (${Object.values(data).reduce((a, x) => a + x[tf].t.length, 0).toLocaleString()} candles)`);
console.log(`sinais ${r.signals}, operações ${m.trades}, acerto ${m.winRate.toFixed(1)}%, R/op ${m.avgR.toFixed(3)} [${m.ciLow.toFixed(3)}; ${m.ciHigh.toFixed(3)}], bruto US$ ${m.grossUsd.toFixed(2)}, taxas US$ ${m.feesUsd.toFixed(2)}, líquido US$ ${m.netUsd.toFixed(2)}, queda máx ${m.maxDdPct.toFixed(1)}%`);
console.log(`treino R/op ${r.train.avgR.toFixed(3)} (${r.train.trades}) | validação ${r.test.avgR.toFixed(3)} (${r.test.trades}) | aleatório ${r.random?.avgR.toFixed(3)} (superou ${r.random?.beatPct.toFixed(0)}%)`);
console.log("ignorados:", r.skipped);
console.log("avisos:", r.warnings);
