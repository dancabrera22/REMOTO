"use client";

import { openJson, sealJson } from "@/lib/crypto";
import type { SignalEnvelope, SignalKind } from "@/lib/protocol";

export interface SignalingOptions {
  code: string;
  peerId: string;
  token: string;
  /** Chave derivada do PIN. Quando presente, todo payload viaja cifrado. */
  key: CryptoKey | null;
  onSignal: (env: SignalEnvelope, data: unknown) => void;
  onStatus?: (status: SignalingStatus) => void;
}

export type SignalingStatus = "conectando" | "aberto" | "reconectando" | "fechado" | "erro";

/**
 * Cliente de sinalizacao.
 *
 * O fluxo SSE se encerra a cada ~45 s por limite da plataforma; reabrimos
 * carregando o cursor, entao nenhuma mensagem se perde na troca. Quando o
 * WebRTC ja esta conectado, `idle()` desliga o fluxo por completo — a
 * sinalizacao so e necessaria no aperto de mao e em reconexoes.
 */
export class Signaling {
  private source: EventSource | null = null;
  private cursor = 0;
  private retry = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private status: SignalingStatus = "fechado";

  constructor(private opts: SignalingOptions) {}

  get open() {
    return this.source !== null;
  }

  private setStatus(status: SignalingStatus) {
    if (this.status === status) return;
    this.status = status;
    this.opts.onStatus?.(status);
  }

  start() {
    this.stopped = false;
    this.openStream();
  }

  /** Fecha o fluxo mantendo o cursor, para retomar depois sem perder nada. */
  idle() {
    this.closeStream();
    this.setStatus("fechado");
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.closeStream();
    this.setStatus("fechado");
  }

  private closeStream() {
    this.source?.close();
    this.source = null;
  }

  private openStream() {
    if (this.stopped || this.source) return;
    this.setStatus(this.retry ? "reconectando" : "conectando");

    const url = new URL("/api/signal/stream", location.origin);
    url.searchParams.set("code", this.opts.code);
    url.searchParams.set("peerId", this.opts.peerId);
    url.searchParams.set("token", this.opts.token);
    url.searchParams.set("cursor", String(this.cursor));

    const source = new EventSource(url.toString());
    this.source = source;

    source.addEventListener("ready", () => {
      this.retry = 0;
      this.setStatus("aberto");
    });

    source.addEventListener("signal", (event) => {
      void this.deliver((event as MessageEvent<string>).data);
    });

    // Fim natural da janela: reabrimos imediatamente, sem espera.
    source.addEventListener("renew", (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as { cursor: number };
      this.cursor = Math.max(this.cursor, payload.cursor);
      this.closeStream();
      if (!this.stopped) this.openStream();
    });

    source.addEventListener("fatal", () => {
      this.closeStream();
      this.scheduleRetry();
    });

    source.onerror = () => {
      // O EventSource tentaria reabrir sozinho com o cursor antigo da URL,
      // o que reentregaria mensagens; assumimos o controle da reconexao.
      this.closeStream();
      this.scheduleRetry();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    this.setStatus(this.retry > 3 ? "erro" : "reconectando");
    const delay = Math.min(500 * 2 ** this.retry, 10_000);
    this.retry += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.openStream(), delay);
  }

  private async deliver(raw: string) {
    let env: SignalEnvelope;
    try {
      env = JSON.parse(raw) as SignalEnvelope;
    } catch {
      return;
    }
    this.cursor = Math.max(this.cursor, env.seq);

    let data: unknown = null;
    try {
      if (env.enc) {
        if (!this.opts.key) return; // sem chave nao ha o que ler
        data = await openJson(this.opts.key, env.data);
      } else {
        data = JSON.parse(env.data);
      }
    } catch {
      // Payload que nao abre com a nossa chave = PIN diferente ou adulteracao.
      return;
    }
    this.opts.onSignal(env, data);
  }

  async send(to: string, kind: SignalKind, payload: unknown) {
    const key = this.opts.key;
    const body = {
      code: this.opts.code,
      peerId: this.opts.peerId,
      token: this.opts.token,
      to,
      kind,
      enc: Boolean(key),
      data: key ? await sealJson(key, payload) : JSON.stringify(payload),
    };
    const res = await fetch("/api/signal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: kind === "bye",
    });
    if (!res.ok) throw new Error(`sinalizacao ${res.status}`);
  }
}
