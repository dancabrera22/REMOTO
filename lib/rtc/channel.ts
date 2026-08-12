"use client";

import type { ControlMessage } from "@/lib/protocol";

export interface ChannelBusOptions {
  onMessage: (message: ControlMessage) => void;
  onBinary: (data: ArrayBuffer) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onRtt?: (ms: number) => void;
}

/**
 * Envolve os dois DataChannels de uma sessao.
 *
 * "control" e ordenado e confiavel: comandos, chat, metadados de arquivo.
 * "bulk" carrega o conteudo dos arquivos, separado de proposito — uma
 * transferencia de 500 MB nao pode atrasar um clique.
 */
export class ChannelBus {
  private control: RTCDataChannel | null = null;
  private bulk: RTCDataChannel | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private opts: ChannelBusOptions) {}

  get ready() {
    return this.control?.readyState === "open";
  }

  get bulkChannel() {
    return this.bulk;
  }

  adopt(channel: RTCDataChannel) {
    if (channel.label === "control") this.setControl(channel);
    else if (channel.label === "bulk") this.setBulk(channel);
  }

  setControl(channel: RTCDataChannel) {
    this.control = channel;
    channel.onopen = () => {
      this.opts.onOpen?.();
      this.startPing();
    };
    channel.onclose = () => {
      this.stopPing();
      this.opts.onClose?.();
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let message: ControlMessage;
      try {
        message = JSON.parse(event.data) as ControlMessage;
      } catch {
        return;
      }
      if (message.t === "ping") {
        this.send({ t: "pong", ts: message.ts });
        return;
      }
      if (message.t === "pong") {
        this.opts.onRtt?.(Math.round(performance.now() - message.ts));
        return;
      }
      this.opts.onMessage(message);
    };
  }

  setBulk(channel: RTCDataChannel) {
    this.bulk = channel;
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) this.opts.onBinary(event.data);
    };
  }

  send(message: ControlMessage): boolean {
    if (this.control?.readyState !== "open") return false;
    try {
      this.control.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * RTT da camada de aplicacao. O `getStats` ja informa o RTT do ICE, mas este
   * mede o caminho que a entrada realmente percorre — incluindo o tempo que a
   * aba leva para processar, que e o que o usuario sente.
   */
  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: "ping", ts: performance.now() }), 2000);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  close() {
    this.stopPing();
    try {
      this.control?.close();
      this.bulk?.close();
    } catch {
      /* ja fechados */
    }
    this.control = null;
    this.bulk = null;
  }
}
