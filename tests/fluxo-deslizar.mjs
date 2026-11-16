/**
 * Deslizar o calendario: o mes ACOMPANHA o dedo (como passar fotos).
 *
 * Os dedos sao eventos de toque do Chrome. O teste mede, com o dedo ainda
 * apoiado na tela, onde o mes esta: se ele segue o dedo, se o vizinho entra de
 * lado (com os pontinhos dele), se o titulo troca ao passar da metade; e depois
 * de soltar, se termina de deslizar ou volta.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:deslizar                (noutro)
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";
const TITULO_RESUMO = "RESUMO DO MÊS";
const AZUL = "rgb(47, 111, 237)";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(fn, ms = 20_000, passo = 150) {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    const v = await fn();
    if (v) return v;
    await espera(passo);
  }
  return null;
}

function achaChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  for (const c of ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Chromium não encontrado. Defina CHROMIUM.");
}

const dois = (n) => String(n).padStart(2, "0");
const hoje = new Date();
const mes = (delta) => new Date(hoje.getFullYear(), hoje.getMonth() + delta, 12);
const nomeDoMes = (d) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const chave = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "pt-BR", hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 8_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });

  /** A pagina de um mes (existe tambem escondida da acessibilidade, entao vai por atributo). */
  const pagina = (d) => page.locator(`[aria-label="${nomeDoMes(d)}"]`);
  const paginas = () => page.locator("[role=group][aria-label*=' de 20']").count();
  /** So a pagina que a pessoa enxerga (as vizinhas, quando montadas, ficam escondidas da acessibilidade). */
  const visiveis = () => page.locator("[role=group][aria-label*=' de 20']:not([aria-hidden=true])").count();
  /** O calendario esta no meio de uma troca (arrastando ou deslizando)? Ele avisa por aria-busy. */
  const movendo = async () => (await page.locator("[aria-busy=true]").count()) > 0;
  const aguardaParar = () => ate(async () => !(await movendo()), 4000);
  const caixa = async (d) => (await pagina(d).count()) ? pagina(d).first().boundingBox() : null;
  /** Pontinhos azuis (quadrados de 6 px) dentro da pagina de um mes. */
  const pontos = (d) =>
    pagina(d).first().evaluate((el, cor) => [...el.querySelectorAll("div")].filter((e) => {
      const r = e.getBoundingClientRect();
      return getComputedStyle(e).backgroundColor === cor && Math.round(r.width) === 6 && Math.round(r.height) === 6;
    }).length, AZUL);

  const toca = (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const move = (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  const solta = () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  /** Arrasta devagar de `de` ate `para` (em x), sem soltar. */
  async function arrasta(de, para, y, passo = 8, atraso = 14) {
    const sentido = para > de ? 1 : -1;
    for (let x = de; sentido > 0 ? x <= para : x >= para; x += sentido * passo) {
      await move(x, y);
      await espera(atraso);
    }
    await move(para, y);
    await espera(60);
  }

  /** Espera o calendario terminar de assentar antes do proximo gesto. */
  const assenta = async () => {
    await aguardaParar();
    // Os vizinhos sao montados quando a tela fica parada um instante: espera isso terminar para o proximo
    // gesto nao competir com a montagem (um toque rapido demais, logo apos assentar, pode ser lido como lento).
    await ate(async () => (await paginas()) === 3, 4000);
  };

  /* --------------------------- preparo: um plantao no mes que vem --------------------------- */

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Hospital A");
  await radio("Azul").click();
  await page.getByLabel("Valor em reais").fill("100000");
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  await page.waitForURL("**/locais", { timeout: 30_000 });

  await page.goto(`${BASE}/plantao/novo?dia=${chave(mes(1))}`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Novo plantão", 60_000);
  await radio("Hospital A").click();
  await page.getByText("Lançar plantão", { exact: true }).click();
  await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem(TITULO_RESUMO, 60_000);
  await espera(600);

  const atual = mes(0);
  const prox = mes(1);
  const ant = mes(-1);

  /* ------------------------------------ parado ------------------------------------ */

  igual("parado, ha uma pagina de mes so a vista", await visiveis(), 1);
  await ate(async () => (await paginas()) === 3, 3000); // os vizinhos sao montados quando a tela fica parada um instante
  igual("os dois meses vizinhos ja estao montados, esperando (o arrasto nao precisa monta-los)", await paginas(), 3);
  const vizinhasFora = await page.evaluate(() => {
    const vista = document.querySelector("[role=group][aria-label*=' de 20']:not([aria-hidden=true])").getBoundingClientRect();
    return [...document.querySelectorAll("[role=group][aria-hidden=true]")].every((e) => {
      const r = e.getBoundingClientRect(); // fora da janela do calendario = cortada pelo overflow
      return r.right <= vista.left + 1 || r.left >= vista.right - 1;
    });
  });
  check("e elas ficam fora da vista (e escondidas da acessibilidade)", vizinhasFora);
  igual("um dia continua sendo UM botao para leitor de tela (a vizinha nao duplica)", await page.getByRole("button", { name: "12", exact: true }).count(), 1);
  const parado = await caixa(atual);
  const W = parado.width;
  const y = parado.y + parado.height / 2;
  const x0 = parado.x;
  check("a pagina atual e o mes de hoje", (await tem(nomeDoMes(atual))));
  igual("os pontinhos do mes seguinte nao poluem a tela parada (so existem fora da vista)", await page.locator("div").evaluateAll((els, cor) => els.filter((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).backgroundColor === cor && Math.round(r.width) === 6 && r.right > 0 && r.left < window.innerWidth; }).length, AZUL), 0);

  /* ------------------------ o mes acompanha o dedo, sem soltar ------------------------ */

  await toca(x0 + W * 0.85, y);
  await arrasta(x0 + W * 0.85, x0 + W * 0.85 - 140, y);

  igual("ao arrastar, o calendario avisa que esta em movimento", await movendo(), true);
  igual("e os tres meses estao la", await paginas(), 3);
  const durante = await caixa(atual);
  check("o mes atual SEGUE o dedo (140 px para a esquerda)", Math.abs(durante.x - (x0 - 140)) < 6, `x ${Math.round(durante.x - x0)}`);
  const vizinho = await caixa(prox);
  check("o proximo mes entra pela direita, colado no atual", Math.abs(vizinho.x - (durante.x + W)) < 14 && vizinho.x < 412, `x ${Math.round(vizinho.x)}`);
  check("o vizinho ja traz o pontinho do plantao dele", (await pontos(prox)) === 1);
  check("o titulo ainda e o do mes atual (nao chegou na metade)", await tem(nomeDoMes(atual), 1500));
  await foto("deslizar-meio");

  await arrasta(x0 + W * 0.85 - 140, x0 + W * 0.85 - 250, y);
  check("passou da metade: o titulo ja mostra o proximo mes, com o dedo ainda na tela", await tem(nomeDoMes(prox), 3000));
  const alem = await caixa(atual);
  check("e o mes continua colado no dedo (250 px)", Math.abs(alem.x - (x0 - 250)) < 6, `x ${Math.round(alem.x - x0)}`);

  await arrasta(x0 + W * 0.85 - 250, x0 + W * 0.85 - 60, y);
  check("voltando antes de soltar, o titulo volta ao mes atual", await tem(nomeDoMes(atual), 3000));

  /* ------------------------------ soltar: arrasto curto volta ------------------------------ */

  await solta();
  check("arrasto curto: ao soltar, volta e fica no mes atual", Boolean(await aguardaParar()));
  const voltou = await caixa(atual);
  check("de volta ao lugar de antes", Math.abs(voltou.x - x0) < 3, `x ${Math.round(voltou.x - x0)}`);
  check("mes atual no titulo", await tem(nomeDoMes(atual), 1500));

  /* ------------------------------ soltar: arrasto longo troca ------------------------------ */

  await toca(x0 + W * 0.85, y);
  await arrasta(x0 + W * 0.85, x0 + W * 0.85 - 170, y);
  await solta();
  check("arrasto longo: termina de deslizar e mostra o proximo mes", await tem(nomeDoMes(prox), 4000));
  check("e o movimento termina (uma pagina so a vista)", Boolean(await aguardaParar()) && (await visiveis()) === 1);
  const assentou = await caixa(prox);
  check("assentado no lugar", Boolean(assentou) && Math.abs(assentou.x - x0) < 3, `x ${assentou ? Math.round(assentou.x - x0) : "?"}`);
  check("o pontinho do plantao esta no mes novo, sem piscar", (await pontos(prox)) === 1);
  check("o dia selecionado acompanha (1 do mes novo)", await tem(`01/${dois(prox.getMonth() + 1)}/${prox.getFullYear()}`));
  await assenta();

  /* --------------------------------- para o outro lado --------------------------------- */

  await toca(x0 + W * 0.15, y);
  await arrasta(x0 + W * 0.15, x0 + W * 0.15 + 170, y);
  igual("arrastando para a direita, o mes anterior entra pela esquerda", (await caixa(atual)) !== null, true);
  const esq = await caixa(atual);
  check("vindo da esquerda, colado no mes atual", esq.x < x0, `x ${Math.round(esq.x - x0)}`);
  await solta();
  check("soltando, volta ao mes anterior", await tem(nomeDoMes(atual), 4000));
  await assenta();

  /* ---------------------------------- arremesso rapido ---------------------------------- */

  await toca(x0 + W * 0.7, y);
  for (let i = 1; i <= 3; i++) await move(x0 + W * 0.7 - i * 26, y); // 78 px, sem pausa: curto (menos de 25%), mas rapido
  await solta();
  check("um arremesso curto e rapido tambem troca o mes", await tem(nomeDoMes(prox), 4000));
  await assenta();

  /* ------------------------------- vertical nao mexe no mes ------------------------------- */

  await toca(x0 + W * 0.5, y);
  for (let i = 1; i <= 8; i++) {
    await move(x0 + W * 0.5 + i, y - i * 12); // sobe, quase sem ir para o lado
    await espera(14);
  }
  igual("rolar na vertical nao arrasta o calendario", await movendo(), false);
  const parte = await caixa(prox);
  check("o mes nao saiu do lugar", Math.abs(parte.x - x0) < 3);
  await solta();
  check("e o mes e o mesmo", await tem(nomeDoMes(prox), 1500));

  /* ------------------------------------- as setas ------------------------------------- */

  await page.getByRole("button", { name: "Mês anterior" }).click();
  // Logo depois do toque o mes esta no meio do caminho: a seta tambem desliza, nao pula.
  let meioDoCaminho = false;
  for (let i = 0; i < 12 && !meioDoCaminho; i++) {
    const c = await caixa(atual);
    if (c && Math.abs(c.x - x0) > 20 && Math.abs(c.x - x0) < W - 20) meioDoCaminho = true; // (o mes anterior entra pela esquerda)
    await espera(20);
  }
  check("a seta desliza o mes (passa pelo meio do caminho), nao troca de uma vez", meioDoCaminho);
  check("e termina no mes anterior", await tem(nomeDoMes(atual), 4000));
  check("a seta termina o movimento", Boolean(await aguardaParar()));
  check("e o botao de um dia funciona depois de tudo isso", await page.getByRole("button", { name: "12", exact: true }).click().then(() => true).catch(() => false));

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
