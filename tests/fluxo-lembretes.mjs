/**
 * Lembretes do app pela interface, com SQLite de verdade e notificacoes FALSAS.
 *
 * No navegador nao ha notificacao agendada; o servidor web e iniciado com
 * EXPO_PUBLIC_CALENDARIO_FALSO=1 e o app usa um sistema em memoria (guardado no localStorage), que o
 * teste espia por `globalThis.__lembretesFalso`.
 *
 *   EXPO_PUBLIC_CALENDARIO_FALSO=1 npx expo start --web --port 8081   (num terminal)
 *   npm run test:lembretes                                            (noutro)
 *
 * O aviso tocando de verdade no Android so se confirma no aparelho.
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

  /** Avisos agendados no sistema falso, ordenados pela hora em que tocam. */
  const avisos = () => page.evaluate(() => [...(globalThis.__lembretesFalso?.agendados.values() ?? [])].sort((a, b) => a.quando - b.quando));
  const avisosAte = async (n, ms = 12_000) => Boolean(await ate(async () => (await avisos()).length === n, ms));

  const ajustes = async () => {
    await page.goto(`${BASE}/ajustes`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("LEMBRETES DO APP", 60_000);
    await espera(500);
  };

  /* ------------------------------ 1. antes de ligar ------------------------------ */

  await ajustes();
  check("Ajustes oferece os lembretes", await tem("Aviso antes de cada plantão"));
  check("diz que nao mostra valores", await tem("não mostra valores"));
  check("e o prazo dos avisos", await tem("próximos 45 dias"));
  for (const r of ["Sem lembrete", "30 min antes", "1 h antes", "2 h antes", "1 dia antes"]) check(`opcao "${r}"`, (await radio(r).count()) === 1);
  check("comeca em 'Sem lembrete'", (await radio("Sem lembrete").getAttribute("aria-checked")) === "true");
  check("tem o botao de teste", await tem("Enviar notificação de teste agora"));
  igual("nada agendado", (await avisos()).length, 0);
  await foto("lembretes-desligado");

  /* ---------------------------- 2. dados para avisar ---------------------------- */

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
  await lanca(emDias(70), "Diurno 7–19"); // alem do prazo de 45 dias: nao ganha aviso ainda

  /* ------------------------------------ 3. ligar ------------------------------------ */

  await ajustes();
  await radio("1 h antes").click();
  check("o cartao mostra que esta ligado", await tem("Ligados"));
  check("diz quantos avisos ha", await tem("2 avisos agendados"));
  check("e que o aviso vem 1 h antes", await tem("avisa 1 h antes"));
  await foto("lembretes-ligado");

  let a = await avisos();
  igual("so os plantoes dentro do prazo ganham aviso", a.length, 2);
  check("o titulo diz quanto falta e onde", a.every((x) => x.titulo === "Plantão em 1 h — Hospital A"));
  check("o corpo traz o horario e o endereco", a[0].corpo.includes("07:00") && a[0].corpo.includes("Av. Brasil, 100"));
  check("sem dinheiro no aviso", a.every((x) => !/R\$|1\.000/.test(x.titulo + x.corpo)));
  check("o primeiro toca 1 h antes do diurno", new Date(a[0].quando).getHours() === 6 && new Date(a[0].quando).getMinutes() === 0);
  check("o segundo toca 1 h antes do noturno", new Date(a[1].quando).getHours() === 18);

  /* ------------------- 4. mudancas no app chegam sozinhas aos avisos ------------------- */

  // O plantao de daqui a 10 dias e o id 2: excluir tira o aviso sem apertar nada.
  await page.goto(`${BASE}/plantao/2`, { waitUntil: "networkidle", timeout: 150_000 });
  await tem("Editar plantão", 60_000);
  await page.getByText("Excluir este plantão", { exact: true }).click();
  await page.getByText("Excluir", { exact: true }).last().click();
  await tem("RESUMO DO MÊS", 30_000);
  check("excluir o plantao tira o aviso sozinho", await avisosAte(1, 15_000));

  // Lancar outro plantao cria o aviso dele.
  await lanca(emDias(5), "Diurno 7–19");
  check("lancar um plantao agenda o aviso dele", await avisosAte(2, 15_000));

  /* ------------------------------- 5. trocar a antecedencia ------------------------------- */

  await ajustes();
  const antes = (await avisos()).map((x) => x.id);
  await radio("30 min antes").click();
  check("o aviso passa a dizer 30 min", await ate(async () => (await avisos()).every((x) => x.titulo === "Plantão em 30 min — Hospital A"), 12_000));
  igual("continua um aviso por plantao", (await avisos()).length, 2);
  check("os avisos antigos sairam", (await avisos()).every((x) => !antes.includes(x.id)));
  check("o cartao diz 30 min", await tem("avisa 30 min antes"));

  /* ---------------------------- 6. reabrir nao duplica nada ---------------------------- */

  await ajustes();
  await espera(3500); // a sincronizacao automatica roda ao abrir
  igual("depois de reabrir, segue um aviso por plantao", (await avisos()).length, 2);

  /* -------------------------------- 7. aviso de teste -------------------------------- */

  await botao("Enviar notificação de teste agora").click();
  check("avisa que o teste toca em 5 segundos", await tem("toca em 5 segundos"));
  const testes = await page.evaluate(() => globalThis.__lembretesFalso.testes);
  igual("um teste foi pedido", testes.length, 1);
  igual("para daqui a 5 segundos", testes[0].emSegundos, 5);
  igual("e os avisos dos plantoes nao foram tocados", (await avisos()).length, 2);

  /* ------------------------- 8. lembrete duplicado com o calendario ------------------------- */

  await botao("Conectar calendário").click();
  await tem("Conectar o calendário");
  await botao("Conectar e sincronizar").click();
  await tem("Sincronizando", 20_000);
  await ajustes();
  check("avisa que o calendario tambem avisa", await tem("O calendário do celular também está avisando"));
  await foto("lembretes-duplicado");
  await botao("Tirar o lembrete do calendário").click();
  check("o aviso some depois de resolver", await some("O calendário do celular também está avisando", 12_000));
  const evs = await page.evaluate(() => [...globalThis.__calendarioFalso.eventos.values()]);
  check("e o evento ficou sem lembrete", evs.length > 0 && evs.every((e) => e.lembreteMin === null));

  /* ---------------------------------- 9. sem permissao ---------------------------------- */

  // O sistema falso volta do localStorage a cada carregamento: a negacao entra por la.
  const negaPermissao = (valor) =>
    page.evaluate((v) => {
      const k = "meu-plantao:lembretes-falso";
      const o = JSON.parse(localStorage.getItem(k) ?? "{}");
      o.permissao = v;
      localStorage.setItem(k, JSON.stringify(o));
    }, valor);
  await negaPermissao("negada");
  await page.goto(`${BASE}/ajustes`, { waitUntil: "networkidle", timeout: 150_000 });
  check("sem permissao, o cartao mostra o problema", await tem("Com problema", 20_000));
  check("explica onde liberar", await tem("Permitir notificações"));
  check("e oferece abrir as configuracoes", await tem("Abrir configurações do app"));
  igual("nada agendado foi apagado", (await avisos()).length, 2);
  await foto("lembretes-bloqueado");
  await negaPermissao("concedida");

  /* ------------------------------------ 10. desligar ------------------------------------ */

  await ajustes();
  await radio("Sem lembrete").click();
  check("desligar tira todos os avisos", await avisosAte(0, 15_000));
  check("o cartao deixa de dizer 'Ligados'", await some("Ligados", 8_000));

  const reais = erros.filter((e) => !/favicon|ResizeObserver/i.test(e));
  check("sem erros no console", reais.length === 0, reais.join(" | "));
  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
