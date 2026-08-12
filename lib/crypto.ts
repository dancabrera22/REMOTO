/**
 * Primitivas compartilhadas entre servidor e navegador.
 * So usa Web Crypto, entao roda igual em Node 20+, Edge Runtime e no browser.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(text: string): Promise<string> {
  return toBase64Url(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

/** Comparacao de tempo constante para tokens e hashes de PIN. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toBase64Url(buf);
}

/** Digitos criptograficamente aleatorios, sem o vies do `% 10`. */
export function randomDigits(count: number): string {
  const out: string[] = [];
  const buf = new Uint8Array(count * 2);
  while (out.length < count) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= 250) continue; // 250..255 enviesaria a distribuicao
      out.push(String(byte % 10));
      if (out.length === count) break;
    }
  }
  return out.join("");
}

/* ------------------------------------------------------------------ */
/* Camada extra de cifra sobre a sinalizacao                           */
/* ------------------------------------------------------------------ */

/**
 * O WebRTC ja cifra midia e dados com DTLS-SRTP, mas as impressoes digitais
 * do DTLS viajam dentro do SDP — que passa pelo nosso servidor. Um servidor
 * comprometido poderia trocar o SDP e se colocar no meio.
 *
 * Derivando uma chave AES-GCM do PIN (que so anfitriao e visualizante
 * conhecem) e cifrando os payloads de sinalizacao, o servidor volta a ser um
 * mero encaminhador de bytes opacos.
 */
export async function deriveSessionKey(pin: string, salt: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(value)),
  );
  const packed = new Uint8Array(12 + body.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(body), 12);
  return toBase64Url(packed);
}

export async function openJson<T>(key: CryptoKey, packedText: string): Promise<T> {
  const packed = fromBase64Url(packedText);
  const iv = packed.subarray(0, 12);
  const body = packed.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
  return JSON.parse(dec.decode(plain)) as T;
}

/**
 * Palavras de seguranca derivadas da chave da sessao — as duas pontas leem em
 * voz alta e conferem. Se baterem, nao ha ninguem no meio.
 */
const WORDS = [
  "agua", "aviao", "bambu", "barco", "cacau", "cafe", "cedro", "chuva",
  "dado", "delta", "farol", "ferro", "fogo", "folha", "gelo", "girassol",
  "ilha", "jade", "lago", "lince", "lua", "manga", "mel", "monte",
  "neve", "norte", "onda", "ouro", "pedra", "pinho", "porto", "praia",
  "raio", "rio", "sal", "seiva", "selva", "sino", "sol", "sul",
  "trigo", "tucano", "vale", "vento", "verde", "vidro", "zebra", "zinco",
];

export async function safetyWords(pin: string, salt: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}|${pin}|remoto`)));
  return [0, 1, 2].map((i) => WORDS[digest[i] % WORDS.length]).join(" · ");
}
