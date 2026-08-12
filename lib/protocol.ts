/**
 * Protocolo do REMOTO.
 *
 * Duas camadas independentes:
 *
 *  1. SINALIZACAO (HTTP: POST /api/signal + SSE /api/signal/stream)
 *     Curta, rara, so acontece no aperto de mao. Trafega SDP e ICE.
 *     O payload pode vir cifrado com a chave derivada do PIN — nesse caso
 *     nem o servidor consegue ler/alterar o SDP (defesa contra MITM do proprio
 *     servidor de sinalizacao).
 *
 *  2. SESSAO (WebRTC DataChannel "control" e "bulk")
 *     Tudo que acontece depois: entrada de mouse/teclado, clipboard, chat,
 *     arquivos, telemetria. Sempre ponto-a-ponto e cifrado por DTLS.
 */

export const PROTOCOL_VERSION = 3;

/* ------------------------------------------------------------------ */
/* Camada 1 — sinalizacao                                              */
/* ------------------------------------------------------------------ */

export type SignalKind =
  | "join" // visualizante anuncia que chegou e pede autorizacao
  | "accept" // anfitriao autoriza o visualizante
  | "reject" // anfitriao recusa
  | "offer"
  | "answer"
  | "ice"
  | "bye";

export interface SignalEnvelope {
  /** Cursor monotonico atribuido pelo servidor; usado para retomar o SSE. */
  seq: number;
  /** peerId de quem enviou. */
  from: string;
  /** peerId destino, ou "*" para todos na sessao. */
  to: string;
  kind: SignalKind;
  /**
   * JSON serializado. Se `enc` for true, e um blob base64 AES-GCM
   * (ver lib/crypto.ts) e o servidor nao consegue interpretar.
   */
  data: string;
  enc?: boolean;
  ts: number;
}

/** Corpo de `kind: "join"` — o unico que o anfitriao le antes de autorizar. */
export interface JoinPayload {
  name: string;
  ua: string;
  wantsControl: boolean;
}

/* ------------------------------------------------------------------ */
/* Camada 2 — canal de controle                                        */
/* ------------------------------------------------------------------ */

export type Role = "host" | "viewer";

/** Bitmask de modificadores, compartilhado entre visualizante e agente. */
export const MOD = {
  SHIFT: 1,
  CTRL: 2,
  ALT: 4,
  META: 8,
} as const;

export type PointerButton = 0 | 1 | 2; // esquerdo | meio | direito

/**
 * Eventos de entrada. Nomes de campo com uma letra: sao os pacotes mais
 * frequentes da sessao (ate 60/s) e o overhead de JSON importa.
 * Coordenadas sempre normalizadas em 0..1 relativas a superficie compartilhada,
 * para que o anfitriao mapeie para a resolucao real dele.
 */
export type InputEvent =
  | { k: "m"; x: number; y: number } // movimento
  | { k: "d"; b: PointerButton; x: number; y: number } // botao pressionado
  | { k: "u"; b: PointerButton; x: number; y: number } // botao solto
  | { k: "c"; b: PointerButton; x: number; y: number; n: number } // clique (n = contagem)
  | { k: "w"; dx: number; dy: number; x: number; y: number } // roda
  | { k: "kd"; c: string; m: number } // tecla pressionada (KeyboardEvent.code)
  | { k: "ku"; c: string; m: number } // tecla solta
  | { k: "txt"; s: string } // texto literal (IME, colar, emoji)
  | { k: "combo"; s: ComboName }; // atalho que o navegador nao deixa capturar

export type ComboName =
  | "ctrl-alt-del"
  | "alt-tab"
  | "win"
  | "cmd-space"
  | "print-screen"
  | "lock-screen";

export interface QualityProfile {
  /** Alvo em bits por segundo do encoder de video. */
  bitrate: number;
  /** Quadros por segundo maximos. */
  fps: number;
  /** Fator de reducao de resolucao aplicado no encoder (1 = nativo). */
  scale: number;
  /** Prioriza nitidez de texto (detail) ou fluidez de movimento (motion). */
  hint: "detail" | "motion" | "text";
}

