/**
 * Unidade do plantao pela interface, com SQLite de verdade.
 *
 * O caso que motivou tudo: a rede "Rede D'Or" tem varias unidades (Itaim, Central…) e cada
 * uma paga um valor. O local guarda so o nome e a cor; a unidade e o valor sao do plantao.
 * O teste cadastra o local SEM valor, lanca plantoes em duas unidades, e confere:
 *   - o campo Unidade e as sugestoes (so as unidades daquele local);
 *   - o valor que ja vem preenchido (o ultimo daquela unidade, na mesma duracao);
 *   - o aviso quando a duracao e outra;
 *   - "Unidade · Local" na agenda, no resumo do formulario e no Financeiro;
 *   - editar a unidade e a escala que se repete com unidade.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:unidades                (noutro)
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
const mesRel = (delta) => {
  const d = new Date(hoje.getFullYear(), hoje.getMonth() + delta, 12);
  return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
};
const chave = ({ ano, mes }, dia) => `${ano}-${dois(mes)}-${dois(dia)}`;

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "pt-BR" });
  const page = await ctx.newPage();

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 15_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const some = async (trecho, ms = 8_000) => Boolean(await ate(async () => !(await texto()).includes(trecho), ms));
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const valorCampo = (rotulo) => page.getByLabel(rotulo).inputValue();
  const campoUnidade = () => page.getByRole("textbox", { name: "Unidade", exact: true });
  const unidadeDigitada = () => campoUnidade().inputValue();
  /** O campo de dinheiro mostra vazio quando o valor e zero (so o texto de apoio "0,00"). */
  const zerado = async () => ["", "0,00"].includes(await valorCampo("Valor em reais"));
  /** A sugestao mostra a grafia do uso mais recente: depois de digitar "ITAIM" num plantao, ela passa a ser "ITAIM". */
  const chipItaim = () => page.getByRole("radio", { name: /^Unidade itaim$/i });
  const marcado = async (nome) => (await radio(nome).getAttribute("aria-checked")) === "true";

  const abreNovo = async (dia) => {
    await page.goto(`${BASE}/plantao/novo${dia ? `?dia=${dia}` : ""}`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Novo plantão", 60_000);
  };
  const lanca = async () => {
    await page.getByText("Lançar plantão", { exact: true }).click();
    await ate(async () => (await texto()).includes(TITULO_RESUMO));
  };
  const agenda = async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
    await tem(TITULO_RESUMO, 60_000);
    await espera(400);
  };

  /* ------------------------ o local: so nome e cor, sem valor ------------------------ */

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Rede D'Or");
  await radio("Azul").click();
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  await page.waitForURL("**/locais", { timeout: 30_000 });
  check("o local foi cadastrado sem valor padrao", (await tem("Rede D'Or")) && (await tem("Sem valor padrão")));

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Hospital Vizinho");
  await radio("Verde").click();
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  await page.waitForURL("**/locais", { timeout: 30_000 });

  const mes = mesRel(-1); // mes passado: os plantoes entram como "realizados"
  const dia12 = chave(mes, 12);

  /* ---------------------------- o campo Unidade e a dica ---------------------------- */

  await abreNovo(dia12);
  await radio("Rede D'Or").click();
  check("o formulario tem o campo Unidade", (await campoUnidade().count()) === 1);
  check("e explica para que serve (ainda nao ha unidade usada)", await tem("Cada unidade pode ter o seu valor"));
  check("sem unidade e sem valor padrao, pede o valor", await tem("Informe o valor deste plantão"));
  check("o valor comeca zerado", await zerado());

  await campoUnidade().fill("Itaim");
  await page.getByLabel("Valor em reais").fill("150000");
  igual("valor digitado", await valorCampo("Valor em reais"), "1.500,00");
  check("o resumo mostra Unidade · Local", await tem("Itaim · Rede D'Or"));
  await foto("unidades-formulario");
  await lanca();
  await agenda();

  // 1o plantao: aparece na agenda com a unidade.
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await espera(500);
  await page.getByRole("button", { name: "12", exact: true }).click();
  check("na agenda o cartao mostra Unidade · Local", await tem("Itaim · Rede D'Or"));
  check("com o valor que foi digitado", await tem("R$ 1.500,00"));
  await foto("unidades-agenda");

  /* ---------------- o 2o plantao: a unidade vira sugestao e traz o valor ---------------- */

  await abreNovo(chave(mes, 13));
  await radio("Rede D'Or").click();
  check("as unidades ja usadas viram sugestao", (await chipItaim().count()) === 1);
  check("sem tocar em nada, o valor ainda e zero (nao ha valor padrao e nenhuma unidade escolhida)", await zerado());
  await chipItaim().click();
  igual("tocar na sugestao preenche o nome", await unidadeDigitada(), "Itaim");
  igual("e o valor: o ultimo daquela unidade", await valorCampo("Valor em reais"), "1.500,00");
  check("a dica diz de onde veio", await tem("Último valor de Itaim"));
  check("e que a duracao era de 12 h", await tem("plantão de 12h"));

  // Mesma unidade, em outra grafia, e o mesmo valor.
  await campoUnidade().fill("ITAIM");
  igual("a grafia nao importa (maiuscula)", await valorCampo("Valor em reais"), "1.500,00");

  // Outra duracao: avisa.
  await page.getByText("24 h", { exact: true }).click();
  igual("duracao diferente: ainda propoe o ultimo valor da unidade", await valorCampo("Valor em reais"), "1.500,00");
  check("mas AVISA que a duracao e outra", await tem("Confira: esta duração é outra"));
  await page.getByLabel("Valor em reais").fill("280000");
  await lanca();

  /* ----------------------- uma unidade nova no mesmo local ----------------------- */

  await abreNovo(chave(mes, 14));
  await radio("Rede D'Or").click();
  await campoUnidade().fill("Central");
  check("unidade nova: sem valor para propor", await zerado());
  check("pede o valor", await tem("Informe o valor deste plantão"));
  await page.getByLabel("Valor em reais").fill("120000");
  await lanca();

  await abreNovo(chave(mes, 15));
  await radio("Rede D'Or").click();
  check("agora o local sugere as duas unidades", (await page.getByRole("radio", { name: /^Unidade /, exact: false }).count()) === 2);
  await page.getByRole("radio", { name: "Unidade Central", exact: true }).click();
  igual("Central propoe o valor de Central", await valorCampo("Valor em reais"), "1.200,00");
  await chipItaim().click();
  igual("e trocar para Itaim propoe o de Itaim (12 h)", await valorCampo("Valor em reais"), "1.500,00");
  await chipItaim().click();
  igual("tocar de novo na unidade escolhida a desmarca", await unidadeDigitada(), "");

  // Outro local: nao sugere as unidades da rede.
  await radio("Hospital Vizinho").click();
  check("outro local nao sugere as unidades dos outros", (await page.getByRole("radio", { name: /^Unidade /, exact: false }).count()) === 0);
  check("e volta a explicar o campo", await tem("Cada unidade pode ter o seu valor"));

  /* -------------------------------- o Financeiro -------------------------------- */

  await page.goto(`${BASE}/financeiro`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem("Quanto entra, e quando", 60_000);
  await espera(600);
  // Os plantoes sao do mes passado e a regra padrao paga no dia 10 do mes seguinte: o recebimento
  // da rede esta no mes atual, um so para as duas unidades.
  check("o recebimento da rede lista as unidades que ele cobre", await tem("Itaim · Central"));
  check("e e UM recebimento so (a rede paga, nao cada unidade)", (await page.getByText("Rede D'Or", { exact: true }).count()) === 1);
  await foto("unidades-financeiro");

  // A folha de baixa mostra cada plantao com a sua unidade.
  await page.getByText("Rede D'Or", { exact: true }).click();
  check("a folha do recebimento mostra a unidade de cada plantao", (await tem("· Itaim")) && (await tem("· Central")));
  await foto("unidades-baixa");
  await page.getByText("Fechar", { exact: true }).first().click().catch(() => {});

  /* ------------------------------ editar a unidade ------------------------------ */

  await agenda();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await espera(500);
  await page.getByRole("button", { name: "14", exact: true }).click();
  await page.getByText("Central · Rede D'Or", { exact: true }).click();
  await tem("Editar plantão", 30_000);
  igual("ao editar, a unidade vem preenchida", await unidadeDigitada(), "Central");
  igual("e o valor e o do plantao (nao o proposto)", await valorCampo("Valor em reais"), "1.200,00");
  await campoUnidade().fill("Central 2");
  igual("trocar a unidade ao editar NAO mexe no valor ja salvo", await valorCampo("Valor em reais"), "1.200,00");
  await page.getByText("Salvar", { exact: true }).click();
  await ate(async () => (await texto()).includes(TITULO_RESUMO));
  await agenda();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await espera(500);
  await page.getByRole("button", { name: "14", exact: true }).click();
  check("a agenda mostra a unidade nova", await tem("Central 2 · Rede D'Or"));

  /* --------------------------- uma escala com unidade --------------------------- */

  const futuro = mesRel(+1);
  await abreNovo(chave(futuro, 10));
  await radio("Rede D'Or").click();
  await campoUnidade().fill("Itaim");
  igual("a unidade conhecida propoe o valor tambem na escala", await valorCampo("Valor em reais"), "1.500,00");
  await radio("Semanal").click();
  check("o botao vira criar escala", await tem("Criar escala"));
  check("o resumo da escala tambem mostra Unidade · Local", await tem("Itaim · Rede D'Or"));
  await page.getByText("Criar escala", { exact: true }).click();
  await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);
  await agenda();
  await page.getByRole("button", { name: "Próximo mês" }).click();
  await espera(600);
  await page.getByRole("button", { name: "10", exact: true }).click();
  check("o plantao da escala mostra a unidade na agenda", await tem("Itaim · Rede D'Or"));
  await page.getByRole("button", { name: "17", exact: true }).click();
  check("e os seguintes da escala tambem", await tem("Itaim · Rede D'Or"));
  await foto("unidades-escala");

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
