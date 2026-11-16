/**
 * A troca de mes e SUAVE: nada pula, pisca ou aparece de repente.
 *
 * O teste grava a tela QUADRO A QUADRO (requestAnimationFrame) enquanto o mes e
 * arrastado e termina de deslizar, e procura descontinuidades — o tipo de defeito que
 * o olho percebe como "piscar" e que uma verificacao do estado final nao ve:
 *
 *   - tudo que fica embaixo do calendario dando um salto quando o mes novo tem mais
 *     (ou menos) semanas que o atual (56 px por semana de diferenca);
 *   - o destaque do dia selecionado so aparecendo depois de o mes assentar;
 *   - a legenda "voltar para hoje" empurrando o conteudo ao aparecer e sumir;
 *   - a lista do dia e o resumo trocando de uma vez, sem esmaecer.
 *
 * Nao depende da data de hoje: procura sozinho dois meses seguidos com numero de
 * semanas diferente (5 e 6, por exemplo) e desliza de um para o outro, e de volta.
 *
 *   npx expo start --web --port 8081     (num terminal)
 *   npm run test:suave                   (noutro)
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
const mes = (delta) => new Date(hoje.getFullYear(), hoje.getMonth() + delta, 1);
const chave = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const nomeDoMes = (d) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
/** Quantas semanas a grade do mes tem (domingo a sabado). */
const semanas = (d) => {
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return Math.ceil((primeiro + new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()) / 7);
};

