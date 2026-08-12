// Teste de integracao real: dois navegadores Chromium, uma sessao WebRTC.
// Valida oferta/resposta, ICE, abertura dos DataChannels, autorizacao do
// anfitriao, chat ponta-a-ponta e o caminho de entrada bloqueado sem agente.
import { chromium } from "playwright-core";
import { BASE, check, findChromium, readCredentials, report, until, wait } from "./helpers.mjs";





async function main() {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--auto-select-desktop-capture-source=Entire screen",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  const hostCtx = await browser.newContext();
  const viewerCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const viewer = await viewerCtx.newPage();

  const errors = [];
  for (const [label, page] of [["host", host], ["viewer", viewer]]) {
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`${label} console: ${msg.text()}`);
    });
  }

  await host.goto(`${BASE}/compartilhar`, { waitUntil: "networkidle" });

  // Codigo e PIN aparecem assim que a sessao e criada no servidor.
  const { code, pin } = await readCredentials(host);
  check("anfitriao obtem codigo de 9 digitos", Boolean(code), code ?? "");
  check("anfitriao obtem PIN de 6 digitos", Boolean(pin));

  const words = await host.locator("main").innerText();
  check("palavras de seguranca aparecem", /Palavras de seguranca: \S+ · \S+ · \S+/.test(words));

  // Visualizante entra.
  await viewer.goto(`${BASE}/conectar?c=${code}#${pin}`, { waitUntil: "networkidle" });
  await viewer.getByLabel("Seu nome").fill("Tester");
  await viewer.getByRole("button", { name: "Conectar" }).click();

  const pendingVisible = await until(async () =>
    (await host.getByRole("button", { name: "Permitir" }).count()) > 0 ? true : null,
  );
  check("pedido de acesso chega ao anfitriao", Boolean(pendingVisible));

  const requestText = await host.locator("main").innerText();
  check("pedido mostra o nome e a intencao", requestText.includes("Tester") && requestText.includes("pediu controle"));

  // Sem autorizacao nao ha conexao: confere antes de permitir.
  const beforeApprove = await viewer.evaluate(() => document.body.innerText);
  check("visualizante fica aguardando antes da autorizacao", beforeApprove.includes("Aguardando o anfitriao"));

  await host.getByRole("button", { name: "Permitir" }).click();

  // Espera os dois lados reportarem conexao estabelecida.
  const connected = await until(async () => {
    const viewerText = await viewer.evaluate(() => document.body.innerText);
    return viewerText.includes("assistindo") || viewerText.includes("controlando") ? viewerText : null;
  }, 30000);
  check("WebRTC conecta ponta-a-ponta", Boolean(connected));

  const hostText = await until(async () => {
    const text = await host.locator("main").innerText();
    return text.includes("conectado") ? text : null;
  }, 20000);
  check("anfitriao lista o participante como conectado", Boolean(hostText));

  // Sem agente local o controle nao pode ser concedido.
  check(
    "visualizante avisado de que falta o agente",
    Boolean(connected && connected.includes("sem agente local")),
  );

  // RTT medido pelo canal de controle prova que o DataChannel esta aberto nos dois sentidos.
  const rtt = await until(async () => {
    const text = await host.locator("main").innerText();
    const match = /(\d+) ms/.exec(text);
    return match ? Number(match[1]) : null;
  }, 20000);
  check("canal de controle responde ao ping", rtt !== null && rtt >= 0, rtt !== null ? `${rtt} ms` : "");

  // Chat nos dois sentidos.
  await viewer.getByLabel("Mensagem do bate-papo").fill("ola do visualizante");
  await viewer.getByRole("button", { name: "Enviar", exact: true }).click();
  const gotAtHost = await until(async () =>
    (await host.locator("main").innerText()).includes("ola do visualizante") ? true : null,
  );
  check("chat visualizante -> anfitriao", Boolean(gotAtHost));

  await host.getByLabel("Mensagem do bate-papo").fill("resposta do anfitriao");
  await host.getByRole("button", { name: "Enviar", exact: true }).click();
  const gotAtViewer = await until(async () =>
    (await viewer.evaluate(() => document.body.innerText)).includes("resposta do anfitriao") ? true : null,
  );
  check("chat anfitriao -> visualizante", Boolean(gotAtViewer));

  // O caminho ICE escolhido aparece nas estatisticas.
  const path = await until(async () => {
    const text = await viewer.evaluate(() => document.body.innerText);
    return /ponto-a-ponto|via TURN/.test(text) ? text.match(/ponto-a-ponto|via TURN/)[0] : null;
  }, 15000);
  check("estatisticas identificam o caminho", Boolean(path), path ?? "");

  // Sair do visualizante deve refletir no anfitriao.
  await viewer.getByRole("button", { name: "Sair" }).click();
  const removed = await until(async () => {
    const text = await host.locator("main").innerText();
    return text.includes("Ninguem conectado") || !text.includes("Tester") ? true : null;
  }, 15000);
  check("saida do visualizante refletida no anfitriao", Boolean(removed));

  check("nenhum erro de JavaScript nas paginas", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
