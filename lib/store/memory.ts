import type { SignalEnvelope } from "@/lib/protocol";
import type { PullResult, SessionRecord, SignalStore } from "./types";

interface Room {
  session: SessionRecord;
  expiresAt: number;
  peers: Map<string, number>;
  /** Caixa de entrada por peer. O cursor do cliente e o indice consumido. */
  boxes: Map<string, SignalEnvelope[]>;
}

/** Teto por caixa. Uma negociacao completa usa ~30 envelopes; 512 e folga larga. */
export const MAX_MAILBOX = 512;

/**
 * Armazenamento em memoria do processo.
 *
 * Suficiente para `next dev` e para um deploy de instancia unica, mas NAO
 * sobrevive ao fan-out serverless da Vercel: dois lambdas nao compartilham
 * este Map. Em producao configure o Upstash Redis (ver .env.example) —
 * /api/health avisa quando o backend em uso e este.
 */
export class MemoryStore implements SignalStore {
  readonly kind = "memory" as const;
  private rooms = new Map<string, Room>();
  private hits = new Map<string, { count: number; resetAt: number }>();

  private gc() {
    const now = Date.now();
    for (const [id, room] of this.rooms) if (room.expiresAt < now) this.rooms.delete(id);
    for (const [key, hit] of this.hits) if (hit.resetAt < now) this.hits.delete(key);
  }

  private room(id: string): Room | null {
    this.gc();
    return this.rooms.get(id) ?? null;
  }

  async createSession(rec: SessionRecord, ttlSeconds: number) {
    this.gc();
    this.rooms.set(rec.id, {
      session: rec,
      expiresAt: Date.now() + ttlSeconds * 1000,
      peers: new Map(),
      boxes: new Map(),
    });
  }

  async getSession(id: string) {
    return this.room(id)?.session ?? null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>, ttlSeconds: number) {
    const room = this.room(id);
    if (!room) return null;
    room.session = { ...room.session, ...patch };
    room.expiresAt = Date.now() + ttlSeconds * 1000;
    return room.session;
  }

  async deleteSession(id: string) {
    this.rooms.delete(id);
  }

  async addPeer(sessionId: string, peerId: string, ttlSeconds: number) {
    const room = this.room(sessionId);
    if (!room) return;
    room.peers.set(peerId, Date.now() + ttlSeconds * 1000);
    if (!room.boxes.has(peerId)) room.boxes.set(peerId, []);
  }

  async removePeer(sessionId: string, peerId: string) {
    const room = this.room(sessionId);
    if (!room) return;
    room.peers.delete(peerId);
    room.boxes.delete(peerId);
  }

  async listPeers(sessionId: string) {
    const room = this.room(sessionId);
    if (!room) return [];
    const now = Date.now();
    return [...room.peers.entries()].filter(([, exp]) => exp > now).map(([p]) => p);
  }

  async push(sessionId: string, env: Omit<SignalEnvelope, "seq">, ttlSeconds: number) {
    const room = this.room(sessionId);
    if (!room) return;
    room.expiresAt = Date.now() + ttlSeconds * 1000;
    const targets =
      env.to === "*" ? (await this.listPeers(sessionId)).filter((p) => p !== env.from) : [env.to];
    for (const target of targets) {
      let box = room.boxes.get(target);
      if (!box) {
        box = [];
        room.boxes.set(target, box);
      }
      if (box.length >= MAX_MAILBOX) continue;
      box.push({ ...env, seq: box.length + 1 });
    }
  }

  async pull(sessionId: string, peerId: string, cursor: number): Promise<PullResult> {
    const box = this.room(sessionId)?.boxes.get(peerId);
    if (!box) return { messages: [], cursor };
    const messages = box.slice(cursor);
    return { messages, cursor: cursor + messages.length };
  }

  async hit(key: string, windowSeconds: number) {
    this.gc();
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    cur.count += 1;
    return cur.count;
  }
}
