import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // O visualizador roda em tela cheia e captura teclado; nada aqui exige imagens remotas.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // getDisplayMedia/microfone so funcionam se a Permissions-Policy liberar a origem.
          {
            key: "Permissions-Policy",
            value: "display-capture=(self), microphone=(self), camera=(self), clipboard-read=(self), clipboard-write=(self)",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        // As rotas de sinalizacao nunca podem ser cacheadas por CDN.
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-transform" },
          { key: "X-Accel-Buffering", value: "no" },
        ],
      },
    ];
  },
};

export default nextConfig;
