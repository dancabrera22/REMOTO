import type { SignalKind } from "@/lib/protocol";
import { SESSION_TTL, authenticate, json, rateLimited } from "@/lib/server/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: SignalKind[] = ["join", "accept", "reject", "offer", "answer", "ice", "bye"];
/** SDP com muitos candidatos cabe bem abaixo disso; o teto barra abuso. */
const MAX_DATA = 24 * 1024;

interface SendBody {
  code?: string;
  peerId?: string;
  token?: string;
  to?: string;
  kind?: SignalKind;
  data?: string;
  enc?: boolean;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SendBody;
  const auth = await authenticate(body.code ?? null, body.peerId ?? null, body.token ?? null);
  if (auth instanceof Response) return auth;
  const { session, peerId, role } = auth;

  // ICE trickle e o pico de volume; 400/min por peer cobre com folga.
  if (await rateLimited(`sig:${session.id}:${peerId}`, 400, 60)) {
    return json({ error: "muitas_mensagens" }, 429);
  }

  const { to, kind, data } = body;
  if (!to || !kind || typeof data !== "string") return json({ error: "envelope_invalido" }, 400);
  if (!KINDS.includes(kind)) return json({ error: "tipo_invalido" }, 400);
  if (data.length > MAX_DATA) return json({ error: "payload_grande" }, 413);

  // Um visualizante so fala com o anfitriao. Isso impede que alguem que tenha
  // o codigo use a sessao como canal lateral entre visualizantes.
  if (role === "viewer" && to !== session.hostPeer) {
    return json({ error: "destino_proibido" }, 403);
  }
  // Autorizar entrada e prerrogativa exclusiva do anfitriao.
  if (role !== "host" && (kind === "accept" || kind === "reject")) {
    return json({ error: "acao_do_anfitriao" }, 403);
  }

  const store = getStore();
  await store.push(
    session.id,
    { from: peerId, to, kind, data, enc: body.enc === true, ts: Date.now() },
    SESSION_TTL,
  );
  if (role === "host") await store.updateSession(session.id, { seenAt: Date.now() }, SESSION_TTL);

  return json({ ok: true });
}
