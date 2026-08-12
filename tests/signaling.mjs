// Teste ponta-a-ponta da sinalizacao: cria sessao, entra, troca envelopes
// cifrados e confere que o SSE entrega tudo na ordem.
import { BASE, check, report } from "./helpers.mjs";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64u(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
function unb64u(text) {
  return new Uint8Array(Buffer.from(text, "base64url"));
}
async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value)));
  const packed = new Uint8Array(12 + body.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(body), 12);
  return b64u(packed);
}
async function open(key, packedText) {
  const packed = unb64u(packedText);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: packed.subarray(0, 12) },
    key,
    packed.subarray(12),
  );
  return JSON.parse(dec.decode(plain));
}


/** Le eventos SSE ate `want` mensagens ou estourar o tempo. */
async function readStream(url, want, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { signal: controller.signal });
  const reader = res.body.getReader();
  const out = [];
  let buffer = "";
  try {
    while (out.length < want) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event === "signal" && data) out.push(JSON.parse(data));
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return out;
}

async function main() {
  // 1. anfitriao abre a sessao
  const created = await (
    await fetch(`${BASE}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
  ).json();
  check("cria sessao", created.code?.length === 9 && created.pin?.length === 6, `codigo ${created.code}`);

  // 2. PIN errado nao entra e nao revela que o codigo existe
  const wrong = await fetch(`${BASE}/api/session/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: created.code, pin: "000000" }),
  });
  const wrongBody = await wrong.json();
  check("recusa PIN errado", wrong.status === 403 && wrongBody.error === "codigo_ou_pin_invalido");

  const ghost = await fetch(`${BASE}/api/session/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "999999999", pin: "123456" }),
  });
  check(
    "codigo inexistente responde igual a PIN errado",
    ghost.status === wrong.status && (await ghost.json()).error === wrongBody.error,
  );

  // 3. visualizante entra
  const joined = await (
    await fetch(`${BASE}/api/session/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.code, pin: created.pin }),
    })
  ).json();
  check("entra com codigo + PIN", Boolean(joined.peerId && joined.token), joined.error ?? "");
  check("visualizante recebe o peer do anfitriao", joined.hostPeer === created.peerId);

  // 4. token forjado e rejeitado
  const forged = await fetch(`${BASE}/api/signal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: created.code,
      peerId: joined.peerId,
      token: "token-invalido",
      to: created.peerId,
      kind: "join",
      data: "{}",
    }),
  });
  check("rejeita token forjado", forged.status === 403);

  // 5. as duas chaves derivadas do mesmo PIN precisam bater
  const hostKey = await deriveKey(created.pin, created.salt);
  const viewerKey = await deriveKey(created.pin, joined.salt);

  // anfitriao escuta antes do envio
  const hostStream = readStream(
    `${BASE}/api/signal/stream?code=${created.code}&peerId=${created.peerId}&token=${encodeURIComponent(created.token)}&cursor=0`,
    2,
  );
  await new Promise((r) => setTimeout(r, 400));

  const payload = { name: "Teste", ua: "node", wantsControl: true };
  const send = async (from, token, to, kind, key, value) =>
    fetch(`${BASE}/api/signal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: created.code,
        peerId: from,
        token,
        to,
        kind,
        enc: true,
        data: await seal(key, value),
      }),
    });

  const sent = await send(joined.peerId, joined.token, created.peerId, "join", viewerKey, payload);
  check("visualizante envia join", sent.ok);

  await send(joined.peerId, joined.token, created.peerId, "ice", viewerKey, { candidate: "abc" });

  const received = await hostStream;
  check("SSE entrega ao anfitriao", received.length === 2, `${received.length} envelope(s)`);
  if (received.length >= 1) {
    const opened = await open(hostKey, received[0].data);
    check("payload cifrado abre com a chave do PIN", opened.name === "Teste" && opened.wantsControl === true);
    check("servidor nao ve o conteudo", !received[0].data.includes("Teste") && received[0].enc === true);
    check("ordem preservada", received[0].kind === "join" && received[1]?.kind === "ice");
  }

  // 6. visualizante nao pode falar com outro visualizante
  const other = await (
    await fetch(`${BASE}/api/session/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: created.code, pin: created.pin }),
    })
  ).json();
  const lateral = await send(joined.peerId, joined.token, other.peerId, "ice", viewerKey, {});
  check("bloqueia trafego entre visualizantes", lateral.status === 403);

  // 7. so o anfitriao autoriza
  const fakeAccept = await send(joined.peerId, joined.token, created.peerId, "accept", viewerKey, {});
  check("so o anfitriao envia accept", fakeAccept.status === 403);

  // 8. cursor retoma sem duplicar nem perder
  const resumed = await readStream(
    `${BASE}/api/signal/stream?code=${created.code}&peerId=${created.peerId}&token=${encodeURIComponent(created.token)}&cursor=1`,
    1,
    3000,
  );
  check("cursor retoma da posicao certa", resumed.length === 1 && resumed[0].kind === "ice");

  // 9. anfitriao encerra e o codigo morre
  const closed = await fetch(
    `${BASE}/api/session?code=${created.code}&peerId=${created.peerId}&token=${encodeURIComponent(created.token)}`,
    { method: "DELETE" },
  );
  check("anfitriao encerra a sessao", closed.ok);
  const afterClose = await fetch(`${BASE}/api/session/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: created.code, pin: created.pin }),
  });
  check("codigo deixa de existir apos encerrar", afterClose.status === 403);

  process.exit(report() ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
