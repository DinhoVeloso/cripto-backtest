"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Metrics, Result, Trade } from "@/lib/engine/types";
import { EquityChart, TradeChart, type Candle } from "./charts";

const usd = (v: number) => `${v < 0 ? "-" : ""}US$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const sign = (v: number) => (v > 0 ? "text-up" : v < 0 ? "text-down" : "");
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const price = (p: number) => p.toLocaleString("pt-BR", { maximumFractionDigits: p >= 1000 ? 2 : p >= 1 ? 4 : 8 });
const REASON: Record<Trade["reason"], string> = { stop: "stop", target: "alvo", exit: "regra de saída", time: "tempo", trail: "stop móvel", breakeven: "no zero a zero", end: "fim do período" };

function Card({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="card px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num text-lg font-semibold ${cls}`}>{value}</div>
      {sub && <div className="num text-xs text-muted">{sub}</div>}
    </div>
  );
}

function MiniMetrics({ m, title }: { m: Metrics; title: string }) {
  return (
    <div className="flex-1">
      <div className="mb-1 text-xs text-muted">{title}</div>
      <div className={`num text-base font-semibold ${sign(m.avgR)}`}>{f(m.avgR, 3)} R/op</div>
      <div className="num text-xs text-muted">{m.trades} operações · acerto {f(m.winRate, 0)}% · {usd(m.netUsd)}</div>
    </div>
  );
}

