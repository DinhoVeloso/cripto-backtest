// Provedores gratuitos do chat, em ordem de preferência. Cada um só entra se tiver a chave configurada.
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export type ProviderId = "groq" | "gemini" | "openrouter";
export const PROVIDER_LABEL: Record<ProviderId, string> = { groq: "Groq", gemini: "Google Gemini", openrouter: "OpenRouter" };

export function availableProviders(): { id: ProviderId; model: string; make: () => LanguageModel }[] {
  const out: { id: ProviderId; model: string; make: () => LanguageModel }[] = [];
  if (process.env.GROQ_API_KEY) {
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    out.push({ id: "groq", model, make: () => createGroq({ apiKey: process.env.GROQ_API_KEY })(model) });
  }
  if (process.env.GEMINI_API_KEY) {
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash" // 3.7/3.8 travam na camada gratuita (testado em 08/11/2026);
    out.push({ id: "gemini", model, make: () => createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(model) });
  }
  if (process.env.OPENROUTER_API_KEY) {
    const model = process.env.OPENROUTER_MODEL || "openrouter/free";
    out.push({ id: "openrouter", model, make: () => createOpenAICompatible({ name: "openrouter", baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY })(model) });
  }
  return out;
}
