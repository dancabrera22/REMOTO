/**
 * Backup em arquivo: o formato, e a validacao de um arquivo antes de ele chegar
 * perto dos dados de verdade.
 *
 * Restaurar APAGA o que existe e poe o conteudo do arquivo no lugar. Entao a
 * regra aqui e desconfiar de tudo: um arquivo que nao e do app, que veio de uma
 * versao mais nova, truncado, editado a mao ou com referencias quebradas
 * (plantao de um local que nao esta no arquivo) tem de ser recusado com uma
 * mensagem clara ANTES de qualquer escrita.
 *
 * Funcoes puras, sem banco. As colunas vem de `TABELAS`, nao de `SELECT *`: o
 * backup nao muda de forma so porque o banco ganhou uma coluna nova.
 *
 * Fica de fora de proposito: o mapa de eventos do calendario e a configuracao
 * (sao do aparelho, nao dos seus dados) — depois de restaurar, a sincronizacao
 * com o calendario se acerta sozinha.
 */

import { normalizaUnidade } from "./plantoes.ts";

export const FORMATO = "meu-plantao-backup";
/**
 * Versao do formato do arquivo.
 *   1  a primeira.
 *   2  plantoes e escalas ganharam `unidade` (o nome do lugar dentro do local).
 * Um arquivo da versao 1 continua restaurando (a coluna nova e opcional e fica sem unidade);
 * um da versao 2 num app que so conhece a 1 e recusado com aviso, em vez de perder as unidades.
 */
export const VERSAO_FORMATO = 2;

export type TipoColuna = "inteiro" | "numero" | "texto";

export interface Coluna {
  nome: string;
  tipo: TipoColuna;
  /** Aceita nulo (e ausente). */
  nulo?: boolean;
  /** Valor quando a coluna nao vem no arquivo (os mesmos padroes do banco). */
  padrao?: number | string;
}

const i = (nome: string, extra: Partial<Coluna> = {}): Coluna => ({ nome, tipo: "inteiro", ...extra });
const n = (nome: string, extra: Partial<Coluna> = {}): Coluna => ({ nome, tipo: "numero", ...extra });
const t = (nome: string, extra: Partial<Coluna> = {}): Coluna => ({ nome, tipo: "texto", ...extra });

export type NomeTabela = "locais" | "series" | "series_puladas" | "plantoes";

/** Na ordem em que se inserem (quem e referenciado vem antes) e se apagam ao contrario. */
export const ORDEM_TABELAS: readonly NomeTabela[] = ["locais", "series", "series_puladas", "plantoes"];

export const TABELAS: Record<NomeTabela, readonly Coluna[]> = {
  locais: [
    i("id"),
    t("nome"),
    t("apelido", { nulo: true }),
    t("cor", { padrao: "#2D7D6F" }),
    t("endereco", { nulo: true }),
    t("contato", { nulo: true }),
    t("observacao", { nulo: true }),
    t("modo_valor", { padrao: "plantao" }),
    i("valor_padrao", { padrao: 0 }),
    t("regra_tipo", { padrao: "dia_mes_seguinte" }),
    i("regra_dia_pagamento", { nulo: true }),
    i("regra_dias_apos", { nulo: true }),
    i("regra_dia_fechamento", { nulo: true }),
    i("regra_meses_adiante", { padrao: 1 }),
    t("ajuste_dia_util", { padrao: "proximo" }),
    n("desconto_percentual", { padrao: 0 }),
    i("criado_em"),
    i("atualizado_em"),
    i("arquivado_em", { nulo: true }),
  ],
  series: [
    i("id"),
    i("local_id"),
    t("tipo"),
    i("dias_semana", { padrao: 0 }),
    i("cada", { padrao: 1 }),
    i("dia_do_mes", { nulo: true }),
    i("inicio_dia"),
    i("fim_dia", { nulo: true }),
    i("inicio_min"),
    i("fim_min"),
    i("valor_bruto", { padrao: 0 }),
    n("desconto_percentual", { padrao: 0 }),
    t("observacao", { nulo: true }),
    t("unidade", { nulo: true }),
    i("gerado_ate", { padrao: 0 }),
    i("criado_em"),
    i("atualizado_em"),
  ],
  series_puladas: [i("serie_id"), i("ocorrencia_dia")],
  plantoes: [
    i("id"),
    i("local_id"),
    i("inicio"),
    i("fim"),
    i("valor_bruto", { padrao: 0 }),
    n("desconto_percentual", { padrao: 0 }),
    t("status", { padrao: "agendado" }),
    t("observacao", { nulo: true }),
    t("unidade", { nulo: true }),
    i("criado_em"),
    i("atualizado_em"),
    i("serie_id", { nulo: true }),
    i("ocorrencia_dia", { nulo: true }),
    i("excecao", { padrao: 0 }),
    i("pago_em", { nulo: true }),
  ],
};

export type Linha = Record<string, number | string | null>;
export type DadosBackup = Record<NomeTabela, Linha[]>;

