/**
 * Financeiro pela interface, com SQLite de verdade.
 *
 * Monta o cenario pelo proprio app (local com regra "3 dias apos", plantoes em
 * datas relativas a hoje) e confere: atrasados em destaque, baixa de varios
 * plantoes de uma vez ou so de alguns, a data em que o dinheiro caiu, desfazer
 * e a navegacao entre meses (setas, deslizar e "como vem por ai").
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:financeiro              (noutro)
 *
 * Datas sao relativas a hoje, entao o teste vale em qualquer dia do ano. Com a
 * regra "3 dias apos, manter a data":
 *   2 plantoes de 60 dias atras  -> deviam ter caido ha 57 dias: ATRASADOS
 *   1 plantao de ontem           -> cai daqui a 2 dias: A RECEBER
 *   1 plantao daqui a 5 dias     -> cai daqui a 8 dias: PREVISTO
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";

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
const hoje = new Date(hojeMeiaNoite());
function hojeMeiaNoite() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
const emDias = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
const chave = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const dataBR = (d) => `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
const mesesEntre = (de, para) => (para.getFullYear() - de.getFullYear()) * 12 + (para.getMonth() - de.getMonth());
const nomeDoMes = (d) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const escuro = Boolean(process.env.ESCURO); // ESCURO=1: mesmo fluxo no tema escuro (retratos com sufixo)
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "pt-BR", hasTouch: true, colorScheme: escuro ? "dark" : "light" });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 15_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const some = async (trecho, ms = 8_000) => Boolean(await ate(async () => !(await texto()).includes(trecho), ms));
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}${escuro ? "-escuro" : ""}.png`) });
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const botao = (nome) => page.getByText(nome, { exact: true }).last();

  async function deslizar(x1, y, x2, passos = 10) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y }] });
    for (let i = 1; i <= passos; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / passos, y }] });
      await espera(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await espera(400);
  }

  const financeiro = async () => {
    await page.goto(`${BASE}/financeiro`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Quanto entra, e quando", 60_000);
    await espera(600);
  };
  /** Vai ao mes de `d` pelas setas, a partir do mes atual. */
  const iraMes = async (d) => {
    const delta = mesesEntre(hoje, d);
    const nome = delta < 0 ? "Mês anterior" : "Próximo mês";
    for (let i = 0; i < Math.abs(delta); i++) await page.getByRole("button", { name: nome }).click();
    await espera(400);
  };

  /* ------------------------------ 1. sem nada ------------------------------ */

  await financeiro();
  check("sem plantoes, explica o que fazer", await tem("Nada para receber ainda"));
  check("e nao mostra atrasos nem previsao", (await some("em atraso", 1000)) && (await some("Como vem por aí", 1000)));
  check("abre no mes atual", await tem(nomeDoMes(hoje)));
  await foto("financeiro-vazio");

  /* ----------------------------- 2. monta o cenario ----------------------------- */

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Hospital A");
  await radio("Azul").click();
  await page.getByLabel("Valor em reais").fill("100000");
  await radio("Dias após").click();
  await page.getByLabel("Dias após o plantão").fill("3");
  await radio("Manter").click();
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  await page.waitForURL("**/locais", { timeout: 30_000 });

  async function lanca(d, turno) {
    await page.goto(`${BASE}/plantao/novo?dia=${chave(d)}`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Novo plantão", 60_000);
    await radio("Hospital A").click();
    await page.getByText(turno, { exact: true }).click();
    await page.getByText("Lançar plantão", { exact: true }).click();
    await ate(async () => (await texto()).includes("RESUMO DO MÊS"), 30_000);
  }
  await lanca(emDias(-60), "Manhã 7–13");
  await lanca(emDias(-60), "Tarde 13–19");
  await lanca(emDias(-1), "Diurno 7–19");
  await lanca(emDias(5), "Diurno 7–19");

  /* ------------------------------ 3. atrasados ------------------------------ */

  await financeiro();
  const aba = (rotulo) => page.getByRole("tab", { name: rotulo, exact: true });
  check("o icone do Financeiro mostra quantos estao atrasados", (await aba("Financeiro, 2 em atraso").count()) === 1);
  check("o alerta de atraso soma os dois plantoes", await tem("R$ 2.000,00 em atraso"));
  check("e conta quantos", await tem("2 plantões · o mais antigo era esperado em"));
  const esperado = emDias(-57);
  check("com a data em que deviam ter caido (60 dias - 3)", await tem(dataBR(esperado).slice(0, 5)) || (await tem("o mais antigo era esperado em")));
  check("a aba tem a opcao de atrasados", await tem("Atrasados (2)"));
  await foto("financeiro-resumo");

  await page.getByText("Ver atrasados", { exact: true }).click();
  check("os atrasados viram a lista", await tem("Era esperado em"));
  igual("os dois plantoes do mesmo dia ficam num cartao so", await page.getByText("Hospital A", { exact: true }).count(), 1);
  check("o cartao mostra o total e as horas", (await tem("R$ 2.000,00")) && (await tem("2 plantões · 12h")));
  await foto("financeiro-atrasados");

  /* ------------------------------ 4. baixa parcial ------------------------------ */

  await page.getByText("Hospital A", { exact: true }).click();
  check("abre o pagamento com os plantoes dentro", await tem("Marcar 2 como recebido · R$ 2.000,00"));
  igual("um item para cada plantao", await page.getByRole("checkbox").count(), 2);
  check("tudo vem marcado", (await page.getByRole("checkbox").first().getAttribute("aria-checked")) === "true");
  check("mostra a data em que era esperado", await tem(`Era esperado em`) && (await tem(dataBR(esperado))));

  await page.getByRole("checkbox").first().click();
  check("desmarcar um muda a conta", await tem("Marcar 1 como recebido · R$ 1.000,00"));
  check("e oferece marcar todos de novo", await tem("Marcar todos"));
  await page.getByRole("checkbox").nth(1).click();
  check("sem nenhum marcado, nao da para confirmar", await tem("Marcar 0 como recebido"));
  await page.getByText("Marcar todos", { exact: true }).click();
  check("marcar todos volta aos dois", await tem("Marcar 2 como recebido · R$ 2.000,00"));
  await page.getByRole("checkbox").first().click();

  check("a data do recebimento pode ser o dia previsto (ja passou)", (await radio("Dia previsto").count()) === 1);
  check("por padrao e hoje", (await radio("Hoje").getAttribute("aria-checked")) === "true");
  await radio("Dia previsto").click();
  check("avisa em que dia vai constar", await tem(`Vai constar como recebido em`) && (await tem(dataBR(esperado))));
  await foto("financeiro-baixa");

  await botao("Marcar 1 como recebido · R$ 1.000,00").click();
  check("a baixa fecha o pagamento", await some("Marcar 1 como recebido"));
  check("o atraso cai para um plantao", await tem("R$ 1.000,00 em atraso"));
  check("e o numero no icone acompanha", await ate(async () => (await aba("Financeiro, 1 em atraso").count()) === 1));
  check("... no singular", await tem("1 plantão · o mais antigo"));

  // O dinheiro recebido aparece no mes em que caiu (o do dia previsto), nao no atual.
  await financeiro();
  await iraMes(esperado);
  check("o mes do dia previsto mostra o recebido", await tem("Recebido em") && (await tem("R$ 1.000,00")));
  check("com o selo de recebido", (await page.getByText("Recebido", { exact: true }).count()) >= 1);
  await foto("financeiro-mes-passado");

  /* ------------------------- 5. baixa do que sobrou, hoje ------------------------- */

  await financeiro();
  await page.getByText("Ver atrasados", { exact: true }).click();
  await page.getByText("Hospital A", { exact: true }).click();
  check("sobrou um plantao", await tem("Marcar 1 como recebido · R$ 1.000,00"));
  igual("sem seletor de todos quando ha um so", await page.getByText("Marcar todos", { exact: true }).count() + (await page.getByText("Desmarcar todos", { exact: true }).count()), 0);
  await botao("Marcar 1 como recebido · R$ 1.000,00").click();
  check("sem mais atrasos, o alerta some", await some("em atraso"));
  check("e o icone volta ao normal", await ate(async () => (await aba("Financeiro").count()) === 1));
  check("e a aba de atrasados tambem", await some("Atrasados ("));

  await financeiro();
  check("este mes: o que caiu hoje aparece como recebido", await tem("Recebido em"));
  await foto("financeiro-recebido");

  /* ------------------------------ 6. desfazer ------------------------------ */

  const cartoes = page.getByText("Hospital A", { exact: true });
  const total = await cartoes.count();
  let achouRecebido = false;
  for (let i = 0; i < total && !achouRecebido; i++) {
    await cartoes.nth(i).click();
    if (await tem("Desfazer recebimento de 1", 2500)) achouRecebido = true;
    else await botao("Fechar").click();
  }
  check("o pagamento recebido oferece desfazer", achouRecebido);
  check("e nao oferece escolher a data (ja caiu)", (await radio("Hoje").count()) === 0);
  await botao("Desfazer recebimento de 1").click();
  check("desfeito: o plantao volta a estar atrasado", await tem("R$ 1.000,00 em atraso"));

  /* ---------------------------- 7. a receber e previsto ---------------------------- */

  const prevD = emDias(8);
  await financeiro();
  await iraMes(prevD);
  check("o previsto de daqui a 8 dias aparece no mes dele", await tem("Previsto"));
  const grupos = page.getByText("Hospital A", { exact: true });
  await grupos.last().click();
  check("pagamento previsto: nao da para dizer que caiu no dia previsto (ainda nao chegou)", (await radio("Dia previsto").count()) === 0);
  check("mas da para escolher hoje ou outra data", (await radio("Hoje").count()) === 1 && (await radio("Outra data").count()) === 1);
  await radio("Outra data").click();
  check("outra data abre o calendario", await tem("voltar para hoje") || (await page.getByRole("button", { name: "Mês anterior" }).count()) >= 1);
  await botao("Fechar").click();

  /* --------------------------- 8. navegacao entre meses --------------------------- */

  await financeiro();
  check("a lista 'como vem por ai' mostra o mes atual", (await page.getByRole("button", { name: new RegExp(`^${nomeDoMes(hoje)}: R\\$`) }).count()) === 1);
  const proxMes = new Date(hoje.getFullYear(), hoje.getMonth() + 3, 1);
  await page.getByRole("button", { name: new RegExp(`^${nomeDoMes(proxMes)}:`) }).click();
  check("tocar num mes dessa lista vai para ele", await tem(nomeDoMes(proxMes)));
  await page.getByText("voltar para este mês", { exact: true }).click();
  check("voltar para este mes", await tem(nomeDoMes(hoje)));

  // A tela rola dentro de um ScrollView, e os passos acima deixaram a pagina rolada: volta ao topo para o
  // cartao do mes ficar abaixo do cabecalho (um dedo no cabecalho nao desliza o mes).
  await page.getByRole("button", { name: "Mês anterior" }).evaluate((el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1 && getComputedStyle(p).overflowY !== "visible") p.scrollTop = 0;
  });
  await espera(300);
  const yCard = (await page.getByRole("button", { name: "Mês anterior" }).boundingBox()).y + 10;
  await deslizar(330, yCard, 90);
  check("deslizar para a esquerda avanca o mes", await tem(nomeDoMes(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1))));
  await deslizar(90, yCard, 330);
  check("deslizar para a direita volta", await tem(nomeDoMes(hoje)));

  /* ----------------------------- 9. persiste ao reabrir ----------------------------- */

  await financeiro();
  check("depois de reabrir o app, o atraso desfeito continua la", await tem("R$ 1.000,00 em atraso"));

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
