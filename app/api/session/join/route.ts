import { randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { SESSION_TTL, clientIp, json, mintToken, rateLimited } from "@/lib/server/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada do visualizante.
 *
 * O codigo tem 9 digitos (10^9 combinacoes) e o PIN mais 6 (10^6). Sozinho
 * isso ja e inviavel de adivinhar, mas limitamos tentativas por IP e por
 * codigo mesmo assim: sem isso, um atacante poderia varrer codigos ativos e
 * ao menos descobrir quais existem.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (await rateLimited(`join-ip:${ip}`, 30, 60)) {
    return json({ error: "muitas_tentativas" }, 429);
  }

  const body = (await req.json().catch(() => ({}))) as { code?: string; pin?: string };
  const code = (body.code ?? "").replace(/\D/g, "");
  const pin = (body.pin ?? "").replace(/\D/g, "");
  if (code.length !== 9 || pin.length !== 6) {
    return json({ error: "codigo_ou_pin_invalido" }, 400);
  }

  if (await rateLimited(`join-code:${code}`, 12, 60)) {
    return json({ error: "muitas_tentativas" }, 429);
  }

  const store = getStore();
  const session = await store.getSession(code);

  // Resposta identica para codigo inexistente e PIN errado: nao entregamos a
  // um atacante a informacao de que o codigo existe.
  const failure = json({ error: "codigo_ou_pin_invalido" }, 403);
  if (!session) return failure;
  if (!safeEqual(session.pinHash, await sha256(`${pin}|${session.salt}`))) return failure;

  const peers = await store.listPeers(code);
  if (peers.length - 1 >= session.maxViewers) {
    return json({ error: "sessao_lotada" }, 409);
  }

  const peerId = randomToken(9);
  await store.addPeer(code, peerId, SESSION_TTL);

  return json({
    peerId,
    token: await mintToken(session, peerId, "viewer"),
    hostPeer: session.hostPeer,
    salt: session.salt,
    requireApproval: session.requireApproval,
    allowControl: session.allowControl,
  });
}
