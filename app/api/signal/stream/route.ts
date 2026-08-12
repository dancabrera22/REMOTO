import { SESSION_TTL, authenticate } from "@/lib/server/auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Teto tolerado por todos os planos da Vercel; o cliente reabre sozinho. */
export const maxDuration = 60;

const WINDOW_MS = 45_000;
const POLL_MIN_MS = 120;
const POLL_MAX_MS = 3_000;
const KEEPALIVE_MS = 12_000;
const PEER_REFRESH_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sinalizacao por Server-Sent Events.
 *
 * A Vercel nao hospeda servidor WebSocket de longa duracao, entao a ponte e
 * um SSE que faz polling no Redis com backoff. O intervalo cai para 120 ms
 * assim que chega qualquer mensagem (a rajada de ICE precisa ser rapida) e
 * sobe ate 3 s quando a sessao esta parada — o que mantem o consumo de
 * comandos do Redis baixo em sessoes longas.
 *
 * A cada 45 s o fluxo se encerra sozinho com `event: renew` carregando o
 * cursor; o cliente reabre e nao perde nenhuma mensagem.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = await authenticate(
    url.searchParams.get("code"),
    url.searchParams.get("peerId"),
    url.searchParams.get("token"),
  );
  if (auth instanceof Response) return auth;
  const { session, peerId } = auth;

  let cursor = Number(url.searchParams.get("cursor") ?? "0");
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  const store = getStore();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let lastKeepalive = startedAt;
      let lastRefresh = startedAt;
      let interval = POLL_MIN_MS;
      let closed = false;

      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) =>
        write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      const onAbort = () => {
        closed = true;
      };
      req.signal.addEventListener("abort", onAbort);

      // 2 KiB de preenchimento: alguns proxies so entregam o corpo depois de
      // acumular um buffer minimo, o que atrasaria o primeiro evento real.
      write(`:${" ".repeat(2048)}\n\n`);
      send("ready", { peerId, cursor, store: store.kind });

      try {
        while (!closed && Date.now() - startedAt < WINDOW_MS) {
          const { messages, cursor: next } = await store.pull(session.id, peerId, cursor);
          if (messages.length) {
            cursor = next;
            for (const message of messages) send("signal", message);
            interval = POLL_MIN_MS;
          } else {
            interval = Math.min(Math.round(interval * 1.35), POLL_MAX_MS);
          }

          const now = Date.now();
          if (now - lastKeepalive > KEEPALIVE_MS) {
            write(`: ping ${now}\n\n`);
            lastKeepalive = now;
          }
          if (now - lastRefresh > PEER_REFRESH_MS) {
            await store.addPeer(session.id, peerId, SESSION_TTL);
            lastRefresh = now;
          }

          await sleep(interval);
        }
        send("renew", { cursor });
      } catch (error) {
        send("fatal", { error: String(error) });
      } finally {
        req.signal.removeEventListener("abort", onAbort);
        closed = true;
        try {
          controller.close();
        } catch {
          /* ja fechado pelo cliente */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
