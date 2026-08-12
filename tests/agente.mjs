// Teste funcional do agente local num X virtual: confere pareamento,
// autorizacao, cabecalhos de CORS/PNA e — o que realmente importa — se o
// cursor do sistema se move para a coordenada pedida.
import { spawn, execFile } from "node:child_process";
import { BASE, check, findChromium, readCredentials, report, until, wait } from "./helpers.mjs";

// Numa maquina com sessao grafica basta exportar DISPLAY; em contentor,
// suba um X virtual antes: `Xvfb :99 -screen 0 1920x1080x24 &`.
const DISPLAY = process.env.DISPLAY ?? ":99";
const REPO = new URL("..", import.meta.url).pathname;

const sh = (cmd, args, env = {}) =>
  new Promise((resolve) =>
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 8000 }, (error, stdout) =>
      resolve({ error, stdout: String(stdout) }),
    ),
  );

async function mouseLocation() {
  const { stdout } = await sh("xdotool", ["getmouselocation"], { DISPLAY });
  const x = /x:(\d+)/.exec(stdout)?.[1];
  const y = /y:(\d+)/.exec(stdout)?.[1];
  return { x: Number(x), y: Number(y) };
}

async function main() {
  const agent = spawn("node", ["agent/remoto-agent.mjs", "--port=45899"], {
    cwd: REPO,
    env: { ...process.env, DISPLAY },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  agent.stdout.on("data", (d) => (output += String(d)));
  agent.stderr.on("data", (d) => (output += String(d)));

  const deadline = Date.now() + 15000;
  let code = null;
  while (Date.now() < deadline && !code) {
    const match = /CODIGO DE PAREAMENTO:\s+((?:[A-Z2-9]\s){5}[A-Z2-9])/.exec(output);
    if (match) code = match[1].replace(/\s/g, "");
    else await wait(250);
  }
  check("agente sobe e mostra codigo de pareamento", Boolean(code), code ?? output.slice(0, 200));
  if (!code) {
    agent.kill();
    process.exit(1);
  }

  check("agente detecta a geometria da tela", /1920x1080/.test(output), /Telas\s+(.*)/.exec(output)?.[1] ?? "");

  const base = "http://127.0.0.1:45899";

  // Antes do pareamento nada e autorizado.
  const helloBefore = await (await fetch(`${base}/hello`)).json();
  check("hello responde sem pareamento", helloBefore.version >= 1 && helloBefore.paired === false);

  const denied = await fetch(`${base}/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [{ k: "m", x: 0.5, y: 0.5 }] }),
  });
  check("recusa entrada sem pareamento", denied.status === 403);

  // Preflight do Chrome para rede privada.
  const preflight = await fetch(`${base}/input`, {
    method: "OPTIONS",
    headers: {
      origin: "https://exemplo.vercel.app",
      "access-control-request-method": "POST",
      "access-control-request-private-network": "true",
    },
  });
  check(
    "responde ao preflight de Private Network Access",
    preflight.headers.get("access-control-allow-private-network") === "true" &&
      preflight.headers.get("access-control-allow-origin") === "https://exemplo.vercel.app",
  );

  const badPair = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "AAAAAA" }),
  });
  check("recusa codigo de pareamento errado", badPair.status === 403);

  const paired = await fetch(`${base}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const { token } = await paired.json();
  check("pareia com o codigo correto", paired.ok && typeof token === "string" && token.length === 64);

  const auth = { "content-type": "application/json", authorization: `Bearer ${token}` };

  // Move o cursor para o centro e confere na propria sessao X.
  await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "m", x: 0.5, y: 0.5 }] }),
  });
  await wait(400);
  const center = await mouseLocation();
  check(
    "coordenada normalizada 0,5/0,5 vira o centro da tela",
    Math.abs(center.x - 960) <= 2 && Math.abs(center.y - 540) <= 2,
    `${center.x},${center.y}`,
  );

  // Canto superior esquerdo e inferior direito.
  await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "m", x: 0, y: 0 }] }),
  });
  await wait(300);
  const origin = await mouseLocation();
  check("0,0 vira o canto superior esquerdo", origin.x === 0 && origin.y === 0, `${origin.x},${origin.y}`);

  await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "m", x: 1, y: 1 }] }),
  });
  await wait(300);
  const corner = await mouseLocation();
  check(
    "1,1 fica dentro da tela (nao estoura)",
    corner.x === 1919 && corner.y === 1079,
    `${corner.x},${corner.y}`,
  );

  // Coordenadas fora da faixa precisam ser presas, nao propagadas.
  await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "m", x: 5, y: -3 }] }),
  });
  await wait(300);
  const clamped = await mouseLocation();
  check("coordenadas fora da faixa sao limitadas", clamped.x === 1919 && clamped.y === 0, `${clamped.x},${clamped.y}`);

  // Teclado: digita num campo do xterm? Sem app grafico, verificamos ao menos
  // que a batelada e aceita e contabilizada.
  const typed = await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      events: [
        { k: "kd", c: "KeyA", m: 0 },
        { k: "ku", c: "KeyA", m: 0 },
        { k: "kd", c: "ArrowLeft", m: 0 },
        { k: "ku", c: "ArrowLeft", m: 0 },
        { k: "txt", s: "ola mundo" },
        { k: "w", dx: 0, dy: 120, x: 0.5, y: 0.5 },
        { k: "d", b: 0, x: 0.5, y: 0.5 },
        { k: "u", b: 0, x: 0.5, y: 0.5 },
      ],
    }),
  });
  const typedBody = await typed.json();
  check("aplica batelada mista de teclado, roda e clique", typed.ok && typedBody.applied === 8, `${typedBody.applied}`);

  // Evento desconhecido nao pode derrubar nem ser contado.
  const junk = await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "inexistente" }, { k: "m", x: 0.25, y: 0.25 }] }),
  });
  const junkBody = await junk.json();
  check("ignora evento desconhecido sem quebrar", junk.ok && junkBody.applied === 1);

  // Revogar o pareamento invalida o token.
  await fetch(`${base}/unpair`, { method: "POST", headers: auth });
  const afterUnpair = await fetch(`${base}/input`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ events: [{ k: "m", x: 0.5, y: 0.5 }] }),
  });
  check("revogar pareamento invalida o token", afterUnpair.status === 403);

  agent.kill("SIGINT");
  await wait(600);
  process.exit(report() ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
