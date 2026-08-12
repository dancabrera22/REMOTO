#!/usr/bin/env node
/**
 * Executor da suite.
 *
 * Cada arquivo e um processo independente porque os testes disputam recursos
 * globais (porta do servidor, porta do agente, cursor do sistema) — isolar em
 * processos evita que uma falha contamine o proximo.
 *
 * Antes de rodar:
 *   npm run build && npm start -- -p 3210
 *
 * `agente` e `controle` exigem um servidor X. Em contentor:
 *   Xvfb :99 -screen 0 1920x1080x24 &   (e `export DISPLAY=:99`)
 */
import { spawn } from "node:child_process";
import { BASE } from "./helpers.mjs";

const SUITES = [
  { name: "sinalizacao", file: "signaling.mjs", needs: "servidor" },
  { name: "sessao webrtc", file: "sessao.mjs", needs: "servidor + chromium" },
  { name: "arquivos", file: "arquivos.mjs", needs: "servidor + chromium" },
  { name: "agente local", file: "agente.mjs", needs: "x11 + xdotool" },
  { name: "agente empacotado", file: "pacote.mjs", needs: "servidor + x11 + xdotool" },
  { name: "controle ponta a ponta", file: "controle.mjs", needs: "servidor + chromium + x11" },
];

const only = process.argv.slice(2);

async function serverUp() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname], {
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

if (!(await serverUp())) {
  console.error(`\nServidor nao responde em ${BASE}.\n  npm run build && npm start -- -p 3210\n`);
  process.exit(1);
}

const failures = [];
for (const suite of SUITES) {
  if (only.length && !only.includes(suite.name) && !only.includes(suite.file)) continue;
  console.log(`\n── ${suite.name}  (${suite.needs})`);
  if (!(await run(suite.file))) failures.push(suite.name);
}

console.log(failures.length ? `\nFalharam: ${failures.join(", ")}` : "\nTudo passou.");
process.exit(failures.length ? 1 : 0);
