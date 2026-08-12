"use client";

import type { DisplayInfo, InputEvent } from "@/lib/protocol";

/** Faixa varrida na descoberta. O agente sobe na primeira porta livre. */
export const AGENT_PORTS = [45789, 45790, 45791, 45792, 45793];
const STORAGE_KEY = "remoto.agent";

export interface AgentInfo {
  version: number;
  os: "windows" | "darwin" | "linux";
  backend: string;
  displays: DisplayInfo[];
  paired: boolean;
}

interface Stored {
  port: number;
  token: string;
}

/**
 * Ponte com o agente local opcional.
 *
 * A pagina web nao pode — por design do sandbox — mover o mouse ou digitar no
 * sistema operacional. Quem quiser controle real baixa e roda `/agente.mjs` —
 * um arquivo, sem instalacao — e a pagina do anfitriao conversa com esse
 * processo pelo loopback. Sem o agente, a sessao continua em modo
 * visualizacao.
 *
 * O pareamento por codigo e o que impede qualquer site aberto no navegador de
 * encontrar o agente e assumir a maquina: sem o codigo mostrado no terminal,
 * nenhuma requisicao de entrada e aceita.
 */
export class AgentClient {
  private base: string | null = null;
  private token: string | null = null;
  info: AgentInfo | null = null;

  constructor() {
    if (typeof localStorage === "undefined") return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Stored | null;
      if (saved?.port && saved.token) {
        this.base = `http://127.0.0.1:${saved.port}`;
        this.token = saved.token;
      }
    } catch {
      /* armazenamento indisponivel ou corrompido */
    }
  }

  get connected() {
    return Boolean(this.base && this.token && this.info?.paired);
  }

  /** Ha um pareamento anterior guardado neste navegador. */
  get hasSaved() {
    return Boolean(this.base && this.token);
  }

  get endpoint() {
    return this.base;
  }

  /** Varre o loopback. Retorna a primeira porta que responde. */
  async discover(): Promise<AgentInfo | null> {
    const ports = this.base ? [Number(this.base.split(":").pop()), ...AGENT_PORTS] : AGENT_PORTS;
    for (const port of [...new Set(ports)]) {
      const base = `http://127.0.0.1:${port}`;
      const info = await this.hello(base);
      if (info) {
        this.base = base;
        this.info = info;
        if (!info.paired) this.token = null;
        return info;
      }
    }
    this.info = null;
    return null;
  }

  private async hello(base: string): Promise<AgentInfo | null> {
    try {
      const res = await fetch(`${base}/hello`, {
        headers: this.token ? { authorization: `Bearer ${this.token}` } : {},
        signal: AbortSignal.timeout(700),
        cache: "no-store",
      });
      if (!res.ok) return null;
      return (await res.json()) as AgentInfo;
    } catch {
      // Porta fechada, agente ausente ou navegador bloqueando rede privada.
      return null;
    }
  }

  /** Troca o codigo de 6 caracteres exibido no terminal por um token. */
  async pair(code: string): Promise<boolean> {
    if (!this.base) return false;
    try {
      const res = await fetch(`${this.base}/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token: string };
      this.token = data.token;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ port: Number(this.base.split(":").pop()), token: data.token }),
      );
      await this.discover();
      return true;
    } catch {
      return false;
    }
  }

  forget() {
    this.token = null;
    this.info = null;
    localStorage.removeItem(STORAGE_KEY);
  }

  /** Executa uma batelada de eventos na maquina do anfitriao. */
  async dispatch(events: InputEvent[]): Promise<boolean> {
    if (!this.base || !this.token || !events.length) return false;
    try {
      const res = await fetch(`${this.base}/input`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ events }),
        // Batelada de entrada nao pode enfileirar: se atrasou, ja nao serve.
        signal: AbortSignal.timeout(2000),
        keepalive: false,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async pickDisplay(id: number): Promise<boolean> {
    if (!this.base || !this.token) return false;
    try {
      const res = await fetch(`${this.base}/display`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