export interface ArquivoBackup {
  formato: typeof FORMATO;
  versaoFormato: number;
  /** Versao do esquema do banco que gerou o arquivo (informativo). */
  esquema: number;
  /** Versao do app que gerou o arquivo (informativo). */
  app: string;
  criadoEm: number;
  dados: DadosBackup;
}

export function montaBackup(dados: DadosBackup, meta: { esquema: number; app: string; criadoEm: number }): ArquivoBackup {
  return { formato: FORMATO, versaoFormato: VERSAO_FORMATO, esquema: meta.esquema, app: meta.app, criadoEm: meta.criadoEm, dados };
}

export function serializaBackup(b: ArquivoBackup): string {
  return JSON.stringify(b);
}

export interface ResumoBackup {
  locais: number;
  plantoes: number;
  series: number;
  criadoEm: number;
  app: string;
}

export function resumoDoBackup(b: ArquivoBackup): ResumoBackup {
  return { locais: b.dados.locais.length, plantoes: b.dados.plantoes.length, series: b.dados.series.length, criadoEm: b.criadoEm, app: b.app };
}

export type ResultadoLeitura = { ok: true; backup: ArquivoBackup; resumo: ResumoBackup } | { ok: false; erro: string };

/* ------------------------------ validacao ------------------------------ */

const STATUS = ["agendado", "realizado", "cancelado", "trocado"];
const MODO_VALOR = ["plantao", "hora"];
const REGRA_TIPO = ["dia_mes_seguinte", "dias_apos", "fechamento"];
const AJUSTE = ["nenhum", "proximo", "anterior"];
const TIPO_SERIE = ["semanal", "intervalo", "mensal"];

const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function normalizaLinha(tabela: NomeTabela, bruta: unknown, posicao: number): { linha: Linha } | { erro: string } {
  const onde = `${tabela}, linha ${posicao + 1}`;
  if (!ehObjeto(bruta)) return { erro: `${onde}: não é um registro.` };

  const linha: Linha = {};
  for (const c of TABELAS[tabela]) {
    let v = bruta[c.nome];
    if (v === undefined) v = c.nulo ? null : (c.padrao ?? undefined);
    if (v === null && c.nulo) {
      linha[c.nome] = null;
      continue;
    }
    if (v === undefined || v === null) return { erro: `${onde}: falta o campo “${c.nome}”.` };

    const certo =
      c.tipo === "texto" ? typeof v === "string" : c.tipo === "inteiro" ? Number.isSafeInteger(v) : typeof v === "number" && Number.isFinite(v);
    if (!certo) return { erro: `${onde}: o campo “${c.nome}” está com um valor inválido.` };
    linha[c.nome] = v as number | string;
  }
  // Um arquivo editado a mao pode trazer a unidade com espacos sobrando ou comprida demais:
  // entra do mesmo jeito que o formulario a grava.
  if ("unidade" in linha) linha.unidade = normalizaUnidade(linha.unidade as string | null);
  return { linha };
}

/** Regras de negocio que o banco tambem impoe: aqui viram mensagem, la virariam um erro seco no meio da restauracao. */
function confereRegras(d: DadosBackup): string | null {
  for (const l of d.locais) {
    if (!MODO_VALOR.includes(l.modo_valor as string)) return `locais, “${l.nome}”: modo de valor desconhecido.`;
    if (!REGRA_TIPO.includes(l.regra_tipo as string)) return `locais, “${l.nome}”: regra de pagamento desconhecida.`;
    if (!AJUSTE.includes(l.ajuste_dia_util as string)) return `locais, “${l.nome}”: ajuste de dia útil desconhecido.`;
    const desc = l.desconto_percentual as number;
    if (desc < 0 || desc > 100) return `locais, “${l.nome}”: desconto fora de 0% a 100%.`;
  }
  for (const s of d.series) {
    if (!TIPO_SERIE.includes(s.tipo as string)) return `series, id ${s.id}: tipo de repetição desconhecido.`;
    const desc = s.desconto_percentual as number;
    if (desc < 0 || desc > 100) return `series, id ${s.id}: desconto fora de 0% a 100%.`;
    if ((s.valor_bruto as number) < 0) return `series, id ${s.id}: valor negativo.`;
  }
  for (const p of d.plantoes) {
    if (!STATUS.includes(p.status as string)) return `plantoes, id ${p.id}: situação desconhecida.`;
    if ((p.fim as number) <= (p.inicio as number)) return `plantoes, id ${p.id}: o fim não vem depois do início.`;
    if ((p.valor_bruto as number) < 0) return `plantoes, id ${p.id}: valor negativo.`;
    const desc = p.desconto_percentual as number;
    if (desc < 0 || desc > 100) return `plantoes, id ${p.id}: desconto fora de 0% a 100%.`;
    if (p.excecao !== 0 && p.excecao !== 1) return `plantoes, id ${p.id}: marca de exceção inválida.`;
    if (p.pago_em !== null && p.status !== "realizado") return `plantoes, id ${p.id}: só plantão realizado pode estar pago.`;
  }
  return null;
}

