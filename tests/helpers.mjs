import fs from "node:fs";
import path from "node:path";

export const BASE = process.env.REMOTO_BASE ?? "http://127.0.0.1:3210";

const results = [];

export function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "  ok  " : " FALHA"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

export function report() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} verificacoes passaram`);
  return failed.length === 0;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repete `fn` ate ela devolver algo verdadeiro ou o tempo acabar. */
export async function until(fn, timeoutMs = 25_000, step = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await wait(step);
  }
  return null;
}

/**
 * Localiza o Chromium. Aceita REMOTO_CHROMIUM, senao procura na pasta que o
 * Playwright usa (PLAYWRIGHT_BROWSERS_PATH) ou nos caminhos usuais do sistema.
 */
export function findChromium() {
  if (process.env.REMOTO_CHROMIUM) return process.env.REMOTO_CHROMIUM;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && fs.existsSync(root)) {
    const dir = fs
      .readdirSync(root)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .pop();
    if (dir) {
      const candidate = path.join(root, dir, "chrome-linux", "chrome");
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  for (const candidate of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error("Chromium nao encontrado. Defina REMOTO_CHROMIUM com o caminho do executavel.");
}

/** Extrai codigo e PIN da tela do anfitriao. */
export async function readCredentials(host) {
  const code = await until(async () => {
    const text = await host.locator("main").innerText();
    return /\b(\d{3} \d{3} \d{3})\b/.exec(text)?.[1]?.replace(/ /g, "") ?? null;
  }, 25_000);
  const pin = await until(async () => {
    const text = await host.locator("main").innerText();
    return [...text.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]).find((d) => !code?.includes(d)) ?? null;
  }, 25_000);
  return { code, pin };
}
