"""Lista os N pares USDT do spot da Binance com maior volume em 24h (sem stablecoins e moedas fiduciárias)."""
import json
import sys
import urllib.request

STABLE = {"USDC", "FDUSD", "TUSD", "USDP", "DAI", "BUSD", "EUR", "EURI", "AEUR", "USD1", "XUSD", "BFUSD", "RLUSD",
          "PAXG", "TRY", "BRL", "GBP", "USDE", "PYUSD", "U"}


def top(n=30):
    req = urllib.request.Request("https://data-api.binance.vision/api/v3/ticker/24hr?type=MINI", headers={"User-Agent": "cripto-backtest-data"})
    rows = json.loads(urllib.request.urlopen(req, timeout=60).read())
    out = []
    for r in rows:
        s = r["symbol"]
        if not s.endswith("USDT") or s[:-4] in STABLE or s[:-4].endswith(("UP", "DOWN", "BULL", "BEAR")):
            continue
        out.append((float(r["quoteVolume"]), s))
    return [s for _, s in sorted(out, reverse=True)[:n]]


if __name__ == "__main__":
    print(" ".join(top(int(sys.argv[1]) if len(sys.argv) > 1 else 30)))
