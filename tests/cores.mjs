/**
 * Paleta de cores dos locais.
 *
 * A cor e a unica pista visual de onde voce estara numa data (o pontinho sob o
 * dia na agenda), entao falha aqui e falha de usabilidade, nao de estetica.
 * Dois criterios, medidos em vez de olhados:
 *
 *   1. contraste >= 3:1 contra a superficie clara e a escura (WCAG 1.4.11,
 *      elementos graficos) — o ponto precisa existir nos dois temas;
 *   2. distancia perceptual (CIE76 em Lab) entre qualquer par de cores — dois
 *      locais nao podem virar "dois pontinhos quase iguais".
 */
import { coresLocais, themes } from "../src/theme/tokens.ts";
import { check, report } from "./helpers.mjs";

const REGEX_HEX = /^#[0-9A-Fa-f]{6}$/;

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linear(canal) {
  const c = canal / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
}

function lab(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

export function distancia(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

export function testes() {
  const claro = themes.light.colors.surface;
  const escuro = themes.dark.colors.surface;

  check("todas as cores sao hexadecimais validos", coresLocais.every((c) => REGEX_HEX.test(c.hex)));
  check("nomes nao se repetem", new Set(coresLocais.map((c) => c.nome)).size === coresLocais.length);
  check("hex nao se repetem", new Set(coresLocais.map((c) => c.hex.toLowerCase())).size === coresLocais.length);

  const fracasClaro = coresLocais.filter((c) => contraste(c.hex, claro) < 3);
  check(
    "contraste >= 3:1 no tema claro",
    fracasClaro.length === 0,
    fracasClaro.map((c) => `${c.nome} ${contraste(c.hex, claro).toFixed(2)}`).join(", ") ||
      `pior ${Math.min(...coresLocais.map((c) => contraste(c.hex, claro))).toFixed(2)}:1`,
  );

  const fracasEscuro = coresLocais.filter((c) => contraste(c.hex, escuro) < 3);
  check(
    "contraste >= 3:1 no tema escuro",
    fracasEscuro.length === 0,
    fracasEscuro.map((c) => `${c.nome} ${contraste(c.hex, escuro).toFixed(2)}`).join(", ") ||
      `pior ${Math.min(...coresLocais.map((c) => contraste(c.hex, escuro))).toFixed(2)}:1`,
  );

  // Pior par: o que mais se parece. Abaixo de ~20 de distancia (CIE76) duas
  // cores ja sao dificeis de separar num ponto de 4 px.
  let pior = { d: Infinity, a: "", b: "" };
  for (let i = 0; i < coresLocais.length; i++) {
    for (let j = i + 1; j < coresLocais.length; j++) {
      const d = distancia(coresLocais[i].hex, coresLocais[j].hex);
      if (d < pior.d) pior = { d, a: coresLocais[i].nome, b: coresLocais[j].nome };
    }
  }
  check(
    "qualquer par de cores e distinguivel (distancia >= 20)",
    pior.d >= 20,
    `mais proximas: ${pior.a} e ${pior.b} = ${pior.d.toFixed(1)}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
