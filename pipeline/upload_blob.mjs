// Envia out/spot para o Vercel Blob (público). Só manda o que mudou desde o último envio.
// Uso: node --env-file=.env.local pipeline/upload_blob.mjs   (precisa de BLOB_READ_WRITE_TOKEN)
import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "out", "spot");
const STATE = path.join(ROOT, ".cache", "uploaded.json");
if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("falta BLOB_READ_WRITE_TOKEN (.env.local)"); process.exit(1); }

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const year = new Date().getUTCFullYear();
const files = walk(OUT).filter((f) => f.endsWith(".gz")).map((f) => path.relative(OUT, f).split(path.sep).join("/"));
const todo = files.filter((rel) => state[rel] !== createHash("sha1").update(readFileSync(path.join(OUT, rel))).digest("hex"));
console.log(`${files.length} arquivos, ${todo.length} para enviar`);

let done = 0, base = state.__base;
const send = async (rel) => {
  const body = readFileSync(path.join(OUT, rel));
  const current = rel.endsWith(`/${year}.bin.gz`); // ano corrente muda todo dia
  const r = await put(`spot/${rel}`, body, { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/octet-stream", cacheControlMaxAge: current ? 3600 : 31536000 });
  base = r.url.slice(0, r.url.indexOf("/spot/") + 5);
  state[rel] = createHash("sha1").update(body).digest("hex");
  if (++done % 50 === 0) { console.log(`  ${done}/${todo.length}`); writeFileSync(STATE, JSON.stringify(state)); }
};
const queue = [...todo];
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await send(queue.shift()); }));

const manifest = await put("spot/manifest.json", readFileSync(path.join(OUT, "manifest.json")), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 60 });
base = manifest.url.slice(0, manifest.url.indexOf("/manifest.json"));
state.__base = base;
writeFileSync(STATE, JSON.stringify(state));
console.log(`pronto. NEXT_PUBLIC_DATA_URL=${base}`);
