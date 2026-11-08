// Só em desenvolvimento: entrega os arquivos de out/spot (em produção os dados vêm do Cloudflare R2).
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "out", "spot");

export async function GET(_req: Request, ctx: RouteContext<"/api/dev-data/[...path]">) {
  if (process.env.NODE_ENV !== "development") return new Response("não encontrado", { status: 404 });
  const parts = (await ctx.params).path;
  const file = path.join(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep) || !/\.(json|gz)$/.test(file)) return new Response("não encontrado", { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, { headers: { "content-type": file.endsWith(".json") ? "application/json" : "application/octet-stream", "cache-control": "no-store" } });
  } catch {
    return new Response("não encontrado", { status: 404 });
  }
}
