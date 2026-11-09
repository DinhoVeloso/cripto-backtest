# Cripto Backtest

Simulador de estratégias para o **spot da Binance** (só compra), com até 5 anos de candles reais (3m a diário), painel com dezenas de variáveis e um chat com especialista em cripto (IA gratuita).

## Como funciona

- **Dados** (`pipeline/`): `build_data.py` baixa os candles de 1m de data.binance.vision (com checksum), monta 3m/5m/15m/1h/4h/1d e grava arquivos compactados em `out/spot/`. `verify.py` confere contra a API da Binance. `upload_blob.mjs` envia para o Vercel Blob (só o que mudou).
- **Motor** (`lib/engine/`): roda no navegador, num Web Worker. Sinais só com candles fechados, stop vence alvo no mesmo candle, ordem limitada só executa se o preço passar, taxas maker/taker e slippage, banca única para vários pares, limites diários. Relatório com treino × validação, entradas aleatórias e Monte Carlo.
- **Especialista** (`app/api/chat`, `lib/ai/`): Groq → Gemini → OpenRouter (troca sozinho quando um falha). Só responde quando chamado. Vê a estratégia e o resultado na tela e pode montar estratégias para aplicar no painel.

## Rodar no PC

```bash
npm install
npm run dev        # http://localhost:3000 (usa os arquivos de out/spot)
npm test           # testes do motor
```

Variáveis em `.env.local` (não vão para o git):

```
GROQ_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
BLOB_READ_WRITE_TOKEN=...          # só para enviar os dados
NEXT_PUBLIC_DATA_URL=...           # endereço público dos dados no Blob (produção)
```

## Atualizar os dados

```bash
python pipeline/build_data.py BTCUSDT ETHUSDT ...   # pares publicados: veja PAIRS em lib/ai/prompt.ts
python pipeline/verify.py BTCUSDT ETHUSDT
node --env-file=.env.local pipeline/upload_blob.mjs
```

Conteúdo educativo: resultados passados não garantem resultados futuros e nada aqui é recomendação de investimento.
