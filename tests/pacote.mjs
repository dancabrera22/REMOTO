// O caminho que o usuario final percorre de verdade: baixar `/agente.mjs` da
// implantacao, rodar o arquivo sozinho — longe do repositorio — e controlar a
// maquina. Se este teste passa, o comando que a interface manda copiar funciona.
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BASE, check, report, until, wait } from "./helpers.mjs";

const DISPLAY = process.env.REMOTO_AGENT_DISPLAY ?? process.env.DISPLAY ?? ":99";

const mouseLocation = () =>
  new Promise((resolve) =>
    execFile("xdotool", ["getmouselocation"], { env: { ...process.env, DISPLAY } }, (_e, stdout) => {
      const text = String(stdout);
      resolve({ x: Number(/x:(\d+)/.exec(text)?.[1]), y: Number(/y:(\d+)/.exec(text)?.[1]) });
    }),
  );

async function main() {
  const res = await fetch(`${BASE}/agente.mjs`);
  check("implantacao serve /agente.mjs", res.ok, `HTTP ${res.status}`);
  const source = await res.text();
  check(
    "e um arquivo unico e autossuficiente",
    !/from\s+"\.\//.test(source) && source.includes("__REMOTO_EMBEDDED__"),
    `${(source.length / 1024).toFixed(1)} KB`,
  );

  // Pasta temporaria vazia: nada de `agent/` por perto para o modulo achar.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remoto-pacote-"));
  const file = path.join(dir, "remoto.mjs");
  fs.writeFileSync(file, source);

  const agent = spawn("node", [file], {
    cwd: dir,
    env: { ...process.env, DISPLAY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  agent.stdout.on("data", (d) => (output += String(d)));
  agent.stderr.on("data", (d) => (output += String(d)));

  const code = await until(() => {
    const match = /CODIGO DE PAREAMENTO:\s+((?:[A-Z2-9]\s){5}[A-Z2-9])/.exec(output);
    return match ? match[1].replace(/\s/g, "") : null;
  }, 20_000);
  check("roda fora do repositorio", Boolean(code), code ?? output.slice(0, 160));

  if (!code) {
    agent.kill();
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }

  const geometry = /Telas\s+\S+ (\d+)x(\d+)/.exec(output);
  const screen = { w: Number(geometry?.[1] ?? 1920), h: Number(geometry?.[2] ?? 1080) };

  const port = Number(/Porta\s+http:\/\/127\.0\.0\.1:(\d+)/.exec(output)?.[1] ?? 45789);
  const base = `http://127.0.0.1:${port}`;

  const paired = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { token } = await paired.json();
  check("pareia pelo codigo do terminal", paired.ok && typeof token === "string");

  await fetch(`${base}/input`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ events: [{ k: "m", x: 0.75, y: 0.25 }] }),
  });
  await wait(400);

  const at = await mouseLocation();
  const expected = { x: Math.round(0.75 * (screen.w - 1)), y: Math.round(0.25 * (screen.h - 1)) };
  check(
    "o arquivo baixado move o cursor real",
    Math.abs(at.x - expected.x) <= 2 && Math.abs(at.y - expected.y) <= 2,
    `esperado ${expected.x},${expected.y} · obtido ${at.x},${at.y}`,
  );

  agent.kill("SIGINT");
  await wait(400);
  fs.rmSync(dir, { recursive: true, force: true });

  process.exit(report() ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
