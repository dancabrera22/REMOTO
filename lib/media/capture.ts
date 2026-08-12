"use client";

export interface ScreenCaptureOptions {
  /** Captura tambem o audio do sistema (so Chrome/Edge, e so em aba ou tela inteira). */
  systemAudio: boolean;
  fps: number;
}

export interface SurfaceInfo {
  width: number;
  height: number;
  fps: number;
  /** "monitor" | "window" | "browser" — o que o usuario escolheu no dialogo. */
  kind: string;
  label: string;
}

/**
 * Abre o seletor nativo de compartilhamento de tela.
 *
 * Precisa ser chamado dentro de um gesto do usuario (clique), senao o
 * navegador recusa. As dicas passadas aqui mudam bastante o resultado:
 *
 * - `displaySurface: "monitor"` deixa a tela inteira pre-selecionada, que e o
 *   que quase todo mundo quer num acesso remoto.
 * - `surfaceSwitching: "include"` permite trocar de janela sem refazer a
 *   negociacao WebRTC.
 * - `selfBrowserSurface: "exclude"` evita o efeito de espelho infinito de
 *   compartilhar a propria aba do REMOTO.
 */
export async function captureScreen(options: ScreenCaptureOptions): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(
      "Este navegador nao suporta captura de tela. Use Chrome, Edge, Firefox ou Safari atualizados, em conexao HTTPS.",
    );
  }

  const constraints: DisplayMediaStreamOptions & Record<string, unknown> = {
    // `cursor` e uma dica nao padronizada que o Chromium respeita; o cast
    // evita brigar com a tipagem enquanto ela nao acompanha a implementacao.
    video: {
      frameRate: { ideal: options.fps, max: 60 },
      width: { ideal: 1920, max: 3840 },
      height: { ideal: 1080, max: 2160 },
      displaySurface: "monitor",
      cursor: "always",
    } as MediaTrackConstraints,
    audio: options.systemAudio
      ? {
          // Processamento de voz destroi audio de sistema (musica, video).
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }
      : false,
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: options.systemAudio ? "include" : "exclude",
    monitorTypeSurfaces: "include",
  };

  try {
    return await navigator.mediaDevices.getDisplayMedia(constraints);
  } catch (error) {
    const name = (error as DOMException)?.name;
    if (name === "NotAllowedError") throw new Error("Compartilhamento cancelado.");
    if (name === "NotFoundError") throw new Error("Nenhuma tela disponivel para capturar.");
    throw error as Error;
  }
}

export async function captureMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

export function describeSurface(stream: MediaStream): SurfaceInfo {
  const track = stream.getVideoTracks()[0];
  const settings = (track?.getSettings() ?? {}) as MediaTrackSettings & { displaySurface?: string };
  return {
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    fps: Math.round(settings.frameRate ?? 0),
    kind: settings.displaySurface ?? "desconhecido",
    label: track?.label ?? "tela",
  };
}

/**
 * Impede que a maquina do anfitriao durma ou apague a tela durante a sessao.
 * Sem isso, uma sessao de suporte cai sozinha depois de alguns minutos ociosa.
 */
export async function keepAwake(): Promise<() => void> {
  type Sentinel = { release: () => Promise<void> };
  const wakeLock = (navigator as Navigator & {
    wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
  }).wakeLock;
  if (!wakeLock) return () => undefined;

  let sentinel: Sentinel | null = null;
  const acquire = async () => {
    try {
      sentinel = await wakeLock.request("screen");
    } catch {
      /* negado ou aba em segundo plano */
    }
  };
  // O bloqueio cai sozinho quando a aba perde visibilidade; retomamos ao voltar.
  const onVisible = () => {
    if (!document.hidden) void acquire();
  };
  document.addEventListener("visibilitychange", onVisible);
  await acquire();

  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    void sentinel?.release().catch(() => undefined);
  };
}

/** Grava a sessao localmente, sem passar por servidor nenhum. */
export function startRecording(stream: MediaStream): { stop: () => Promise<Blob>; mime: string } {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  const mime = candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.start(1000);

  return {
    mime,
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime || "video/webm" }));
        recorder.stop();
      }),
  };
}
