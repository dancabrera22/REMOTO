"use client";

import { deriveSessionKey, safetyWords } from "@/lib/crypto";
import {
  PROTOCOL_VERSION,
  type ControlMessage,
  type DisplayInfo,
  type InputEvent,
  type PeerCapabilities,
} from "@/lib/protocol";
import { ChannelBus } from "@/lib/rtc/channel";
import { FileTransfers, type TransferView } from "@/lib/rtc/files";
import { PeerLink } from "@/lib/rtc/peer";
import { Signaling, type SignalingStatus } from "@/lib/rtc/signaling";
import { EMPTY_STATS, StatsSampler, type LinkStats } from "@/lib/rtc/stats";
import type { ChatEntry } from "./host";
import { loadIceServers } from "./host";

export type ViewerPhase =
  | "inicial"
  | "entrando"
  | "aguardando"
  | "conectando"
  | "conectado"
  | "recusado"
  | "encerrado"
  | "erro";

export interface ViewerSnapshot {
  phase: ViewerPhase;
  error: string | null;
  hostName: string;
  words: string;
  signal: SignalingStatus;
  stream: MediaStream | null;
  caps: PeerCapabilities | null;
  /** Controle de mouse/teclado concedido pelo anfitriao. */
  control: boolean;
  controlNote: string | null;
  surface: { width: number; height: number; label: string } | null;
  displays: DisplayInfo[];
  stats: LinkStats;
  rttMs: number;
  chat: ChatEntry[];
  transfers: TransferView[];
  clipboardIn: string | null;
  notice: string | null;
}

const EMPTY: ViewerSnapshot = {
  phase: "inicial",
  error: null,
  hostName: "",
  words: "",
  signal: "fechado",
  stream: null,
  caps: null,
  control: false,
  controlNote: null,
  surface: null,
  displays: [],
  stats: EMPTY_STATS,
  rttMs: 0,
  chat: [],
  transfers: [],
  clipboardIn: null,
  notice: null,
};

/**
 * Lado visualizante da sessao.
 *
 * O papel dele na negociacao e o "polite": nunca inicia oferta, sempre cede
 * quando ha colisao. Isso simplifica muito o caso de renegociacao — que
 * acontece toda vez que o anfitriao troca de tela ou liga o microfone.
 */
export class ViewerSession {
  private snapshot: ViewerSnapshot = EMPTY;
  private listeners = new Set<() => void>();

  private signaling: Signaling | null = null;
  private link: PeerLink | null = null;
  private bus: ChannelBus | null = null;
  private files: FileTransfers | null = null;
  private sampler = new StatsSampler("recebendo");
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private hostPeer = "";
  private chatSeq = 0;
  private iceServers: RTCIceServer[] = [];
  private name = "Visitante";
  private stopped = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private patch(partial: Partial<ViewerSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  /* ------------------------------ entrada ------------------------------ */

  async join(code: string, pin: string, name: string, wantsControl: boolean) {
    this.name = name || "Visitante";
    this.patch({ phase: "entrando", error: null });

    try {
      const res = await fetch("/api/session/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, pin }),
      });
      const data = (await res.json()) as {
        peerId?: string;
        token?: string;
        hostPeer?: string;
        salt?: string;
        error?: string;
      };

      if (!res.ok || !data.peerId || !data.token || !data.hostPeer || !data.salt) {
        throw new Error(explain(data.error, res.status));
      }

      this.hostPeer = data.hostPeer;
      this.iceServers = await loadIceServers();
      const key = await deriveSessionKey(pin, data.salt);

      this.signaling = new Signaling({
        code,
        peerId: data.peerId,
        token: data.token,
        key,
        onStatus: (signal) => this.patch({ signal }),
        onSignal: (env, payload) => void this.onSignal(env.kind, payload),
      });
      this.signaling.start();

      this.patch({ phase: "aguardando", words: await safetyWords(pin, data.salt) });

      await this.signaling.send(this.hostPeer, "join", {
        name: this.name,
        ua: navigator.userAgent.slice(0, 120),
        wantsControl,
      });

      this.statsTimer = setInterval(() => void this.sampleStats(), 1000);
    } catch (error) {
      this.patch({ phase: "erro", error: (error as Error).message });
    }
  }

  private async onSignal(kind: string, payload: unknown) {
    switch (kind) {
      case "accept":
        if (!this.link) this.createLink();
        this.patch({ phase: "conectando" });
        break;

      case "reject":
        this.patch({
          phase: "recusado",
          error: (payload as { reason?: string })?.reason ?? "O anfitriao recusou a conexao.",
        });
        this.signaling?.stop();
        break;

      case "offer":
      case "answer":
        if (!this.link) this.createLink();
        await this.link!.applyDescription(payload as RTCSessionDescriptionInit);
        break;

      case "ice":
        await this.link?.applyCandidate(payload as RTCIceCandidateInit);
        break;

      case "bye":
        this.patch({ phase: "encerrado", error: "O anfitriao encerrou a sessao." });
        this.teardown();
        break;
    }
  }

