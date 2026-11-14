/**
 * Retratos da interface.
 *
 * O app roda no navegador via react-native-web, entao da para ver cada aba nos
 * dois temas, no tamanho de um celular, sem emulador Android. Nao substitui o
 * teste no aparelho, mas pega regressao de layout em segundos.
 *
 *   npx expo start --web --port 8081      (num terminal)
 *   npm run test:telas                    (noutro)
 *
 * As imagens saem em `tests/telas/`.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SAIDA = path.join(AQUI, "telas");
const BASE = process.env.EXPO_WEB ?? "http://127.0.0.1:8081";

const ABAS = ["agenda", "locais", "financeiro", "ajustes"];
const ROTAS = { agenda: "/", locais: "/locais", financeiro: "/financeiro", ajustes: "/ajustes" };

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function achaChromium() {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  for (const caminho of [
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ]) {
    if (fs.existsSync(caminho)) return caminho;
  }
  throw new Error("Chromium não encontrado. Defina CHROMIUM com o caminho do executável.");
}

async function main() {
  fs.mkdirSync(SAIDA, { recursive: true });

  const resposta = await fetch(BASE).catch(() => null);
  if (!resposta?.ok) {
    console.error(`\nO servidor web do Expo não respondeu em ${BASE}.\n  npx expo start --web --port 8081\n`);
    process.exit(1);
  }

  const browser = await chromium.launch({
    executablePath: achaChromium(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let problemas = 0;

  for (const esquema of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      colorScheme: esquema,
    });
    const page = await ctx.newPage();
    const erros = [];
    page.on("pageerror", (e) => erros.push(String(e.message)));
    page.on("console", (m) => m.type() === "error" && erros.push(m.text()));

    for (const aba of ABAS) {
      await page.goto(BASE + ROTAS[aba], { waitUntil: "networkidle", timeout: 120_000 });
      await espera(2500);
      const arquivo = path.join(SAIDA, `${esquema}-${aba}.png`);
      await page.screenshot({ path: arquivo });
      console.log(`  ${esquema}/${aba} → ${path.relative(process.cwd(), arquivo)}`);
    }

    if (erros.length) {
      problemas += erros.length;
      console.log(`  ! ${esquema}: ${erros.length} erro(s)\n    ${erros.slice(0, 5).join("\n    ")}`);
    } else {
      console.log(`  ${esquema}: sem erros de JavaScript`);
    }

    await ctx.close();
  }

  await browser.close();
  process.exit(problemas ? 1 : 0);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
