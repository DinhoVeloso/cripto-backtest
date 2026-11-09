"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { CATALOG, defaultParams } from "@/lib/engine/catalog";
import { FEE_PRESETS } from "@/lib/engine/templates";
import type { Manifest } from "@/lib/engine/data";
import type { IndicatorDef, Strategy } from "@/lib/engine/types";
import { GroupEditor, OperandPicker } from "./rule-editor";

const TFS = ["3m", "5m", "15m", "1h", "4h", "1d"];
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
          <span className="lbl">Pares (spot, contra USDT)</span>
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
        <p className="text-xs text-muted">Spot: só operações de compra (não existe venda a descoberto).</p>
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

      <Section title="Entrada (compra)" open>
        <GroupEditor st={st} g={st.entry.long ?? { mode: "all", items: [] }} onChange={(g) => up("entry", { long: g })} />
        <div className="grid grid-cols-2 gap-2">
          <label><span className="lbl">Tipo de ordem</span>
            <select className="inp w-full" value={st.entry.order} onChange={(e) => up("entry", { order: e.target.value as Strategy["entry"]["order"] })}>
              <option value="market">A mercado (abertura seguinte)</option>
              <option value="limit">Limitada abaixo do fechamento</option>
              <option value="stop">Stop no rompimento da máxima</option>
            </select>
          </label>
          {st.entry.order !== "market" && <Num label="Distância" suffix="%" step={0.05} value={st.entry.offsetPct} onChange={(v) => up("entry", { offsetPct: v })} />}
          {st.entry.order !== "market" && <Num label="Validade" suffix="candles" min={1} value={st.entry.validBars} onChange={(v) => up("entry", { validBars: v })} />}
          <Num label="Espera após sair" suffix="candles" min={0} value={st.entry.cooldownBars} onChange={(v) => up("entry", { cooldownBars: v })} />
        </div>
      </Section>

      <Section title="Stop" note={st.stop.type}>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="lbl">Tipo</span>
            <select className="inp w-full" value={st.stop.type} onChange={(e) => up("stop", { type: e.target.value as Strategy["stop"]["type"] })}>
              <option value="percent">% fixo</option>
              <option value="atr">Múltiplo do ATR</option>
              <option value="swing">Mínima dos últimos N candles</option>
              <option value="indicator">Valor de um indicador</option>
              <option value="none">Sem stop (não recomendado)</option>
            </select>
          </label>
          {(st.stop.type === "percent" || st.stop.type === "atr") && <Num label={st.stop.type === "percent" ? "Distância" : "Múltiplo"} suffix={st.stop.type === "percent" ? "%" : "x ATR"} step={0.1} value={st.stop.value} onChange={(v) => up("stop", { value: v })} />}
          {st.stop.type === "atr" && <Num label="Período do ATR" value={st.stop.atrPeriod} min={1} onChange={(v) => up("stop", { atrPeriod: v })} />}
          {st.stop.type === "swing" && <Num label="N candles" value={st.stop.lookback} min={1} onChange={(v) => up("stop", { lookback: v })} />}
          {(st.stop.type === "swing" || st.stop.type === "indicator") && <Num label="Folga" suffix="%" step={0.05} value={st.stop.bufferPct} onChange={(v) => up("stop", { bufferPct: v })} />}
          <Num label="Stop mínimo" suffix="%" step={0.1} value={st.stop.minPct} onChange={(v) => up("stop", { minPct: v })} hint="Sinais com stop mais curto são ignorados (o custo comeria o resultado)" />
          <Num label="Stop máximo" suffix="%" step={0.5} value={st.stop.maxPct} onChange={(v) => up("stop", { maxPct: v })} />
        </div>
        {st.stop.type === "indicator" && <OperandPicker st={st} value={st.stop.operand ?? { kind: "price", field: "low" }} onChange={(o) => up("stop", { operand: o })} allowNum={false} />}
      </Section>

      <Section title="Alvo" note={st.target.type}>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="lbl">Tipo</span>
            <select className="inp w-full" value={st.target.type} onChange={(e) => up("target", { type: e.target.value as Strategy["target"]["type"] })}>
              <option value="rr">Múltiplo do risco (R)</option>
              <option value="percent">% fixo</option>
              <option value="indicator">Nível de um indicador (acompanha)</option>
              <option value="none">Sem alvo (sai pelas regras de saída)</option>
            </select>
          </label>
          {(st.target.type === "rr" || st.target.type === "percent") && <Num label={st.target.type === "rr" ? "Risco:retorno" : "Distância"} suffix={st.target.type === "rr" ? "R" : "%"} step={0.1} value={st.target.value} onChange={(v) => up("target", { value: v })} />}
        </div>
        {st.target.type === "indicator" && <OperandPicker st={st} value={st.target.operand ?? { kind: "price", field: "high" }} onChange={(o) => up("target", { operand: o })} allowNum={false} />}
      </Section>

      <Section title="Saída e gestão da posição">
        <span className="lbl">Sair quando (avaliado no fechamento; sai na abertura seguinte)</span>
        <GroupEditor st={st} g={st.exit.long ?? { mode: "any", items: [] }} onChange={(g) => up("exit", { long: g })} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Tempo máximo" suffix="candles, 0 = livre" min={0} value={st.exit.maxBars} onChange={(v) => up("exit", { maxBars: v })} />
          <Num label="Mover stop p/ entrada em" suffix="R, 0 = não" step={0.1} min={0} value={st.exit.breakevenAtR} onChange={(v) => up("exit", { breakevenAtR: v })} />
          <label><span className="lbl">Stop móvel</span>
            <select className="inp w-full" value={st.exit.trailing.type} onChange={(e) => up("exit", { trailing: { ...st.exit.trailing, type: e.target.value as "none" } })}>
              <option value="none">Desligado</option><option value="percent">% abaixo da máxima</option><option value="atr">ATR abaixo da máxima</option>
            </select>
          </label>
          {st.exit.trailing.type !== "none" && <Num label="Distância" suffix={st.exit.trailing.type === "percent" ? "%" : "x ATR"} step={0.1} value={st.exit.trailing.value} onChange={(v) => up("exit", { trailing: { ...st.exit.trailing, value: v } })} />}
          <Num label="Parcial em" suffix="R, 0 = não" step={0.1} min={0} value={st.exit.partial.atR} onChange={(v) => up("exit", { partial: { ...st.exit.partial, atR: v } })} />
          {st.exit.partial.atR > 0 && <Num label="Fração da parcial" suffix="0 a 1" step={0.05} min={0} max={1} value={st.exit.partial.fraction} onChange={(v) => up("exit", { partial: { ...st.exit.partial, fraction: v } })} />}
        </div>
      </Section>

      <Section title="Banca e risco" note={`US$ ${st.risk.capital}`}>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Banca inicial" suffix="US$" min={1} value={st.risk.capital} onChange={(v) => up("risk", { capital: v })} />
          <Num label="Risco por operação" suffix="%" step={0.1} value={st.risk.riskPct} onChange={(v) => up("risk", { riskPct: v })} />
          <Num label="Teto por posição" suffix="% da banca" value={st.risk.maxPositionPct} onChange={(v) => up("risk", { maxPositionPct: v })} />
          <Num label="Reserva intocável" suffix="%" value={st.risk.cashBufferPct} onChange={(v) => up("risk", { cashBufferPct: v })} />
          <Num label="Posições ao mesmo tempo" min={1} value={st.risk.maxOpen} onChange={(v) => up("risk", { maxOpen: v })} />
          <Num label="Operações por dia" suffix="0 = livre" min={0} value={st.risk.maxTradesDay} onChange={(v) => up("risk", { maxTradesDay: v })} />
          <Num label="Perda máxima no dia" suffix="%, 0 = livre" step={0.5} min={0} value={st.risk.maxLossDayPct} onChange={(v) => up("risk", { maxLossDayPct: v })} />
          <Num label="Compra mínima" suffix="US$" step={1} min={0} value={st.risk.minNotional} onChange={(v) => up("risk", { minNotional: v })} />
        </div>
      </Section>

      <Section title="Custos" note={FEE_PRESETS[st.costs.preset]?.label ?? "personalizado"}>
        <label className="block"><span className="lbl">Corretora</span>
          <select className="inp w-full" value={FEE_PRESETS[st.costs.preset] ? st.costs.preset : ""} onChange={(e) => { const p = FEE_PRESETS[e.target.value]; if (p) up("costs", { preset: e.target.value, takerPct: p.takerPct, makerPct: p.makerPct, slippagePct: p.slippagePct }); }}>
            {!FEE_PRESETS[st.costs.preset] && <option value="">personalizado</option>}
            {Object.entries(FEE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <Num label="Taxa taker" suffix="%" step={0.005} value={st.costs.takerPct} onChange={(v) => up("costs", { takerPct: v, preset: "custom" })} />
          <Num label="Taxa maker" suffix="%" step={0.005} value={st.costs.makerPct} onChange={(v) => up("costs", { makerPct: v, preset: "custom" })} />
          <Num label="Slippage" suffix="% por lado" step={0.005} value={st.costs.slippagePct} onChange={(v) => up("costs", { slippagePct: v, preset: "custom" })} />
        </div>
        <p className="text-xs text-muted">Taker: ordens a mercado, stops e saídas por regra. Maker: alvos e ordens limitadas.</p>
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
