"use client";
import { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Metrics, Result, Trade } from "@/lib/engine/types";
import { breakEvenPct } from "@/lib/engine/binary";
import { EquityChart, TradeChart, type Candle } from "./charts";

const usd = (v: number) => `${v < 0 ? "-" : ""}US$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const sign = (v: number) => (v > 0 ? "text-up" : v < 0 ? "text-down" : "");
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ");
const price = (p: number) => p.toLocaleString("pt-BR", { maximumFractionDigits: p >= 1000 ? 2 : p >= 1 ? 4 : 8 });
const REASON: Record<Trade["reason"], string> = { stop: "stop", target: "alvo", exit: "regra de saída", time: "tempo", trail: "stop móvel", breakeven: "no zero a zero", end: "fim do período", win: "ganhou", loss: "perdeu" };
const SIDE = (t: Trade) => (t.side === 1 ? "sobe" : "desce");

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
      <div className={`num text-base font-semibold ${sign(m.avgR)}`}>{f(m.avgR * 100, 1)}% por aposta</div>
      <div className="num text-xs text-muted">{m.trades} apostas · acerto {f(m.winRate, 1)}% · {usd(m.netUsd)}</div>
    </div>
  );
}

export function Results({ r, randomPending, loadWindow }: {
  r: Result; randomPending: boolean;
  loadWindow: (t: Trade) => Promise<{ candles: Candle[]; overlays: { name: string; values: (number | null)[] }[] }>;
}) {
  const m = r.metrics;
  const be = breakEvenPct(r.strategy.binary.payoutPct);
  const wins = r.trades.filter((t) => t.pnlUsd > 0).length;
  const sideStats = useMemo(() => {
    const calc = (sd: 1 | -1) => { const tr = r.trades.filter((t) => t.side === sd); const w = tr.filter((t) => t.pnlUsd > 0).length; return { trades: tr.length, winRate: tr.length ? (w / tr.length) * 100 : 0, netUsd: tr.reduce((x, t) => x + t.pnlUsd, 0) }; };
    return { up: calc(1), down: calc(-1) };
  }, [r.trades]);
  const side = (sd: 1 | -1) => (sd === 1 ? sideStats.up : sideStats.down);
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
        <Card label="Resultado líquido" value={usd(m.netUsd)} sub={`${f(m.returnPct, 1)}% da banca`} cls={sign(m.netUsd)} />
        <Card label="Acerto" value={`${f(m.winRate, 1)}%`} sub={`mínimo para empatar: ${f(be, 1)}%`} cls={m.winRate >= be ? "text-up" : "text-down"} />
        <Card label="Apostas" value={String(m.trades)} sub={`${wins} ganhas · ${m.trades - wins} perdidas`} />
        <Card label="Lucro por aposta" value={`${f(m.avgR * 100, 1)}%`} sub={`do valor apostado · IC 95%: ${f(m.ciLow * 100, 1)}% a ${f(m.ciHigh * 100, 1)}%`} cls={sign(m.avgR)} />
        <Card label="Queda máxima" value={`${f(m.maxDdPct, 1)}%`} sub={`pior sequência: ${m.maxLosingStreak} perdas`} cls={m.maxDdPct > 30 ? "text-down" : ""} />
        <Card label="Média por aposta" value={usd(m.expectancyUsd)} cls={sign(m.expectancyUsd)} sub={`fator de lucro ${f(m.profitFactor, 2)}`} />
        <Card label="Sobe" value={`${f(side(1).winRate, 1)}%`} sub={`${side(1).trades} apostas · ${usd(side(1).netUsd)}`} cls={sign(side(1).netUsd)} />
        <Card label="Desce" value={`${f(side(-1).winRate, 1)}%`} sub={`${side(-1).trades} apostas · ${usd(side(-1).netUsd)}`} cls={sign(side(-1).netUsd)} />
        <Card label="Sinais" value={String(r.signals)} sub={`${Object.values(r.skipped).reduce((x, y) => x + y, 0)} ignorados`} />
        <Card label="Cálculo" value={`${f(r.ms / 1000, 1)} s`} sub="no seu navegador" />
      </div>

      <div className="card p-3">
        <div className="mb-2 text-sm font-medium">Banca (fim de cada dia; pode ficar negativa se a opção de parar estiver desligada)</div>
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
          <div className="mb-2 text-sm font-medium">Contra apostas aleatórias</div>
          {r.random ? (
            <>
              <div className="num text-base font-semibold">aleatório: {f(r.random.avgR * 100, 1)}% por aposta</div>
              <div className="num text-xs text-muted">faixa de 90%: {f(r.random.p5 * 100, 1)}% a {f(r.random.p95 * 100, 1)}% · {r.random.runs} rodadas</div>
              <div className={`num mt-1 text-sm ${r.random.beatPct >= 95 ? "text-up" : "text-warn"}`}>a estratégia superou {f(r.random.beatPct, 0)}% das rodadas</div>
            </>
          ) : <p className="text-xs text-muted">{randomPending ? "calculando…" : "desligado ou sem sinais"}</p>}
          <p className="mt-2 text-xs text-muted">Mesmo payout, valor e banca, com a direção sorteada na mesma frequência. Com payout abaixo de 100%, aleatório perde.</p>
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
        <div className="card p-3">
          <div className="mb-2 text-sm font-medium">Payout e ponto de equilíbrio</div>
          <div className="num space-y-0.5 text-sm">
            <div>payout: {r.strategy.binary.payoutPct}% · aposta {r.strategy.binary.stakeMode === "fixed" ? usd(r.strategy.binary.stake) : `${f(r.strategy.binary.stake, 1)}% da banca`}</div>
            <div>acerto mínimo para empatar: {f(be, 2)}%</div>
            <div className={m.winRate >= be ? "text-up" : "text-down"}>seu acerto: {f(m.winRate, 2)}% ({m.winRate >= be ? "+" : ""}{f(m.winRate - be, 2)} pontos)</div>
          </div>
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
          <span>Apostas ({r.trades.length}) — clique para ver no gráfico</span>
          <span className="flex items-center gap-1 text-xs font-normal">
            <button className="btn h-6 px-2" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
            {page + 1}/{Math.max(1, Math.ceil(trades.length / per))}
            <button className="btn h-6 px-2" disabled={(page + 1) * per >= trades.length} onClick={() => setPage(page + 1)}>›</button>
          </span>
        </div>
        <table className="num w-full text-xs">
          <thead><tr className="text-left text-muted">{["sinal em", "aposta", "candle seguinte (abre → fecha)", "resultado em", "", "valor", "líquido", "banca"].map((h) => <th key={h} className="font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {trades.slice(page * per, page * per + per).map((t, i) => (
              <tr key={i} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={async () => {
                setLoading(t.entryTime);
                try { setOpen({ t, w: await loadWindow(t) }); } finally { setLoading(null); }
              }}>
                <td className="py-1">{loading === t.entryTime ? "carregando…" : date(t.entryTime)}</td><td>{SIDE(t)}</td>
                <td>{price(t.entryPrice)} → {price(t.exitPrice)}</td><td>{date(t.exitTime)}</td><td className={sign(t.pnlUsd)}>{REASON[t.reason]}</td>
                <td>{usd(t.riskUsd)}</td><td className={sign(t.pnlUsd)}>{usd(t.pnlUsd)}</td><td>{usd(t.equityAfter)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(null)}>
          <div className="card w-full max-w-5xl p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>{open.t.symbol} · {date(open.t.entryTime)} · {SIDE(open.t)} · <span className={sign(open.t.pnlUsd)}>{REASON[open.t.reason]} {usd(open.t.pnlUsd)}</span></span>
              <button onClick={() => setOpen(null)} className="text-muted hover:text-text"><X size={18} /></button>
            </div>
            <TradeChart candles={open.w.candles} overlays={open.w.overlays} side={open.t.side}
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
