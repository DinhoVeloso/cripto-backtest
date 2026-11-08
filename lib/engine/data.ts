// Leitura dos arquivos CBK1 gerados por pipeline/build_data.py (ver o formato lá).

export type Series = {
  tf: number; // segundos
  t: Float64Array; // abertura do candle, em segundos UTC
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
};

export type Manifest = {
  market: string;
  updated: number;
  timeframes: Record<string, number>;
  symbols: Record<string, { decimals: number; first: number; last_end: number; files: Record<string, { n: number; bytes: number }> }>;
};

export function decode(buf: ArrayBuffer): Series {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "CBK1") throw new Error("arquivo de dados inválido");
  const decimals = dv.getUint8(5);
  const tf = dv.getUint32(8, true);
  const n = dv.getUint32(12, true);
  const t0 = dv.getUint32(16, true);
  const c0 = Number(dv.getBigInt64(20, true));
  const scale = 10 ** decimals;
  const s: Series = { tf, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  const offDt = 32, offDc = offDt + 2 * n, offDo = offDc + 4 * n, offUh = offDo + 4 * n, offUl = offUh + 4 * n, offV = offUl + 4 * n;
  let t = t0, c = c0;
  for (let i = 0; i < n; i++) {
    t += dv.getUint16(offDt + 2 * i, true) * tf;
    const o = c + dv.getInt32(offDo + 4 * i, true);
    c += dv.getInt32(offDc + 4 * i, true);
    const hi = Math.max(o, c) + dv.getInt32(offUh + 4 * i, true);
    const lo = Math.min(o, c) - dv.getInt32(offUl + 4 * i, true);
    s.t[i] = t; s.o[i] = o / scale; s.h[i] = hi / scale; s.l[i] = lo / scale; s.c[i] = c / scale; s.v[i] = dv.getFloat32(offV + 4 * i, true);
  }
  return s;
}

export function concat(parts: Series[]): Series {
  const n = parts.reduce((a, p) => a + p.t.length, 0);
  const out: Series = { tf: parts[0]?.tf ?? 0, t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  let k = 0;
  for (const p of parts) {
    for (const key of ["t", "o", "h", "l", "c", "v"] as const) out[key].set(p[key], k);
    k += p.t.length;
  }
  return out;
}

export function slice(s: Series, from: number, to: number): Series {
  // from/to em segundos; mantém candles com from <= t < to
  let a = 0, b = s.t.length;
  while (a < b && s.t[a] < from) a++;
  while (b > a && s.t[b - 1] >= to) b--;
  return { tf: s.tf, t: s.t.subarray(a, b), o: s.o.subarray(a, b), h: s.h.subarray(a, b), l: s.l.subarray(a, b), c: s.c.subarray(a, b), v: s.v.subarray(a, b) };
}

async function gunzip(res: Response): Promise<ArrayBuffer> {
  if (!res.body) throw new Error("resposta vazia");
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

const CACHE = "cripto-backtest-dados-v1";

/** Baixa (ou lê do cache do navegador) um arquivo .bin.gz e decodifica. */
export async function loadFile(baseUrl: string, rel: string, version: number): Promise<Series> {
  const url = `${baseUrl.replace(/\/$/, "")}/${rel}?v=${version}`;
  let res: Response | undefined;
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => undefined) : undefined;
  if (cache) res = await cache.match(url);
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`falha ao baixar ${rel} (${res.status})`);
    if (cache) await cache.put(url, res.clone()).catch(() => undefined);
  }
  return decode(await gunzip(res));
}

export async function loadSeries(baseUrl: string, manifest: Manifest, symbol: string, tfName: string, from: number, to: number): Promise<Series> {
  const info = manifest.symbols[symbol];
  if (!info) throw new Error(`par sem dados: ${symbol}`);
  const y0 = new Date(from * 1000).getUTCFullYear(), y1 = new Date((to - 1) * 1000).getUTCFullYear();
  const rels = Object.keys(info.files).filter((r) => {
    const [, tf, file] = r.split("/");
    const y = Number(file.slice(0, 4));
    return tf === tfName && y >= y0 && y <= y1;
  }).sort();
  const parts = await Promise.all(rels.map((r) => loadFile(baseUrl, r, manifest.updated)));
  return slice(concat(parts), from, to);
}
