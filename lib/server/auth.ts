import { fromBase64Url, safeEqual, toBase64Url } from "@/lib/crypto";
import { getStore } from "@/lib/store";
import type { SessionRecord } from "@/lib/store/types";

/** Sessao expira sozinha; cada sinal renova a janela. */
export const SESSION_TTL = 60 * 60 * 4;
export const MAX_VIEWERS = 8;

/**
 * Token de peer = HMAC(authKey da sessao, "peerId|role").
 * Stateless: nao precisamos guardar um registro por participante, e conferir
 * e so recomputar. Como a authKey e sorteada por sessao, um token nao vale
 * para outra sessao nem sobrevive ao fim desta.
 */
async function hmac(authKey: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(authKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(sig);
}

export function mintToken(session: SessionRecord, peerId: string, role: "host" | "viewer") {
  return hmac(session.authKey, `${peerId}|${role}`);
}

export async function verifyToken(
  session: SessionRecord,
  peerId: string,
  token: string,
): Promise<"host" | "viewer" | null> {
  for (const role of ["host", "viewer"] as const) {
    const expected = await hmac(session.authKey, `${peerId}|${role}`);
    if (safeEqual(expected, token)) return role;
  }
  return null;
}

export interface AuthedRequest {
  session: SessionRecord;
  peerId: string;
  role: "host" | "viewer";
}

/**
 * Confere codigo + peerId + token e devolve o contexto, ou uma Response de erro.
 * Toda rota de sinalizacao passa por aqui.
 */
export async function authenticate(
  code: string | null,
  peerId: string | null,
  token: string | null,
): Promise<AuthedRequest | Response> {
  if (!code || !peerId || !token) {
    return json({ error: "parametros_ausentes" }, 400);
  }
  const session = await getStore().getSession(code);
  if (!session) return json({ error: "sessao_inexistente" }, 404);
  const role = await verifyToken(session, peerId, token);
  if (!role) return json({ error: "token_invalido" }, 403);
  return { session, peerId, role };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

/** IP do cliente atras do proxy da Vercel. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "0.0.0.0";
}

/** `true` quando o limite foi estourado. */
export async function rateLimited(key: string, max: number, windowSeconds: number) {
  const count = await getStore().hit(key, windowSeconds);
  return count > max;
}
