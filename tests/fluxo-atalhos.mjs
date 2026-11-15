/**
 * Atalhos pela interface, com SQLite de verdade:
 *   - botao "Local" na agenda;
 *   - o circulo com "+" ao lado dos locais, no formulario de plantao: cadastra o
 *     local e volta com ele escolhido e o resto do formulario intacto;
 *   - segurar o dedo num dia abre "Incluir plantao" naquela data.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:atalhos                 (noutro)
 *
 * O dia 12 e usado porque nunca aparece como dia "vizinho" na grade, entao so
 * existe uma celula 12.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";
// `innerText` respeita o text-transform: titulos de secao aparecem em caixa alta.
const TITULO_RESUMO = "RESUMO DO MÊS";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(fn, ms = 20_000, passo = 200) {
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
const dataBR = (dia) => `${dois(dia)}/${dois(hoje.getMonth() + 1)}/${hoje.getFullYear()}`;

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    locale: "pt-BR",
    hasTouch: true,
  });
  const page = await ctx.newPage();

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 15_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const some = async (trecho, ms = 8_000) => Boolean(await ate(async () => !(await texto()).includes(trecho), ms));
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const marcado = async (nome) => (await radio(nome).getAttribute("aria-checked")) === "true";
  const valorCampo = (rotulo) => page.getByLabel(rotulo).inputValue();
  const dia = (n) => page.getByRole("button", { name: String(n), exact: true });

  /**
   * Segura o botao por `ms` e solta. E o mouse mantido pressionado, nao um toque:
   * o Chrome emulado nao entrega toque longo sintetico ao `onLongPress` do
   * react-native-web (um toque de verdade no Android e tratado pelo proprio RN).
   */
  async function segurar(localizador, ms = 700) {
    const caixa = await localizador.boundingBox();
    await page.mouse.move(caixa.x + caixa.width / 2, caixa.y + caixa.height / 2);
    await page.mouse.down();
    await espera(ms);
    await page.mouse.up();
    await espera(300);
  }

  const agenda = async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem(TITULO_RESUMO, 60_000);
  };

  /* ------------------------ 1. botao "Local" na agenda ------------------------ */

  await agenda();
  check("a agenda tem o botao Local", (await page.getByText("Local", { exact: true }).count()) === 1);
  check("e o botao Novo continua la", (await page.getByText("Novo", { exact: true }).count()) === 1);
  await foto("atalhos-agenda");

  await page.getByText("Local", { exact: true }).click();
  check("o botao abre o cadastro de local", await tem("Cadastrar local"));
  await page.getByLabel("Nome do local").fill("Hospital Central");
  await radio("Azul").click();
  await page.getByLabel("Valor em reais").fill("120000");
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  check("ao salvar, volta para a agenda", await tem(TITULO_RESUMO, 30_000));

  /* ------------------------- 2. segurar o dedo num dia ------------------------- */

  await dia(12).click();
  await espera(300);
  check("um toque curto so seleciona o dia (nao abre a folha)", await some("Incluir plantão", 1500));

  await segurar(dia(12));
  check("segurar o dia abre a folha com a data", await tem("Incluir plantão"));
  check("que diz quantos plantoes ja tem ali", await tem("Nenhum plantão neste dia"));
  await foto("atalhos-segurar");

  await page.getByText("Fechar", { exact: true }).click();
  check("fechar volta para a agenda", await some("Incluir plantão"));

  await segurar(dia(12));
  await page.getByText("Incluir plantão", { exact: true }).click();
  check("incluir abre o formulario de plantao", await tem("Novo plantão"));
  const rotuloData = await page.getByRole("button", { name: /^Data:/ }).getAttribute("aria-label");
  check(`na data que foi segurada (${dataBR(12)})`, rotuloData.includes(dataBR(12)), rotuloData);

  /* --------------------- 3. circulo "+" ao lado dos locais --------------------- */

  await radio("Hospital Central").click();
  await page.getByText("Noturno 19–7", { exact: true }).click();
  await page.getByLabel("Valor em reais").fill("99900");

  const mais = page.getByRole("button", { name: "Cadastrar novo local" });
  check("o formulario tem o circulo com + ao lado dos locais", (await mais.count()) === 1);
  const caixaMais = await mais.boundingBox();
  const caixaChip = await radio("Hospital Central").boundingBox();
  check("e ele fica na mesma fileira do local", Math.abs(caixaMais.y + caixaMais.height / 2 - (caixaChip.y + caixaChip.height / 2)) < 6);
  check("e e redondo", Math.round(caixaMais.width) === Math.round(caixaMais.height));
  await foto("atalhos-mais");

  await mais.click();
  check("o + abre o cadastro de local", await tem("Cadastrar local"));
  await page.getByLabel("Nome do local").fill("UPA Norte");
  await radio("Verde").click();
  // O formulario de plantao continua montado por baixo: o campo da tela de cima e o ultimo.
  await page.getByLabel("Valor em reais").last().fill("10000");
  await page.getByText("Cadastrar local", { exact: true }).last().click();

  check("ao salvar, volta para o plantao", await tem("Novo plantão", 30_000));
  check("o local novo ja vem escolhido", await ate(async () => marcado("UPA Norte")));
  check("e o anterior deixa de estar", !(await marcado("Hospital Central")));
  igual("o horario digitado antes continua (entrada)", await valorCampo("Horário de entrada"), "19:00");
  igual("e a saida", await valorCampo("Horário de saída"), "07:00");
  const rotuloDepois = await page.getByRole("button", { name: /^Data:/ }).getAttribute("aria-label");
  check("e a data tambem", rotuloDepois.includes(dataBR(12)), rotuloDepois);
  igual("o valor digitado a mao nao e trocado pelo do local novo", await valorCampo("Valor em reais"), "999,00");
  check("mas oferece usar o valor do local novo", await tem("Usar o valor do local: R$ 100,00"));
  await foto("atalhos-local-novo");

  await page.getByText("Lançar plantão", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);
  await dia(12).click();
  check("o plantao foi lancado no local novo", await tem("UPA Norte"));

  /* ---------------------- 4. sem nenhum local: segurar o dia ---------------------- */

  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: "pt-BR" });
  const page2 = await ctx2.newPage();
  await page2.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 150_000 });
  await ate(async () => (await page2.evaluate(() => document.body.innerText)).includes(TITULO_RESUMO), 60_000);
  const caixa2 = await page2.getByRole("button", { name: "12", exact: true }).boundingBox();
  await page2.mouse.move(caixa2.x + caixa2.width / 2, caixa2.y + caixa2.height / 2);
  await page2.mouse.down();
  await espera(700);
  await page2.mouse.up();
  check(
    "sem locais, segurar o dia leva a cadastrar um local primeiro",
    Boolean(await ate(async () => (await page2.evaluate(() => document.body.innerText)).includes("Cadastrar um local primeiro"), 8000)),
  );
  await ctx2.close();

  /* --------------------------------- fim --------------------------------- */

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
