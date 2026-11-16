/**
 * Calendario pela interface, com SQLite de verdade e um calendario FALSO.
 *
 * No navegador nao existe calendario do aparelho; o servidor web e iniciado com
 * EXPO_PUBLIC_CALENDARIO_FALSO=1 e o app usa um calendario em memoria (guardado
 * no localStorage), que o teste espia por `globalThis.__calendarioFalso`.
 *
 *   EXPO_PUBLIC_CALENDARIO_FALSO=1 npx expo start --web --port 8081   (num terminal)
 *   npm run test:calendario                                           (noutro)
 *
 * A integracao com o calendario do Android de verdade so se confirma no aparelho.
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
const hoje = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const emDias = (n) => new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
const chave = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  EXPO_PUBLIC_CALENDARIO_FALSO=1 npx expo start --web --port 8081\n`);
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
  const botao = (nome) => page.getByText(nome, { exact: true }).last();

  /** Eventos do calendario falso, ordenados. */
  const eventos = () =>
    page.evaluate(() => [...(globalThis.__calendarioFalso?.eventos.values() ?? [])].sort((a, b) => a.inicio - b.inicio));
  const eventosAte = async (n, ms = 12_000) => Boolean(await ate(async () => (await eventos()).length === n, ms));

  const ajustes = async () => {
    await page.goto(`${BASE}/ajustes`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("CALENDÁRIO DO CELULAR", 60_000);
    await espera(500);
  };

  /* ------------------------------ 1. antes de conectar ------------------------------ */

  await ajustes();
  check("Ajustes oferece conectar o calendario", await tem("Conectar calendário"));
  check("explica o que acontece", await tem("Cada plantão vira um evento"));
  check("e que o Google Calendar entra pela conta do aparelho", await tem("Google Calendar"));
  igual("sem conectar, o calendario esta vazio", (await eventos()).length, 0);
  await foto("calendario-desconectado");

  /* ----------------------------- 2. dados para sincronizar ----------------------------- */

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Hospital A");
  await radio("Azul").click();
  await page.getByLabel("Valor em reais").fill("100000");
  await page.getByPlaceholder("Rua, número, bairro").fill("Av. Brasil, 100");
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
  await lanca(emDias(3), "Diurno 7–19");
  await lanca(emDias(10), "Noturno 19–7");

  /* ------------------------------------ 3. conectar ------------------------------------ */

  await ajustes();
  await botao("Conectar calendário").click();
  check("abre a escolha do calendario", await tem("Conectar o calendário"));
  check("lista os calendarios com a conta", (await tem("Pessoal")) && (await tem("Trabalho")) && (await tem("pessoa@gmail.com")));
  check("o principal vem escolhido", (await page.getByRole("radio", { name: /^Pessoal/ }).getAttribute("aria-checked")) === "true");
  check("o lembrete padrao e 1 h antes", (await radio("1 h antes").getAttribute("aria-checked")) === "true");
  check("o valor nao aparece por padrao", (await radio("Não mostrar").getAttribute("aria-checked")) === "true");
  check("avisa que quem lembra e o calendario", await tem("o próprio calendário do celular"));
  await espera(700); // a folha entra com uma animacao; o retrato so depois dela
  await foto("calendario-escolha");

  await page.getByRole("radio", { name: /^Trabalho/ }).click();
  await radio("2 h antes").click();
  await botao("Conectar e sincronizar").click();
  check("depois de conectar, o cartao mostra o estado", await tem("Sincronizando", 20_000));
  check("com o calendario e a conta", await tem("Trabalho · pessoa@gmail.com"));
  check("o lembrete escolhido", await tem("2 h antes"));
  check("diz o que foi feito", await tem("2 eventos criados"));
  check("e quantos eventos ha", await tem("2 eventos"));
  await foto("calendario-conectado");

  const evs = await eventos();
  igual("o calendario recebeu os dois plantoes", evs.length, 2);
  check("todos no calendario escolhido", evs.every((e) => e.calendarioId === "cal-2"));
  check("com titulo, local e lembrete", evs.every((e) => e.titulo === "Plantão · Hospital A" && e.local === "Av. Brasil, 100" && e.lembreteMin === 120));
  check("sem dinheiro nas notas", evs.every((e) => !e.notas.includes("R$")));
  check("o primeiro e o diurno e o segundo o noturno", new Date(evs[0].inicio).getHours() === 7 && new Date(evs[1].inicio).getHours() === 19);
  check("o noturno termina no dia seguinte", new Date(evs[1].fim).getDate() !== new Date(evs[1].inicio).getDate());

  /* ------------------- 4. mudancas no app chegam sozinhas ao calendario ------------------- */

  // O primeiro plantao lancado tem id 1: editar a observacao muda o evento sem apertar nada.
  await page.goto(`${BASE}/plantao/1`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Editar plantão", 60_000);
  await page.getByPlaceholder("Troca, setor, quem cobriu…").fill("Levar crachá");
  await page.getByText("Salvar alterações", { exact: true }).click();
  await tem("RESUMO DO MÊS", 30_000);
  check("editar o plantao atualiza o evento sozinho (sem apertar nada)", Boolean(await ate(async () => (await eventos())[0].notas.startsWith("Levar crachá"), 15_000)));
  igual("e continua um evento por plantao", (await eventos()).length, 2);

  // Excluir o segundo plantao remove o evento.
  await page.goto(`${BASE}/plantao/2`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Editar plantão", 60_000);
  await page.getByText("Excluir este plantão", { exact: true }).click();
  await page.getByText("Excluir", { exact: true }).last().click();
  await tem("RESUMO DO MÊS", 30_000);
  check("excluir o plantao remove o evento", await eventosAte(1, 15_000));

  /* ------------------------------ 5. alterar as opcoes ------------------------------ */

  await ajustes();
  await botao("Alterar").click();
  check("alterar abre com o que ja estava escolhido", (await page.getByRole("radio", { name: /^Trabalho/ }).getAttribute("aria-checked")) === "true" && (await radio("2 h antes").getAttribute("aria-checked")) === "true");
  await radio("Mostrar").click();
  check("avisa que o valor fica visivel", await tem("ficam visíveis para quem tiver acesso"));
  await botao("Salvar e sincronizar").click();
  check("o cartao passa a dizer que o valor aparece", await tem("Aparece"));
  const comValor = (await eventos())[0];
  check("o evento ganha o liquido e a data de recebimento", comValor.notas.includes("Líquido: R$ 1.000,00") && comValor.notas.includes("Cai na conta:"));
  check("e mantem a observacao", comValor.notas.startsWith("Levar crachá"));

  await botao("Sincronizar agora").click();
  check("sincronizar sem mudancas diz que esta tudo em dia", await tem("Tudo em dia"));

  /* ------------------------- 6. reabrir o app nao duplica nada ------------------------- */

  await ajustes();
  await espera(3500); // a sincronizacao automatica roda ao abrir
  igual("depois de reabrir, segue um evento so", (await eventos()).length, 1);
  check("o cartao continua conectado", await tem("Trabalho · pessoa@gmail.com"));

  /* ---------------------------------- 7. problemas ---------------------------------- */

  await page.evaluate(() => {
    globalThis.__calendarioFalso.permissaoAtual = "negada";
  });
  await botao("Sincronizar agora").click();
  check("sem permissao, o cartao mostra o problema", await tem("Com problema"));
  check("diz que falta permissao", await tem("não tem permissão"));
  check("e oferece abrir as configuracoes", await tem("Abrir configurações do app"));
  igual("nada foi apagado do calendario", (await eventos()).length, 1);
  await foto("calendario-problema");
  await page.evaluate(() => {
    globalThis.__calendarioFalso.permissaoAtual = "concedida";
  });
  await botao("Sincronizar agora").click();
  check("devolvida a permissao, volta ao normal", await some("Com problema", 15_000) && (await tem("Trabalho · pessoa@gmail.com")));

  // O calendario escolhido sumiu do aparelho: dá para escolher outro e os eventos vao junto.
  await page.evaluate(() => {
    const f = globalThis.__calendarioFalso;
    f.calendarios = f.calendarios.filter((c) => c.id !== "cal-2");
  });
  await botao("Sincronizar agora").click();
  check("calendario removido do aparelho: avisa qual", await tem("“Trabalho” não está mais disponível"));
  await botao("Alterar").click();
  check("so sobra o outro na lista", (await page.getByRole("radio", { name: /^Pessoal/ }).count()) === 1 && (await page.getByRole("radio", { name: /^Trabalho/ }).count()) === 0);
  await botao("Salvar e sincronizar").click();
  check("o problema some ao escolher outro", await some("Com problema", 15_000));
  const movidos = await eventos();
  check("os eventos foram para o calendario novo", movidos.length === 1 && movidos[0].calendarioId === "cal-1");

  /* ------------------------------------ 8. parar ------------------------------------ */

  await botao("Parar").click();
  check("parar pergunta o que fazer com os eventos", (await tem("Parar de sincronizar?")) && (await tem("O app criou 1 evento")));
  await espera(700);
  await foto("calendario-parar");
  await botao("Parar e manter os eventos").click();
  check("parar mantendo: volta a oferecer conectar", await tem("Conectar calendário"));
  check("e avisa que os eventos continuam", await tem("Os eventos continuam no calendário"));
  igual("o evento segue no calendario", (await eventos()).length, 1);

  // Reconectar depois de manter os eventos cria eventos novos (a folha avisa); remover tira so os do app.
  await botao("Conectar calendário").click();
  await botao("Conectar e sincronizar").click();
  await tem("Pessoal · pessoa@gmail.com", 20_000); // o cartao conectado (o botao tambem diz "Sincronizando…" enquanto trabalha)
  igual("reconectar cria eventos novos (os antigos ficaram sem ligacao com o app)", (await eventos()).length, 2);
  await botao("Parar").click();
  await botao("Parar e remover os eventos").click();
  check("parar removendo tira so o que o app criou desta vez", await eventosAte(1, 10_000));
  check("e diz quantos removeu", await tem("1 evento removido"));

  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
