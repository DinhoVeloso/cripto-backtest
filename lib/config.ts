// Endereço público dos dados de mercado (Vercel Blob). Sem ele, usa os arquivos locais (só em desenvolvimento).
// Remove BOM/espaços que podem vir de variáveis gravadas por terminais no Windows.
export const DATA_URL = (process.env.NEXT_PUBLIC_DATA_URL || "/api/dev-data").replace(/^[﻿\s]+|[\s/]+$/g, "");
