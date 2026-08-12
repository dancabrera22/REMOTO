import { MemoryStore } from "./memory";
import { RedisStore, redisFromEnv } from "./redis";
import type { SignalStore } from "./types";

declare global {
  // Sobrevive ao hot-reload do `next dev`, que reavalia modulos a cada edicao.
  // eslint-disable-next-line no-var
  var __remotoStore: SignalStore | undefined;
}

function build(): SignalStore {
  const redis = redisFromEnv();
  if (redis) return new RedisStore(redis);
  return new MemoryStore();
}

export function getStore(): SignalStore {
  if (!globalThis.__remotoStore) globalThis.__remotoStore = build();
  return globalThis.__remotoStore;
}

export type { SessionRecord, SignalStore } from "./types";
