"use client";

export interface LinkStats {
  /** kbit/s medidos no intervalo entre duas amostras. */
  kbps: number;
  fps: number;
  width: number;
  height: number;
  /** Ida e volta em milissegundos, do par de candidatos em uso. */
  rttMs: number;
  jitterMs: number;
  lossPercent: number;
  codec: string;
  /** "direto" quando ha caminho P2P, "relay" quando passa pelo TURN. */
  path: "direto" | "relay" | "local" | "?";
  /** Motivo pelo qual o encoder esta se limitando (cpu, bandwidth...). */
  limitedBy: string;
  bytes: number;
}

export const EMPTY_STATS: LinkStats = {
  kbps: 0,
  fps: 0,
  width: 0,
  height: 0,
  rttMs: 0,
  jitterMs: 0,
  lossPercent: 0,
  codec: "—",
  path: "?",
  limitedBy: "none",
  bytes: 0,
};

/**
 * Amostra o `getStats` e converte contadores acumulados em taxas.
 * Guarda a leitura anterior para calcular a diferenca.
 */
export class StatsSampler {
  private prevBytes = 0;
  private prevAt = 0;
  private prevLost = 0;
  private prevPackets = 0;

  constructor(private direction: "enviando" | "recebendo") {}

  async sample(pc: RTCPeerConnection): Promise<LinkStats> {
    const report = await pc.getStats();
    const out: LinkStats = { ...EMPTY_STATS };
    const now = performance.now();

    const codecs = new Map<string, string>();
    let rtp: RTCStats | undefined;
    let pair: RTCStats | undefined;
    const candidates = new Map<string, { candidateType?: string }>();

    report.forEach((stat) => {
      switch (stat.type) {
        case "codec":
          codecs.set(stat.id, (stat as RTCStats & { mimeType?: string }).mimeType ?? "");
          break;
        case "outbound-rtp":
          if (this.direction === "enviando" && (stat as RTCStats & { kind?: string }).kind === "video") rtp = stat;
          break;
        case "inbound-rtp":
          if (this.direction === "recebendo" && (stat as RTCStats & { kind?: string }).kind === "video") rtp = stat;
          break;
        case "candidate-pair":
          if ((stat as RTCStats & { nominated?: boolean; state?: string }).state === "succeeded") pair = stat;
          break;
        case "local-candidate":
        case "remote-candidate":
          candidates.set(stat.id, stat as RTCStats & { candidateType?: string });
          break;
      }
    });

    if (rtp) {
      const r = rtp as RTCStats & {
        bytesSent?: number;
        bytesReceived?: number;
        framesPerSecond?: number;
        frameWidth?: number;
        frameHeight?: number;
        packetsLost?: number;
        packetsReceived?: number;
        packetsSent?: number;
        jitter?: number;
        codecId?: string;
        qualityLimitationReason?: string;
      };
      const bytes = r.bytesSent ?? r.bytesReceived ?? 0;
      if (this.prevAt && bytes >= this.prevBytes) {
        const seconds = (now - this.prevAt) / 1000;
        if (seconds > 0) out.kbps = Math.round(((bytes - this.prevBytes) * 8) / seconds / 1000);
      }
      this.prevBytes = bytes;
      this.prevAt = now;
      out.bytes = bytes;

      out.fps = Math.round(r.framesPerSecond ?? 0);
      out.width = r.frameWidth ?? 0;
      out.height = r.frameHeight ?? 0;
      out.jitterMs = Math.round((r.jitter ?? 0) * 1000);
      out.limitedBy = r.qualityLimitationReason ?? "none";
      out.codec = (codecs.get(r.codecId ?? "") ?? "").replace("video/", "") || "—";

      const lost = r.packetsLost ?? 0;
      const total = r.packetsReceived ?? r.packetsSent ?? 0;
      const dLost = Math.max(0, lost - this.prevLost);
      const dTotal = Math.max(0, total - this.prevPackets);
      out.lossPercent = dTotal > 0 ? Math.round((dLost / (dTotal + dLost)) * 1000) / 10 : 0;
      this.prevLost = lost;
      this.prevPackets = total;
    }

    if (pair) {
      const p = pair as RTCStats & {
        currentRoundTripTime?: number;
        localCandidateId?: string;
        remoteCandidateId?: string;
      };
      out.rttMs = Math.round((p.currentRoundTripTime ?? 0) * 1000);
      const local = candidates.get(p.localCandidateId ?? "")?.candidateType;
      const remote = candidates.get(p.remoteCandidateId ?? "")?.candidateType;
      if (local === "relay" || remote === "relay") out.path = "relay";
      else if (local === "host" && remote === "host") out.path = "local";
      else if (local || remote) out.path = "direto";
    }

    return out;
  }
}
