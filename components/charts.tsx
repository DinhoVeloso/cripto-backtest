"use client";
import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, createSeriesMarkers, LineSeries, type IChartApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";

const theme = {
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a93a3", fontSize: 11 },
  grid: { vertLines: { color: "#1c222c" }, horzLines: { color: "#1c222c" } },
  rightPriceScale: { borderColor: "#252b36" },
  timeScale: { borderColor: "#252b36", timeVisible: true },
  crosshair: { mode: 0 },
};

function useChart(build: (chart: IChartApi) => void, deps: unknown[]) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, { ...theme, autoSize: true });
    build(chart);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return el;
}

export function EquityChart({ points, capital, split }: { points: { t: number; v: number }[]; capital: number; split: number }) {
  const el = useChart((chart) => {
    const line = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    line.setData(points.map((p) => ({ time: p.t as UTCTimestamp, value: p.v })));
    line.createPriceLine({ price: capital, color: "#8a93a3", lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "inicial" });
    const at = points.find((p) => p.t >= split);
    if (at) createSeriesMarkers(line, [{ time: at.t as UTCTimestamp, position: "aboveBar", color: "#f59e0b", shape: "arrowDown", text: "início da validação" }]);
  }, [points, capital, split]);
  return <div ref={el} className="h-64 w-full" />;
}

export type Candle = { t: number; o: number; h: number; l: number; c: number };

export function TradeChart({ candles, overlays, entry, exit, stop }: {
  candles: Candle[]; overlays: { name: string; values: (number | null)[] }[];
  entry: { t: number; p: number }; exit: { t: number; p: number; win: boolean }; stop: number;
}) {
  const colors = ["#a78bfa", "#f472b6", "#facc15", "#2dd4bf", "#fb923c", "#60a5fa"];
  const el = useChart((chart) => {
    const cs = chart.addSeries(CandlestickSeries, { upColor: "#22c55e", downColor: "#ef4444", borderVisible: false, wickUpColor: "#22c55e", wickDownColor: "#ef4444" });
    cs.setData(candles.map((c) => ({ time: c.t as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    overlays.forEach((o, k) => {
      const s = chart.addSeries(LineSeries, { color: colors[k % colors.length], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: o.name });
      s.setData(o.values.map((v, i) => (v === null ? { time: candles[i].t as UTCTimestamp } : { time: candles[i].t as UTCTimestamp, value: v })));
    });
    cs.createPriceLine({ price: stop, color: "#ef4444", lineStyle: 2, lineWidth: 1, title: "stop" });
    cs.createPriceLine({ price: entry.p, color: "#3b82f6", lineStyle: 2, lineWidth: 1, title: "entrada" });
    const marks: SeriesMarker<Time>[] = [
      { time: entry.t as UTCTimestamp, position: "belowBar", color: "#3b82f6", shape: "arrowUp", text: "compra" },
      { time: exit.t as UTCTimestamp, position: "aboveBar", color: exit.win ? "#22c55e" : "#ef4444", shape: "arrowDown", text: "saída" },
    ];
    createSeriesMarkers(cs, marks.sort((a, b) => (a.time as number) - (b.time as number)));
  }, [candles, overlays, entry, exit, stop]);
  return <div ref={el} className="h-96 w-full" />;
}
