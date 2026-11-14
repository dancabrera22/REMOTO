/**
 * Modelo e regras de um local de plantao.
 *
 * Sem banco, sem tela: o que o formulario valida e o que o banco grava passam
 * pelas mesmas funcoes, e os testes rodam em Node puro.
 */
import { coresLocais } from "../theme/tokens.ts";
import { aplicaDesconto, formatBRLCompacto, valorPorHora, type Centavos } from "./money.ts";
import { REGRA_PADRAO, validaRegra, type ErrosRegra, type RegraPagamento } from "./pagamento.ts";

export type ModoValor = "plantao" | "hora";

export interface LocalInput {
  nome: string;
  apelido: string | null;
  cor: string;
  endereco: string | null;
  contato: string | null;
  observacao: string | null;
  modoValor: ModoValor;
  valorPadrao: Centavos;
  regra: RegraPagamento;
  /** Retencoes do local (IR, ISS, cooperativa), em %: 0 a 100. */
  descontoPercentual: number;
}

export interface Local extends LocalInput {
  id: number;
  criadoEm: number;
  atualizadoEm: number;
  /** Preenchido quando o local foi arquivado; some das listas, mantem o historico. */
  arquivadoEm: number | null;
}

export const REGEX_COR = /^#[0-9A-Fa-f]{6}$/;
export const LIMITE_NOME = 60;
export const LIMITE_APELIDO = 20;
export const LIMITE_TEXTO = 300;

/**
 * Cor sugerida para um local novo: a primeira da paleta que nenhum local ativo
 * usa. Se todas estiverem em uso, recomeca da primeira — repetir e preferivel
 * a recusar, e o formulario avisa quando acontece.
 */
export function proximaCor(emUso: readonly string[]): string {
  const usadas = new Set(emUso.map((c) => c.toLowerCase()));
  const livre = coresLocais.find((c) => !usadas.has(c.hex.toLowerCase()));
  return (livre ?? coresLocais[0]).hex;
}

export function localVazio(emUso: readonly string[] = []): LocalInput {
  return {
    nome: "",
    apelido: null,
    cor: proximaCor(emUso),
    endereco: null,
    contato: null,
    observacao: null,
    modoValor: "plantao",
    valorPadrao: 0,
    regra: { ...REGRA_PADRAO },
    descontoPercentual: 0,
  };
}

export type ErrosLocal = Partial<
  Record<"nome" | "apelido" | "cor" | "valorPadrao" | "descontoPercentual", string>
> &
  ErrosRegra;

export interface OutroLocal {
  id: number;
  nome: string;
  cor: string;
}

export interface ResultadoValidacao {
  erros: ErrosLocal;
  /** Avisos nao impedem salvar: so chamam a atencao para algo provavelmente nao intencional. */
  avisos: { nome?: string; cor?: string };
}

export const normaliza = (s: string) =>
  s
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * `outros` sao os demais locais ativos (sem o que esta sendo editado). Nome
 * repetido nao e erro — ha redes com varias unidades de mesmo nome — mas e
 * quase sempre engano, entao vira aviso.
 */
export function validaLocal(entrada: LocalInput, outros: readonly OutroLocal[] = []): ResultadoValidacao {
  const erros: ErrosLocal = {};
  const avisos: ResultadoValidacao["avisos"] = {};

  const nome = entrada.nome.trim();
  if (!nome) erros.nome = "Dê um nome ao local.";
  else if (nome.length > LIMITE_NOME) erros.nome = `Use até ${LIMITE_NOME} caracteres.`;

  if (entrada.apelido && entrada.apelido.trim().length > LIMITE_APELIDO) {
    erros.apelido = `Use até ${LIMITE_APELIDO} caracteres.`;
  }

  if (!REGEX_COR.test(entrada.cor)) erros.cor = "Escolha uma cor.";

  if (!Number.isInteger(entrada.valorPadrao) || entrada.valorPadrao < 0) {
    erros.valorPadrao = "O valor não pode ser negativo.";
  }

  if (
    !Number.isFinite(entrada.descontoPercentual) ||
    entrada.descontoPercentual < 0 ||
    entrada.descontoPercentual > 100
  ) {
    erros.descontoPercentual = "Informe de 0% a 100%.";
  }

  Object.assign(erros, validaRegra(entrada.regra));

  if (nome && outros.some((o) => normaliza(o.nome) === normaliza(nome))) {
    avisos.nome = "Já existe um local com esse nome.";
  }
  if (REGEX_COR.test(entrada.cor)) {
    const igual = outros.find((o) => o.cor.toLowerCase() === entrada.cor.toLowerCase());
    if (igual) avisos.cor = `${igual.nome} já usa essa cor.`;
  }

  return { erros, avisos };
}

export function temErros(erros: object): boolean {
  return Object.values(erros).some(Boolean);
}

/** Valor de um plantao deste local, dado o tempo trabalhado (padrao: 12 h). */
export function valorEstimado(
  modo: ModoValor,
  valorPadrao: Centavos,
  minutos = 720,
): Centavos {
  return modo === "hora" ? valorPorHora(valorPadrao, minutos) : valorPadrao;
}

export function valorLiquido(bruto: Centavos, descontoPercentual: number): Centavos {
  return aplicaDesconto(bruto, descontoPercentual);
}

/** "R$ 1.200 por plantão" ou "R$ 100 por hora". */
export function descreveValor(modo: ModoValor, valorPadrao: Centavos): string {
  if (!valorPadrao) return "Sem valor padrão";
  return `${formatBRLCompacto(valorPadrao)} ${modo === "hora" ? "por hora" : "por plantão"}`;
}
