"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui";

type Platform = "windows" | "macos" | "linux";

const LABELS: Record<Platform, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

function detect(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "linux";
}

/**
 * Comando para ativar o controle na maquina compartilhada.
 *
 * O arquivo e servido pela propria implantacao (`/agente.mjs`), nao pelo npm:
 * assim o que roda vem exatamente do endereco que a pessoa ja esta acessando,
 * sem depender de um nome de pacote publico que qualquer um poderia registrar.
 */
export function AgentCommand() {
  const [platform, setPlatform] = useState<Platform>("windows");
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setPlatform(detect());
    setOrigin(location.origin);
  }, []);

  const url = `${origin}/agente.mjs`;
  const commands: Record<Platform, string> = {
    windows: `irm ${url} -OutFile "$env:TEMP\\remoto.mjs"; node "$env:TEMP\\remoto.mjs"`,
    macos: `curl -fsSL ${url} -o /tmp/remoto.mjs && node /tmp/remoto.mjs`,
    linux: `curl -fsSL ${url} -o /tmp/remoto.mjs && node /tmp/remoto.mjs`,
  };
  const command = commands[platform];

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-ink-300">
        Para liberar mouse e teclado, rode isto no computador que esta sendo compartilhado. Ele baixa um arquivo,
        executa e pronto — nao instala nada, nao pede administrador e some quando voce fechar a janela.
      </p>

      <div className="flex gap-1">
        {(Object.keys(LABELS) as Platform[]).map((key) => (
          <button
            key={key}
            onClick={() => setPlatform(key)}
            className={`rounded px-2 py-1 text-[11px] ${
              platform === key ? "bg-ink-700 text-ink-200" : "text-ink-400 hover:text-ink-200"
            }`}
          >
            {LABELS[key]}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-ink-600 bg-ink-850 p-3">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">
          {platform === "windows" ? "PowerShell" : "Terminal"}
        </div>
        <code className="block break-all font-mono text-xs leading-relaxed text-ink-200">{command}</code>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "copiado" : "copiar comando"}
        </Button>
        <a href="/agente.mjs" download="remoto-agente.mjs">
          <Button variant="subtle">baixar o arquivo</Button>
        </a>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-400">
        Precisa do{" "}
        <a className="text-accent underline" href="https://nodejs.org/" target="_blank" rel="noreferrer">
          Node.js 18 ou mais novo
        </a>{" "}
        na maquina compartilhada. Para conferir, rode <code className="font-mono">node -v</code>.
        {platform === "linux" && " No Linux tambem e preciso o xdotool e uma sessao X11."}
        {platform === "macos" &&
          " No macOS, conceda Acessibilidade ao Terminal em Ajustes do Sistema > Privacidade e Seguranca."}
      </p>
    </div>
  );
}
