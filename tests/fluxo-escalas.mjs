/**
 * Escalas, pagamento e gestos pela interface, com SQLite de verdade.
 *
 * Cobre o que a Etapa 4 promete a quem usa o app:
 *   - cadastrar uma escala fixa uma vez ("toda quarta") e ela aparecer nas datas;
 *   - deslizar o calendario troca de mes;
 *   - deslizar o cartao para a esquerda revela o botao de excluir;
 *   - excluir um plantao de escala pergunta o alcance (so este / proximos / todos);
 *   - editar o valor de uma escala pergunta o alcance e nao mexe no que ja foi pago;
 *   - marcar plantoes como pagos.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:escalas                 (noutro)
 *
 * Os gestos sao dedos de verdade (eventos de toque do Chrome), nao cliques.
 * Datas sao relativas ao mes que vem: os dias 9, 16 e 23 existem uma unica vez
 * na grade (os dias 1-7 e 24-31 tambem aparecem como "vizinhos").
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { diasSemanaLongo } from "../src/lib/datetime.ts";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";
// `innerText` respeita o text-transform: titulos de secao aparecem em caixa alta.
const TITULO_RESUMO = "RESUMO DO MÊS";
const ESCOPO = /^(Só este plantão|Este e os próximos|Todos da escala)/;

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
const nomeDoMes = ({ ano, mes }) =>
  new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

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
  const cdp = await ctx.newCDPSession(page);

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 15_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const some = async (trecho, ms = 8_000) => Boolean(await ate(async () => !(await texto()).includes(trecho), ms));
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const valorCampo = (rotulo) => page.getByLabel(rotulo).inputValue();
  const dia = (n) => page.getByRole("button", { name: String(n), exact: true });

  /** Um dedo arrastando na horizontal: o que um polegar faz de verdade. */
  async function deslizar(x1, y, x2, passos = 10) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y }] });
    for (let i = 1; i <= passos; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x1 + ((x2 - x1) * i) / passos, y }],
      });
      await espera(16);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await espera(400);
  }

  // O Modal do react-native-web nao tem role="dialog"; os botoes dele sao os ultimos da pagina.
  const noModal = (texto) => page.getByText(texto, { exact: true }).last();

  async function cadastraLocal({ nome, cor, valor }) {
    await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
    await page.getByLabel("Nome do local").fill(nome);
    await radio(cor).click();
    await page.getByLabel("Valor em reais").fill(String(valor));
    await page.getByText("Cadastrar local", { exact: true }).click();
    await page.waitForURL("**/locais", { timeout: 30_000 });
    await tem("cadastrados");
  }

  const agenda = async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
    await tem(TITULO_RESUMO, 60_000);
  };
  const agendaNoMes = async (delta) => {
    await agenda();
    const botao = delta < 0 ? "Mês anterior" : "Próximo mês";
    for (let i = 0; i < Math.abs(delta); i++) await page.getByRole("button", { name: botao }).click();
    await espera(500);
  };
  const abreCartao = async (n, nomeLocal = "Hospital Central") => {
    await dia(n).click();
    await espera(300);
    await page.getByText(nomeLocal).first().click();
  };

  const futuro = mesRel(+1);
  const passado = mesRel(-1);
  const diaSemanaBase = new Date(futuro.ano, futuro.mes - 1, 9).getDay();

  /* ------------------------------- 0. preparo ------------------------------- */

  await cadastraLocal({ nome: "Hospital Central", cor: "Azul", valor: 120000 });

  /* ------------------------ 1. cadastrar uma escala fixa ------------------------ */

  await page.goto(`${BASE}/plantao/novo?dia=${chave(futuro, 9)}`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Novo plantão", 60_000);
  await radio("Hospital Central").click();

  check("o formulario oferece repetir", await tem("REPETIÇÃO"));
  check("por padrao nao repete", (await radio("Não repete").getAttribute("aria-checked")) === "true");
  check("e a situacao aparece (plantao avulso)", await tem("SITUAÇÃO"));

  await radio("Semanal").click();
  const nomeDia = diasSemanaLongo[diaSemanaBase];
  const alvoDia = page.getByRole("checkbox", { name: nomeDia, exact: true });
  check(`semanal ja vem com o dia da data marcado (${nomeDia})`, (await alvoDia.getAttribute("aria-checked")) === "true");
  check("e a previa mostra as proximas datas", await tem("Próximos:"));
  check("com a descricao da repeticao", await tem("Toda ") || (await tem("Todo ")));
  check("escala nova nao pergunta a situacao", await some("SITUAÇÃO"));
  check("nem o pagamento", await some("PAGAMENTO"));
  check("o botao vira criar escala", await tem("Criar escala"));
  await foto("escala-formulario");

  await page.getByText("Criar escala", { exact: true }).click();
  await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);

  await agendaNoMes(+1);
  await dia(9).click();
  check("a escala criou o plantao do dia 9", await tem("Hospital Central"));
  check("marcado como de escala", (await page.getByLabel("Plantão de escala (se repete)").count()) >= 1);
  await dia(16).click();
  check("e o do dia 16", await tem("Hospital Central"));
  await dia(23).click();
  check("e o do dia 23", await tem("Hospital Central"));
  await dia(10).click();
  check("um dia fora da escala segue vazio", await tem("Nenhum plantão neste dia"));
  await foto("escala-agenda");

  /* ------------------------- 2. deslizar o calendario ------------------------- */

  await agenda();
  check("a agenda abre no mes atual", await tem(nomeDoMes(mesRel(0))));
  const y = (await page.getByRole("button", { name: "15", exact: true }).first().boundingBox())?.y ?? 400;

  await deslizar(330, y + 10, 90);
  check("deslizar para a esquerda avanca o mes", await tem(nomeDoMes(futuro)));
  check("e o dia selecionado acompanha (nao fica o de outro mes)", !(await texto()).includes(`, ${dois(hoje.getDate())}/${dois(hoje.getMonth() + 1)}/${hoje.getFullYear()}`));

  await deslizar(90, y + 10, 330);
  check("deslizar para a direita volta o mes", await tem(nomeDoMes(mesRel(0))));
  await deslizar(90, y + 10, 330);
  check("e continua para tras", await tem(nomeDoMes(passado)));

  await deslizar(300, y + 10, 270);
  check("um arrasto curto nao troca de mes", await tem(nomeDoMes(passado)));

  /* ----------------------- 3. deslizar o cartao para excluir ----------------------- */

  await agendaNoMes(+1);
  await dia(16).click();
  await tem("Hospital Central");
  check("fechado, nao ha botao de excluir escondido", (await page.getByRole("button", { name: /^Excluir plantão de/ }).count()) === 0);

  const caixa = await page.getByText("Hospital Central").first().boundingBox();
  const yCartao = caixa.y + 20;
  await deslizar(340, yCartao, 120);
  const botaoExcluir = page.getByRole("button", { name: "Excluir plantão de Hospital Central" });
  check("deslizar para a esquerda revela o botao de excluir", (await botaoExcluir.count()) === 1);
  await foto("escala-deslizado");

  // Aberto, tocar no cartao so o fecha.
  await page.getByText("Hospital Central").first().click({ position: { x: 4, y: 4 } }).catch(() => undefined);
  await espera(500);

  await deslizar(340, yCartao, 120);
  await botaoExcluir.click();
  check("excluir plantao de escala pergunta o alcance", await tem("Excluir plantão da escala"));
  check("com as tres opcoes", (await page.getByRole("radio", { name: ESCOPO }).count()) === 3);
  check("so este vem escolhido", (await page.getByRole("radio", { name: /^Só este plantão/ }).getAttribute("aria-checked")) === "true");
  check("mostra quantos plantoes cada opcao atinge", await tem("agendados"));
  await foto("escala-excluir");

  await noModal("Excluir").click();
  check("so este: o plantao do dia 16 some", await tem("Nenhum plantão neste dia"));

  await dia(23).click();
  check("os outros continuam (dia 23)", await tem("Hospital Central"));

  // Recarregar nao pode trazer de volta o que foi excluido.
  await agendaNoMes(+1);
  await dia(16).click();
  check("excluido continua excluido depois de reabrir o app", await tem("Nenhum plantão neste dia"));

  /* ------------------------------ 4. marcar como pago ------------------------------ */

  // Um plantao avulso no mes passado (vem como realizado): o cartao oferece marcar como pago.
  await page.goto(`${BASE}/plantao/novo?dia=${chave(passado, 12)}`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Novo plantão", 60_000);
  await radio("Hospital Central").click();
  check("no passado a situacao ja vem realizado", (await radio("Realizado").getAttribute("aria-checked")) === "true");
  check("o formulario oferece o pagamento", await tem("PAGAMENTO"));
  await page.getByText("Lançar plantão", { exact: true }).click();
  await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);

  await agendaNoMes(-1);
  await dia(12).click();
  check("o cartao oferece marcar como pago", await tem("Marcar como pago"));
  igual("e ainda nao mostra pagamento", (await texto()).includes("Pago em"), false);
  await page.getByText("Marcar como pago", { exact: true }).click();
  check("marcado: aparece 'Pago em' no cartao", await tem("Pago em"));
  check("o botao some", await some("Marcar como pago"));
  check("o resumo do mes mostra o recebido", await tem("Já recebido"));
  check("e o que falta receber", await tem("A receber"));
  await foto("escala-pago");

  // Desfazer pelo formulario.
  await page.getByText("Hospital Central").first().click();
  await tem("Editar plantão");
  check("o formulario sabe que esta pago", (await radio("Já recebi").getAttribute("aria-checked")) === "true");
  await radio("A receber").click();
  await page.getByText("Salvar alterações", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);
  await agendaNoMes(-1);
  await dia(12).click();
  check("desfazer: o cartao volta a oferecer marcar como pago", await tem("Marcar como pago"));
  await page.getByText("Marcar como pago", { exact: true }).click();
  await tem("Pago em");

  // Cancelar um plantao pago limpa o pagamento (nao se recebe por plantao que nao houve).
  await page.getByText("Hospital Central").first().click();
  await tem("Editar plantão");
  await radio("Cancelado").click();
  check("cancelado esconde o pagamento", await some("PAGAMENTO"));
  await page.getByText("Salvar alterações", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);
  await agendaNoMes(-1);
  await dia(12).click();
  check("cancelado nao fica pago", await tem("Cancelado") && !(await texto()).includes("Pago em"));

  /* --------------------- 5. editar o valor de toda a escala --------------------- */

  await agendaNoMes(+1);
  // Marca o do dia 9 como pago: ele e fato consumado e nao pode mudar com a escala.
  await abreCartao(9);
  await tem("Editar plantão");
  check("plantao de escala mostra a escala", await tem("Este plantão faz parte de uma escala"));
  await radio("Já recebi").click();
  await page.getByText("Salvar alterações", { exact: true }).click();
  await tem(TITULO_RESUMO, 30_000);

  await agendaNoMes(+1);
  await abreCartao(23);
  await tem("Editar plantão");
  await page.getByLabel("Valor em reais").fill("150000");
  await page.getByText("Salvar alterações", { exact: true }).click();
  check("mexer no valor pergunta o alcance", await tem("Aplicar a quais plantões?"));
  check("sem 'so este' escondido: oferece as tres opcoes", (await page.getByRole("radio", { name: ESCOPO }).count()) === 3);
  check("avisa que o ja pago nao muda", await tem("já realizado ou pago fica como está") || (await tem("já realizados ou pagos ficam")));
  await foto("escala-editar");

  await page.getByRole("radio", { name: /^Todos da escala/ }).click();
  await noModal("Salvar").click();
  await tem(TITULO_RESUMO, 30_000);

  await agendaNoMes(+1);
  await dia(23).click();
  check("o dia 23 passou para R$ 1.500,00", await tem("R$ 1.500,00"));
  await dia(9).click();
  check("o dia 9 (ja pago) continua com R$ 1.200,00", (await tem("R$ 1.200,00")) && !(await texto()).includes("R$ 1.500,00"));
  await dia(16).click();
  check("e o dia 16, que foi excluido, nao voltou", await tem("Nenhum plantão neste dia"));

  /* ----------------------- 6. excluir este e os proximos ----------------------- */

  await abreCartao(23);
  await tem("Editar plantão");
  await page.getByText("Excluir este plantão", { exact: true }).click();
  check("excluir pelo formulario tambem pergunta o alcance", await tem("Excluir plantão da escala"));
  await page.getByRole("radio", { name: /^Este e os próximos/ }).click();
  await noModal("Excluir").click();
  await tem(TITULO_RESUMO, 30_000);

  await agendaNoMes(+1);
  await dia(23).click();
  check("este e os proximos: o dia 23 sumiu", await tem("Nenhum plantão neste dia"));
  await dia(9).click();
  check("o plantao pago do dia 9 ficou (e historico)", await tem("Pago em"));

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
