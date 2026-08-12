import { Redis } from "@upstash/redis";
import type { SignalEnvelope } from "@/lib/protocol";
import { MAX_MAILBOX } from "./memory";
import type { PullResult, SessionRecord, SignalStore } from "./types";

const sessionKey = (id: string) => `remoto:s:${id}`;
const peersKey = (id: string) => `remoto:p:${id}`;
const boxKey = (id: string, peer: string) => `remoto:m:${id}:${peer}`;
const rateKey = (key: string) => `remoto:r:${key}`;

/**
 * Backend de producao: Upstash Redis pela API REST.
 *
 * REST (e nao TCP) e o que torna isso viavel em funcoes serverless — nao ha
 * pool de conexoes para vazar entre invocacoes e funciona igual em Node e Edge.
 */
export class RedisStore implements SignalStore {
  readonly kind = "redis" as const;

  constructor(private redis: Redis) {}

  async createSession(rec: SessionRecord, ttlSeconds: number) {
    await this.redis.set(sessionKey(rec.id), JSON.stringify(rec), { ex: ttlSeconds });
  }

  async getSession(id: string) {
    const raw = await this.redis.get<string | SessionRecord>(sessionKey(id));
    if (!raw) return null;
    // O SDK do Upstash desserializa JSON automaticamente quando reconhece o formato.
    return (typeof raw === "string" ? (JSON.parse(raw) as SessionRecord) : raw) ?? null;
  }

  async updateSession(id: string, patch: Partial<SessionRecord>, ttlSeconds: number) {
    const cur = await this.getSession(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await this.redis.set(sessionKey(id), JSON.stringify(next), { ex: ttlSeconds });
    return next;
  }

  async deleteSession(id: string) {
    const peers = await this.listPeers(id);
    const pipe = this.redis.pipeline();
    pipe.del(sessionKey(id));
    pipe.del(peersKey(id));
    for (const p of peers) pipe.del(boxKey(id, p));
    await pipe.exec();
  }

  async addPeer(sessionId: string, peerId: string, ttlSeconds: number) {
    const pipe = this.redis.pipeline();
    pipe.sadd(peersKey(sessionId), peerId);
    pipe.expire(peersKey(sessionId), ttlSeconds);
    await pipe.exec();
  }

  async removePeer(sessionId: string, peerId: string) {
    const pipe = this.redis.pipeline();
    pipe.srem(peersKey(sessionId), peerId);
    pipe.del(boxKey(sessionId, peerId));
    await pipe.exec();
  }

  async listPeers(sessionId: string) {
    return (await this.redis.smembers(peersKey(sessionId))) ?? [];
  }

  async push(sessionId: string, env: Omit<SignalEnvelope, "seq">, ttlSeconds: number) {
    const targets =
      env.to === "*" ? (await this.listPeers(sessionId)).filter((p) => p !== env.from) : [env.to];
    if (!targets.length) return;
    const pipe = this.redis.pipeline();
    for (const target of targets) {
      const key = boxKey(sessionId, target);
      // seq real e o indice na caixa; o cliente usa o cursor de leitura.
      pipe.rpush(key, JSON.stringify({ ...env, seq: 0 }));
      pipe.ltrim(key, -MAX_MAILBOX, -1);
      pipe.expire(key, ttlSeconds);
    }
    pipe.expire(sessionKey(sessionId), ttlSeconds);
    await pipe.exec();
  }

  async pull(sessionId: string, peerId: string, cursor: number): Promise<PullResult> {
    const raw = await this.redis.lrange<string | SignalEnvelope>(boxKey(sessionId, peerId), cursor, -1);
    if (!raw?.length) return { messages: [], cursor };
    const messages = raw.map((item, i) => {
      const env = (typeof item === "string" ? JSON.parse(item) : item) as SignalEnvelope;
      return { ...env, seq: cursor + i + 1 };
    });
    return { messages, cursor: cursor + messages.length };
  }

  async hit(key: string, windowSeconds: number) {
    const k = rateKey(key);
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.expire(k, windowSeconds);
    return count;
  }
}

/** Le as variaveis que tanto a integracao Upstash quanto a Vercel KV injetam. */
export function redisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token, retry: { retries: 2, backoff: (n) => 50 * 2 ** n } });
}