/** Dois meses seguidos (de `i` e `i + 1` meses a partir de hoje) com numero de semanas diferente. */
function acharPar() {
  for (let i = 0; i < 24; i++) if (semanas(mes(i)) !== semanas(mes(i + 1))) return i;
  throw new Error("Nao achei dois meses seguidos com numero de semanas diferente.");
}

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });
  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const iA = acharPar();
  const A = mes(iA);
  const B = mes(iA + 1);
  const difSemanas = semanas(B) - semanas(A);
  console.log(`\nPar de meses: ${nomeDoMes(A)} (${semanas(A)} semanas) -> ${nomeDoMes(B)} (${semanas(B)} semanas)\n`);

  const browser = await chromium.launch({ executablePath: achaChromium(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, locale: "pt-BR", hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  const erros = [];
  page.on("pageerror", (e) => erros.push(String(e.message)));
  page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

  const texto = () => page.evaluate(() => document.body.innerText);
  const tem = async (trecho, ms = 8_000) => Boolean(await ate(async () => (await texto()).includes(trecho), ms));

  /* ------------------------------- preparo: um local e plantoes ------------------------------- */

  await page.goto(`${BASE}/local/novo`, { waitUntil: "networkidle", timeout: 150_000 });
  await page.getByLabel("Nome do local").fill("Hospital A");
  await page.getByRole("radio", { name: "Azul", exact: true }).click();
  await page.getByLabel("Valor em reais").fill("100000");
  await page.getByText("Cadastrar local", { exact: true }).last().click();
  await page.waitForURL("**/locais", { timeout: 30_000 });

  // Plantoes nos dois meses (no dia 1 de cada um: e o dia que fica selecionado ao chegar la) e hoje.
  const dia = (d, n) => new Date(d.getFullYear(), d.getMonth(), n);
  for (const d of [hoje, dia(A, 1), dia(A, 10), dia(B, 1), dia(B, 10)]) {
    await page.goto(`${BASE}/plantao/novo?dia=${chave(d)}`, { waitUntil: "networkidle", timeout: 150_000 });
    await tem("Novo plantão", 60_000);
    await page.getByRole("radio", { name: "Hospital A", exact: true }).click();
    await page.getByText("Lançar plantão", { exact: true }).click();
    await ate(async () => (await texto()).includes(TITULO_RESUMO), 30_000);
  }

  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 120_000 });
  await tem(TITULO_RESUMO, 60_000);

  const parou = () => ate(async () => (await page.locator("[aria-busy=true]").count()) === 0, 5000);
  for (let i = 0; i < iA; i++) {
    await page.getByRole("button", { name: "Próximo mês" }).click();
    await tem(nomeDoMes(mes(i + 1)), 6000);
    await parou();
  }
  await tem(nomeDoMes(A), 6000);
  await parou();
  await espera(900); // deixa os meses vizinhos serem montados fora da vista

  /* ------------------------------- o gravador de quadros ------------------------------- */

  await page.evaluate(() => {
    const TITULO = /^[a-zç]+ de 20\d\d$/i;
    const folhas = () => [...document.querySelectorAll("div, span")].filter((e) => e.children.length === 0);
    const opacidadeEfetiva = (el) => {
      let o = 1;
      for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    window.__quadros = [];
    window.__grava = true;
    const assina = () => {
      const janela = document.querySelector("[aria-busy]").getBoundingClientRect();
      const fl = folhas();
      const resumo = fl.find((e) => e.textContent.trim().toUpperCase() === "RESUMO DO MÊS");
      const titulo = fl.find((e) => TITULO.test(e.textContent.trim()));
      const cabecalhoDia = fl.find((e) => /, \d{2}\/\d{2}\/\d{4}$/.test(e.textContent.trim()));
      const destaques = [...document.querySelectorAll("[aria-selected=true]")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.right > janela.left + 1 && r.left < janela.right - 1 && r.bottom > janela.top && r.top < janela.bottom)
        .map((r) => ({ x: Math.round(r.x), y: Math.round(r.y) }));
      return {
        t: performance.now(),
        busy: document.querySelector("[aria-busy=true]") !== null,
        titulo: titulo?.textContent.trim(),
        tituloAltura: titulo?.parentElement ? Math.round(titulo.parentElement.getBoundingClientRect().height) : null,
        resumoY: resumo ? resumo.getBoundingClientRect().y : null,
        cabecalhoDia: cabecalhoDia?.textContent.trim(),
        opacidade: cabecalhoDia ? opacidadeEfetiva(cabecalhoDia) : null,
        destaques,
      };
    };
    const laco = () => {
      if (window.__grava) window.__quadros.push(assina());
      requestAnimationFrame(laco);
    };
    requestAnimationFrame(laco);
  });

  const toca = (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  const move = (x, y) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  const solta = () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  /** Desliza o dedo `px` (negativo = para a esquerda) e devolve os quadros ate a tela assentar. */
  async function desliza(px, { depois = 1500, atraso = 14 } = {}) {
    const caixa = await page.locator("[aria-busy]").boundingBox();
    const y = caixa.y + caixa.height / 2;
    const de = px < 0 ? caixa.x + caixa.width * 0.85 : caixa.x + caixa.width * 0.15;
    await page.evaluate(() => (window.__quadros = []));
    await toca(de, y);
    const passo = px < 0 ? -10 : 10;
    for (let x = 0; px < 0 ? x >= px : x <= px; x += passo) {
      await move(de + x, y);
      await espera(atraso);
    }
    await solta();
    await espera(depois);
    return page.evaluate(() => window.__quadros.slice());
  }

  /** Analisa uma gravacao: o que pulou, o que apareceu de repente. */
  function analisa(q) {
    const ys = q.map((f) => f.resumoY).filter((v) => v !== null);
    let maiorSalto = 0;
    for (let i = 1; i < ys.length; i++) maiorSalto = Math.max(maiorSalto, Math.abs(ys[i] - ys[i - 1]));
    const ultimoMovendo = q.map((f) => f.busy).lastIndexOf(true);
    const antes = q[ultimoMovendo];
    const depois = q[ultimoMovendo + 1] ?? q[q.length - 1];
    const alturas = q.map((f) => f.tituloAltura).filter((v) => v !== null);
    const opMovendo = q.filter((f) => f.busy && f.opacidade !== null).map((f) => f.opacidade);
    let trocaDoCabecalho = null; // o quadro em que o cabecalho do dia muda de texto
    for (let i = 1; i < q.length; i++) if (q[i].cabecalhoDia !== q[i - 1].cabecalhoDia) { trocaDoCabecalho = q[i]; break; }
    let maiorBuraco = 0;
    for (let i = 1; i < q.length; i++) maiorBuraco = Math.max(maiorBuraco, q[i].t - q[i - 1].t);
    return {
      maiorSalto,
      deltaTotal: ys.length ? ys[ys.length - 1] - ys[0] : 0,
      saltoFinal: antes && depois && antes.resumoY !== null && depois.resumoY !== null ? Math.abs(depois.resumoY - antes.resumoY) : null,
      destaquesAntes: antes?.destaques ?? [],
      destaquesDepois: depois?.destaques ?? [],
      variacaoDoTitulo: alturas.length ? Math.max(...alturas) - Math.min(...alturas) : 0,
      menorOpacidade: opMovendo.length ? Math.min(...opMovendo) : 1,
      opacidadeNaTroca: trocaDoCabecalho?.opacidade ?? null,
      opacidadeFinal: q[q.length - 1].opacidade,
      tituloFinal: q[q.length - 1].titulo,
      buraco: maiorBuraco,
      quadros: q.length,
    };
  }

  /* ------------------- A -> B: o conteudo de baixo acompanha, o destaque chega junto ------------------- */

  const r1 = analisa(await desliza(-200));
  console.log(`  (${r1.quadros} quadros gravados)`);
  check("termina no mes seguinte", r1.tituloFinal === nomeDoMes(B), r1.tituloFinal);
  check(
    `a diferenca de ${Math.abs(difSemanas)} semana(s) vira ~${Math.abs(difSemanas) * 56} px, de verdade`,
    Math.abs(Math.abs(r1.deltaTotal) - Math.abs(difSemanas) * 56) <= 4,
    `${Math.round(r1.deltaTotal)} px`,
  );
  check("o conteudo de baixo nunca da um salto (maior passo entre dois quadros)", r1.maiorSalto <= 14, `${r1.maiorSalto.toFixed(1)} px`);
  check("e o ultimo quadro deslizando ja esta onde vai ficar (sem tranco ao assentar)", r1.saltoFinal !== null && r1.saltoFinal <= 14, `${r1.saltoFinal?.toFixed(1)} px`);
  igual("no ultimo quadro deslizando ha UM dia destacado a vista", r1.destaquesAntes.length, 1);
  check(
    "o destaque do dia ja estava no lugar onde fica (nao aparece depois de assentar)",
    r1.destaquesDepois.length === 1 && Math.abs(r1.destaquesAntes[0]?.x - r1.destaquesDepois[0].x) <= 2 && Math.abs(r1.destaquesAntes[0]?.y - r1.destaquesDepois[0].y) <= 2,
    `${JSON.stringify(r1.destaquesAntes[0])} -> ${JSON.stringify(r1.destaquesDepois[0])}`,
  );
  check("a lista do dia e o resumo esmaecem durante a troca", r1.menorOpacidade <= 0.6, `minimo ${r1.menorOpacidade.toFixed(2)}`);
  check("a lista do dia troca com o conteudo esmaecido, nao em cheio", r1.opacidadeNaTroca !== null && r1.opacidadeNaTroca <= 0.7, `${r1.opacidadeNaTroca?.toFixed(2)}`);
  check("e volta ao normal em seguida", r1.opacidadeFinal >= 0.99, `${r1.opacidadeFinal?.toFixed(2)}`);
  check("a linha do titulo nao muda de altura (a legenda \"voltar para hoje\" nao empurra nada)", r1.variacaoDoTitulo <= 1, `${r1.variacaoDoTitulo} px`);
  check("nenhum quadro parado por mais de 250 ms", r1.buraco <= 250, `${Math.round(r1.buraco)} ms`);

  /* ------------------------------- B -> A, para o outro lado ------------------------------- */

  await parou();
  await espera(900);
  const r2 = analisa(await desliza(200));
  check("de volta ao mes anterior", r2.tituloFinal === nomeDoMes(A), r2.tituloFinal);
  check("voltando, o conteudo de baixo tambem nao da salto", r2.maiorSalto <= 14, `${r2.maiorSalto.toFixed(1)} px`);
  check("e o ultimo quadro deslizando ja esta onde vai ficar", r2.saltoFinal !== null && r2.saltoFinal <= 14, `${r2.saltoFinal?.toFixed(1)} px`);
  check(
    "o destaque chega junto tambem na volta",
    r2.destaquesDepois.length === 1 && r2.destaquesAntes.length === 1 && Math.abs(r2.destaquesAntes[0]?.x - r2.destaquesDepois[0].x) <= 2 && Math.abs(r2.destaquesAntes[0]?.y - r2.destaquesDepois[0].y) <= 2,
  );

  /* ------------------------------- arrasto curto: nada fica esmaecido ------------------------------- */

  await parou();
  await espera(900);
  const r3 = analisa(await desliza(-40, { atraso: 70 })); // curto e devagar: desiste
  check("arrasto curto: volta ao mes em que estava", r3.tituloFinal === nomeDoMes(A), r3.tituloFinal);
  check("e a lista do dia nao fica esmaecida (nao houve troca)", r3.opacidadeFinal >= 0.99, `${r3.opacidadeFinal?.toFixed(2)}`);
  check("nem pulou", r3.maiorSalto <= 14, `${r3.maiorSalto.toFixed(1)} px`);

  /* ----------------- dois deslizes seguidos, antes de os vizinhos serem preparados ----------------- */

  await parou();
  await espera(900);
  await desliza(-200, { depois: 120 }); // solta e ja comeca outro, logo em seguida
  const r4 = analisa(await desliza(-200));
  check("o segundo deslize, quase colado no primeiro, tambem funciona", r4.tituloFinal === nomeDoMes(mes(iA + 2)), r4.tituloFinal);
  // Aqui o dia 1 do mes novo nao tem plantao: a lista passa de um cartao para o aviso "nenhum plantao",
  // que e bem mais alto. Antes o resumo pulava de uma vez; agora a altura desliza.
  console.log(`  (a lista mudou ${Math.round(Math.abs(r4.deltaTotal))} px de altura no total)`);
  check(
    "a lista que muda de altura DESLIZA: nenhum quadro carrega mais de 40% da mudanca",
    Math.abs(r4.deltaTotal) < 60 || r4.maiorSalto <= Math.abs(r4.deltaTotal) * 0.4,
    `maior passo ${r4.maiorSalto.toFixed(1)} px de ${Math.round(Math.abs(r4.deltaTotal))}`,
  );

  /* -------------------- a legenda "voltar para hoje" nao muda a altura do titulo -------------------- */

  await parou();
  await page.evaluate(() => (window.__quadros = []));
  const alturaTitulo = () => page.evaluate(() => {
    const t = [...document.querySelectorAll("div")].find((e) => e.children.length === 0 && /^[a-zç]+ de 20\d\d$/i.test(e.textContent.trim()));
    return Math.round(t.parentElement.getBoundingClientRect().height);
  });
  const emOutroMes = await alturaTitulo();
  await page.getByText("voltar para hoje", { exact: true }).click();
  await tem(nomeDoMes(mes(0)), 6000);
  await parou();
  const noMesDeHoje = await alturaTitulo();
  igual("o titulo tem a mesma altura no mes de hoje e em outro mes", noMesDeHoje, emOutroMes);
  check("e no mes de hoje nao ha legenda visivel", !(await texto()).includes("voltar para hoje"));

  /* ------------------------------- tocar num dia nao esmaece nada ------------------------------- */

  await espera(900);
  await page.evaluate(() => (window.__quadros = []));
  await page.getByRole("button", { name: "12", exact: true }).click();
  await espera(500);
  const toque = analisa(await page.evaluate(() => window.__quadros.slice()));
  check("tocar num dia do mesmo mes nao esmaece a lista", toque.menorOpacidade >= 0.99, `minimo ${toque.menorOpacidade.toFixed(2)}`);

  await page.screenshot({ path: path.join(SAIDA, "suave-final.png") });
  igual("nenhum erro no console", erros.length, 0);
  if (erros.length) console.log(erros.slice(0, 5).join("\n"));

  await browser.close();
  process.exit(report() ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
