#!/usr/bin/env node
/**
 * Agente local do REMOTO.
 *
 * Por que ele existe: uma pagina web nao pode — e nao deve poder — mover o
 * mouse ou digitar no sistema operacional. Esse limite e do sandbox do
 * navegador, nao uma limitacao que se contorne com codigo esperto. Entao para
 * ter controle real (e nao so ver a tela) alguem precisa executar codigo fora
 * do sandbox.
 *
 * O que este agente NAO faz: nao instala nada, nao pede privilegio de
 * administrador, nao escreve no registro nem cria servico, nao abre porta na
 * rede (so 127.0.0.1) e nao fala com servidor nenhum. Ele so recebe eventos
 * de entrada da propria aba do navegador, pelo loopback, e some quando voce
 * fecha o terminal.
 *
 *   node agent/remoto-agent.mjs        (a partir do repositorio)
 *   node agente.mjs                   (arquivo unico, baixado de /agente.mjs)
 */

import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import { createBackend } from "./backends.mjs";

const VERSION = 3;
const PORTS = [45789, 45790, 45791, 45792, 45793];
/** Sem I, O, 0 e 1: o codigo e lido em voz alta e digitado a mao. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PAIR_ATTEMPTS = 12;

const args = parseArgs(process.argv.slice(2));

const state = {
  /** Codigo mostrado no terminal; some depois do pareamento. */
  pairingCode: randomCode(6),
  token: null,
  pairAttempts: 0,
  displayId: 0,
  lastActivity: 0,
  backend: null,
};

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { port: null, origin: null, quiet: false };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "port") out.port = Number(value);
    else if (key === "origin") out.origin = value;
    else if (key === "quiet") out.quiet = true;
    else if (key === "help" || key === "h") {
      console.log(
        [
          "Agente local do REMOTO",
          "",
          "  --port=45789          porta fixa no loopback (padrao: primeira livre)",
          "  --origin=https://...  aceita apenas essa origem (padrao: qualquer, com pareamento)",
          "  --quiet               menos mensagens",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return out;
}

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (args.origin && origin && origin !== args.origin) return false;
  res.setHeader("access-control-allow-origin", origin ?? "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "600");
  // O Chrome exige este cabecalho para deixar uma pagina publica falar com
  // um endereco privado (Private Network Access).
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("access-control-allow-private-network", "true");
  }
  res.setHeader("vary", "origin");
  return true;
}

function authorized(req) {
  if (!state.token) return false;
  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== state.token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(state.token));
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("corpo grande demais"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* Aplicacao dos eventos                                               */
/* ------------------------------------------------------------------ */

function currentDisplay() {
  const list = state.backend.displays;
  return list.find((d) => d.id === state.displayId) ?? list[0];
}

/**
 * Coordenadas chegam normalizadas (0..1) contra a superficie compartilhada.
 * Aqui viram pixels absolutos da tela escolhida — por isso a pagina do
 * anfitriao pergunta qual monitor esta sendo compartilhado quando ha mais de
 * um: o `getDisplayMedia` nao revela essa informacao ao JavaScript.
 */
function toPixels(nx, ny) {
  const display = currentDisplay();
  const x = display.x + Math.min(Math.max(nx, 0), 1) * (display.width - 1);
  const y = display.y + Math.min(Math.max(ny, 0), 1) * (display.height - 1);
  return [x, y];
}

function applyEvents(events) {
  const backend = state.backend;
  let applied = 0;

  for (const event of events) {
    switch (event.k) {
      case "m": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        break;
      }
      case "d": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.down(event.b ?? 0);
        break;
      }
      case "u": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.up(event.b ?? 0);
        break;
      }
      case "c": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        for (let i = 0; i < Math.min(event.n ?? 1, 3); i++) {
          backend.down(event.b ?? 0);
          backend.up(event.b ?? 0);
        }
        break;
      }
      case "w": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.wheel(event.dx ?? 0, event.dy ?? 0);
        break;
      }
      case "kd":
        backend.keyDown(event.c);
        break;
      case "ku":
        backend.keyUp(event.c);
        break;
      case "txt":
        if (typeof event.s === "string" && event.s.length <= 8192) backend.type(event.s);
        break;
      case "combo":
        backend.combo(event.s);
        break;
      default:
        continue;
    }
    applied += 1;
  }

  state.lastActivity = Date.now();
  return applied;
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  try {
    if (req.method === "GET" && url.pathname === "/hello") {
      json(res, 200, {
        version: VERSION,
        os: os.platform(),
        backend: state.backend.name,
        displays: state.backend.displays,
        // So confirmamos o pareamento a quem apresenta o token correto.
        paired: authorized(req),
        warning: state.backend.warning ?? null,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair") {
      if (state.pairAttempts >= MAX_PAIR_ATTEMPTS) {
        json(res, 429, { error: "tentativas_esgotadas" });
        return;
      }
      const body = await readBody(req, 1024);
      state.pairAttempts += 1;
      if (String(body.code ?? "").toUpperCase() !== state.pairingCode) {
        json(res, 403, { error: "codigo_invalido" });
        return;
      }
      state.token = crypto.randomBytes(32).toString("hex");
      state.pairAttempts = 0;
      console.log("\n  ✓ Navegador pareado. O controle remoto esta ativo.\n");
      json(res, 200, { token: state.token });
      return;
    }

    if (req.method === "POST" && url.pathname === "/input") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      const body = await readBody(req);
      const events = Array.isArray(body.events) ? body.events.slice(0, 256) : [];
      json(res, 200, { applied: applyEvents(events) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/display") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      const body = await readBody(req, 1024);
      const id = Number(body.id);
      if (state.backend.displays.some((d) => d.id === id)) state.displayId = id;
      json(res, 200, { displayId: state.displayId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/release") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      state.backend.releaseAll();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/unpair") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      state.backend.releaseAll();
      state.token = null;
      state.pairingCode = randomCode(6);
      console.log(`\n  Pareamento revogado. Novo codigo: ${state.pairingCode}\n`);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "rota_desconhecida" });
  } catch (error) {
    json(res, 400, { error: String(error?.message ?? error) });
  }
});

async function listen() {
  const candidates = args.port ? [args.port] : PORTS;
  for (const port of candidates) {
    const ok = await new Promise((resolve) => {
      const onError = () => resolve(false);
      server.once("error", onError);
      // Loopback apenas: o agente nunca fica exposto na rede local.
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve(true);
      });
    });
    if (ok) return port;
  }
  throw new Error(`Nenhuma porta livre em ${candidates.join(", ")}.`);
}

