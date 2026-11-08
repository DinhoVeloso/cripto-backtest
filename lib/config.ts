// Endereço público dos dados de mercado (Cloudflare R2). Sem ele, usa os arquivos locais (só em desenvolvimento).
export const DATA_URL = process.env.NEXT_PUBLIC_DATA_URL || "/api/dev-data";