export function Results({ r, randomPending, loadWindow }: {
  r: Result; randomPending: boolean;
  loadWindow: (t: Trade) => Promise<{ candles: Candle[]; overlays: { name: string; values: (number | null)[] }[] }>;
}) {
  const m = r.metrics;
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<{ t: Trade; w: Awaited<ReturnType<typeof loadWindow>> } | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const years = useMemo(() => [...new Set(Object.keys(r.monthly).map((k) => k.slice(0, 4)))].sort(), [r.monthly]);
  const trades = [...r.trades].reverse();
  const per = 50;

  return (
    <div className="space-y-4">
      {r.warnings.length > 0 && (
        <div className="card border-warn/40 bg-warn/5 p-3">
          {r.warnings.map((w, i) => <p key={i} className="flex gap-2 text-sm text-warn"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{w}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="Resultado líquido" value={usd(m.netUsd)} sub={`${f(m.returnPct, 1)}% · ao ano ${f(m.cagrPct, 1)}%`} cls={sign(m.netUsd)} />
        <Card label="Resultado por operação" value={`${f(m.avgR, 3)} R`} sub={`IC 95%: ${f(m.ciLow, 2)} a ${f(m.ciHigh, 2)}`} cls={sign(m.avgR)} />
        <Card label="Operações" value={String(m.trades)} sub={`acerto ${f(m.winRate, 1)}% · ${f(m.avgBars, 0)} candles em média`} />
        <Card label="Queda máxima" value={`${f(m.maxDdPct, 1)}%`} sub={`pior sequência: ${m.maxLosingStreak} perdas`} cls={m.maxDdPct > 30 ? "text-down" : ""} />
        <Card label="Custos pagos" value={usd(m.feesUsd)} sub={`bruto ${usd(m.grossUsd)}`} />
        <Card label="Fator de lucro" value={f(m.profitFactor, 2)} sub={`Sharpe ${f(m.sharpe, 2)}`} />
        <Card label="Média por operação" value={usd(m.expectancyUsd)} cls={sign(m.expectancyUsd)} sub={`melhor ${f(m.bestR, 1)}R · pior ${f(m.worstR, 1)}R`} />
        <Card label="Tempo posicionado" value={`${f(m.exposurePct, 1)}%`} sub="por par" />
        <Card label="Sinais" value={String(r.signals)} sub={`${Object.values(r.skipped).reduce((a, b) => a + b, 0)} ignorados`} />
        <Card label="Cálculo" value={`${f(r.ms / 1000, 1)} s`} sub="no seu navegador" />
      </div>

      <div className="card p-3">
        <div className="mb-2 text-sm font-medium">Patrimônio (marcado a mercado, diário)</div>
        <EquityChart points={r.equity} capital={r.strategy.risk.capital} split={r.splitTime} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-3">
          <div className="mb-2 text-sm font-medium">Treino × validação</div>
          <div className="flex gap-3">
            <MiniMetrics m={r.train} title="treino" />
            <MiniMetrics m={r.test} title={`validação (${r.strategy.validation.testPct}% final)`} />
          </div>
          <p className="mt-2 text-xs text-muted">Se você ajustou a estratégia olhando o resultado, só a validação conta.</p>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-sm font-medium">Contra entradas aleatórias</div>
          {r.random ? (
            <>
              <div className="num text-base font-semibold">aleatório: {f(r.random.avgR, 3)} R/op</div>
              <div className="num text-xs text-muted">faixa de 90%: {f(r.random.p5, 3)} a {f(r.random.p95, 3)} · {r.random.runs} rodadas</div>
              <div className={`num mt-1 text-sm ${r.random.beatPct >= 95 ? "text-up" : "text-warn"}`}>a estratégia superou {f(r.random.beatPct, 0)}% das rodadas</div>
            </>
          ) : <p className="text-xs text-muted">{randomPending ? "calculando…" : "desligado ou sem sinais"}</p>}
          <p className="mt-2 text-xs text-muted">Mesmas saídas, custos e banca, com entradas sorteadas na mesma frequência.</p>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-sm font-medium">Monte Carlo (ordem embaralhada)</div>
          {r.monteCarlo ? (
            <div className="num space-y-0.5 text-sm">
              <div>queda máxima típica: {f(r.monteCarlo.ddP50, 1)}% · pior 5%: <span className="text-down">{f(r.monteCarlo.ddP95, 1)}%</span></div>
              <div>resultado: {f(r.monteCarlo.finalP5, 1)}% / {f(r.monteCarlo.finalP50, 1)}% / {f(r.monteCarlo.finalP95, 1)}%</div>
              <div className="text-xs text-muted">(5% piores / mediana / 5% melhores)</div>
              <div>chance de cair 50% ou mais: {f(r.monteCarlo.ruinPct, 1)}%</div>
            </div>
          ) : <p className="text-xs text-muted">poucas operações</p>}
        </div>
      </div>

      <div className="card overflow-x-auto p-3">
        <div className="mb-2 text-sm font-medium">Resultado por mês (% da banca)</div>
        <table className="num w-full text-xs">
          <thead><tr className="text-muted"><th className="text-left font-normal">ano</th>{["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"].map((x) => <th key={x} className="font-normal">{x}</th>)}<th className="font-normal">ano</th></tr></thead>
          <tbody>
            {years.map((y) => {
              let acc = 1;
              return (
                <tr key={y}>
                  <td className="py-0.5 text-muted">{y}</td>
                  {Array.from({ length: 12 }, (_, k) => {
                    const v = r.monthly[`${y}-${String(k + 1).padStart(2, "0")}`];
                    if (v !== undefined) acc *= 1 + v / 100;
                    const a = v === undefined ? 0 : Math.min(Math.abs(v) / 10, 1);
                    return <td key={k} className="px-0.5 py-0.5 text-center" style={{ background: v === undefined ? undefined : v >= 0 ? `rgba(34,197,94,${0.12 + a * 0.5})` : `rgba(239,68,68,${0.12 + a * 0.5})` }}>{v === undefined ? "" : f(v, 1)}</td>;
                  })}
                  <td className={`text-center font-semibold ${sign(acc - 1)}`}>{f((acc - 1) * 100, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card overflow-x-auto p-3">
          <div className="mb-2 text-sm font-medium">Por par</div>
          <table className="num w-full text-xs">
            <thead><tr className="text-left text-muted"><th className="font-normal">par</th><th className="font-normal">op.</th><th className="font-normal">acerto</th><th className="font-normal">R/op</th><th className="font-normal">líquido</th></tr></thead>
            <tbody>{Object.entries(r.bySymbol).sort((a, b) => b[1].netUsd - a[1].netUsd).map(([s, x]) => (
              <tr key={s} className="border-t border-line"><td className="py-1">{s}</td><td>{x.trades}</td><td>{f(x.winRate, 0)}%</td><td className={sign(x.avgR)}>{f(x.avgR, 3)}</td><td className={sign(x.netUsd)}>{usd(x.netUsd)}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card p-3">
          <div className="mb-2 text-sm font-medium">Sinais ignorados</div>
          {Object.keys(r.skipped).length ? (
            <ul className="num space-y-1 text-xs">{Object.entries(r.skipped).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between border-t border-line pt-1"><span>{k}</span><span>{v}</span></li>)}</ul>
          ) : <p className="text-xs text-muted">nenhum</p>}
        </div>
      </div>

      <div className="card overflow-x-auto p-3">
        <div className="mb-2 flex items-center justify-between text-sm font-medium">
          <span>Operações ({r.trades.length}) — clique para ver no gráfico</span>
          <span className="flex items-center gap-1 text-xs font-normal">
            <button className="btn h-6 px-2" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
            {page + 1}/{Math.max(1, Math.ceil(trades.length / per))}
            <button className="btn h-6 px-2" disabled={(page + 1) * per >= trades.length} onClick={() => setPage(page + 1)}>›</button>
          </span>
        </div>
        <table className="num w-full text-xs">
          <thead><tr className="text-left text-muted">{["entrada", "par", "preço", "saída", "motivo", "candles", "taxas", "líquido", "R", "banca"].map((h) => <th key={h} className="font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {trades.slice(page * per, page * per + per).map((t, i) => (
              <tr key={i} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={async () => {
                setLoading(t.entryTime);
                try { setOpen({ t, w: await loadWindow(t) }); } finally { setLoading(null); }
              }}>
                <td className="py-1">{loading === t.entryTime ? "carregando…" : date(t.entryTime)}</td><td>{t.symbol.replace(/USDT$/, "")}</td>
                <td>{price(t.entryPrice)} → {price(t.exitPrice)}</td><td>{date(t.exitTime)}</td><td>{REASON[t.reason]}</td><td>{t.bars}</td>
                <td>{usd(t.feesUsd)}</td><td className={sign(t.pnlUsd)}>{usd(t.pnlUsd)}</td><td className={sign(t.r)}>{f(t.r, 2)}</td><td>{usd(t.equityAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(null)}>
          <div className="card w-full max-w-5xl p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>{open.t.symbol} · {date(open.t.entryTime)} · {REASON[open.t.reason]} · <span className={sign(open.t.pnlUsd)}>{usd(open.t.pnlUsd)} ({f(open.t.r, 2)}R)</span></span>
              <button onClick={() => setOpen(null)} className="text-muted hover:text-text"><X size={18} /></button>
            </div>
            <TradeChart candles={open.w.candles} overlays={open.w.overlays} stop={open.t.stopInitial}
              entry={{ t: snap(open.w.candles, open.t.entryTime), p: open.t.entryPrice }}
              exit={{ t: snap(open.w.candles, open.t.exitTime), p: open.t.exitPrice, win: open.t.pnlUsd > 0 }} />
          </div>
        </div>
      )}
    </div>
  );
}

function snap(c: Candle[], t: number) {
  let best = c[0]?.t ?? t;
  for (const x of c) if (x.t <= t) best = x.t;
  return best;
}
