"use client";

import type { QualityProfile } from "@/lib/protocol";

export type PeerSignal =
  | { kind: "offer" | "answer"; data: RTCSessionDescriptionInit }
  | { kind: "ice"; data: RTCIceCandidateInit };

export interface PeerLinkOptions {
  /**
   * Negociacao perfeita: o lado "polite" cede quando duas ofertas se cruzam.
   * O anfitriao (que envia midia) e o impolite; o visualizante e o polite.
   */
  polite: boolean;
  iceServers: RTCIceServer[];
  /** Forca todo o trafego pelo TURN — util para diagnosticar e para redes que bloqueiam P2P. */
  relayOnly?: boolean;
  onSignal: (signal: PeerSignal) => void;
  onTrack?: (stream: MediaStream) => void;
  onDataChannel?: (channel: RTCDataChannel) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  onIceStateChange?: (state: RTCIceConnectionState) => void;
}

/** Preferencia de codec. VP9 tem ferramentas proprias para conteudo de tela
 *  (texto fica bem mais legivel na mesma taxa de bits que o VP8/H264). */
const CODEC_PREFERENCE = ["video/VP9", "video/H264", "video/VP8"];

export class PeerLink {
  readonly pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private closed = false;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: PeerLinkOptions) {
    this.pc = new RTCPeerConnection({
      iceServers: opts.iceServers,
      iceTransportPolicy: opts.relayOnly ? "relay" : "all",
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      // Pool pequeno acelera a primeira conexao sem custar muito.
      iceCandidatePoolSize: 4,
    });

    this.pc.onnegotiationneeded = async () => {
      if (this.closed) return;
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.opts.onSignal({ kind: "offer", data: this.pc.localDescription.toJSON() });
        }
      } catch (error) {
        console.error("[rtc] falha ao criar oferta", error);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.opts.onSignal({ kind: "ice", data: candidate.toJSON() });
    };

    this.pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) this.opts.onTrack?.(stream);
    };

    this.pc.ondatachannel = (event) => this.opts.onDataChannel?.(event.channel);

    this.pc.onconnectionstatechange = () => {
      this.opts.onStateChange?.(this.pc.connectionState);
      if (this.pc.connectionState === "failed") this.restartIce();
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      this.opts.onIceStateChange?.(state);
      // "disconnected" costuma se resolver sozinho (troca de rede, wifi fraco).
      // So forcamos o restart se persistir.
      if (state === "disconnected" && !this.recoverTimer && !this.opts.polite) {
        this.recoverTimer = setTimeout(() => {
          this.recoverTimer = null;
          if (this.pc.iceConnectionState === "disconnected") this.restartIce();
        }, 4000);
      }
      if (state === "connected" || state === "completed") {
        if (this.recoverTimer) {
          clearTimeout(this.recoverTimer);
          this.recoverTimer = null;
        }
      }
    };
  }

  /* -------------------- negociacao -------------------- */

  async applyDescription(desc: RTCSessionDescriptionInit) {
    if (this.closed) return;
    const collision =
      desc.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");

    this.ignoreOffer = !this.opts.polite && collision;
    if (this.ignoreOffer) return;

    if (collision) {
      // Lado polite: descarta a propria oferta e aceita a do outro.
      await this.pc.setLocalDescription({ type: "rollback" });
    }
    await this.pc.setRemoteDescription(desc);

    for (const candidate of this.pendingCandidates.splice(0)) {
      await this.pc.addIceCandidate(candidate).catch(() => undefined);
    }

    if (desc.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.opts.onSignal({ kind: "answer", data: this.pc.localDescription.toJSON() });
      }
    }
  }

  async applyCandidate(candidate: RTCIceCandidateInit) {
    if (this.closed) return;
    // Candidatos podem chegar antes da descricao remota; guardamos para depois.
    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (error) {
      if (!this.ignoreOffer) console.warn("[rtc] candidato recusado", error);
    }
  }

  restartIce() {
    if (this.closed || this.opts.polite) return;
    try {
      this.pc.restartIce();
    } catch (error) {
      console.warn("[rtc] restartIce indisponivel", error);
    }
  }

  /* -------------------- midia -------------------- */

  addStream(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      if (track.kind === "video") this.preferCodec(sender);
    }
  }

  /** Troca a superficie compartilhada sem renegociar a sessao inteira. */
  async replaceTrack(track: MediaStreamTrack) {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
    if (sender) {
      await sender.replaceTrack(track);
      return true;
    }
    return false;
  }

  private preferCodec(sender: RTCRtpSender) {
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === sender);
    if (!transceiver?.setCodecPreferences) return;
    const capabilities = RTCRtpSender.getCapabilities("video");
    if (!capabilities) return;
    const ranked = [...capabilities.codecs].sort(
      (a, b) => rank(a.mimeType) - rank(b.mimeType),
    );
    try {
      transceiver.setCodecPreferences(ranked);
    } catch {
      /* navegador sem suporte: segue a ordem padrao */
    }
  }

  /** Aplica limites de taxa, quadros e escala no encoder. */
  async applyQuality(profile: QualityProfile) {
    const sender = this.pc.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;

    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = profile.bitrate;
    params.encodings[0].maxFramerate = profile.fps;
    params.encodings[0].scaleResolutionDownBy = Math.max(1, profile.scale);
    // Texto ilegivel e pior que animacao travada: preservamos a resolucao.
    params.degradationPreference = profile.hint === "motion" ? "maintain-framerate" : "maintain-resolution";

    await sender.setParameters(params).catch((error) => console.warn("[rtc] setParameters", error));

    if (sender.track) {
      sender.track.contentHint = profile.hint === "text" ? "text" : profile.hint;
    }
  }

  createChannel(label: string, init: RTCDataChannelInit): RTCDataChannel {
    return this.pc.createDataChannel(label, init);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.pc.getSenders().forEach((s) => s.track?.stop?.());
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.ondatachannel = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.pc.close();
    } catch {
      /* ja fechado */
    }
  }
}

function rank(mimeType: string) {
  const index = CODEC_PREFERENCE.indexOf(mimeType);
  return index === -1 ? CODEC_PREFERENCE.length : index;
}