/** Ids unicos e todas as referencias apontando para algo que esta no proprio arquivo. */
function confereReferencias(d: DadosBackup): string | null {
  const unicos = (tabela: NomeTabela): { erro: string } | { ids: Set<number> } => {
    const ids = new Set<number>();
    for (const l of d[tabela]) {
      const id = l.id as number;
      if (ids.has(id)) return { erro: `${tabela}: o id ${id} aparece mais de uma vez.` };
      ids.add(id);
    }
    return { ids };
  };

  const locais = unicos("locais");
  if ("erro" in locais) return locais.erro;
  const series = unicos("series");
  if ("erro" in series) return series.erro;
  const plantoes = unicos("plantoes");
  if ("erro" in plantoes) return plantoes.erro;

  for (const s of d.series) {
    if (!locais.ids.has(s.local_id as number)) return `series, id ${s.id}: o local ${s.local_id} não está no arquivo.`;
  }
  const ocorrencias = new Set<string>();
  for (const p of d.plantoes) {
    if (!locais.ids.has(p.local_id as number)) return `plantoes, id ${p.id}: o local ${p.local_id} não está no arquivo.`;
    if (p.serie_id !== null) {
      if (!series.ids.has(p.serie_id as number)) return `plantoes, id ${p.id}: a escala ${p.serie_id} não está no arquivo.`;
      if (p.ocorrencia_dia === null) return `plantoes, id ${p.id}: plantão de escala sem o dia da ocorrência.`;
      const chave = `${p.serie_id}|${p.ocorrencia_dia}`;
      if (ocorrencias.has(chave)) return `plantoes, id ${p.id}: a escala ${p.serie_id} tem duas ocorrências no mesmo dia.`;
      ocorrencias.add(chave);
    }
  }
  const puladas = new Set<string>();
  for (const x of d.series_puladas) {
    if (!series.ids.has(x.serie_id as number)) return `series_puladas: a escala ${x.serie_id} não está no arquivo.`;
    const chave = `${x.serie_id}|${x.ocorrencia_dia}`;
    if (puladas.has(chave)) return `series_puladas: a escala ${x.serie_id} repete um dia excluído.`;
    puladas.add(chave);
  }
  return null;
}

/**
 * Le o texto de um arquivo de backup. Nao toca em banco nenhum: devolve o
 * backup normalizado (so as colunas conhecidas, com os padroes aplicados) ou o
 * motivo de ele nao servir.
 */
export function interpretaBackup(texto: string): ResultadoLeitura {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, erro: "Não consegui ler este arquivo. Ele não parece um backup do Meu Plantão (ou está incompleto)." };
  }

  if (!ehObjeto(bruto) || bruto.formato !== FORMATO) {
    return { ok: false, erro: "Este arquivo não é um backup do Meu Plantão." };
  }
  if (typeof bruto.versaoFormato !== "number" || !Number.isInteger(bruto.versaoFormato) || bruto.versaoFormato < 1) {
    return { ok: false, erro: "Este backup não informa a versão do formato." };
  }
  if (bruto.versaoFormato > VERSAO_FORMATO) {
    return { ok: false, erro: "Este backup foi feito por uma versão mais nova do app. Atualize o Meu Plantão para restaurá-lo." };
  }
  if (!ehObjeto(bruto.dados)) return { ok: false, erro: "O backup está sem os dados." };

  const dados = {} as DadosBackup;
  for (const tabela of ORDEM_TABELAS) {
    const origem = bruto.dados[tabela];
    if (!Array.isArray(origem)) return { ok: false, erro: `O backup está incompleto: faltam os ${tabela.replace("_", " ")}.` };
    const linhas: Linha[] = [];
    for (let k = 0; k < origem.length; k++) {
      const r = normalizaLinha(tabela, origem[k], k);
      if ("erro" in r) return { ok: false, erro: `Backup com dados inválidos — ${r.erro}` };
      linhas.push(r.linha);
    }
    dados[tabela] = linhas;
  }

  const erro = confereReferencias(dados) ?? confereRegras(dados);
  if (erro) return { ok: false, erro: `Backup com dados inválidos — ${erro}` };

  const backup: ArquivoBackup = {
    formato: FORMATO,
    versaoFormato: bruto.versaoFormato,
    esquema: typeof bruto.esquema === "number" ? bruto.esquema : 0,
    app: typeof bruto.app === "string" ? bruto.app : "",
    criadoEm: typeof bruto.criadoEm === "number" && Number.isFinite(bruto.criadoEm) ? bruto.criadoEm : 0,
    dados,
  };
  return { ok: true, backup, resumo: resumoDoBackup(backup) };
}

/** "meu-plantao-backup-2026-11-16.json". */
export function nomeDoArquivoDeBackup(agoraMs: number): string {
  const d = new Date(agoraMs);
  const dois = (x: number) => String(x).padStart(2, "0");
  return `meu-plantao-backup-${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}.json`;
}
