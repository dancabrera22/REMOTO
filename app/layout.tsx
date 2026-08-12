import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "REMOTO · acesso remoto pelo navegador",
  description:
    "Compartilhe e controle uma tela pelo navegador, sem instalar nada. Conexao ponto-a-ponto cifrada, com transferencia de arquivos, chat e area de transferencia.",
  applicationName: "REMOTO",
  robots: { index: true, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
  // O visualizador ocupa a tela toda; zoom por pinca atrapalharia o controle.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
