"use client";

import { AgentClient, type AgentInfo } from "@/lib/agent/client";
import { deriveSessionKey, safetyWords } from "@/lib/crypto";
import { captureMicrophone, captureScreen, describeSurface, keepAwake, type SurfaceInfo } from "@/lib/media/capture";
import {
  PROTOCOL_VERSION,
  QUALITY_PRESETS,
  type ControlMessage,
  type InputEvent,
  type JoinPayload,
  type PeerCapabilities,
} from "@/lib/protocol";
import { ChannelBus } from "@/lib/rtc/channel";
import { FileTransfers, type TransferView } from "@/lib/rtc/files";
import { PeerLink } from "@/lib/rtc/peer";
import { Signaling, type SignalingStatus } from "@/lib/rtc/signaling";
import { EMPTY_STATS, StatsSampler, type LinkStats } from "@/lib/rtc/stats";

export interface ViewerEntry {
  peerId: string;
  name: string;
  status: "pendente" | "conectando" | "conectado" | "recusado" | "saiu";
  /** Este visualizante pode enviar mouse e teclado. */
  control: boolean;
  wantsControl: boolean;
  rttMs: number;
  stats: LinkStats;
  pointer: { x: number; y: number } | null;
  since: number;
}

export interface ChatEntry {
  id: number;
  from: string;
  text: string;
  ts: number;
  mine: boolean;
}

export interface HostSnapshot {
  phase: "iniciando" | "pronta" | "erro";
  error: string | null;
  code: string;
  pin: string;
  link: string;
  words: string;
  storeKind: string;
  signal: SignalingStatus;
  sharing: boolean;
  surface: SurfaceInfo | null;
  micOn: boolean;
  viewers: ViewerEntry[];
  chat: ChatEntry[];
  transfers: TransferView[];
  agent: AgentInfo | null;
  agentPaired: boolean;
  quality: string;
  clipboardIn: string | null;
  notice: string | null;
  /** Qual monitor corresponde a superficie compartilhada (mapeamento do agente). */
  displayId: number;
}

interface PeerEntry {
  link: PeerLink;
  bus: ChannelBus;
  files: FileTransfers;
  sampler: StatsSampler;
  entry: ViewerEntry;
}

const EMPTY: HostSnapshot = {
  phase: "iniciando",
  error: null,
  code: "",
  pin: "",
  link: "",
  words: "",
  storeKind: "",
  signal: "fechado",
  sharing: false,
  surface: null,
  micOn: false,
  viewers: [],
  chat: [],
  transfers: [],
  agent: null,
  agentPaired: false,
  quality: "auto",
  clipboardIn: null,
  notice: null,
  displayId: 0,
};

/**
 * Lado anfitriao da sessao.
 *
 * Escrito como classe e nao como hook porque a maquina de estados aqui e
 * inerentemente imperativa (varias conexoes WebRTC simultaneas, cada uma com
 * seus canais e temporizadores). O React observa o resultado por
 * `useSyncExternalStore`, sem se meter no ciclo de vida das conexoes.
 */
export class HostSession {
  private snapshot: HostSnapshot = EMPTY;
  private listeners = new Set<() => void>();

  private signaling: Signaling | null = null;
  private token = "";
  private peerId = "";
  private key: CryptoKey | null = null;
  private iceServers: RTCIceServer[] = [];
  private peers = new Map<string, PeerEntry>();
  /** Quem pediu para entrar e ainda aguarda o anfitriao decidir. */
  private pending = new Map<string, ViewerEntry>();
  private stream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private releaseWakeLock: (() => void) | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private chatSeq = 0;
  private agentClient = new AgentClient();
  private stopped = false;

  constructor(private name: string) {}

  /* ------------------------- observabilidade ------------------------- */

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private patch(partial: Partial<HostSnapshot>) {
    this.snapshot = { ...this.snapshot, ...partial };
    for (const listener of this.listeners) listener();
  }

  private syncViewers() {
    this.patch({
      viewers: [
        ...[...this.pending.values()].map((entry) => ({ ...entry })),
        ...[...this.peers.values()].map((p) => ({ ...p.entry })),
      ],
    });
  }

  private syncTransfers() {
    const all = [...this.peers.values()].flatMap((p) => p.files.list());
    this.patch({ transfers: all });
  }

  private notice(text: string | null) {
    this.patch({ notice: text });
  }

  /* ----------------------------- ciclo ----------------------------- */

