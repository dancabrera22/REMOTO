// Laco completo: anfitriao compartilha a tela do X virtual, visualizante
// recebe o video, ganha controle e move o mouse — e conferimos o cursor real
// do sistema com xdotool. Se este teste passa, o produto faz o que promete.
import { chromium } from "playwright-core";
import { spawn, execFile } from "node:child_process";
import { BASE, check, findChromium, readCredentials, report, until, wait } from "./helpers.mjs";

/**
 * Duas telas X, de proposito: uma e a "maquina controlada" (onde o agente
 * injeta entrada) e a outra e a "maquina de quem controla" (onde os
 * navegadores desenham).
 *
 * Se as duas fossem a mesma, o teste entraria em realimentacao: o agente move
 * o cursor fisico, o cursor passa por baixo da janela do visualizante, o
 * navegador emite um pointermove legitimo, que e reenviado ao agente, que
 * move o cursor de novo. Modelar duas maquinas separadas — que e o cenario
 * real do produto — elimina o laco.
 *
 *   Xvfb :98 -screen 0 1920x1080x24 &   # controlada
 *   Xvfb :99 -screen 0 1920x1080x24 &   # navegadores
 */
const DISPLAY = process.env.REMOTO_AGENT_DISPLAY ?? ":98";
const BROWSER_DISPLAY = process.env.DISPLAY ?? ":99";
const REPO = new URL("..", import.meta.url).pathname;



const mouseLocation = () =>
  new Promise((resolve) =>
    execFile("xdotool", ["getmouselocation"], { env: { ...process.env, DISPLAY } }, (_e, stdout) => {
      const text = String(stdout);
      resolve({ x: Number(/x:(\d+)/.exec(text)?.[1]), y: Number(/y:(\d+)/.exec(text)?.[1]) });
    }),
  );

