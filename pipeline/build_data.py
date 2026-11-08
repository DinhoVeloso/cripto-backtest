"""Baixa candles de 1m do spot da Binance (data.binance.vision) e gera os arquivos do simulador.

Uso:  python pipeline/build_data.py BTCUSDT ETHUSDT [--start 2021-11]
Saída: out/spot/{PAR}/{tempo}/{ano}.bin.gz  +  out/spot/manifest.json

Formato .bin (little-endian), depois comprimido com gzip:
  cabeçalho 32 bytes: b"CBK1", versão u8, casas u8, reservado u16, tempo_s u32, n u32, t0 u32 (abertura do 1º candle, s),
                      c0 i64 (1º fechamento em inteiros = preço * 10^casas), reservado u32
  colunas, n valores cada:
    dt  u16  diferença de tempo para o candle anterior, em unidades do tempo gráfico (1 = sem buraco; o 1º é 0)
    dc  i32  fechamento - fechamento anterior   (inteiros)
    do  i32  abertura   - fechamento anterior
    uh  i32  máxima - max(abertura, fechamento)  (>= 0)
    ul  i32  min(abertura, fechamento) - mínima  (>= 0)
    v   f32  volume (moeda base)
Só candles completos entram. Buracos (exchange parada) ficam como buracos: dt > 1.
"""
import argparse
import csv
import gzip
import hashlib
import io
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, ".cache", "raw")
OUT = os.path.join(ROOT, "out", "spot")
BASE = "https://data.binance.vision/data/spot"
TIMEFRAMES = {"3m": 180, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
UA = {"User-Agent": "cripto-backtest-data"}


def http(url, tries=4):
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # rede instável: tenta de novo
            err = e
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"falha ao baixar {url}: {err}")


def fetch_zip(sym, kind, stamp):
    """kind 'monthly' (AAAA-MM) ou 'daily' (AAAA-MM-DD). Retorna o caminho do zip conferido ou None se não existe."""
    name = f"{sym}-1m-{stamp}.zip"
    path = os.path.join(RAW, sym, name)
    if os.path.exists(path):
        return path
    url = f"{BASE}/{kind}/klines/{sym}/1m/{name}"
    blob = http(url)
    if blob is None:
        return None
    check = http(url + ".CHECKSUM")
    if check is None or check.split()[0].decode() != hashlib.sha256(blob).hexdigest():
        raise RuntimeError(f"checksum não confere: {name}")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".part", "wb") as f:
        f.write(blob)
    os.replace(path + ".part", path)
    return path


def decimals(s):
    if "." not in s:
        return 0
    return len(s.rstrip("0").split(".")[1])


def read_zip(path):
    """Linhas de 1m: (t_s, o, h, l, c, v) e o maior número de casas decimais visto nos preços."""
    rows, d = [], 0
    with zipfile.ZipFile(path) as z:
        for member in z.namelist():
            with z.open(member) as f:
                for rec in csv.reader(io.TextIOWrapper(f, "utf-8")):
                    if not rec or not rec[0].isdigit():
                        continue  # cabeçalho
                    t = int(rec[0])
                    t = t // 1_000_000 if t > 10**14 else t // 1000  # desde 2025 o spot vem em microssegundos
                    for s in rec[1:5]:
                        d = max(d, decimals(s))
                    rows.append((t, float(rec[1]), float(rec[2]), float(rec[3]), float(rec[4]), float(rec[5])))
    rows.sort()
    return rows, d


def aggregate(rows, tf, last_end):
    """Agrupa 1m em tf segundos. Descarta o último grupo se ele ainda não terminou (fim > last_end)."""
    # Como a Binance: minutos sem negócio (volume 0) não definem abertura/máxima/mínima,
    # a não ser que o grupo inteiro não tenha negócio.
    out, cur = [], None
    for t, o, h, l, c, v in rows:
        g = t - t % tf
        if cur is None or cur[0] != g:
            if cur is not None:
                out.append(cur)
            cur = [g, o, h, l, c, v]
        elif cur[5] == 0 and v > 0:
            cur[1:] = [o, h, l, c, v]
        elif v == 0:
            cur[4] = c
        else:
            if h > cur[2]: cur[2] = h
            if l < cur[3]: cur[3] = l
            cur[4] = c
            cur[5] += v
    if cur is not None and cur[0] + tf <= last_end:
        out.append(cur)
    return out


