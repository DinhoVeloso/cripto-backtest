// Uso: npx tsx lib/engine/bench.ts  — roda uma estratégia de exemplo nos arquivos de out/ e mede o tempo.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { concat, decode, type Manifest, type Series } from "./data";
import { prepareBinary, randomBaselineBinary, summarizeBinary } from "./binary";
import { TEMPLATES } from "./templates";

const manifest: Manifest = JSON.parse(readFileSync("out/spot/manifest.json", "utf8"));
const load = (sym: string, tf: string): Series =>
  concat(Object.keys(manifest.symbols[sym].files).filter((r) => r.split("/")[1] === tf).sort().map((r) => {
    const raw = gunzipSync(readFileSync(`out/spot/${r}`));
    return decode(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);
  }));

const name = process.argv[2] ?? "donchian_touch";
const tf = process.argv[3] ?? "5m";
const syms = (process.argv[4] ?? "BTCUSDT").split(",");
const st = { ...structuredClone(TEMPLATES[name].strategy), symbols: syms, tf };
const t0 = performance.now();
const data: Record<string, Record<string, Series>> = {};
for (const s of new Set([...syms, ...st.indicators.map((d) => d.symbol).filter((x): x is string => !!x)])) {
  data[s] = {};
  for (const t of new Set([tf, ...st.indicators.map((d) => d.tf).filter((x): x is string => !!x)])) data[s][t] = load(s, t);
}
const t1 = performance.now();
const prepared = prepareBinary(st, data);
const r = summarizeBinary(st, prepared);
r.random = randomBaselineBinary(st, prepared, r);
const m = r.metrics;
console.log(`${name} ${tf} ${syms.join(",")}: leitura ${(t1 - t0).toFixed(0)} ms, backtest ${r.ms.toFixed(0)} ms (${prepared[0].s.t.length.toLocaleString()} candles)`);
console.log(`sinais ${r.signals}, apostas ${m.trades}, acerto ${m.winRate.toFixed(1)}% (mínimo ${(100 / (1 + st.binary.payoutPct / 100)).toFixed(1)}%), lucro/aposta ${(m.avgR * 100).toFixed(1)}%, líquido US$ ${m.netUsd.toFixed(2)}, queda máx ${m.maxDdPct.toFixed(1)}%`);
console.log(`treino ${(r.train.avgR * 100).toFixed(1)}% (${r.train.trades}) | validação ${(r.test.avgR * 100).toFixed(1)}% (${r.test.trades}) | aleatório ${((r.random?.avgR ?? NaN) * 100).toFixed(1)}% (superou ${r.random?.beatPct.toFixed(0)}%)`);
console.log("ignorados:", r.skipped);