  private createLink() {
    this.link = new PeerLink({
      polite: true,
      iceServers: this.iceServers,
      onSignal: (signal) => void this.signaling?.send(this.hostPeer, signal.kind, signal.data),
      onTrack: (stream) => this.patch({ stream, phase: "conectado" }),
      onStateChange: (state) => {
        if (state === "connected") this.patch({ phase: "conectado" });
        if (state === "failed") this.patch({ notice: "Conexao perdida. Tentando restabelecer..." });
      },
      onDataChannel: (channel) => {
        if (!this.bus) this.createBus();
        this.bus!.adopt(channel);
      },
    });
    if (!this.bus) this.createBus();
  }

  private createBus() {
    this.bus = new ChannelBus({
      onMessage: (message) => this.onControl(message),
      onBinary: (data) => this.files?.handleChunk(data),
      onOpen: () => {
        this.bus?.send({
          t: "hello",
          role: "viewer",
          name: this.name,
          caps: { agent: false, os: "browser", width: 0, height: 0, displays: 1, version: PROTOCOL_VERSION },
        });
      },
      onRtt: (rttMs) => this.patch({ rttMs }),
    });
    this.files = new FileTransfers(
      () => this.bus?.bulkChannel ?? null,
      (message) => this.bus?.send(message),
      (transfers) => this.patch({ transfers }),
    );
  }

  private onControl(message: ControlMessage) {
    if (this.files?.handleControl(message)) return;

    switch (message.t) {
      case "hello":
        this.patch({ hostName: message.name, caps: message.caps });
        break;
      case "caps":
        this.patch({ caps: message.caps });
        break;
      case "grant":
        this.patch({
          control: message.control,
          controlNote: message.reason ?? null,
        });
        break;
      case "surface":
        this.patch({
          surface: { width: message.width, height: message.height, label: message.label },
        });
        break;
      case "displays":
        this.patch({ displays: message.list });
        break;
      case "chat":
        this.patch({
          chat: [
            ...this.snapshot.chat,
            { id: ++this.chatSeq, from: message.from, text: message.text, ts: message.ts, mine: false },
          ].slice(-200),
        });
        break;
      case "clip":
        void navigator.clipboard?.writeText(message.text).catch(() => undefined);
        this.patch({ clipboardIn: message.text.slice(0, 5000) });
        break;
      case "bye":
        this.patch({ phase: "encerrado", error: message.reason });
        this.teardown();
        break;
      default:
        break;
    }
  }

  /* ------------------------------ acoes ------------------------------ */

  sendInput(events: InputEvent[]) {
    if (!this.snapshot.control) return;
    this.bus?.send({ t: "input", e: events });
  }

  sendPointer(x: number, y: number) {
    this.bus?.send({ t: "ptr", x, y, label: this.name });
  }

  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !this.bus) return;
    const ts = Date.now();
    this.bus.send({ t: "chat", text: trimmed, from: this.name, ts });
    this.patch({
      chat: [...this.snapshot.chat, { id: ++this.chatSeq, from: this.name, text: trimmed, ts, mine: true }].slice(-200),
    });
  }

  async sendClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      this.bus?.send({ t: "clip", text: text.slice(0, 100_000) });
      this.patch({ notice: "Area de transferencia enviada." });
    } catch {
      this.patch({ notice: "O navegador negou a leitura da area de transferencia." });
    }
  }

  requestClipboard() {
    this.bus?.send({ t: "clip-req" });
  }

  async sendFile(file: File) {
    await this.files?.offer(file);
  }

  acceptFile(id: string) {
    this.files?.accept(id);
  }

  rejectFile(id: string) {
    this.files?.reject(id);
  }

  cancelFile(id: string) {
    this.files?.cancel(id);
  }

  pickDisplay(id: number) {
    this.bus?.send({ t: "pick-display", id });
  }

  requestReshare() {
    this.bus?.send({ t: "reshare" });
  }

  /** Aviso passageiro na barra lateral (limites do navegador, permissoes). */
  notify(text: string | null) {
    this.patch({ notice: text });
  }

  leave() {
    if (this.hostPeer) void this.signaling?.send(this.hostPeer, "bye", { reason: "saiu" });
    this.patch({ phase: "encerrado" });
    this.teardown();
  }

  private teardown() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.files?.dispose();
    this.bus?.close();
    this.link?.close();
    this.signaling?.stop();
  }

  stop() {
    this.leave();
  }

  private async sampleStats() {
    if (!this.link || this.link.pc.connectionState !== "connected") return;
    this.patch({ stats: await this.sampler.sample(this.link.pc) });
  }
}

function explain(code: string | undefined, status: number): string {
  switch (code) {
    case "codigo_ou_pin_invalido":
      return "Codigo ou PIN incorreto.";
    case "muitas_tentativas":
      return "Muitas tentativas. Aguarde um minuto e tente de novo.";
    case "sessao_lotada":
      return "A sessao ja atingiu o limite de participantes.";
    case "sessao_inexistente":
      return "Essa sessao nao existe mais.";
    default:
      return `Nao foi possivel entrar (${status}).`;
  }
}
