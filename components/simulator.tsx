"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Play, RotateCcw } from "lucide-react";
import { DATA_URL } from "@/lib/config";
import { TF } from "@/lib/engine/backtest";
import type { Manifest } from "@/lib/engine/data";
import { BASE, TEMPLATES } from "@/lib/engine/templates";
import type { Result, Strategy, Trade } from "@/lib/engine/types";
import type { WorkerIn, WorkerOut } from "@/lib/engine/worker";
import { StrategyForm } from "./strategy-form";
import { Results } from "./results";
import { Chat } from "./chat";

const KEY = "cb:strategy:v1";

function loadSaved(): Strategy {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...structuredClone(BASE), ...JSON.parse(raw) };
  } catch { /* sem armazenamento: começa do modelo */ }
  return structuredClone(TEMPLATES.pctb_trend.strategy);
}

export function Simulator() {
  const [st, setSt] = useState<Strategy>(() => structuredClone(TEMPLATES.pctb_trend.strategy));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [randomPending, setRandomPending] = useState(false);
  const [chat, setChat] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const waiters = useRef(new Map<number, (m: WorkerOut) => void>());
  const loaded = useRef(false);
  const current = useRef(st);
  const manifestRef = useRef<Manifest | null>(null);
  useEffect(() => { current.current = st; }, [st]);

  useEffect(() => {
    // estado salvo só existe no navegador: lido depois da montagem para não divergir do HTML do servidor
    if (!loaded.current) { loaded.current = true; setSt(loadSaved()); }
    const w = new Worker(new URL("../lib/engine/worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => waiters.current.get(ev.data.id)?.(ev.data);
    worker.current = w;
    fetch(`${DATA_URL}/manifest.json`).then((r) => r.json()).then((m: Manifest) => {
      manifestRef.current = m;
      setManifest(m);
      // estratégia salva pode ter pares que saíram da lista
      setSt((s) => { const symbols = s.symbols.filter((x) => m.symbols[x]); return symbols.length === s.symbols.length ? s : { ...s, symbols: symbols.length ? symbols : ["BTCUSDT"] }; });
    }).catch(() => setError("Não foi possível carregar a lista de pares."));
    return () => w.terminate();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignora */ }
  }, [st]);

  const runBacktest = useCallback((override?: Strategy) => {
    const st = override ?? current.current;
    if (!worker.current) return;
    if (!st.symbols.length) { setError("Escolha pelo menos um par."); return; }
    const known = manifestRef.current?.symbols;
    const missing = known ? [...new Set([...st.symbols, ...st.indicators.map((i) => i.symbol).filter((x): x is string => !!x)])].filter((x) => !known[x]) : [];
    if (missing.length) { setError(`Par sem dados no simulador: ${missing.join(", ")}.`); return; }
    if (!st.entry.long?.items.length) { setError("Defina pelo menos uma condição de entrada."); return; }
    const id = ++seq.current;
    setBusy(true); setError(""); setStatus("baixando dados"); setRandomPending(false);
    waiters.current.clear();
    waiters.current.set(id, (m) => {
      if (m.type === "progress") setStatus(m.msg);
      else if (m.type === "result") { setResult(m.result); setBusy(false); setStatus(""); setRandomPending(m.result.strategy.validation.randomRuns > 0); }
      else if (m.type === "random") { setResult((r) => (r ? { ...r, random: m.random, warnings: [...r.warnings, ...m.warnings] } : r)); setRandomPending(false); waiters.current.delete(id); }
      else if (m.type === "error") { setError(m.error); setBusy(false); setStatus(""); setRandomPending(false); waiters.current.delete(id); }
    });
    worker.current.postMessage({ type: "run", id, strategy: st, dataUrl: absolute(DATA_URL) } satisfies WorkerIn);
  }, []);

  const loadWindow = useCallback((t: Trade) => new Promise<{ candles: { t: number; o: number; h: number; l: number; c: number }[]; overlays: { name: string; values: (number | null)[] }[] }>((resolve, reject) => {
    const id = ++seq.current;
    const strategy = result?.strategy ?? st;
    const pad = TF[strategy.tf] * 60;
    waiters.current.set(id, (m) => {
      if (m.type === "window") { waiters.current.delete(id); resolve({ candles: m.candles, overlays: m.overlays }); }
      if (m.type === "error") { waiters.current.delete(id); reject(new Error(m.error)); }
    });
    worker.current?.postMessage({ type: "window", id, strategy, dataUrl: absolute(DATA_URL), symbol: t.symbol, from: t.entryTime - pad, to: t.exitTime + pad / 2 } satisfies WorkerIn);
  }), [result, st]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2">
        <span className="mr-2 font-semibold">Cripto Backtest</span>
        <input className="inp w-56" value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} title="Nome da estratégia" />
        <select className="inp w-64" value="" onChange={(e) => { const t = TEMPLATES[e.target.value]; if (t) { setSt(structuredClone(t.strategy)); setResult(null); } }}>
          <option value="">Carregar modelo pronto…</option>
          {Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <button className="btn" title="Começar do zero" onClick={() => { setSt(structuredClone(BASE)); setResult(null); }}><RotateCcw size={14} /> nova</button>
        <button className="btn btn-primary" onClick={() => runBacktest()} disabled={busy}><Play size={14} /> {busy ? status || "rodando…" : "Rodar backtest"}</button>
        {randomPending && <span className="text-xs text-muted">comparando com entradas aleatórias…</span>}
        <button className={`btn ml-auto ${chat ? "border-accent" : ""}`} onClick={() => setChat(!chat)}><MessageSquare size={14} /> Especialista</button>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[440px] shrink-0 overflow-y-auto border-r border-line bg-panel max-lg:w-[360px] max-md:hidden">
          <StrategyForm st={st} set={setSt} manifest={manifest} />
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && <div className="card mb-3 border-down/40 bg-down/5 p-3 text-sm text-down">{error}</div>}
          {result ? <Results r={result} randomPending={randomPending} loadWindow={loadWindow} /> : (
            <div className="mx-auto mt-16 max-w-xl text-center text-sm text-muted">
              <p className="mb-2 text-base text-text">Monte a estratégia no painel à esquerda e clique em <b>Rodar backtest</b>.</p>
              <p>Dados reais do spot da Binance, até 5 anos, de 3 minutos ao diário. O cálculo roda no seu navegador e considera taxas, slippage, banca e limites de risco.</p>
              <p className="mt-3">{st.symbols.length} par(es) · {st.tf} · {st.from} a {st.to}</p>
            </div>
          )}
        </main>
        {chat && <Chat strategy={st} result={result} onApply={(s) => { setSt(s); setResult(null); runBacktest(s); }} onClose={() => setChat(false)} />}
      </div>
    </div>
  );
}

function absolute(u: string) {
  return u.startsWith("http") ? u : new URL(u, location.origin).toString();
}