  async start() {
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requireApproval: true, allowControl: true }),
      });
      if (!res.ok) throw new Error(`Nao foi possivel abrir a sessao (${res.status}).`);
      const data = (await res.json()) as {
        code: string;
        pin: string;
        salt: string;
        peerId: string;
        token: string;
        store: string;
      };

      this.peerId = data.peerId;
      this.token = data.token;
      this.key = await deriveSessionKey(data.pin, data.salt);

      const link = `${location.origin}/conectar?c=${data.code}#${data.pin}`;
      this.patch({
        phase: "pronta",
        code: data.code,
        pin: data.pin,
        link,
        words: await safetyWords(data.pin, data.salt),
        storeKind: data.store,
      });

      this.iceServers = await loadIceServers();

      this.signaling = new Signaling({
        code: data.code,
        peerId: data.peerId,
        token: data.token,
        key: this.key,
        onStatus: (signal) => this.patch({ signal }),
        onSignal: (env, payload) => void this.onSignal(env.from, env.kind, payload),
      });
      this.signaling.start();

      // So varremos o loopback quando ja houve um pareamento neste navegador.
      // Sondar as portas sem motivo enche o console de erros de rede e atrasa
      // a abertura da pagina para quem nunca vai usar o agente.
      if (this.agentClient.hasSaved) void this.refreshAgent();

      this.statsTimer = setInterval(() => void this.sampleStats(), 1000);
    } catch (error) {
      this.patch({ phase: "erro", error: (error as Error).message });
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.statsTimer) clearInterval(this.statsTimer);
    for (const peer of this.peers.values()) this.teardownPeer(peer, "sessao encerrada");
    this.peers.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.releaseWakeLock?.();
    this.signaling?.stop();

    if (this.snapshot.code) {
      const url = `/api/session?code=${this.snapshot.code}&peerId=${this.peerId}&token=${encodeURIComponent(this.token)}`;
      void fetch(url, { method: "DELETE", keepalive: true }).catch(() => undefined);
    }
  }

  /* -------------------------- compartilhar -------------------------- */

  async share(systemAudio = true) {
    try {
      const stream = await captureScreen({ systemAudio, fps: 60 });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;

      // O usuario pode encerrar pelo aviso nativo do navegador.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => this.stopShare());

      this.patch({ sharing: true, surface: describeSurface(stream) });
      this.releaseWakeLock = await keepAwake();

      for (const peer of this.peers.values()) {
        const replaced = await peer.link.replaceTrack(stream.getVideoTracks()[0]!);
        if (!replaced) peer.link.addStream(stream);
        void peer.link.applyQuality(QUALITY_PRESETS[this.snapshot.quality]!);
        this.announceCaps(peer);
      }
      this.notice(null);
    } catch (error) {
      this.notice((error as Error).message);
    }
  }

  /** Fluxo local para a pre-visualizacao e para a gravacao. */
  previewStream(): MediaStream | null {
    return this.stream;
  }

  stopShare() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.releaseWakeLock?.();
    this.releaseWakeLock = null;
    this.patch({ sharing: false, surface: null });
    // Superficie zerada = "parei de compartilhar", sem derrubar a sessao:
    // chat, arquivos e a propria conexao continuam de pe.
    this.broadcast({ t: "surface", width: 0, height: 0, label: "parado" });
  }

  async toggleMic() {
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
      this.patch({ micOn: false });
      return;
    }
    try {
      this.micStream = await captureMicrophone();
      const track = this.micStream.getAudioTracks()[0]!;
      for (const peer of this.peers.values()) peer.link.pc.addTrack(track, this.micStream);
      this.patch({ micOn: true });
    } catch {
      this.notice("Nao foi possivel acessar o microfone.");
    }
  }

  setQuality(preset: string) {
    const profile = QUALITY_PRESETS[preset];
    if (!profile) return;
    this.patch({ quality: preset });
    for (const peer of this.peers.values()) void peer.link.applyQuality(profile);
  }

  /* ------------------------- sinalizacao ------------------------- */

  private async onSignal(from: string, kind: string, payload: unknown) {
    if (kind === "join") {
      const join = payload as JoinPayload;
      const existing = this.peers.get(from);
      if (existing) return;

      const entry: ViewerEntry = {
        peerId: from,
        name: (join?.name ?? "Visitante").slice(0, 40),
        status: "pendente",
        control: false,
        wantsControl: Boolean(join?.wantsControl),
        rttMs: 0,
        stats: EMPTY_STATS,
        pointer: null,
        since: Date.now(),
      };
      this.pending.set(from, entry);
      this.syncViewers();
      return;
    }

    const peer = this.peers.get(from);
    if (!peer) return;

    if (kind === "offer" || kind === "answer") {
      await peer.link.applyDescription(payload as RTCSessionDescriptionInit);
    } else if (kind === "ice") {
      await peer.link.applyCandidate(payload as RTCIceCandidateInit);
    } else if (kind === "bye") {
      this.removePeer(from, "saiu");
    }
  }

  async approve(peerId: string) {
    const entry = this.pending.get(peerId);
    if (!entry) return;
    this.pending.delete(peerId);
    entry.status = "conectando";

    await this.signaling?.send(peerId, "accept", { ok: true });
    this.createPeer(entry);
  }

  async deny(peerId: string) {
    const entry = this.pending.get(peerId);
    this.pending.delete(peerId);
    await this.signaling?.send(peerId, "reject", { reason: "recusado pelo anfitriao" });
    this.syncViewers();
    if (entry) this.notice(`Pedido de ${entry.name} recusado.`);
  }

  private createPeer(entry: ViewerEntry) {
    const link = new PeerLink({
      polite: false,
      iceServers: this.iceServers,
      onSignal: (signal) => void this.signaling?.send(entry.peerId, signal.kind, signal.data),
      onStateChange: (state) => {
        entry.status = state === "connected" ? "conectado" : state === "failed" ? "saiu" : entry.status;
        this.syncViewers();
      },
    });

    const bus = new ChannelBus({
      onMessage: (message) => this.onControl(entry.peerId, message),
      onBinary: (data) => this.peers.get(entry.peerId)?.files.handleChunk(data),
      onOpen: () => {
        this.announceCaps(this.peers.get(entry.peerId)!);
        entry.status = "conectado";
        this.syncViewers();
      },
      onRtt: (ms) => {
        entry.rttMs = ms;
        this.syncViewers();
      },
    });

    // Confiavel e ordenado: comandos nao podem chegar fora de ordem.
    bus.setControl(link.createChannel("control", { ordered: true }));
    bus.setBulk(link.createChannel("bulk", { ordered: true }));

    const files = new FileTransfers(
      () => bus.bulkChannel,
      (message) => bus.send(message),
      () => this.syncTransfers(),
    );

    const peer: PeerEntry = { link, bus, files, sampler: new StatsSampler("enviando"), entry };
    this.peers.set(entry.peerId, peer);

    if (this.stream) link.addStream(this.stream);
    if (this.micStream) link.pc.addTrack(this.micStream.getAudioTracks()[0]!, this.micStream);
    void link.applyQuality(QUALITY_PRESETS[this.snapshot.quality]!);

    this.syncViewers();
  }

  private teardownPeer(peer: PeerEntry, reason: string) {
    peer.bus.send({ t: "bye", reason });
    peer.files.dispose();
    peer.bus.close();
    peer.link.close();
  }

  private removePeer(peerId: string, status: ViewerEntry["status"]) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.entry.status = status;
    peer.entry.control = false;
    this.teardownPeer(peer, "encerrado");
    this.peers.delete(peerId);
    this.syncViewers();
  }

  disconnect(peerId: string) {
    this.removePeer(peerId, "saiu");
  }

  /* ------------------------ canal de controle ------------------------ */

  private onControl(peerId: string, message: ControlMessage) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    if (peer.files.handleControl(message)) return;

    switch (message.t) {
      case "input":
        this.applyInput(peer, message.e);
        break;

      case "ptr":
        peer.entry.pointer = { x: message.x, y: message.y };
        this.syncViewers();
        break;

      case "chat":
        this.pushChat({
          id: ++this.chatSeq,
          from: peer.entry.name,
          text: message.text.slice(0, 2000),
          ts: message.ts,
          mine: false,
        });
        break;

      case "clip":
        // Escrever na area de transferencia pode exigir foco na aba; se falhar,
        // mostramos o conteudo para o usuario copiar manualmente.
        void navigator.clipboard?.writeText(message.text).catch(() => undefined);
        this.patch({ clipboardIn: message.text.slice(0, 5000) });
        break;

      case "clip-req":
        void this.sendClipboard(peerId);
        break;

      case "reshare":
        void this.share();
        break;

      case "pick-display":
        void this.setDisplay(message.id);
        break;

      case "bye":
        this.removePeer(peerId, "saiu");
        break;

      default:
        break;
    }
  }

  /**
   * Entrada so e aplicada quando as tres condicoes valem: o visualizante tem
   * controle concedido, o agente local esta pareado e a sessao esta
   * compartilhando. Qualquer uma faltando, os eventos sao descartados.
   */
  private applyInput(peer: PeerEntry, events: InputEvent[]) {
    if (!peer.entry.control || !this.agentClient.connected) return;
    void this.agentClient.dispatch(events);
  }

  async setControl(peerId: string, control: boolean) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (control) {
      // Um controlador por vez: dois cursores disputando a mesma maquina
      // produzem um resultado que ninguem consegue usar.
      for (const other of this.peers.values()) {
        if (other.entry.peerId !== peerId && other.entry.control) {
          other.entry.control = false;
          other.bus.send({ t: "grant", control: false, reason: "controle passou para outro participante" });
        }
      }
      if (!this.agentClient.connected) {
        peer.bus.send({ t: "grant", control: false, reason: "agente local nao pareado" });
        this.notice("Ative o agente local para conceder controle de mouse e teclado.");
        return;
      }
    }

    peer.entry.control = control;
    peer.bus.send({ t: "grant", control });
    this.syncViewers();
  }

  private announceCaps(peer: PeerEntry) {
    const surface = this.snapshot.surface;
    const caps: PeerCapabilities = {
      agent: this.agentClient.connected,
      os: this.agentClient.info?.os ?? navigatorPlatform(),
      width: surface?.width ?? 0,
      height: surface?.height ?? 0,
      displays: this.agentClient.info?.displays.length ?? 1,
      version: PROTOCOL_VERSION,
    };
    peer.bus.send({ t: "hello", role: "host", name: this.name, caps });
    if (surface) {
      peer.bus.send({ t: "surface", width: surface.width, height: surface.height, label: surface.kind });
    }
    if (this.agentClient.info?.displays.length) {
      peer.bus.send({ t: "displays", list: this.agentClient.info.displays });
    }
  }

  private broadcast(message: ControlMessage) {
    for (const peer of this.peers.values()) peer.bus.send(message);
  }

  /* ---------------------------- extras ---------------------------- */

  private pushChat(entry: ChatEntry) {
    this.patch({ chat: [...this.snapshot.chat, entry].slice(-200) });
  }

  sendChat(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const entry: ChatEntry = { id: ++this.chatSeq, from: this.name, text: trimmed, ts: Date.now(), mine: true };
    this.pushChat(entry);
    this.broadcast({ t: "chat", text: trimmed, from: this.name, ts: entry.ts });
  }

  async sendClipboard(peerId?: string) {
    try {
      const text = await navigator.clipboard.readText();
      const message: ControlMessage = { t: "clip", text: text.slice(0, 100_000) };
      if (peerId) this.peers.get(peerId)?.bus.send(message);
      else this.broadcast(message);
    } catch {
      this.notice("O navegador negou a leitura da area de transferencia. Clique na pagina e tente de novo.");
    }
  }

  async sendFile(file: File, peerId?: string) {
    const targets = peerId ? [this.peers.get(peerId)].filter(Boolean) : [...this.peers.values()];
    for (const peer of targets as PeerEntry[]) await peer.files.offer(file);
  }

  acceptFile(id: string) {
    for (const peer of this.peers.values()) peer.files.accept(id);
  }

  rejectFile(id: string) {
    for (const peer of this.peers.values()) peer.files.reject(id);
  }

  cancelFile(id: string) {
    for (const peer of this.peers.values()) peer.files.cancel(id);
  }

  /* ----------------------------- agente ----------------------------- */

  async refreshAgent() {
    const info = await this.agentClient.discover();
    this.patch({ agent: info, agentPaired: this.agentClient.connected });
    if (info) this.broadcastCaps();
    return info;
  }

  async pairAgent(code: string) {
    const ok = await this.agentClient.pair(code);
    this.patch({ agent: this.agentClient.info, agentPaired: this.agentClient.connected });
    if (!ok) this.notice("Codigo de pareamento incorreto ou agente fora do ar.");
    else {
      this.notice(null);
      this.broadcastCaps();
    }
    return ok;
  }

  forgetAgent() {
    this.agentClient.forget();
    for (const peer of this.peers.values()) {
      if (peer.entry.control) {
        peer.entry.control = false;
        peer.bus.send({ t: "grant", control: false, reason: "agente desconectado" });
      }
    }
    this.patch({ agent: null, agentPaired: false });
    this.syncViewers();
    this.broadcastCaps();
  }

  async setDisplay(id: number) {
    const ok = await this.agentClient.pickDisplay(id);
    if (ok) this.patch({ displayId: id });
  }

  private broadcastCaps() {
    for (const peer of this.peers.values()) this.announceCaps(peer);
  }

  private async sampleStats() {
    for (const peer of this.peers.values()) {
      if (peer.link.pc.connectionState !== "connected") continue;
      peer.entry.stats = await peer.sampler.sample(peer.link.pc);
    }
    if (this.peers.size) this.syncViewers();
  }
}

function navigatorPlatform(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X/i.test(ua)) return "darwin";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "desconhecido";
}

export async function loadIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/ice", { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { iceServers: RTCIceServer[] };
    return data.iceServers ?? [];
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}
