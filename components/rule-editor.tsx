"use client";
import { Plus, Trash2 } from "lucide-react";
import { CATALOG } from "@/lib/engine/catalog";
import type { Cond, CondOp, Group, Operand, Strategy } from "@/lib/engine/types";

const OPS: { v: CondOp; label: string }[] = [
  { v: ">", label: "maior que" },
  { v: "<", label: "menor que" },
  { v: ">=", label: "maior ou igual" },
  { v: "<=", label: "menor ou igual" },
  { v: "crossAbove", label: "cruza para cima" },
  { v: "crossBelow", label: "cruza para baixo" },
  { v: "risingFor", label: "sobe há N candles" },
  { v: "fallingFor", label: "cai há N candles" },
];

const PRICE: { f: string; label: string }[] = [
  { f: "close", label: "Fechamento" }, { f: "open", label: "Abertura" }, { f: "high", label: "Máxima" }, { f: "low", label: "Mínima" },
  { f: "volume", label: "Volume" }, { f: "hl2", label: "(máx+mín)/2" }, { f: "hlc3", label: "(máx+mín+fech)/3" },
];
const TIME: { f: "hour" | "weekday" | "minute"; label: string }[] = [
  { f: "hour", label: "Hora (UTC)" }, { f: "weekday", label: "Dia da semana (0=dom)" }, { f: "minute", label: "Minuto" },
];

export function operandChoices(st: Strategy): { key: string; label: string; op: Operand }[] {
  const out: { key: string; label: string; op: Operand }[] = [{ key: "num", label: "Número", op: { kind: "num", value: 0 } }];
  for (const p of PRICE) out.push({ key: `price:${p.f}`, label: `Preço · ${p.label}`, op: { kind: "price", field: p.f as never } });
  for (const d of st.indicators) {
    const item = CATALOG[d.type];
    if (!item) continue;
    const where = [d.tf, d.symbol].filter(Boolean).join(" ");
    for (const o of item.outputs) out.push({ key: `ind:${d.id}:${o.key}`, label: `${d.id}${where ? ` (${where})` : ""} · ${o.label}`, op: { kind: "ind", ref: d.id, out: o.key } });
  }
  for (const t of TIME) out.push({ key: `time:${t.f}`, label: t.label, op: { kind: "time", field: t.f } });
  return out;
}

export function operandKey(op: Operand): string {
  if (op.kind === "num") return "num";
  if (op.kind === "price") return `price:${op.field}`;
  if (op.kind === "time") return `time:${op.field}`;
  return `ind:${op.ref}:${op.out}`;
}

export function OperandPicker({ st, value, onChange, allowNum = true }: { st: Strategy; value: Operand; onChange: (o: Operand) => void; allowNum?: boolean }) {
  const choices = operandChoices(st).filter((c) => allowNum || c.key !== "num");
  const key = operandKey(value);
  const shift = value.kind === "ind" || value.kind === "price" ? value.shift ?? 0 : 0;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <select className="inp max-w-56" value={key} onChange={(e) => {
        const c = choices.find((x) => x.key === e.target.value);
        if (c) onChange(structuredClone(c.op));
      }}>
        {!choices.some((c) => c.key === key) && <option value={key}>(indicador removido)</option>}
        {choices.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
      {value.kind === "num" && (
        <input className="inp w-24 num" type="number" step="any" value={value.value} onChange={(e) => onChange({ kind: "num", value: Number(e.target.value) })} />
      )}
      {(value.kind === "ind" || value.kind === "price") && (
        <label className="inline-flex items-center gap-1 text-xs text-muted" title="Usa o valor de N candles atrás">
          <input className="inp w-12 num" type="number" min={0} value={shift} onChange={(e) => onChange({ ...value, shift: Math.max(0, Number(e.target.value)) })} />
          atrás
        </label>
      )}
    </span>
  );
}

function CondRow({ st, c, onChange, onRemove }: { st: Strategy; c: Cond; onChange: (c: Cond) => void; onRemove: () => void }) {
  const rising = c.op === "risingFor" || c.op === "fallingFor";
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-line bg-panel-2/50 p-1.5">
      <OperandPicker st={st} value={c.left} onChange={(left) => onChange({ ...c, left })} allowNum={false} />
      <select className="inp" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as CondOp })}>
        {OPS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
      {rising ? (
        <input className="inp w-16 num" type="number" min={1} value={c.n ?? 1} onChange={(e) => onChange({ ...c, n: Math.max(1, Number(e.target.value)) })} />
      ) : (
        <OperandPicker st={st} value={c.right} onChange={(right) => onChange({ ...c, right })} />
      )}
      <button className="ml-auto text-muted hover:text-down" title="Remover condição" onClick={onRemove}><Trash2 size={14} /></button>
    </div>
  );
}

export function GroupEditor({ st, g, onChange, onRemove, depth = 0 }: { st: Strategy; g: Group; onChange: (g: Group) => void; onRemove?: () => void; depth?: number }) {
  const set = (i: number, it: Cond | Group) => onChange({ ...g, items: g.items.map((x, k) => (k === i ? it : x)) });
  const del = (i: number) => onChange({ ...g, items: g.items.filter((_, k) => k !== i) });
  const firstInd = st.indicators[0];
  const blank: Cond = {
    left: firstInd ? { kind: "ind", ref: firstInd.id, out: CATALOG[firstInd.type]?.outputs[0].key ?? "value" } : { kind: "price", field: "close" },
    op: ">", right: { kind: "num", value: 0 },
  };
  return (
    <div className={depth ? "rounded border border-dashed border-line p-2" : ""}>
      <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
        <select className="inp h-7 text-xs" value={g.mode} onChange={(e) => onChange({ ...g, mode: e.target.value as Group["mode"] })}>
          <option value="all">TODAS as condições (E)</option>
          <option value="any">QUALQUER condição (OU)</option>
        </select>
        {onRemove && <button className="text-muted hover:text-down" onClick={onRemove} title="Remover grupo"><Trash2 size={14} /></button>}
      </div>
      <div className="space-y-1.5">
        {g.items.map((it, i) => "mode" in it
          ? <GroupEditor key={i} st={st} g={it} depth={depth + 1} onChange={(x) => set(i, x)} onRemove={() => del(i)} />
          : <CondRow key={i} st={st} c={it} onChange={(x) => set(i, x)} onRemove={() => del(i)} />)}
        {!g.items.length && <p className="text-xs text-muted">Nenhuma condição.</p>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button className="btn h-7 text-xs" onClick={() => onChange({ ...g, items: [...g.items, structuredClone(blank)] })}><Plus size={13} /> condição</button>
        {depth < 2 && <button className="btn h-7 text-xs" onClick={() => onChange({ ...g, items: [...g.items, { mode: g.mode === "all" ? "any" : "all", items: [structuredClone(blank)] }] })}><Plus size={13} /> grupo</button>}
      </div>
    </div>
  );
}