function banner(port) {
  const display = currentDisplay();
  const lines = [
    "",
    "  ┌──────────────────────────────────────────────┐",
    "  │  REMOTO · agente local                       │",
    "  └──────────────────────────────────────────────┘",
    "",
    `  Porta      http://127.0.0.1:${port}`,
    `  Sistema    ${os.platform()} · ${state.backend.name}`,
    `  Telas      ${state.backend.displays.map((d) => `${d.label} ${d.width}x${d.height}`).join(", ")}`,
    `  Ativa      ${display.label}`,
    "",
    `  CODIGO DE PAREAMENTO:  ${state.pairingCode.split("").join(" ")}`,
    "",
    "  Digite esse codigo na aba do REMOTO, em 'Ativar controle'.",
    "  Enquanto este terminal estiver aberto, quem voce autorizar",
    "  na sessao controla este computador. Ctrl+C encerra tudo.",
    "",
  ];
  if (state.backend.warning) lines.push(`  ! ${state.backend.warning}`, "");
  console.log(lines.join("\n"));
}

async function main() {
  try {
    state.backend = await createBackend();
  } catch (error) {
    console.error(`\n  Nao foi possivel iniciar o executor de entrada:\n  ${error.message}\n`);
    process.exit(1);
  }

  const primary = state.backend.displays.find((d) => d.primary);
  if (primary) state.displayId = primary.id;

  const port = await listen();
  if (!args.quiet) banner(port);

  const shutdown = () => {
    console.log("\n  Encerrando agente. Teclas e botoes liberados.\n");
    try {
      state.backend.close();
    } catch {
      /* nada a fazer */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
