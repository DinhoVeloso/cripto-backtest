"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { Check, Send, X } from "lucide-react";
import { BASE } from "@/lib/engine/templates";
import type { Result, Strategy } from "@/lib/engine/types";

type Provider = { id: string; label: string; model: string };

/** Resumo enxuto do backtest para o especialista (sem a lista inteira de operações). */
function summarize(r: Result | null) {
  if (!r) return null;
  const pick = (m: Result["metrics"]) => ({ operacoes: m.trades, acerto: +m.winRate.toFixed(1), rPorOp: +m.avgR.toFixed(3), ic95: [+m.ciLow.toFixed(3), +m.ciHigh.toFixed(3)], liquidoUsd: +m.netUsd.toFixed(2), brutoUsd: +m.grossUsd.toFixed(2), taxasUsd: +m.feesUsd.toFixed(2), quedaMaxPct: +m.maxDdPct.toFixed(1), fatorLucro: +m.profitFactor.toFixed(2) });
  const years: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.monthly)) years[k.slice(0, 4)] = +(((1 + (years[k.slice(0, 4)] ?? 0) / 100) * (1 + v / 100) - 1) * 100).toFixed(1);
  const reasons: Record<string, number> = {};
  for (const t of r.trades) reasons[t.reason] = (reasons[t.reason] ?? 0) + 1;
  return {
    geral: { ...pick(r.metrics), retornoPct: +r.metrics.returnPct.toFixed(1), cagrPct: +r.metrics.cagrPct.toFixed(1), sharpe: +r.metrics.sharpe.toFixed(2), candlesMedios: +r.metrics.avgBars.toFixed(0) },
    treino: pick(r.train), validacao: pick(r.test), aleatorio: r.random, monteCarlo: r.monteCarlo, porAno: years,
    porPar: Object.fromEntries(Object.entries(r.bySymbol).map(([s, m]) => [s, { op: m.trades, rPorOp: +m.avgR.toFixed(3), liquidoUsd: +m.netUsd.toFixed(2) }])),
    motivosDeSaida: reasons, sinais: r.signals, ignorados: r.skipped, avisos: r.warnings,
  };
}

function extractStrategy(text: string): Strategy | null {
  const m = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].pop();
  if (!m) return null;
  try {
    const s = JSON.parse(m[1]);
    if (!s || typeof s !== "object" || !Array.isArray(s.indicators) || !s.entry) return null;
    const b = structuredClone(BASE);
    // o modelo às vezes escreve "BTC" em vez de "BTCUSDT" ou um tempo gráfico que não existe
    const symbols = (Array.isArray(s.symbols) && s.symbols.length ? s.symbols : b.symbols).map((x: string) => { const u = String(x).toUpperCase().replace(/[^A-Z0-9]/g, ""); return u.endsWith("USDT") ? u : `${u}USDT`; });
    const tf = ["3m", "5m", "15m", "1h", "4h", "1d"].includes(s.tf) ? s.tf : b.tf;
    const date = (d: unknown, fb: string) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : fb);
    return { ...b, ...s, symbols, tf, from: date(s.from, b.from), to: date(s.to, b.to), side: "long", entry: { ...b.entry, ...s.entry }, stop: { ...b.stop, ...s.stop }, target: { ...b.target, ...s.target },
      exit: { ...b.exit, ...s.exit, trailing: { ...b.exit.trailing, ...s.exit?.trailing }, partial: { ...b.exit.partial, ...s.exit?.partial } },
      risk: { ...b.risk, ...s.risk }, costs: { ...b.costs, ...s.costs }, validation: { ...b.validation, ...s.validation } };
  } catch { return null; }
}

function Text({ text }: { text: string }) {
  // mostra o texto sem o bloco JSON (que vira o botão "Aplicar")
  const clean = text.replace(/```json[\s\S]*?(```|$)/g, "").trim();
  return <div className="whitespace-pre-wrap leading-relaxed">{clean.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith("**") && p.endsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p)}</div>;
}

const SUGGESTIONS = [
  "Por que essa estratégia perde dinheiro?",
  "Que filtro você testaria para melhorar só as compras?",
  "Monte uma estratégia de rompimento no 1h com filtro de tendência do BTC",
  "Quais fatores macro mais mexem com o preço do bitcoin?",
];

export function Chat({ strategy, result, onApply, onClose }: { strategy: Strategy; result: Result | null; onApply: (s: Strategy) => void; onClose: () => void }) {
  const [input, setInput] = useState("");
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [provider, setProvider] = useState("auto");
  const [applied, setApplied] = useState<string | null>(null);
  const { messages, sendMessage, status, error, stop } = useChat();
  const end = useRef<HTMLDivElement>(null);
  const summary = useMemo(() => summarize(result), [result]);

  useEffect(() => { fetch("/api/chat").then((r) => r.json()).then((d) => setProviders(d.providers)).catch(() => setProviders([])); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (text: string) => {
    if (!text.trim() || status === "streaming" || status === "submitted") return;
    sendMessage({ text }, { body: { context: { strategy, summary }, provider } });
    setInput("");
  };

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-full">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-medium">Especialista cripto</span>
        <select className="inp ml-auto h-7 text-xs" value={provider} onChange={(e) => setProvider(e.target.value)} title="Provedor de IA (gratuito)">
          <option value="auto">automático</option>
          {providers?.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button onClick={onClose} className="text-muted hover:text-text" title="Fechar"><X size={18} /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {providers && !providers.length && <p className="rounded border border-warn/40 p-2 text-xs text-warn">Nenhuma chave de IA configurada no servidor (GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY).</p>}
        {!messages.length && (
          <div className="space-y-2 text-muted">
            <p>Pergunte sobre o backtest na tela, peça para montar uma estratégia ou tire dúvidas sobre o mercado. Eu só respondo quando você pergunta.</p>
            {SUGGESTIONS.map((s) => <button key={s} className="block w-full rounded border border-line px-2 py-1.5 text-left text-xs hover:border-muted hover:text-text" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
        {messages.map((m) => {
          const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          const st = m.role === "assistant" && status !== "streaming" ? extractStrategy(text) : null;
          const meta = m.metadata as { provider?: string; model?: string } | undefined;
          return (
            <div key={m.id} className={m.role === "user" ? "ml-8 rounded-lg bg-accent/15 px-3 py-2" : ""}>
              <Text text={text} />
              {st && (
                <button className="btn mt-2 border-accent text-xs" onClick={() => { onApply(st); setApplied(m.id); }}>
                  {applied === m.id ? <><Check size={13} /> aplicada — clique para rodar de novo</> : "Aplicar e rodar backtest"}
                </button>
              )}
              {meta?.provider && <div className="mt-1 text-[10px] text-muted">{meta.provider} · {meta.model}</div>}
            </div>
          );
        })}
        {status === "submitted" && <p className="text-xs text-muted">pensando…</p>}
        {error && <p className="text-xs text-down">{readError(error)}</p>}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea className="inp h-16 flex-1 resize-none py-1.5" placeholder="Sua pergunta…" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        {status === "streaming" ? <button type="button" className="btn" onClick={stop}>parar</button> : <button className="btn btn-primary" disabled={!input.trim()}><Send size={14} /></button>}
      </form>
      <p className="px-3 pb-2 text-[10px] text-muted">Conteúdo educativo, não é recomendação de investimento.</p>
    </aside>
  );
}

function readError(e: Error) {
  try { const j = JSON.parse(e.message); if (j.error) return j.error; } catch { /* texto simples */ }
  return e.message || "Erro ao falar com o especialista.";
}
