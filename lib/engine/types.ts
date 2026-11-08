// Formato da estratégia: JSON puro, salvo no banco, editado no painel e preenchido pelo chat.

export type Source = "open" | "high" | "low" | "close" | "volume" | "hl2" | "hlc3" | "ohlc4";

export type IndicatorDef = {
  id: string; // nome curto usado nas regras, ex. "bb"
  type: string; // chave do catálogo, ex. "bollinger"
  params: Record<string, number | string>;
  tf?: string; // tempo gráfico (>= o da estratégia). Vazio = o da estratégia
  symbol?: string; // outro par (ex. BTCUSDT como filtro). Vazio = o próprio par
};

export type Operand =
  | { kind: "ind"; ref: string; out: string; shift?: number }
  | { kind: "price"; field: Source; tf?: string; symbol?: string; shift?: number }
  | { kind: "time"; field: "hour" | "weekday" | "minute" } // UTC; weekday 0 = domingo
  | { kind: "num"; value: number };

export type CondOp = ">" | "<" | ">=" | "<=" | "crossAbove" | "crossBelow" | "risingFor" | "fallingFor";

export type Cond = { left: Operand; op: CondOp; right: Operand; n?: number };
export type Group = { mode: "all" | "any"; items: (Cond | Group)[] };

export type Strategy = {
  name: string;
  symbols: string[];
  tf: string;
  from: string; // AAAA-MM-DD
  to: string;
  side: "long" | "short" | "both";
  indicators: IndicatorDef[];
  entry: {
    long?: Group;
    short?: Group;
    order: "market" | "limit" | "stop";
    offsetPct: number; // limitada: abaixo do fechamento (compra); stop: acima da máxima do candle do sinal
    validBars: number; // validade da ordem limitada/stop
    cooldownBars: number; // candles de espera depois de uma saída no mesmo par
  };
  stop: {
    type: "percent" | "atr" | "swing" | "indicator" | "none";
    value: number; // % ou múltiplo do ATR
    atrPeriod: number;
    lookback: number; // swing: mínima dos N candles
    bufferPct: number; // folga além do swing/indicador
    operand?: Operand; // type = indicator
    minPct: number; // distância mínima do stop; abaixo disso o sinal é ignorado
    maxPct: number;
  };
  target: {
    type: "rr" | "percent" | "indicator" | "none";
    value: number;
    operand?: Operand; // ex. média de Bollinger (acompanha a cada candle)
  };
  exit: {
    long?: Group; // condição de saída avaliada no fechamento; sai na abertura seguinte
    short?: Group;
    maxBars: number; // 0 = sem limite
    trailing: { type: "none" | "percent" | "atr"; value: number };
    breakevenAtR: number; // 0 = desligado
    partial: { atR: number; fraction: number }; // atR 0 = desligado
  };
  risk: {
    capital: number;
    riskPct: number; // risco por operação (% do patrimônio)
    maxPositionPct: number; // teto de cada posição (% do patrimônio)
    cashBufferPct: number; // reserva que nunca é usada
    maxOpen: number; // posições abertas ao mesmo tempo (todas as moedas)
    maxTradesDay: number; // 0 = sem limite
    maxLossDayPct: number; // perda realizada no dia que trava novas entradas; 0 = sem limite
    minNotional: number; // compra mínima da corretora em US$
  };
  costs: { preset: string; takerPct: number; makerPct: number; slippagePct: number };
  validation: { testPct: number; randomRuns: number; monteCarloRuns: number; seed: number };
};

export type Trade = {
  symbol: string;
  side: 1 | -1;
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number; // média ponderada se houve parcial
  qty: number;
  stopInitial: number;
  riskUsd: number;
  grossUsd: number;
  feesUsd: number;
  slippageUsd: number;
  pnlUsd: number; // líquido
  r: number; // pnl / risco planejado
  bars: number;
  reason: "stop" | "target" | "exit" | "time" | "trail" | "breakeven" | "end";
  equityAfter: number;
};

export type Metrics = {
  trades: number;
  winRate: number;
  avgR: number;
  ciLow: number;
  ciHigh: number;
  totalR: number;
  profitFactor: number;
  netUsd: number;
  returnPct: number;
  cagrPct: number;
  maxDdPct: number;
  sharpe: number; // diário, anualizado
  feesUsd: number;
  grossUsd: number;
  avgBars: number;
  expectancyUsd: number;
  bestR: number;
  worstR: number;
  maxLosingStreak: number;
  exposurePct: number;
};

export type Result = {
  strategy: Strategy;
  trades: Trade[];
  equity: { t: number; v: number }[]; // diário, marcado a mercado
  metrics: Metrics;
  train: Metrics;
  test: Metrics;
  splitTime: number;
  monthly: Record<string, number>; // AAAA-MM -> % do mês
  bySymbol: Record<string, Metrics>;
  random?: { avgR: number; p5: number; p95: number; runs: number; beatPct: number };
  monteCarlo?: { ddP50: number; ddP95: number; finalP5: number; finalP50: number; finalP95: number; ruinPct: number };
  signals: number;
  skipped: Record<string, number>; // motivo -> quantidade
  warnings: string[];
  ms: number;
};
