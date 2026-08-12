import { randomDigits, randomToken, sha256 } from "@/lib/crypto";
import {
  MAX_VIEWERS,
  SESSION_TTL,
  authenticate,
  clientIp,
  json,
  mintToken,
  rateLimited,
} from "@/lib/server/auth";
import { getStore } from "@/lib/store";
import type { SessionRecord } from "@/lib/store/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateBody {
  requireApproval?: boolean;
  allowControl?: boolean;
  maxViewers?: number;
}

/** Abre uma sessao. Quem chama vira o anfitriao. */
export async function POST(req: Request) {
  if (await rateLimited(`create:${clientIp(req)}`, 20, 60)) {
    return json({ error: "muitas_sessoes" }, 429);
  }

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const store = getStore();

  // Colisao em 9 digitos e improvavel, mas conferir e barato.
  let code = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = `${randomDigits(1).replace("0", "1")}${randomDigits(8)}`;
    if (!(await store.getSession(candidate))) {
      code = candidate;
      break;
    }
  }
  if (!code) return json({ error: "sem_codigo_disponivel" }, 503);

  const pin = randomDigits(6);
  const salt = randomToken(12);
  const hostPeer = randomToken(9);

  const record: SessionRecord = {
    id: code,
    hostPeer,
    authKey: randomToken(32),
    pinHash: await sha256(`${pin}|${salt}`),
    salt,
    requireApproval: body.requireApproval !== false,
    allowControl: body.allowControl !== false,
    maxViewers: Math.min(Math.max(body.maxViewers ?? 4, 1), MAX_VIEWERS),
    createdAt: Date.now(),
    seenAt: Date.now(),
  };

  await store.createSession(record, SESSION_TTL);
  await store.addPeer(code, hostPeer, SESSION_TTL);

  return json({
    code,
    pin,
    salt,
    peerId: hostPeer,
    token: await mintToken(record, hostPeer, "host"),
    ttl: SESSION_TTL,
    requireApproval: record.requireApproval,
    allowControl: record.allowControl,
    store: store.kind,
  });
}

interface PatchBody {
  code?: string;
  peerId?: string;
  token?: string;
  allowControl?: boolean;
  requireApproval?: boolean;
}

/** Anfitriao muda as regras da sessao em andamento. */
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const auth = await authenticate(body.code ?? null, body.peerId ?? null, body.token ?? null);
  if (auth instanceof Response) return auth;
  if (auth.role !== "host") return json({ error: "acao_do_anfitriao" }, 403);

  const patch: Partial<SessionRecord> = { seenAt: Date.now() };
  if (typeof body.allowControl === "boolean") patch.allowControl = body.allowControl;
  if (typeof body.requireApproval === "boolean") patch.requireApproval = body.requireApproval;

  const next = await getStore().updateSession(auth.session.id, patch, SESSION_TTL);
  return json({ allowControl: next?.allowControl, requireApproval: next?.requireApproval });
}

/** Encerra a sessao: o codigo deixa de existir imediatamente. */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const auth = await authenticate(
    url.searchParams.get("code"),
    url.searchParams.get("peerId"),
    url.searchParams.get("token"),
  );
  if (auth instanceof Response) return auth;
  if (auth.role !== "host") return json({ error: "acao_do_anfitriao" }, 403);

  await getStore().deleteSession(auth.session.id);
  return json({ ok: true });
}
