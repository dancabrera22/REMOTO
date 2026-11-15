/**
 * Fluxo de plantoes pela interface, com SQLite de verdade.
 *
 * O ponto central: lancar um plantao pinta o dia, na agenda, com a cor do
 * local. Alem disso: sugestao de valor, noturno, conflito de horario, plantao
 * passado "a confirmar", cancelar tirando o ponto e excluir.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:plantoes                (noutro)
 *
 * Datas sao relativas ao mes atual: "mes passado" e "mes que vem" nao dependem
 * do dia em que o teste roda. O dia 12 e usado porque nunca aparece como dia
 * "vizinho" na grade (esses sao 1-7 e 24-31), entao so existe uma celula 12.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";

// `innerText` respeita o text-transform: o titulo da secao aparece em caixa alta.
const TITULO_RESUMO = "RESUMO DO MÊS";

const AZUL = "rgb(47, 111, 237)";
const VERDE = "rgb(30, 158, 91)";

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
const dataBR = ({ ano, mes }, dia) => `${dois(dia)}/${dois(mes)}/${ano}`;

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
  const marcado = async (nome) => (await radio(nome).getAttribute("aria-checked")) === "true";
  const valorCampo = (rotulo) => page.getByLabel(rotulo).inputValue();

  /** Pontinhos de uma cor (quadrados de 6 px) visiveis na tela. */
  const pontos = (cor) =>
    page.evaluate(
      (cor) =>
        [...document.querySelectorAll("div")].filter((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.width > 0 &&
            getComputedStyle(e).backgroundColor === cor &&
            Math.round(r.width) === 6 &&
            Math.round(r.height) === 6
          );
        }).length,
      cor,
    );

  async function cadastraLocal({ nome, apelido, cor, valor, desconto, porHora }) {
    await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
    await page.getByLabel("Nome do local").fill(nome);
    if (apelido) await page.getByPlaceholder("HM").fill(apelido);
    await radio(cor).click();
    if (porHora) await radio("Por hora").click();
    await page.getByLabel("Valor em reais").fill(String(valor));
    if (desconto) await page.getByLabel("Percentual de descontos").fill(String(desconto));
    await page.getByText("Cadastrar local", { exact: true }).click();
    // O nome tambem aparece na previa do proprio formulario; so a volta para a
    // lista prova que a gravacao terminou.
    await page.waitForURL("**/locais", { timeout: 30_000 });
    await tem("cadastrados");
  }

  const abreNovo = async (dia) => {
    await page.goto(`${BASE}/plantao/novo${dia ? `?dia=${dia}` : ""}`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Novo plantão", 60_000);
  };
  const lanca = async () => {
    await page.getByText("Lançar plantão", { exact: true }).click();
    await ate(async () => (await texto()).includes(TITULO_RESUMO));
  };
  const agendaNoMes = async (delta) => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
    await tem(TITULO_RESUMO, 60_000);
    const botao = delta < 0 ? "Mês anterior" : "Próximo mês";
    for (let i = 0; i < Math.abs(delta); i++) await page.getByRole("button", { name: botao }).click();
    await espera(500);
  };

  const passado = mesRel(-1);
  const futuro = mesRel(+1);

  /* ------------------------------ 1. sem locais ------------------------------ */

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 150_000 });
  check("agenda vazia pede para cadastrar um local", await tem("Cadastre um local primeiro", 60_000));
  check("o resumo do mes comeca zerado", (await texto()).includes("R$ 0,00"));

  await abreNovo();
  check("o formulario de plantao tambem pede um local", await tem("Cadastre um local primeiro"));

  /* -------------------------------- 2. dois locais -------------------------------- */

  await cadastraLocal({ nome: "Hospital Central", apelido: "HC", cor: "Azul", valor: 120000, desconto: 11 });
  await cadastraLocal({ nome: "UPA Norte", cor: "Verde", valor: 10000, porHora: true });
  check("locais cadastrados", (await texto()).includes("Hospital Central") && (await texto()).includes("UPA Norte"));

  /* --------------------------- 3. formulario: sugestoes --------------------------- */

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem(TITULO_RESUMO, 60_000);
  await page.getByText("Novo", { exact: true }).click();
  check("o botao Novo da agenda abre o formulario", await tem("Novo plantão"));
  check("com dois locais e nenhum plantao, nada vem escolhido", !(await marcado("Hospital Central")) && !(await marcado("UPA Norte")));

  await page.getByText("Lançar plantão", { exact: true }).click();
  check("sem local nao salva", await tem("Escolha o local."));
  check("resume o que falta", await tem("Falta corrigir"));

  await radio("Hospital Central").click();
  igual("valor do local vem preenchido", await valorCampo("Valor em reais"), "1.200,00");
  check("avisa que e sugestao", await tem("Sugerido pelo local"));
  check("horario padrao e diurno de 12 h", await tem("Termina no mesmo dia · 12h"));
  check("mostra o desconto do local", await tem("Desconto do local: 11%"));

  await page.getByText("Noturno 19–7", { exact: true }).click();
  check("noturno termina no dia seguinte", await tem("Termina no dia seguinte"));
  igual("entrada do noturno", await valorCampo("Horário de entrada"), "19:00");
  igual("saida do noturno", await valorCampo("Horário de saída"), "07:00");
  check("o turno escolhido fica marcado", await marcado("Noturno 19–7"));

  await page.getByText("24 h", { exact: true }).click();
  check("24 horas", await tem("· 24h"));
  igual("plantao fechado: valor nao muda com a duracao", await valorCampo("Valor em reais"), "1.200,00");

  // Local pago por hora: o valor acompanha a duracao.
  await radio("UPA Norte").click();
  igual("por hora, 24h x R$ 100", await valorCampo("Valor em reais"), "2.400,00");
  await page.getByText("Diurno 7–19", { exact: true }).click();
  igual("por hora, 12h x R$ 100", await valorCampo("Valor em reais"), "1.200,00");

  // Valor digitado vence a sugestao, e da para voltar a ela.
  await page.getByLabel("Valor em reais").fill("150000");
  igual("valor digitado a mao", await valorCampo("Valor em reais"), "1.500,00");
  check("oferece voltar ao valor do local", await tem("Usar o valor do local: R$ 1.200,00"));
  await page.getByText("Usar o valor do local: R$ 1.200,00").click();
  igual("voltou ao valor do local", await valorCampo("Valor em reais"), "1.200,00");
  check("e o atalho some", await some("Usar o valor do local"));

  // O horario nao aceita bobagem.
  await page.getByLabel("Horário de entrada").fill("2575");
  check("horario impossivel e recusado ao salvar", (await valorCampo("Horário de entrada")) === "25:75");
  await page.getByText("Lançar plantão", { exact: true }).click();
  check("avisa do horario", await tem("Informe os dois horários"));
  await page.getByLabel("Horário de entrada").fill("0700");

  /* ---------------- 4. o plantao que pinta o dia com a cor do local ---------------- */

  await radio("Hospital Central").click();
  await page.getByRole("button", { name: /^Data:/ }).click();
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await page.getByRole("button", { name: "12", exact: true }).click();
  check("a data escolhida no calendario aparece no campo", await tem(dataBR(passado, 12)));
  check("plantao no passado ja vem como Realizado", await marcado("Realizado"));
  await page.getByText("Noturno 19–7", { exact: true }).click();

  check("o resumo mostra o liquido", await tem("R$ 1.068,00"));
  check("o resumo diz quando cai na conta", await tem("Cai na conta:"));
  await foto("plantao-form-resumo");
  await page.getByText("Lançar plantão", { exact: true }).click();
  check("salvar devolve a agenda", await tem(TITULO_RESUMO, 30_000));

  await agendaNoMes(-1);
  igual("o dia do plantao ganha UM pontinho azul", await pontos(AZUL), 1);
  igual("e nenhum verde", await pontos(VERDE), 0);

  await page.getByRole("button", { name: "12", exact: true }).click();
  check("o cartao do dia mostra o local", await tem("Hospital Central · HC"));
  check("o horario do noturno com +1", await tem("19:00 → 07:00 +1 · 12h"));
  check("o liquido com o desconto de 11%", await tem("R$ 1.068,00"));
  check("a situacao", await tem("Realizado"));
  const resumoMes = await texto();
  check("o resumo do mes soma 1 plantao de 12h", resumoMes.includes("12h") && resumoMes.includes("R$ 1.068,00"));
  await foto("agenda-mes-claro");

  /* ----------------------- 5. plantao passado a confirmar ----------------------- */

  await abreNovo(chave(passado, 13));
  check("o ultimo local usado vem escolhido", await marcado("Hospital Central"));
  await radio("Agendado").click();
  await lanca();
  await agendaNoMes(-1);
  igual("agora ha dois pontinhos azuis (12 e 13)", await pontos(AZUL), 2);
  await page.getByRole("button", { name: "13", exact: true }).click();
  check("plantao passado e agendado avisa que ja terminou", await tem("já terminou"));
  check("o resumo conta 1 a confirmar", await tem("1 a confirmar"));
  await page.getByText("Foi realizado", { exact: true }).click();
  check("confirmar tira o aviso", await some("já terminou"));
  check("e o contador a confirmar", await some("a confirmar"));
  check("o resumo passa a somar os dois", (await texto()).includes("R$ 2.136,00"));

  /* ------------------------------ 6. conflito de horario ------------------------------ */

  await abreNovo(chave(futuro, 12));
  await radio("UPA Norte").click();
  await page.getByText("Diurno 7–19", { exact: true }).click();
  check("sem outro plantao no dia, nao ha aviso", !(await texto()).includes("Conflita com"));
  await lanca();

  await abreNovo(chave(futuro, 12));
  await radio("Hospital Central").click();
  await page.getByText("Tarde 13–19", { exact: true }).click();
  check("sobrepor outro plantao avisa quem e", await tem("Conflita com UPA Norte (07:00 → 19:00 · 12h)."));

  await page.getByText("Noturno 19–7", { exact: true }).click();
  check("plantao que comeca quando o outro termina NAO conflita (12x12)", await some("Conflita com", 4_000));
  await page.getByText("Tarde 13–19", { exact: true }).click();
  check("o aviso volta ao sobrepor de novo", await tem("Conflita com UPA Norte"));
  await foto("plantao-form-conflito");
  await lanca();
  check("conflito e aviso, nao impede salvar", await tem(TITULO_RESUMO));

  await agendaNoMes(+1);
  igual("o dia com dois locais tem pontinho azul", await pontos(AZUL), 1);
  igual("e pontinho verde", await pontos(VERDE), 1);

  /* ------------------------------ 7. editar e cancelar ------------------------------ */

  await agendaNoMes(-1);
  await page.getByRole("button", { name: "12", exact: true }).click();
  await page.getByText("Hospital Central · HC").first().click();
  check("abre o plantao para edicao", await tem("Editar plantão"));
  igual("local carregado", String(await marcado("Hospital Central")), "true");
  igual("valor carregado", await valorCampo("Valor em reais"), "1.200,00");
  igual("entrada carregada", await valorCampo("Horário de entrada"), "19:00");
  igual("saida carregada", await valorCampo("Horário de saída"), "07:00");
  check("situacao carregada", await marcado("Realizado"));

  await radio("Cancelado").click();
  check("cancelado explica que nao conta", await tem("Não conta no que você vai receber."));
  await page.getByText("Salvar alterações", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);

  await agendaNoMes(-1);
  igual("cancelar tira o pontinho do dia 12 (sobra so o do 13)", await pontos(AZUL), 1);
  await page.getByRole("button", { name: "12", exact: true }).click();
  check("o cartao cancelado continua visivel", await tem("Cancelado"));
  check("e o resumo deixa de contar esse plantao", (await texto()).includes("R$ 1.068,00") && !(await texto()).includes("R$ 2.136,00"));

  /* --------------------------------- 8. excluir --------------------------------- */

  await agendaNoMes(+1);
  await page.getByRole("button", { name: "12", exact: true }).click();
  await page.getByText("UPA Norte").first().click();
  await tem("Editar plantão");
  await page.getByText("Excluir este plantão", { exact: true }).click();
  check("pede confirmacao antes de excluir", await tem("Excluir este plantão?"));
  await page.getByText("Cancelar", { exact: true }).click();
  check("cancelar mantem o plantao", await some("Excluir este plantão?"));
  await page.getByText("Excluir este plantão", { exact: true }).click();
  await page.getByText("Excluir", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);

  await agendaNoMes(+1);
  igual("excluir tira o pontinho verde", await pontos(VERDE), 0);
  igual("mas o plantao azul do mesmo dia continua", await pontos(AZUL), 1);

  /* ------------------------------- 9. persistencia ------------------------------- */

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem(TITULO_RESUMO, 60_000);
  await page.getByRole("button", { name: "Mês anterior" }).click();
  await espera(600);
  igual("os plantoes sobrevivem a recarregar a pagina", await pontos(AZUL), 1);

  /* ---------------------------------- 10. tema escuro ---------------------------------- */

  await page.getByRole("button", { name: "13", exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await espera(800);
  igual("tema escuro: o pontinho mantem a cor do local", await pontos(AZUL), 1);
  await foto("agenda-mes-escuro");

  check("nenhum erro de JavaScript durante o fluxo", erros.length === 0, erros.slice(0, 3).join(" | "));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
