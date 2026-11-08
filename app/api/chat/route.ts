import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessage } from "ai";
import { availableProviders, PROVIDER_LABEL, type ProviderId } from "@/lib/ai/providers";
import { systemPrompt, type ScreenContext } from "@/lib/ai/prompt";

export const maxDuration = 60;

// limite simples por IP (por instância): protege a cota gratuita dos provedores
const hits = new Map<string, number[]>();
const LIMIT = 30, WINDOW = 60 * 60 * 1000;

export async function GET() {
  return Response.json({ providers: availableProviders().map((p) => ({ id: p.id, label: PROVIDER_LABEL[p.id], model: p.model })) });
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW);
  if (recent.length >= LIMIT) return Response.json({ error: "Limite de mensagens por hora atingido. Tente mais tarde." }, { status: 429 });
  hits.set(ip, [...recent, now]);

  const body: { messages: UIMessage[]; context: ScreenContext; provider?: ProviderId | "auto" } = await req.json();
  const messages = body.messages.slice(-20);
  const all = availableProviders();
  if (!all.length) return Response.json({ error: "Nenhum provedor de IA configurado (GROQ_API_KEY, GEMINI_API_KEY ou OPENROUTER_API_KEY)." }, { status: 503 });
  const order = body.provider && body.provider !== "auto" ? [...all.filter((p) => p.id === body.provider), ...all.filter((p) => p.id !== body.provider)] : all;
  const system = systemPrompt(body.context);
  const modelMessages = await convertToModelMessages(messages);

  const failures: string[] = [];
  for (const p of order) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(new Error("sem resposta em 25 s")), 25_000); // travou: tenta o próximo
    const result = streamText({ model: p.make(), system, messages: modelMessages, maxRetries: 0, temperature: 0.4, abortSignal: abort.signal });
    const reader = result.stream[Symbol.asyncIterator]();
    type Part = Awaited<ReturnType<typeof reader.next>>["value"];
    const buffered: Part[] = [];
    let failed: unknown = null;
    try {
      // espera o primeiro texto: se o provedor recusar (limite gratuito, chave errada), tenta o próximo
      for (;;) {
        const next = await reader.next();
        if (next.done) break;
        buffered.push(next.value);
        if (next.value.type === "error") { failed = next.value.error; break; }
        if (next.value.type === "text-delta" || next.value.type === "reasoning-delta") break;
      }
    } catch (e) {
      failed = e;
    }
    clearTimeout(timer);
    if (failed) { failures.push(`${PROVIDER_LABEL[p.id]}: ${failed instanceof Error ? failed.message : String(failed)}`.slice(0, 200)); continue; }
    const stream = new ReadableStream({
      async start(ctrl) {
        for (const part of buffered) ctrl.enqueue(part);
        try {
          for (;;) { const n = await reader.next(); if (n.done) break; ctrl.enqueue(n.value); }
        } finally { ctrl.close(); }
      },
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: stream as typeof result.stream, messageMetadata: () => ({ provider: PROVIDER_LABEL[p.id], model: p.model }), onError: () => "O provedor interrompeu a resposta. Tente de novo." }),
    });
  }
  console.error("chat: todos os provedores falharam", failures);
  return Response.json({ error: "Os provedores gratuitos não responderam agora (limite de uso ou indisponibilidade). Tente em alguns minutos." }, { status: 502 });
}
