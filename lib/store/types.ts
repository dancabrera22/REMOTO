import type { SignalEnvelope } from "@/lib/protocol";

export interface SessionRecord {
  /** Codigo de 9 digitos que o usuario digita. */
  id: string;
  /** peerId do anfitriao — unico autorizado a aceitar visualizantes. */
  hostPeer: string;
  /**
   * Chave HMAC aleatoria da sessao. Nunca sai do servidor: os tokens de cada
   * peer sao HMAC(authKey, peerId), o que permite autenticar sem guardar um
   * registro por participante (e sem race entre entradas simultaneas).
   */
  authKey: string;
  /** SHA-256 de `pin + salt`, conferido na entrada. */
  pinHash: string;
  /** Salt publico usado no hash do PIN e na derivacao da chave AES do SDP. */
  salt: string;
  /** Exige que o anfitriao clique em "permitir" para cada visualizante. */
  requireApproval: boolean;
  /** Permite que visualizantes solicitem controle de mouse/teclado. */
  allowControl: boolean;
  maxViewers: number;
  createdAt: number;
  /** Ultimo sinal de vida do anfitriao (epoch ms). */
  seenAt: number;
}

export interface PullResult {
  messages: SignalEnvelope[];
  cursor: number;
}

/**
 * Backend de sinalizacao. Duas implementacoes: memoria (dev / instancia unica)
 * e Upstash Redis via REST (producao serverless na Vercel).
 */
export interface SignalStore {
  readonly kind: "memory" | "redis";

  createSession(rec: SessionRecord, ttlSeconds: number): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<SessionRecord>, ttlSeconds: number): Promise<SessionRecord | null>;
  deleteSession(id: string): Promise<void>;

  /** Registra um peer na sessao para que o broadcast alcance todos. */
  addPeer(sessionId: string, peerId: string, ttlSeconds: number): Promise<void>;
  removePeer(sessionId: string, peerId: string): Promise<void>;
  listPeers(sessionId: string): Promise<string[]>;

  /** Entrega o envelope. `to === "*"` entrega a todos menos ao remetente. */
  push(sessionId: string, env: Omit<SignalEnvelope, "seq">, ttlSeconds: number): Promise<void>;
  /** Le a caixa de `peerId` a partir de `cursor` (exclusivo). */
  pull(sessionId: string, peerId: string, cursor: number): Promise<PullResult>;

  /** Contador com janela deslizante grosseira, para limitar tentativas. */
  hit(key: string, windowSeconds: number): Promise<number>;
}
