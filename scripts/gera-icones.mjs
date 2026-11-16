#!/usr/bin/env node
/**
 * Gera os icones do app (launcher, adaptativo, monocromatico, abertura e
 * favicon) a partir de um desenho em SVG.
 *
 *   node scripts/gera-icones.mjs
 *
 * O desenho e um calendario com um tracado de batimento (saude) que termina num
 * pontinho verde — o mesmo pontinho que marca os dias na agenda. Esta tudo aqui
 * em codigo, entao da para mudar uma cor ou o tamanho e gerar de novo.
 *
 * Renderiza com o Chromium que o Playwright usa (o mesmo dos testes de tela).
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMAGENS = path.join(RAIZ, "assets", "images");
const DESENHOS = path.join(RAIZ, "assets", "design");

const MARCA = "#0E4F4A"; // verde-petroleo da marca
const MARCA_ESCURA = "#093B37";
const VERDE = "#1E9E5B"; // o pontinho
const FAIXA = "#2A9D8F"; // faixa do topo do calendario (mais clara que o fundo, para o calendario nao se misturar a ele)

/** O desenho, centrado em (0,0), com ~640 de largura. `modo`: "cor" ou "mono" (silhueta branca com recortes). */
function calendario(modo) {
  const cor = modo === "cor";
  const branco = "#FFFFFF";
  const cartao = "M -300 -290 H 300 V 194 A 76 76 0 0 1 224 270 H -224 A 76 76 0 0 1 -300 194 Z";
  const pulso = "M -232 75 H -112 L -56 -25 L 22 185 L 82 25 L 112 75 H 196";

  if (cor) {
    // O corpo branco comeca abaixo da faixa (sem sobreposicao: nada de filete claro na emenda).
    const corpo = "M -300 -120 H 300 V 194 A 76 76 0 0 1 224 270 H -224 A 76 76 0 0 1 -300 194 Z";
    return `
      <rect x="-300" y="-290" width="600" height="171" fill="${FAIXA}"/>
      <path d="${corpo}" fill="${branco}"/>
      <rect x="-170" y="-352" width="60" height="150" rx="30" fill="${branco}" stroke="${MARCA}" stroke-width="14"/>
      <rect x="110" y="-352" width="60" height="150" rx="30" fill="${branco}" stroke="${MARCA}" stroke-width="14"/>
      <path d="${pulso}" fill="none" stroke="${MARCA}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="244" cy="75" r="30" fill="${VERDE}"/>`;
  }

  // Monocromatico: o Android pinta so a forma. Cartao e argolas cheios; pulso, ponto e a faixa do topo ficam vazados.
  return `
    <defs>
      <mask id="m" maskUnits="userSpaceOnUse" x="-400" y="-400" width="800" height="800">
        <rect x="-400" y="-400" width="800" height="800" fill="white"/>
        <path d="${pulso}" fill="none" stroke="black" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="244" cy="75" r="30" fill="black"/>
        <rect x="-300" y="-134" width="600" height="14" fill="black"/>
      </mask>
    </defs>
    <g mask="url(#m)">
      <path d="${cartao}" fill="${branco}"/>
      <rect x="-170" y="-352" width="60" height="150" rx="30" fill="${branco}"/>
      <rect x="110" y="-352" width="60" height="150" rx="30" fill="${branco}"/>
    </g>`;
}

/** Uma pagina SVG de `tamanho` px. `fundo`: cor/gradiente ou `null` (transparente). */
function svg({ tamanho, fundo, modo, escala, deslocaY = 0, saida = tamanho }) {
  const cx = tamanho / 2;
  const cy = tamanho / 2 + deslocaY;
  const bg =
    fundo === null
      ? ""
      : fundo === "marca"
        ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14665F"/><stop offset="1" stop-color="${MARCA_ESCURA}"/></linearGradient></defs><rect width="${tamanho}" height="${tamanho}" fill="url(#g)"/>`
        : `<rect width="${tamanho}" height="${tamanho}" fill="${fundo}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${saida}" height="${saida}" viewBox="0 0 ${tamanho} ${tamanho}">${bg}<g transform="translate(${cx} ${cy}) scale(${escala})">${modo ? calendario(modo) : ""}</g></svg>`;
}

const SAIDAS = [
  // Icone completo (lojas, web): o desenho ocupa ~2/3 do quadrado.
  { arquivo: "icon.png", tamanho: 1024, fundo: "marca", modo: "cor", escala: 1.12, deslocaY: 20 },
  // Adaptativo do Android: o sistema recorta em circulo/quadrado arredondado e so garante a area central
  // (um circulo de ~61% do lado): por isso o desenho e menor aqui.
  { arquivo: "android-icon-foreground.png", tamanho: 1024, fundo: null, modo: "cor", escala: 0.8, deslocaY: 14 },
  { arquivo: "android-icon-background.png", tamanho: 1024, fundo: "marca", modo: null, escala: 1 },
  { arquivo: "android-icon-monochrome.png", tamanho: 1024, fundo: null, modo: "mono", escala: 0.8, deslocaY: 14 },
  // Tela de abertura: o desenho sobre o fundo da marca (a cor do fundo e definida no app.json).
  { arquivo: "splash-icon.png", tamanho: 1024, fundo: null, modo: "cor", escala: 1.2, deslocaY: 20 },
  // Favicon: desenhado em 1024 e entregue em 192 (o navegador reduz para 16/32/48).
  { arquivo: "favicon.png", tamanho: 1024, saida: 192, fundo: "marca", modo: "cor", escala: 1.12, deslocaY: 20 },
];

const CHROMIUM = ["/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((c) => fs.existsSync(c));
if (!CHROMIUM) throw new Error("Chromium nao encontrado.");

fs.mkdirSync(DESENHOS, { recursive: true });
const navegador = await chromium.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });

for (const s of SAIDAS) {
  const lado = s.saida ?? s.tamanho;
  const desenho = svg(s);
  fs.writeFileSync(path.join(DESENHOS, s.arquivo.replace(".png", ".svg")), desenho);

  const pagina = await navegador.newPage({ viewport: { width: lado, height: lado }, deviceScaleFactor: 1 });
  await pagina.setContent(`<html><body style="margin:0;background:transparent">${desenho}</body></html>`);
  const png = await pagina.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: lado, height: lado } });
  await pagina.close();
  fs.writeFileSync(path.join(IMAGENS, s.arquivo), png);
  console.log(`  ${s.arquivo.padEnd(32)} ${lado}x${lado}  (${png.length} bytes)`);
}

await navegador.close();
