import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // só em desenvolvimento: permite abrir pelo 127.0.0.1 ou pelo IP da rede local (celular na mesma rede)
  allowedDevOrigins: ["127.0.0.1", "192.168.1.83"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
