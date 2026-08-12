import { json } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUN_FALLBACK = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
];

type IceServer = { urls: string | string[]; username?: string; credential?: string };

/**
 * Entrega os servidores ICE ao cliente.
 *
 * Duas razoes para isso ser um endpoint e nao uma constante no bundle:
 * credenciais de TURN sao efemeras (precisam ser geradas por sessao) e nao
 * devem ficar publicas em JavaScript estatico.
 *
 * Sem TURN, cerca de 10-20% das conexoes falham — quem estiver atras de NAT
 * simetrico ou firewall corporativo nunca fecha o caminho direto. STUN sozinho
 * resolve a maioria dos casos domesticos; TURN e o que garante o resto.
 */
export async function GET() {
  const stun: IceServer[] = (process.env.STUN_URLS?.split(",").map((s) => s.trim()).filter(Boolean) ?? STUN_FALLBACK)
    .map((urls) => ({ urls }));

  try {
    const cloudflare = await cloudflareTurn();
    if (cloudflare) return json({ iceServers: [...stun, ...cloudflare], turn: true, provider: "cloudflare" });

    const metered = await meteredTurn();
    if (metered) return json({ iceServers: [...stun, ...metered], turn: true, provider: "metered" });

    const twilio = await twilioTurn();
    if (twilio) return json({ iceServers: twilio, turn: true, provider: "twilio" });

    const secret = await coturnSecret();
    if (secret) return json({ iceServers: [...stun, ...secret], turn: true, provider: "coturn-secret" });

    const fixed = staticTurn();
    if (fixed) return json({ iceServers: [...stun, ...fixed], turn: true, provider: "estatico" });
  } catch (error) {
    // TURN indisponivel nao pode derrubar a sessao: seguimos so com STUN.
    console.error("[ice] falha ao obter TURN:", error);
  }

  return json({ iceServers: stun, turn: false, provider: "stun" });
}

function staticTurn(): IceServer[] | null {
  const urls = process.env.TURN_URLS?.split(",").map((s) => s.trim()).filter(Boolean);
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  if (!urls?.length || !username || !credential) return null;
  return [{ urls, username, credential }];
}

/** Credencial temporaria do coturn no modo `use-auth-secret` (RFC 5766 REST). */
async function coturnSecret(): Promise<IceServer[] | null> {
  const urls = process.env.TURN_URLS?.split(",").map((s) => s.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET;
  if (!urls?.length || !secret) return null;

  const expiry = Math.floor(Date.now() / 1000) + 6 * 3600;
  const username = `${expiry}:remoto`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return [{ urls, username, credential }];
}

async function cloudflareTurn(): Promise<IceServer[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return null;

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ttl: 6 * 3600 }),
  });
  if (!res.ok) throw new Error(`cloudflare ${res.status}`);
  const data = (await res.json()) as { iceServers?: IceServer | IceServer[] };
  if (!data.iceServers) return null;
  return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
}

async function meteredTurn(): Promise<IceServer[] | null> {
  const apiKey = process.env.METERED_API_KEY;
  const subdomain = process.env.METERED_SUBDOMAIN;
  if (!apiKey || !subdomain) return null;

  const res = await fetch(`https://${subdomain}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`);
  if (!res.ok) throw new Error(`metered ${res.status}`);
  return (await res.json()) as IceServer[];
}

async function twilioTurn(): Promise<IceServer[] | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !authToken) return null;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${sid}:${authToken}`)}` },
  });
  if (!res.ok) throw new Error(`twilio ${res.status}`);
  const data = (await res.json()) as { ice_servers?: IceServer[] };
  return data.ice_servers ?? null;
}