async function main() {
  // 1. agente local na porta padrao
  const agent = spawn("node", ["agent/remoto-agent.mjs"], {
    cwd: REPO,
    env: { ...process.env, DISPLAY },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let agentOut = "";
  agent.stdout.on("data", (d) => (agentOut += String(d)));
  agent.stderr.on("data", (d) => (agentOut += String(d)));

  const pairCode = await until(() => {
    const match = /CODIGO DE PAREAMENTO:\s+((?:[A-Z2-9]\s){5}[A-Z2-9])/.exec(agentOut);
    return match ? match[1].replace(/\s/g, "") : null;
  }, 15000);
  check("agente local ativo", Boolean(pairCode), pairCode ?? "");

  // A tela contra a qual o agente mapeia as coordenadas sai do proprio banner.
  const geometry = /Telas\s+\S+ (\d+)x(\d+)/.exec(agentOut);
  const screen = { w: Number(geometry?.[1] ?? 1920), h: Number(geometry?.[2] ?? 1080) };
  check("agente informa a geometria da tela", Boolean(geometry), `${screen.w}x${screen.h}`);

  // 2. dois navegadores com janela real no X virtual
  const browser = await chromium.launch({
    executablePath: findChromium(),
    headless: false,
    env: { ...process.env, DISPLAY: BROWSER_DISPLAY },
    args: [
      "--use-fake-ui-for-media-stream",
      "--auto-select-desktop-capture-source=Screen 1",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
    ],
  });

  const hostCtx = await browser.newContext();
  // Muitos contentores nao conseguem capturar a tela (o Chromium devolve
  // `NotReadableError` ate para captura de aba). Tentamos a captura real e,
  // se ela falhar, seguimos com um canvas 1920x1080 — que produz um
  // MediaStream de verdade. Todo o resto do caminho (negociacao, video,
  // normalizacao de coordenadas, agente) continua sendo o de producao.
  await hostCtx.addInitScript(() => {
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = async (constraints) => {
      try {
        return await real(constraints);
      } catch {
        /* ambiente sem captura de tela */
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      let frame = 0;
      setInterval(() => {
        ctx.fillStyle = "#123";
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = "#4c8dff";
        ctx.fillRect((frame * 13) % 1800, 400, 120, 120);
        frame++;
      }, 33);
      return canvas.captureStream(30);
    };
  });
  const host = await hostCtx.newPage();
  const viewer = await (await browser.newContext()).newPage();

  await host.goto(`${BASE}/compartilhar`, { waitUntil: "networkidle" });

  const { code, pin } = await readCredentials(host);

  // 3. anfitriao compartilha a tela
  await host.getByRole("button", { name: "Compartilhar tela" }).click();
  const sharing = await until(async () => {
    const text = await host.locator("main").innerText();
    return /Compartilhando \w+ · \d+×\d+/.test(text) ? /Compartilhando (.+)/.exec(text)[1] : null;
  }, 20000);
  check("captura de tela iniciada", Boolean(sharing), sharing ?? "");

  // 4. pareia o agente pela interface
  await host.getByLabel("Codigo de pareamento do agente").fill(pairCode);
  await host.getByRole("button", { name: "Ativar" }).click();
  const agentPaired = await until(async () => {
    const text = await host.locator("main").innerText();
    return text.includes("pareado") && text.includes("Controle de mouse") ? true : null;
  }, 20000);
  check("navegador pareia com o agente pela interface", Boolean(agentPaired));

  // 5. visualizante entra e e autorizado
  await viewer.goto(`${BASE}/conectar?c=${code}#${pin}`, { waitUntil: "networkidle" });
  await viewer.getByLabel("Seu nome").fill("Piloto");
  await viewer.getByRole("button", { name: "Conectar" }).click();
  await host.getByRole("button", { name: "Permitir" }).waitFor({ timeout: 20000 });
  await host.getByRole("button", { name: "Permitir" }).click();

  const videoReady = await until(async () => {
    const size = await viewer.evaluate(() => {
      const v = document.querySelector("video");
      return v && v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null;
    });
    return size;
  }, 30000);
  check("video da tela chega ao visualizante", Boolean(videoReady), videoReady ? `${videoReady.w}×${videoReady.h}` : "");

  // 6. anfitriao concede controle
  await host.getByRole("switch").first().click();
  const controlling = await until(async () => {
    const text = await viewer.evaluate(() => document.body.innerText);
    return text.includes("controlando") ? true : null;
  }, 20000);
  check("controle concedido chega ao visualizante", Boolean(controlling));

  // 7. o teste de verdade: mover o mouse no visualizante move o cursor do SO
  await viewer.bringToFront();
  const box = await viewer.locator("video").boundingBox();
  const targets = [
    { fx: 0.25, fy: 0.25 },
    { fx: 0.75, fy: 0.6 },
    { fx: 0.5, fy: 0.5 },
  ];

  for (const target of targets) {
    await viewer.mouse.move(box.x + box.width * target.fx, box.y + box.height * target.fy);
    const expectedX = Math.round(target.fx * (screen.w - 1));
    const expectedY = Math.round(target.fy * (screen.h - 1));

    const landed = await until(async () => {
      const at = await mouseLocation();
      return Math.abs(at.x - expectedX) <= 12 && Math.abs(at.y - expectedY) <= 12 ? at : null;
    }, 8000, 150);

    const at = landed ?? (await mouseLocation());
    check(
      `mouse do visualizante em ${target.fx}/${target.fy} move o cursor real`,
      Boolean(landed),
      `esperado ~${expectedX},${expectedY} · obtido ${at.x},${at.y}`,
    );
  }

  // 8. revogar o controle interrompe a entrada de imediato
  await host.getByRole("switch").first().click();
  await until(async () => {
    const text = await viewer.evaluate(() => document.body.innerText);
    return text.includes("assistindo") ? true : null;
  }, 10000);

  const before = await mouseLocation();
  await viewer.bringToFront();
  await viewer.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9);
  await wait(1200);
  const after = await mouseLocation();
  check(
    "revogar o controle interrompe a entrada",
    before.x === after.x && before.y === after.y,
    `${before.x},${before.y} -> ${after.x},${after.y}`,
  );

  await browser.close();
  agent.kill("SIGINT");
  await wait(500);
  process.exit(report() ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