def encode(bars, tf, d):
    scale = 10 ** d
    q = lambda p: int(round(p * scale))
    n = len(bars)
    t0 = bars[0][0]
    c0 = q(bars[0][4])
    dt, dc, do, uh, ul, vol = [], [], [], [], [], []
    prev_t, prev_c = t0, c0
    for t, o, h, l, c, v in bars:
        oi, hi, li, ci = q(o), q(h), q(l), q(c)
        step = (t - prev_t) // tf
        if step > 65535:
            raise ValueError("buraco grande demais")
        dt.append(step)
        dc.append(ci - prev_c); do.append(oi - prev_c)
        uh.append(hi - max(oi, ci)); ul.append(min(oi, ci) - li)
        vol.append(v)
        prev_t, prev_c = t, ci
    for col in (dc, do, uh, ul):
        if max(map(abs, col)) >= 2**31:
            raise ValueError("variação não cabe em 32 bits")
    head = b"CBK1" + struct.pack("<BBHIIIqI", 1, d, 0, tf, n, t0, c0, 0)
    body = (struct.pack(f"<{n}H", *dt) + struct.pack(f"<{n}i", *dc) + struct.pack(f"<{n}i", *do) +
            struct.pack(f"<{n}i", *uh) + struct.pack(f"<{n}i", *ul) + struct.pack(f"<{n}f", *vol))
    return gzip.compress(head + body, 9)


def months(start, end):
    y, m = start
    while (y, m) <= end:
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def build(sym, start, log):
    today = datetime.now(timezone.utc).date()
    last_month = (today.replace(day=1) - timedelta(days=1))
    jobs = [("monthly", f"{y}-{m:02d}") for y, m in months(start, (last_month.year, last_month.month))]
    d = today.replace(day=1)
    while d < today:  # mês corrente: arquivos diários até ontem
        jobs.append(("daily", d.isoformat()))
        d += timedelta(days=1)
    with ThreadPoolExecutor(8) as ex:
        paths = list(ex.map(lambda j: fetch_zip(sym, *j), jobs))
    missing = [s for (k, s), p in zip(jobs, paths) if p is None]
    paths = [p for p in paths if p]
    if not paths:
        log(f"{sym}: sem dados")
        return None
    if missing:
        log(f"{sym}: arquivos inexistentes (par mais novo ou dia ainda não publicado): {missing[:3]}{'...' if len(missing) > 3 else ''}")

    per_tf = {tf: {} for tf in TIMEFRAMES}  # tf -> ano -> barras
    dec = n1m = 0
    first = last_end = None
    # Cada arquivo é um mês ou um dia completo e começa em 00:00 UTC: nenhum candle (nem 4h, nem 1d)
    # atravessa dois arquivos, então cada arquivo é agrupado sozinho e sem guardar o 1m na memória.
    for p in paths:
        rows, d_ = read_zip(p)
        if not rows:
            continue
        dec = max(dec, d_)
        n1m += len(rows)
        first = rows[0][0] if first is None else first
        last_end = rows[-1][0] + 60
        for name, tf in TIMEFRAMES.items():
            for bar in aggregate(rows, tf, float("inf")):
                per_tf[name].setdefault(datetime.fromtimestamp(bar[0], timezone.utc).year, []).append(bar)

    info = {"decimals": dec, "first": first, "last_end": last_end, "bars_1m": n1m, "files": {}}
    for name, years in per_tf.items():
        for year, bars in sorted(years.items()):
            blob = encode(bars, TIMEFRAMES[name], dec)
            rel = f"{sym}/{name}/{year}.bin.gz"
            path = os.path.join(OUT, rel)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(blob)
            info["files"][rel] = {"n": len(bars), "bytes": len(blob)}
    total = sum(x["bytes"] for x in info["files"].values())
    log(f"{sym}: {n1m:,} candles de 1m, {dec} casas, {len(info['files'])} arquivos, {total / 1e6:.1f} MB")
    return info


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols", nargs="+")
    ap.add_argument("--start", default="2021-11")
    a = ap.parse_args()
    start = tuple(int(x) for x in a.start.split("-"))
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(mpath, encoding="utf-8")) if os.path.exists(mpath) else {"market": "spot", "symbols": {}}
    for sym in a.symbols:
        t = time.time()
        info = build(sym.upper(), start, print)
        if info:
            manifest["symbols"][sym.upper()] = info
        print(f"  ({time.time() - t:.0f}s)")
    manifest["updated"] = int(time.time())
    manifest["timeframes"] = TIMEFRAMES
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)


if __name__ == "__main__":
    main()