export const QUALITY_PRESETS: Record<string, QualityProfile> = {
  auto: { bitrate: 4_000_000, fps: 30, scale: 1, hint: "detail" },
  nitidez: { bitrate: 8_000_000, fps: 15, scale: 1, hint: "text" },
  fluidez: { bitrate: 6_000_000, fps: 60, scale: 1.5, hint: "motion" },
  economia: { bitrate: 800_000, fps: 12, scale: 2, hint: "text" },
};

export interface PeerCapabilities {
  /** O anfitriao tem o agente local pareado (controle real de SO). */
  agent: boolean;
  /** Sistema operacional detectado no anfitriao. */
  os: string;
  /** Resolucao da superficie compartilhada. */
  width: number;
  height: number;
  /** Numero de telas que o agente enxerga (1 quando nao ha agente). */
  displays: number;
  version: number;
}

export type ControlMessage =
  /* Handshake do canal */
  | { t: "hello"; role: Role; name: string; caps: PeerCapabilities }
  /* Entrada remota */
  | { t: "input"; e: InputEvent[] }
  /* Anfitriao concede ou revoga o controle */
  | { t: "grant"; control: boolean; reason?: string }
  /* Ponteiro do visualizante desenhado na tela do anfitriao (modo somente-ver) */
  | { t: "ptr"; x: number; y: number; label: string }
  /* Area de transferencia bidirecional */
  | { t: "clip"; text: string }
  | { t: "clip-req" }
  /* Bate-papo */
  | { t: "chat"; text: string; from: string; ts: number }
  /* Superficie compartilhada e monitores */
  | { t: "surface"; width: number; height: number; label: string }
  | { t: "displays"; list: DisplayInfo[] }
  | { t: "pick-display"; id: number }
  | { t: "reshare" }
  /* Estado do agente no anfitriao */
  | { t: "caps"; caps: PeerCapabilities }
  /* Latencia */
  | { t: "ping"; ts: number }
  | { t: "pong"; ts: number }
  /* Encerramento */
  | { t: "bye"; reason: string }
  /* Transferencia de arquivos (metadados no canal de controle) */
  | { t: "file-offer"; id: string; name: string; size: number; mime: string }
  | { t: "file-accept"; id: string }
  | { t: "file-reject"; id: string; reason: string }
  | { t: "file-done"; id: string }
  | { t: "file-cancel"; id: string; reason: string };

export interface DisplayInfo {
  id: number;
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

/* ------------------------------------------------------------------ */
/* Canal "bulk" — binario puro                                         */
/* ------------------------------------------------------------------ */

/**
 * Cada pedaco de arquivo vai como ArrayBuffer:
 *   [ 0..15 ] id da transferencia (16 bytes ASCII)
 *   [16..19 ] indice do pedaco (uint32 big-endian)
 *   [20..   ] conteudo
 */
export const CHUNK_HEADER_BYTES = 20;
export const FILE_ID_BYTES = 16;
/** 64 KiB e o maior tamanho seguro em todas as implementacoes de SCTP. */
export const CHUNK_SIZE = 64 * 1024 - CHUNK_HEADER_BYTES;

export function encodeChunk(id: string, index: number, body: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(CHUNK_HEADER_BYTES + body.byteLength);
  for (let i = 0; i < FILE_ID_BYTES; i++) out[i] = id.charCodeAt(i) & 0xff;
  new DataView(out.buffer).setUint32(FILE_ID_BYTES, index, false);
  out.set(new Uint8Array(body), CHUNK_HEADER_BYTES);
  return out.buffer;
}

export function decodeChunk(buf: ArrayBuffer): { id: string; index: number; body: ArrayBuffer } {
  const view = new Uint8Array(buf);
  let id = "";
  for (let i = 0; i < FILE_ID_BYTES; i++) id += String.fromCharCode(view[i]);
  const index = new DataView(buf).getUint32(FILE_ID_BYTES, false);
  return { id, index, body: buf.slice(CHUNK_HEADER_BYTES) };
}
