/**
 * Dados e aparencia pela interface, com SQLite de verdade: fazer backup (o
 * download de verdade), restaurar (arquivo escolhido de verdade), recusar
 * arquivos ruins sem tocar em nada, desfazer, exportar a planilha, e o tema.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:dados                   (noutro)
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { themes } from "../src/theme/tokens.ts";
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
const hoje = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const emDias = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
const chave = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`;
};
const BOM = String.fromCharCode(0xfeff);

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "meu-plantao-dados-"));

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: "pt-BR", acceptDownloads: true, colorScheme: "light" });
  const page = await ctx.newPage();

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 15_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));
  const some = async (trecho, ms = 8_000) => Boolean(await ate(async () => !(await texto()).includes(trecho), ms));
  const foto = (nome) => page.screenshot({ path: path.join(SAIDA, `${nome}.png`) });
  const radio = (nome) => page.getByRole("radio", { name: nome, exact: true });
  const botao = (nome) => page.getByText(nome, { exact: true }).last();

  const ajustes = async () => {
    await page.goto(`${BASE}/ajustes`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("SEUS DADOS", 60_000);
    await espera(500);
  };
  const locais = async () => {
    await page.goto(`${BASE}/locais`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("cadastrados", 60_000);
    await espera(400);
    return texto();
  };

  /** Clica e espera o download que ele dispara; devolve nome e conteudo. */
  async function baixa(clique) {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), clique()]);
    const arquivo = path.join(pasta, d.suggestedFilename());
    await d.saveAs(arquivo);
    return { nome: d.suggestedFilename(), caminho: arquivo, conteudo: fs.readFileSync(arquivo, "utf8") };
  }

  /** Clica em "Escolher arquivo" e responde ao seletor com `caminho` (ou nada, para desistir). */
  async function escolhe(caminho) {
    const [c] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15_000 }), botao("Escolher arquivo").click()]);
    await c.setFiles(caminho ? [caminho] : []);
  }

  async function cadastraLocal(nome, cor, valor) {
    await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
    await page.getByLabel("Nome do local").fill(nome);
    await radio(cor).click();
    await page.getByLabel("Valor em reais").fill(String(valor));
    await page.getByText("Cadastrar local", { exact: true }).last().click();
    await page.waitForURL("**/locais", { timeout: 30_000 });
  }
  async function lanca(local, d, turno) {
    await page.goto(`${BASE}/plantao/novo?dia=${chave(d)}`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Novo plantão", 60_000);
    await radio(local).click();
    await page.getByText(turno, { exact: true }).click();
    await page.getByText("Lançar plantão", { exact: true }).click();
    await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);
  }

  /* ------------------------------------ preparo ------------------------------------ */

  await cadastraLocal("Hospital A", "Azul", 100000);
  await lanca("Hospital A", emDias(-3), "Diurno 7–19");
  await lanca("Hospital A", emDias(5), "Noturno 19–7");

  await ajustes();
  check("Ajustes tem a secao de dados", (await tem("Fazer backup")) && (await tem("Escolher arquivo")) && (await tem("Exportar planilha")));
  check("e a de aparencia", await tem("APARÊNCIA"));
  check("e nao tem mais a lista de etapas", await some("Construção em etapas", 1000));
  await foto("dados-ajustes");

  /* ------------------------------------ backup ------------------------------------ */

  const bk = await baixa(() => botao("Fazer backup").click());
  check("o arquivo tem o nome do dia", /^meu-plantao-backup-\d{4}-\d{2}-\d{2}\.json$/.test(bk.nome), bk.nome);
  const json = JSON.parse(bk.conteudo);
  igual("e e um backup do Meu Plantao", json.formato, "meu-plantao-backup");
  igual("com 1 local", json.dados.locais.length, 1);
  igual("e 2 plantoes", json.dados.plantoes.length, 2);
  check("o local e o certo", json.dados.locais[0].nome === "Hospital A");
  check("a tela confirma o que foi guardado", await tem("Backup pronto: 1 local, 2 plantões"));
  check("e lembra de guardar fora do celular", await tem("Guarde o arquivo fora do celular"));
  const copiaDoBackup = path.join(pasta, "backup-bom.json");
  fs.copyFileSync(bk.caminho, copiaDoBackup);

  /* ------------------------------ mexe nos dados depois ------------------------------ */

  await cadastraLocal("UPA Norte", "Verde", 50000);
  await lanca("UPA Norte", emDias(2), "Diurno 7–19");
  check("agora ha 2 locais", (await locais()).includes("UPA Norte"));

  /* ------------------------------ recusar arquivos ruins ------------------------------ */

  await ajustes();
  const lixo = path.join(pasta, "lixo.txt");
  fs.writeFileSync(lixo, "isto nao e um backup");
  await escolhe(lixo);
  check("texto qualquer: recusa com explicacao", await tem("Não consegui ler este arquivo"));
  check("e nem abre a confirmacao", await some("Restaurar este backup?", 800));

  const outro = path.join(pasta, "outro.json");
  fs.writeFileSync(outro, JSON.stringify({ nome: "outro programa" }));
  await escolhe(outro);
  check("JSON de outro programa", await tem("não é um backup do Meu Plantão"));

  const quebrado = JSON.parse(bk.conteudo);
  quebrado.dados.plantoes[0].local_id = 999;
  const quebradoCaminho = path.join(pasta, "quebrado.json");
  fs.writeFileSync(quebradoCaminho, JSON.stringify(quebrado));
  await escolhe(quebradoCaminho);
  check("backup com referencia quebrada diz onde", await tem("o local 999 não está no arquivo"));

  const futuro = JSON.parse(bk.conteudo);
  futuro.versaoFormato = 99;
  const futuroCaminho = path.join(pasta, "futuro.json");
  fs.writeFileSync(futuroCaminho, JSON.stringify(futuro));
  await escolhe(futuroCaminho);
  check("backup de versao mais nova pede para atualizar o app", await tem("versão mais nova do app"));
  await foto("dados-recusado");

  await escolhe(null);
  check("desistir do seletor nao faz nada", await some("Restaurar este backup?", 800));
  check("os dados continuam intactos depois das recusas", (await locais()).includes("UPA Norte"));

  /* -------------------------------------- restaurar -------------------------------------- */

  await ajustes();
  check("antes de restaurar, nao ha o que desfazer", await some("Desfazer a restauração", 800));
  await escolhe(copiaDoBackup);
  check("restaurar mostra o que tem no arquivo", await tem("Restaurar este backup?"));
  check("com o nome do arquivo", await tem("backup-bom.json"));
  check("o que o arquivo traz", await tem("1 local, 2 plantões"));
  check("e o que vai ser substituido", (await tem("No celular agora (será substituído)")) && (await tem("2 locais, 3 plantões")));
  check("avisa que os dados atuais ficam guardados", await tem("ficam guardados no app"));
  await espera(600);
  await foto("dados-restaurar");

  await botao("Cancelar").click();
  check("cancelar nao troca nada", (await locais()).includes("UPA Norte"));

  await ajustes();
  await escolhe(copiaDoBackup);
  await tem("Restaurar este backup?");
  await botao("Substituir tudo").click();
  check("restaurou", await tem("Restaurado: 1 local, 2 plantões"));
  check("e oferece desfazer", await tem("Desfazer a restauração"));
  const depois = await locais();
  check("so o local do backup existe", depois.includes("Hospital A") && !depois.includes("UPA Norte"));

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem(TITULO_RESUMO, 60_000);
  check("e a agenda mostra os plantoes do backup", await tem("1 plantão no mês") || (await tem("2 plantões no mês")) || (await tem("Seus plantões do mês")));

  /* -------------------------------------- desfazer -------------------------------------- */

  await ajustes();
  await botao("Desfazer a restauração").click();
  check("desfazer confirma antes", await tem("Voltar ao que havia antes?"));
  check("mostra o que volta", await tem("2 locais, 3 plantões"));
  await botao("Substituir tudo").click();
  check("desfeito", await tem("Tudo como estava antes da restauração"));
  check("o botao some", await some("Desfazer a restauração", 3000));
  check("o local que tinha sumido voltou", (await locais()).includes("UPA Norte"));

  /* -------------------------------------- planilha -------------------------------------- */

  await ajustes();
  check("o ano dos plantoes aparece como opcao", await tem(String(hoje.getFullYear())));
  const csv = await baixa(() => botao("Exportar planilha").click());
  igual("nome do arquivo de todos os anos", csv.nome, "meu-plantao-plantoes-todos.csv");
  check("comeca com a marca de UTF-8", csv.conteudo.startsWith(BOM));
  const linhas = csv.conteudo.slice(1).split("\r\n");
  igual("cabecalho certo", linhas[0], "Data;Dia;Início;Fim;Horas;Local;Unidade;Situação;Conta no valor;Valor bruto;Desconto (%);Valor líquido;Recebimento previsto;Pago em;Observação;Escala");
  igual("3 plantoes + cabecalho + linha final", linhas.length, 5);
  check("traz o local e o valor sem R$", linhas.some((l) => l.includes(";Hospital A;") && l.includes(";1000,00;")));
  check("o de UPA Norte tambem", linhas.some((l) => l.includes(";UPA Norte;") && l.includes(";500,00;")));
  check("o passado esta realizado e o futuro agendado", linhas.some((l) => l.includes(";Realizado;Sim;")) && linhas.some((l) => l.includes(";Agendado;Sim;")));
  check("a tela confirma", await tem("Planilha pronta: 3 plantões"));
  fs.writeFileSync(path.join(SAIDA, "dados-planilha.csv"), csv.conteudo);

  const ano = hoje.getFullYear();
  const noAno = [emDias(-3), emDias(5), emDias(2)].filter((d) => d.getFullYear() === ano).length;
  await radio(String(ano)).click();
  const csvAno = await baixa(() => botao("Exportar planilha").click());
  igual("com o ano escolhido, o nome leva o ano", csvAno.nome, `meu-plantao-plantoes-${ano}.csv`);
  igual("e so os plantoes do ano", csvAno.conteudo.slice(1).split("\r\n").length - 2, noAno);

  /* --------------------------------------- tema --------------------------------------- */

  await ajustes();
  const temFundo = (hex) => page.evaluate((cor) => [...document.querySelectorAll("div")].some((e) => getComputedStyle(e).backgroundColor === cor), rgb(hex));
  check("claro por padrao (celular em modo claro)", await temFundo(themes.light.colors.bg));
  check("sem ter escolhido, a opcao 'Do celular' esta marcada", (await radio("Do celular").getAttribute("aria-checked")) === "true");

  await radio("Escuro").click();
  check("escolher escuro muda a tela na hora", Boolean(await ate(() => temFundo(themes.dark.colors.bg), 5000)));
  check("e o claro some", !(await temFundo(themes.light.colors.bg)));
  await foto("dados-tema-escuro");

  await ajustes();
  check("depois de reabrir, continua escuro", Boolean(await ate(() => temFundo(themes.dark.colors.bg), 8000)));
  check("com 'Escuro' marcado", (await radio("Escuro").getAttribute("aria-checked")) === "true");

  await radio("Claro").click();
  check("claro fixo, mesmo com o celular em modo claro", Boolean(await ate(() => temFundo(themes.light.colors.bg), 5000)));
  await page.emulateMedia({ colorScheme: "dark" });
  await espera(800);
  check("claro fixo ignora o celular em modo escuro", await temFundo(themes.light.colors.bg));

  await radio("Do celular").click();
  check("'Do celular' com o celular em modo escuro: escuro", Boolean(await ate(() => temFundo(themes.dark.colors.bg), 5000)));
  await page.emulateMedia({ colorScheme: "light" });
  check("e voltando ao modo claro do celular, claro", Boolean(await ate(() => temFundo(themes.light.colors.bg), 5000)));

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  fs.rmSync(pasta, { recursive: true, force: true });
  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
