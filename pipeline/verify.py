"""Confere os arquivos gerados contra a API de klines da Binance em janelas sorteadas.

Uso: python pipeline/verify.py BTCUSDT ETHUSDT [--samples 20]
"""
import argparse
import gzip
import json
import os
import random
import struct
import sys
import urllib.parse
import urllib.request
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out", "spot")
API = "https://data-api.binance.vision/api/v3/klines?"


def decode(path):
    raw = gzip.decompress(open(path, "rb").read())
    assert raw[:4] == b"CBK1"
    ver, d, _, tf, n, t0, c0, _ = struct.unpack_from("<BBHIIIqI", raw, 4)
    off = 32
    dt = struct.unpack_from(f"<{n}H", raw, off); off += 2 * n
    cols = []
    for _ in range(4):
        cols.append(struct.unpack_from(f"<{n}i", raw, off)); off += 4 * n
    vol = struct.unpack_from(f"<{n}f", raw, off)
    dc, do, uh, ul = cols
    scale = 10 ** d
    bars, t, c = [], t0, c0
    for i in range(n):
        t += dt[i] * tf
        o = c + do[i]
        c = c + dc[i]
        h = max(o, c) + uh[i]
        l = min(o, c) - ul[i]
        bars.append((t, o / scale, h / scale, l / scale, c / scale, vol[i]))
    return tf, bars


def api(sym, interval, start_s, limit):
    q = urllib.parse.urlencode({"symbol": sym, "interval": interval, "startTime": start_s * 1000, "limit": limit, "timeZone": "0"})
    with urllib.request.urlopen(urllib.request.Request(API + q, headers={"User-Agent": "cripto-backtest-data"}), timeout=30) as r:
        return [(int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])) for k in json.loads(r.read())]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols", nargs="+")
    ap.add_argument("--samples", type=int, default=12)
    a = ap.parse_args()
    manifest = json.load(open(os.path.join(OUT, "manifest.json"), encoding="utf-8"))
    rng = random.Random(7)
    ok = True
    for sym in a.symbols:
        files = manifest["symbols"][sym]["files"]
        size = defaultdict(int)
        for rel, x in files.items():
            size[rel.split("/")[1]] += x["bytes"]
        print(f"{sym}: tamanho por tempo gráfico:", {k: f"{v / 1e6:.1f} MB" for k, v in size.items()})
        for tf_name in manifest["timeframes"]:
            rels = [r for r in files if r.split("/")[1] == tf_name]
            checked = bad = 0
            worst_v = 0.0
            for _ in range(a.samples):
                rel = rng.choice(rels)
                tf, bars = decode(os.path.join(OUT, rel))
                i = rng.randrange(0, max(1, len(bars) - 50))
                mine = bars[i:i + 50]
                theirs = {b[0]: b for b in api(sym, tf_name, mine[0][0], 50)}
                for b in mine:
                    r = theirs.get(b[0])
                    if r is None:
                        continue
                    checked += 1
                    if any(abs(x - y) > 1e-9 * max(1, abs(y)) for x, y in zip(b[1:5], r[1:5])):
                        bad += 1
                        if bad <= 3:
                            print("   diferente:", tf_name, b, r)
                    if r[5] > 0:
                        worst_v = max(worst_v, abs(b[5] - r[5]) / r[5])
                # candles que a API tem e o arquivo não (deveria ser só o último incompleto)
            ok &= bad == 0
            print(f"  {tf_name:4}: {checked} candles conferidos, {bad} com preço diferente, maior erro de volume {worst_v * 100:.4f}%")
    print("OK" if ok else "HÁ DIFERENÇAS")


if __name__ == "__main__":
    main()
