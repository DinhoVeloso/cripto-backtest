"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CATALOG, defaultParams } from "@/lib/engine/catalog";
import { breakEvenPct } from "@/lib/engine/binary";
import type { Manifest } from "@/lib/engine/data";
import type { IndicatorDef, Strategy } from "@/lib/engine/types";
import { GroupEditor } from "./rule-editor";

const TFS = ["1m", "3m", "5m"];
const TF_RANK: Record<string, number> = Object.fromEntries(TFS.map((t, i) => [t, i]));

function Num({ label, value, onChange, step = 1, min, max, hint, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string; suffix?: string }) {
  return (
    <label className="block" title={hint}>
      <span className="lbl">{label}{suffix ? ` (${suffix})` : ""}</span>
      <input className="inp w-full num" type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : 0}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

function Section({ title, children, open = false, note }: { title: string; children: React.ReactNode; open?: boolean; note?: string }) {
  return (
    <details open={open} className="group border-b border-line">
      <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-panel-2">
        <span>{title}</span>
        {note && <span className="text-xs font-normal text-muted">{note}</span>}
      </summary>
      <div className="space-y-3 px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}

export function StrategyForm({ st, set, manifest }: { st: Strategy; set: (s: Strategy) => void; manifest: Manifest | null }) {
  const up = <K extends keyof Strategy>(k: K, v: Partial<Strategy[K]>) => set({ ...st, [k]: typeof st[k] === "object" && !Array.isArray(st[k]) ? { ...(st[k] as object), ...v } : v } as Strategy);
  const [query, setQuery] = useState("");
  const [newType, setNewType] = useState("ema");
  const symbols = useMemo(() => Object.keys(manifest?.symbols ?? {}), [manifest]);
  const firstDate = (sym: string) => manifest?.symbols[sym] ? new Date(manifest.symbols[sym].first * 1000).toISOString().slice(0, 10) : "";
  const earliest = st.symbols.map(firstDate).filter(Boolean).sort().pop();

  const setInd = (i: number, d: IndicatorDef) => set({ ...st, indicators: st.indicators.map((x, k) => (k === i ? d : x)) });
  const addInd = () => {
    let id = newType, k = 2;
    while (st.indicators.some((d) => d.id === id)) id = `${newType}${k++}`;
    set({ ...st, indicators: [...st.indicators, { id, type: newType, params: defaultParams(newType) }] });
  };

  return (
    <div className="text-sm">
      <Section title="Mercado e período" open note={`${st.symbols.length} par(es) · ${st.tf}`}>
        <div>
          <span className="lbl">Par (um por vez)</span>
          <input className="inp mb-1.5 w-full" placeholder="buscar…" value={query} onChange={(e) => setQuery(e.target.value.toUpperCase())} />
          <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {symbols.filter((s) => s.includes(query)).map((s) => (
              <label key={s} className={`flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-xs ${st.symbols.includes(s) ? "bg-accent/20 text-text" : "text-muted hover:bg-panel-2"}`} title={`dados desde ${firstDate(s)}`}>
                <input type="checkbox" className="accent-accent" checked={st.symbols.includes(s)} onChange={(e) => set({ ...st, symbols: e.target.checked ? [...st.symbols, s] : st.symbols.filter((x) => x !== s) })} />
                {s}
              </label>
            ))}
            {!symbols.length && <p className="col-span-3 text-xs text-muted">carregando a lista de pares…</p>}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <button className="btn h-7 text-xs" onClick={() => set({ ...st, symbols: symbols.slice(0, 10) })}>10 primeiros</button>
            <button className="btn h-7 text-xs" onClick={() => set({ ...st, symbols })}>todos</button>
            <button className="btn h-7 text-xs" onClick={() => set({ ...st, symbols: [] })}>limpar</button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label><span className="lbl">Tempo gráfico</span>
            <select className="inp w-full" value={st.tf} onChange={(e) => set({ ...st, tf: e.target.value })}>{TFS.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          <label><span className="lbl">De</span><input className="inp w-full" type="date" value={st.from} onChange={(e) => set({ ...st, from: e.target.value })} /></label>
          <label><span className="lbl">Até</span><input className="inp w-full" type="date" value={st.to} onChange={(e) => set({ ...st, to: e.target.value })} /></label>
        </div>
        {earliest && earliest > st.from && <p className="text-xs text-warn">Algum par escolhido só tem dados a partir de {earliest}.</p>}
        <p className="text-xs text-muted">Opções binárias de 1 candle: o resultado sai no fechamento do candle seguinte.</p>
      </Section>

      <Section title="Indicadores" open note={`${st.indicators.length}`}>
        {st.indicators.map((d, i) => {
          const item = CATALOG[d.type];
          return (
            <div key={i} className="space-y-2 rounded border border-line bg-panel-2/40 p-2">
              <div className="flex items-center gap-1.5">
                <input className="inp w-24 font-mono text-xs" value={d.id} title="Nome usado nas regras"
                  onChange={(e) => {
                    const id = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
                    if (!id || st.indicators.some((x, k) => k !== i && x.id === id)) return;
                    set(renameRef({ ...st, indicators: st.indicators.map((x, k) => (k === i ? { ...x, id } : x)) }, d.id, id));
                  }} />
                <span className="flex-1 truncate text-xs text-muted">{item?.label ?? d.type}</span>
                <button className="text-muted hover:text-down" title="Remover indicador" onClick={() => set({ ...st, indicators: st.indicators.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {item?.params.map((p) => p.options ? (
                  <label key={p.key}><span className="lbl">{p.label}</span>
                    <select className="inp w-full" value={String(d.params[p.key] ?? p.default)} onChange={(e) => setInd(i, { ...d, params: { ...d.params, [p.key]: e.target.value } })}>
                      {p.options.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </label>
                ) : (
                  <Num key={p.key} label={p.label} value={Number(d.params[p.key] ?? p.default)} step={p.step ?? 1} min={p.min} max={p.max} onChange={(v) => setInd(i, { ...d, params: { ...d.params, [p.key]: v } })} />
                ))}
                <label><span className="lbl">Tempo</span>
                  <select className="inp w-full" value={d.tf ?? ""} onChange={(e) => setInd(i, { ...d, tf: e.target.value || undefined })}>
                    <option value="">o da estratégia</option>
                    {TFS.filter((t) => TF_RANK[t] > TF_RANK[st.tf]).map((t) => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label><span className="lbl">Par</span>
                  <select className="inp w-full" value={d.symbol ?? ""} onChange={(e) => setInd(i, { ...d, symbol: e.target.value || undefined })}>
                    <option value="">o próprio par</option>
                    {symbols.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
        <div className="flex gap-1.5">
          <select className="inp flex-1" value={newType} onChange={(e) => setNewType(e.target.value)}>
            {Object.entries(groupBy()).map(([g, items]) => (
              <optgroup key={g} label={g}>{items.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</optgroup>
            ))}
          </select>
          <button className="btn" onClick={addInd}><Plus size={14} /> adicionar</button>
        </div>
      </Section>

      <Section title="Sobe (compra) quando…" open note={`${st.entry.long?.items.length ?? 0} condição(ões)`}>
        <GroupEditor st={st} g={st.entry.long ?? { mode: "all", items: [] }} onChange={(g) => up("entry", { long: g })} />
      </Section>

      <Section title="Desce (venda) quando…" open note={`${st.entry.short?.items.length ?? 0} condição(ões)`}>
        <GroupEditor st={st} g={st.entry.short ?? { mode: "all", items: [] }} onChange={(g) => up("entry", { short: g })} />
      </Section>

      <Section title="Aposta e payout" open note={`${st.binary.payoutPct}% · acerto mínimo ${breakEvenPct(st.binary.payoutPct).toFixed(1)}%`}>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Payout" suffix="% do valor" step={1} min={1} max={500} value={st.binary.payoutPct} onChange={(v) => up("binary", { payoutPct: v })} hint="Quanto a corretora paga sobre o valor apostado quando você acerta. Quando erra, perde o valor inteiro." />
          <Num label="Banca inicial" suffix="US$" min={1} value={st.risk.capital} onChange={(v) => up("risk", { capital: v })} />
          <label><span className="lbl">Valor da aposta</span>
            <select className="inp w-full" value={st.binary.stakeMode} onChange={(e) => up("binary", { stakeMode: e.target.value as "fixed" | "percent" })}>
              <option value="fixed">Fixo (US$)</option>
              <option value="percent">% da banca atual</option>
            </select>
          </label>
          <Num label="Valor" suffix={st.binary.stakeMode === "fixed" ? "US$" : "% da banca"} step={st.binary.stakeMode === "fixed" ? 0.5 : 0.5} min={0.01} value={st.binary.stake} onChange={(v) => up("binary", { stake: v })} />
        </div>
        <p className="text-xs text-muted">Você aposta durante o candle do sinal (antes dos 5 segundos finais) e o resultado é a <b>cor do candle seguinte</b>: verde = &quot;sobe&quot; ganha, vermelho = &quot;desce&quot; ganha. O preço de entrada não conta.</p>
        <p className="text-xs text-muted">Com payout de {st.binary.payoutPct}% você precisa acertar mais de {breakEvenPct(st.binary.payoutPct).toFixed(1)}% das apostas só para não perder dinheiro.</p>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={st.binary.allowOverlap} onChange={(e) => up("binary", { allowOverlap: e.target.checked })} />
          permitir várias apostas abertas ao mesmo tempo
        </label>
        <label className="flex items-center gap-2 text-xs" title="Desligado: continua apostando o mesmo valor mesmo depois de a banca acabar (a banca fica negativa), para ver se a estratégia tem vantagem no período todo."><input type="checkbox" className="accent-accent" checked={!!st.binary.stopWhenBroke} onChange={(e) => up("binary", { stopWhenBroke: e.target.checked })} />
          parar de apostar quando a banca não cobrir o valor
        </label>
      </Section>

      <Section title="Pausa depois de perder" note={st.binary.rearm ? "ligada" : "desligada"}>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-accent" checked={!!st.binary.rearm}
          onChange={(e) => up("binary", { rearm: e.target.checked ? { mode: "all", items: [] } : undefined })} />
          depois de uma aposta perdida, parar até o candle cumprir esta condição
        </label>
        {st.binary.rearm && <GroupEditor st={st} g={st.binary.rearm} onChange={(g) => up("binary", { rearm: g })} />}
        {st.binary.rearm && <p className="text-xs text-muted">Vale a partir do candle seguinte à perda. Ex.: o candle toca o meio do canal (mínima ≤ meio e máxima ≥ meio). Em indicadores que usam o candle atual (Bollinger, médias, IFR), use &quot;1 atrás&quot;.</p>}
      </Section>

      <Section title="Validação">
        <div className="grid grid-cols-2 gap-2">
          <Num label="Período de validação" suffix="% final" min={0} max={90} value={st.validation.testPct} onChange={(v) => up("validation", { testPct: v })} />
          <Num label="Rodadas aleatórias" suffix="0 = não" min={0} max={200} value={st.validation.randomRuns} onChange={(v) => up("validation", { randomRuns: v })} />
          <Num label="Simulações Monte Carlo" min={0} max={5000} step={100} value={st.validation.monteCarloRuns} onChange={(v) => up("validation", { monteCarloRuns: v })} />
          <Num label="Semente" value={st.validation.seed} onChange={(v) => up("validation", { seed: v })} />
        </div>
      </Section>
    </div>
  );
}

function groupBy() {
  const out: Record<string, [string, (typeof CATALOG)[string]][]> = {};
  for (const [k, v] of Object.entries(CATALOG)) (out[v.group] ??= []).push([k, v]);
  return out;
}

/** Atualiza as referências quando um indicador muda de nome. */
function renameRef(st: Strategy, from: string, to: string): Strategy {
  const walk = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const x = o as Record<string, unknown>;
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x)) copy[k] = walk(v);
      if (copy.kind === "ind" && copy.ref === from) copy.ref = to;
      return copy;
    }
    return o;
  };
  return { ...st, entry: walk(st.entry) as Strategy["entry"], exit: walk(st.exit) as Strategy["exit"], stop: walk(st.stop) as Strategy["stop"], target: walk(st.target) as Strategy["target"] };
}
