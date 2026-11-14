/**
 * Fluxo completo de Locais, pela interface, com SQLite de verdade.
 *
 * O app roda no navegador (react-native-web) e o `expo-sqlite` roda sobre
 * wa-sqlite: as mesmas migracoes e os mesmos comandos SQL do celular, so que o
 * motor e WebAssembly em vez de nativo. Nao substitui abrir no aparelho, mas
 * prova o caminho inteiro — formulario, validacao, gravacao, lista, edicao,
 * arquivamento — sem nenhuma simulacao no meio.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:fluxo                   (noutro)
 *
 * Cada execucao usa um contexto novo do navegador, logo um banco vazio.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatData, formatDiaSemana, inicioDoDia, somaDias } from "../src/lib/datetime.ts";
import { calculaDataRecebimento } from "../src/lib/pagamento.ts";
import { check, igual, report } from "./helpers.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";

const AZUL = "rgb(47, 111, 237)";
const PRIMARIA = "rgb(14, 79, 74)"; // verde-petroleo do tema claro

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
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });

  /** Retangulos dos elementos que tem fundo `cor` e lado `tam` (px). */
  const caixas = (cor, tam) =>
    page.evaluate(
      ([cor, tam]) =>
        [...document.querySelectorAll("div")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return getComputedStyle(e).backgroundColor === cor && Math.round(r.width) === tam && Math.round(r.height) === tam;
          })
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
      [cor, tam],
    );

  /* ---------------------------- 1. estado inicial ---------------------------- */

  await page.goto(`${BASE}/locais`, { waitUntil: "networkidle", timeout: 150_000 });
  check("lista vazia mostra o convite para cadastrar", await tem("Nenhum local cadastrado", 60_000));
  check("o banco abriu (sem aviso de erro)", !(await texto()).includes("Não consegui ler o banco"));

  await page.getByText("Cadastrar primeiro local").click();
  check("abre o formulario de novo local", await tem("Novo local"));
  check("cor sugerida e a primeira livre", await tem("Cor: Vermelho"));

  /* ------------------------------- 2. validacao ------------------------------- */

  await page.getByText("Cadastrar local", { exact: true }).click();
  check("nome vazio e recusado", await tem("Dê um nome ao local."));
  check("resume o que falta corrigir", await tem("Falta corrigir"));

  /* --------------------------- 3. preenchimento completo --------------------------- */

  await page.getByLabel("Nome do local").fill("Hospital Central");
  await page.getByPlaceholder("HM").fill("HC");

  await page.getByRole("radio", { name: "Azul", exact: true }).click();
  check("cor escolhida aparece no rotulo", await tem("Cor: Azul"));
  check(
    "a cor marcada fica sinalizada para leitor de tela",
    (await page.getByRole("radio", { name: "Azul", exact: true }).getAttribute("aria-checked")) === "true",
  );

  // Previa de cor: mesmo componente da agenda.
  const pontos = await caixas(AZUL, 6);
  check("a previa pinta pontinhos na cor escolhida", pontos.length >= 4, `${pontos.length} pontos azuis de 6 px`);

  // O dia selecionado tem um quadrado escuro; o ponto precisa ficar FORA dele,
  // senao a cor do local se perde justamente no dia em que voce esta olhando.
  const quadrados = await caixas(PRIMARIA, 38);
  check("a previa mostra um dia selecionado", quadrados.length === 1);
  if (quadrados.length === 1) {
    const q = quadrados[0];
    const sob = pontos.find((p) => Math.abs(p.x + p.w / 2 - (q.x + q.w / 2)) < 6);
    check("o ponto do dia selecionado fica fora do quadrado, com a cor do local", Boolean(sob) && sob.y >= q.y + q.h - 1);
  }

  await page.getByLabel("Valor em reais").fill("120000");
  igual("campo de valor entra como maquininha", await page.getByLabel("Valor em reais").inputValue(), "1.200,00");
  await page.getByLabel("Percentual de descontos").fill("11");

  await page.getByRole("radio", { name: "Fechamento", exact: true }).click();
  await page.getByLabel("Dia do fechamento").fill("20");
  await page.getByLabel("Dia do pagamento").fill("10");

  /* ----------------------------------- previa ----------------------------------- */

  check("previa mostra o liquido", await tem("R$ 1.068,00"));
  check("previa explica o desconto", await tem("bruto R$ 1.200,00, menos 11%"));

  const regra = { tipo: "fechamento", diaPagamento: 10, diasApos: null, diaFechamento: 20, mesesAdiante: 1, ajusteDiaUtil: "proximo" };
  const hoje = inicioDoDia(Date.now());
  for (const plantao of [hoje, somaDias(hoje, 15)]) {
    const paga = calculaDataRecebimento(regra, plantao);
    const esperado = `${formatDiaSemana(paga)}, ${formatData(paga)}`;
    check(`previa: plantao de ${formatData(plantao)} cai em ${esperado}`, await tem(esperado, 5000));
  }

  await page.getByText("Cor na agenda", { exact: true }).scrollIntoViewIfNeeded();
  await foto("locais-form-cor");
  await foto("locais-form-topo");
  await page.getByText("Prévia", { exact: true }).scrollIntoViewIfNeeded();
  await foto("locais-form-previa");

  /* --------------------------------- 4. salvar --------------------------------- */

  await page.getByText("Cadastrar local", { exact: true }).click();
  check("volta para a lista depois de salvar", await tem("Hospital Central · HC"));
  check(
    "lista resume valor, regra e desconto",
    await tem("R$ 1.200 por plantão · Fecha dia 20 · paga dia 10 do mês seguinte · −11%"),
  );
  const bolinhas = await caixas(AZUL, 10);
  check("o local aparece na lista com a cor escolhida", bolinhas.length === 1);
  await foto("locais-lista");

  /* ------------------------ 5. segundo local: cor em uso ------------------------ */

  await page.getByText("Novo", { exact: true }).click();
  check("o segundo local nao herda a cor do primeiro", await tem("Cor: Vermelho"));
  await page.getByLabel("Nome do local").fill("UPA Norte");
  await page.getByRole("radio", { name: "Azul, usada por Hospital Central" }).click();
  check("avisa quando a cor ja e de outro local", await tem("Hospital Central já usa essa cor."));
  await page.getByRole("radio", { name: "Verde", exact: true }).click();
  check("trocar de cor remove o aviso", !(await texto()).includes("já usa essa cor"));
  await page.getByLabel("Valor em reais").fill("90000");
  await page.getByRole("radio", { name: "Dias após", exact: true }).click();
  await page.getByLabel("Dias após o plantão").fill("45");
  await page.getByText("Cadastrar local", { exact: true }).click();
  check("segundo local salvo", await tem("UPA Norte"));
  check("lista em ordem alfabetica", (await texto()).indexOf("Hospital Central") < (await texto()).indexOf("UPA Norte"));
  check("regra por dias aparece na lista", await tem("Paga 45 dias após o plantão"));

  /* ---------------------------------- 6. editar ---------------------------------- */

  await page.getByText("Hospital Central · HC").click();
  check("abre o local para edicao", await tem("Editar local"));
  igual("nome carregado", await page.getByLabel("Nome do local").inputValue(), "Hospital Central");
  igual("valor carregado", await page.getByLabel("Valor em reais").inputValue(), "1.200,00");
  igual("desconto carregado", await page.getByLabel("Percentual de descontos").inputValue(), "11");
  igual("dia do fechamento carregado", await page.getByLabel("Dia do fechamento").inputValue(), "20");
  check(
    "cor carregada",
    (await page.getByRole("radio", { name: "Azul", exact: true }).getAttribute("aria-checked")) === "true",
  );
  check(
    "tipo de regra carregado",
    (await page.getByRole("radio", { name: "Fechamento", exact: true }).getAttribute("aria-checked")) === "true",
  );

  await page.getByLabel("Nome do local").fill("Hospital Central Sul");
  await page.getByText("Salvar alterações").click();
  check("edicao refletida na lista", await tem("Hospital Central Sul · HC"));
  check("nome antigo sumiu", !(await texto()).includes("Hospital Central · HC"));

  /* --------------------------- 7. arquivar e restaurar --------------------------- */

  await page.getByText("UPA Norte").click();
  await tem("Editar local");
  await page.getByText("Arquivar este local").click();
  check("pede confirmacao antes de arquivar", await tem("Arquivar UPA Norte?"));
  await page.getByText("Cancelar", { exact: true }).click();
  check("cancelar mantem o local", !(await texto()).includes("Arquivar UPA Norte?"));
  await page.getByText("Arquivar este local").click();
  await page.getByText("Arquivar", { exact: true }).click();

  check("arquivado some da lista principal", await ate(async () => !(await texto()).includes("Paga 45 dias após o plantão")));
  check("aparece o contador de arquivados", await tem("ARQUIVADOS (1)"));
  await page.getByText("Mostrar", { exact: true }).click();
  check("local arquivado fica visivel na secao propria", await tem("arquivado"));
  await page.getByText("Restaurar", { exact: true }).click();
  // Esperar o contador sumir e o botao Restaurar desaparecer e o que prova que o
  // local saiu da secao de arquivados; ele so pode estar na lista principal.
  check("contador de arquivados some depois de restaurar", Boolean(await ate(async () => !(await texto()).includes("ARQUIVADOS"))));
  check("o botao Restaurar desaparece", (await page.getByText("Restaurar", { exact: true }).count()) === 0);
  igual(
    "o local volta para a lista principal, uma unica vez",
    ((await texto()).match(/Paga 45 dias após o plantão/g) ?? []).length,
    1,
  );

  /* ------------------------------- 8. persistencia ------------------------------- */

  await page.goto(`${BASE}/locais`, { waitUntil: "networkidle", timeout: 120_000 });
  const persistiu = await tem("Hospital Central Sul · HC", 30_000);
  check("os dados sobrevivem a recarregar a pagina", persistiu);

  await foto("locais-lista-final");

  /* ------------------------------ 9. sem erros de JS ------------------------------ */

  check("nenhum erro de JavaScript durante o fluxo", erros.length === 0, erros.slice(0, 3).join(" | "));

  /* ----------------------- 10. a mesma secao no tema escuro ----------------------- */

  const escuro = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "pt-BR", colorScheme: "dark" });
  const pe = await escuro.newPage();
  await pe.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await pe.getByLabel("Nome do local").fill("Hospital Central");
  await pe.getByRole("radio", { name: "Azul", exact: true }).click();
  await pe.getByText("Cor na agenda", { exact: true }).scrollIntoViewIfNeeded();
  await espera(600);
  await pe.screenshot({ path: path.join(SAIDA, "locais-form-cor-escuro.png") });
  const pontosEscuro = await pe.evaluate(
    (cor) =>
      [...document.querySelectorAll("div")].filter((e) => {
        const r = e.getBoundingClientRect();
        return getComputedStyle(e).backgroundColor === cor && Math.round(r.width) === 6 && Math.round(r.height) === 6;
      }).length,
    AZUL,
  );
  check("tema escuro: os pontinhos mantem a cor do local", pontosEscuro >= 4, `${pontosEscuro} pontos`);
  await escuro.close();

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
