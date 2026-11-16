/**
 * A escolha de tema: seguir o sistema (padrao), ou fixar claro / escuro.
 * Pura, sem React e sem banco; a tela e o armazenamento ficam em outros arquivos.
 */

export type EscolhaTema = "sistema" | "claro" | "escuro";

export const ESCOLHAS_TEMA: readonly { valor: EscolhaTema; rotulo: string }[] = [
  { valor: "sistema", rotulo: "Do celular" },
  { valor: "claro", rotulo: "Claro" },
  { valor: "escuro", rotulo: "Escuro" },
];

export const ESCOLHA_PADRAO: EscolhaTema = "sistema";

/** Texto guardado -> escolha. Qualquer coisa desconhecida (ou ausente) volta ao padrao. */
export function leEscolhaTema(texto: string | null | undefined): EscolhaTema {
  return texto === "claro" || texto === "escuro" || texto === "sistema" ? texto : ESCOLHA_PADRAO;
}

/** Qual tema desenhar: a escolha, ou o do sistema quando a escolha e "do celular". */
export function temaEfetivo(escolha: EscolhaTema, sistemaEscuro: boolean): "light" | "dark" {
  if (escolha === "claro") return "light";
  if (escolha === "escuro") return "dark";
  return sistemaEscuro ? "dark" : "light";
}
