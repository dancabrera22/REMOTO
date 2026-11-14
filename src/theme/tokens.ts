/**
 * Linguagem visual do Meu Plantão.
 *
 * Tudo que aparece na tela sai daqui — cor, espaço, raio, tipografia. Centralizar
 * isso na Etapa 1 e o que faz as telas seguintes nascerem coerentes sem esforco.
 *
 * O verde-petroleo e a cor de marca: le como saude sem cair no azul-hospital de
 * sempre. Verde para dinheiro que entrou, ambar para o que esta previsto,
 * vermelho para o que atrasou — a semantica do app todo em tres cores.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const type = {
  display: { fontSize: 30, fontWeight: "700", letterSpacing: -0.6 },
  title: { fontSize: 21, fontWeight: "700", letterSpacing: -0.3 },
  section: { fontSize: 13, fontWeight: "700", letterSpacing: 0.8 },
  body: { fontSize: 16, fontWeight: "400" },
  bodyStrong: { fontSize: 16, fontWeight: "600" },
  label: { fontSize: 14, fontWeight: "500" },
  caption: { fontSize: 12, fontWeight: "500" },
  money: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
} as const;

/**
 * Cores que o usuario atribui aos locais de plantao.
 *
 * Um plantao e reconhecido pela cor antes de ser lido: o pontinho sob o dia na
 * agenda e a unica pista visual de onde voce estara naquela data. Por isso a
 * paleta segue dois criterios, ambos verificados em `tests/cores.mjs`:
 *
 *  1. Visivel nos dois temas — contraste minimo de 3:1 contra a superficie
 *     clara e contra a escura (o padrao WCAG para elementos graficos).
 *  2. Distinguivel entre si — espalhadas pelo circulo cromatico, para que dois
 *     locais nunca virem "dois pontinhos quase iguais".
 *
 * Indigo e vinho foram testados e retirados: o primeiro ficava a 12 de distancia
 * do azul, e o segundo so passava no tema escuro clareando ate virar rosa.
 * Melhor treze cores bem separadas do que quinze que se confundem.
 *
 * Os nomes existem para leitores de tela: "cor 3 de 13" nao diz nada a quem
 * nao enxerga a paleta.
 */
export const coresLocais = [
  { hex: "#D6453D", nome: "Vermelho" },
  { hex: "#D9701E", nome: "Laranja" },
  { hex: "#B8861B", nome: "Mostarda" },
  { hex: "#6F9A1F", nome: "Oliva" },
  { hex: "#1E9E5B", nome: "Verde" },
  { hex: "#1F8A78", nome: "Verde-água" },
  { hex: "#1B90B8", nome: "Ciano" },
  { hex: "#2F6FED", nome: "Azul" },
  { hex: "#8A4FBF", nome: "Roxo" },
  { hex: "#B4409E", nome: "Magenta" },
  { hex: "#D9467A", nome: "Rosa" },
  { hex: "#A06A3F", nome: "Marrom" },
  { hex: "#6B7C8C", nome: "Grafite" },
] as const;

export type CorLocal = (typeof coresLocais)[number];

export function nomeDaCor(hex: string): string {
  return coresLocais.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.nome ?? "Personalizada";
}

interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryOn: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
}

const light: Palette = {
  bg: "#F4F6F7",
  surface: "#FFFFFF",
  surfaceAlt: "#EDF1F2",
  border: "#DFE5E7",
  borderStrong: "#C3CDD0",
  text: "#111A1C",
  textMuted: "#56656A",
  textFaint: "#8A979B",
  primary: "#0E4F4A",
  primaryOn: "#FFFFFF",
  primarySoft: "#DCEAE7",
  success: "#0F7A52",
  successSoft: "#DBF0E6",
  warning: "#9A6508",
  warningSoft: "#FBEED2",
  danger: "#A62B28",
  dangerSoft: "#FADFDE",
  overlay: "rgba(17, 26, 28, 0.45)",
};

const dark: Palette = {
  bg: "#0D1214",
  surface: "#151D1F",
  surfaceAlt: "#1D2729",
  border: "#273336",
  borderStrong: "#3A4A4E",
  text: "#E9EFF0",
  textMuted: "#9AAAAE",
  textFaint: "#6D7F84",
  primary: "#4FBFA8",
  primaryOn: "#06211E",
  primarySoft: "#15302D",
  success: "#4FC88E",
  successSoft: "#13301F",
  warning: "#E0A93F",
  warningSoft: "#33280F",
  danger: "#F0837E",
  dangerSoft: "#361B1A",
  overlay: "rgba(0, 0, 0, 0.6)",
};

export type ThemeName = "light" | "dark";

export interface Theme {
  name: ThemeName;
  colors: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  type: typeof type;
}

export const themes: Record<ThemeName, Theme> = {
  light: { name: "light", colors: light, spacing, radius, type },
  dark: { name: "dark", colors: dark, spacing, radius, type },
};
