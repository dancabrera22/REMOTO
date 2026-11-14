/**
 * Acesso aos locais.
 *
 * Depende de `Executor`, nao do `expo-sqlite`: no aparelho recebe o banco do
 * Expo; nos testes recebe um adaptador sobre o `node:sqlite`. Os mesmos
 * comandos SQL rodam nos dois — e isso que da confianca de que o teste prova
 * alguma coisa sobre o app real.
 */
import {
  LIMITE_APELIDO,
  LIMITE_NOME,
  LIMITE_TEXTO,
  normaliza,
  type Local,
  type LocalInput,
  type ModoValor,
} from "../lib/locais.ts";
import type { AjusteDiaUtil, TipoRegra } from "../lib/pagamento.ts";

type Param = string | number | null;

export interface Executor {
  getAllAsync<T>(sql: string, params?: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: Param[]): Promise<T | null>;
  runAsync(sql: string, params?: Param[]): Promise<{ lastInsertRowId: number; changes: number }>;
}

interface Linha {
  id: number;
  nome: string;
  apelido: string | null;
  cor: string;
  endereco: string | null;
  contato: string | null;
  observacao: string | null;
  modo_valor: ModoValor;
  valor_padrao: number;
  regra_tipo: TipoRegra;
  regra_dia_pagamento: number | null;
  regra_dias_apos: number | null;
  regra_dia_fechamento: number | null;
  regra_meses_adiante: number;
  ajuste_dia_util: AjusteDiaUtil;
  desconto_percentual: number;
  criado_em: number;
  atualizado_em: number;
  arquivado_em: number | null;
}

function paraLocal(l: Linha): Local {
  return {
    id: l.id,
    nome: l.nome,
    apelido: l.apelido,
    cor: l.cor,
    endereco: l.endereco,
    contato: l.contato,
    observacao: l.observacao,
    modoValor: l.modo_valor,
    valorPadrao: l.valor_padrao,
    regra: {
      tipo: l.regra_tipo,
      diaPagamento: l.regra_dia_pagamento,
      diasApos: l.regra_dias_apos,
      diaFechamento: l.regra_dia_fechamento,
      mesesAdiante: l.regra_meses_adiante,
      ajusteDiaUtil: l.ajuste_dia_util,
    },
    descontoPercentual: l.desconto_percentual,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    arquivadoEm: l.arquivado_em,
  };
}

/** Texto opcional: vazio vira `null`, e o limite e aplicado antes de gravar. */
function texto(valor: string | null, limite: number): string | null {
  const t = (valor ?? "").trim();
  return t ? t.slice(0, limite) : null;
}

/**
 * So grava os campos da regra que o tipo escolhido usa. Trocar de "fechamento"
 * para "dias apos" nao deixa o dia de fechamento esquecido no banco, onde
 * confundiria quem for ler os dados depois.
 */
function camposDaRegra(r: LocalInput["regra"]) {
  return {
    diaPagamento: r.tipo === "dias_apos" ? null : r.diaPagamento,
    diasApos: r.tipo === "dias_apos" ? r.diasApos : null,
    diaFechamento: r.tipo === "fechamento" ? r.diaFechamento : null,
  };
}

const COLUNAS = `
  nome = ?, apelido = ?, cor = ?, endereco = ?, contato = ?, observacao = ?,
  modo_valor = ?, valor_padrao = ?,
  regra_tipo = ?, regra_dia_pagamento = ?, regra_dias_apos = ?,
  regra_dia_fechamento = ?, regra_meses_adiante = ?, ajuste_dia_util = ?,
  desconto_percentual = ?`;

function valores(entrada: LocalInput): Param[] {
  const regra = camposDaRegra(entrada.regra);
  return [
    entrada.nome.trim().slice(0, LIMITE_NOME),
    texto(entrada.apelido, LIMITE_APELIDO),
    entrada.cor,
    texto(entrada.endereco, LIMITE_TEXTO),
    texto(entrada.contato, LIMITE_TEXTO),
    texto(entrada.observacao, LIMITE_TEXTO),
    entrada.modoValor,
    entrada.valorPadrao,
    entrada.regra.tipo,
    regra.diaPagamento,
    regra.diasApos,
    regra.diaFechamento,
    entrada.regra.mesesAdiante,
    entrada.regra.ajusteDiaUtil,
    entrada.descontoPercentual,
  ];
}

/** Ordem alfabetica sem diferenciar acento: "Álvaro" fica entre "A" e "B", nao depois do "Z". */
function porNome(a: Local, b: Local): number {
  const x = normaliza(a.nome);
  const y = normaliza(b.nome);
  return x < y ? -1 : x > y ? 1 : a.id - b.id;
}

export async function listaLocais(db: Executor, opcoes: { arquivados: boolean }): Promise<Local[]> {
  const linhas = await db.getAllAsync<Linha>(
    `SELECT * FROM locais WHERE arquivado_em IS ${opcoes.arquivados ? "NOT " : ""}NULL`,
  );
  return linhas.map(paraLocal).sort(porNome);
}

export async function buscaLocal(db: Executor, id: number): Promise<Local | null> {
  const linha = await db.getFirstAsync<Linha>("SELECT * FROM locais WHERE id = ?", [id]);
  return linha ? paraLocal(linha) : null;
}

export async function criaLocal(db: Executor, entrada: LocalInput, agora = Date.now()): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO locais (
       nome, apelido, cor, endereco, contato, observacao,
       modo_valor, valor_padrao,
       regra_tipo, regra_dia_pagamento, regra_dias_apos,
       regra_dia_fechamento, regra_meses_adiante, ajuste_dia_util,
       desconto_percentual, criado_em, atualizado_em
     ) VALUES (${Array(17).fill("?").join(", ")})`,
    [...valores(entrada), agora, agora],
  );
  return r.lastInsertRowId;
}

/** Devolve `false` quando o local nao existe (por exemplo, foi apagado em outra tela). */
export async function atualizaLocal(
  db: Executor,
  id: number,
  entrada: LocalInput,
  agora = Date.now(),
): Promise<boolean> {
  const r = await db.runAsync(`UPDATE locais SET ${COLUNAS}, atualizado_em = ? WHERE id = ?`, [
    ...valores(entrada),
    agora,
    id,
  ]);
  return r.changes > 0;
}

export async function arquivaLocal(db: Executor, id: number, agora = Date.now()): Promise<boolean> {
  const r = await db.runAsync(
    "UPDATE locais SET arquivado_em = ?, atualizado_em = ? WHERE id = ? AND arquivado_em IS NULL",
    [agora, agora, id],
  );
  return r.changes > 0;
}

export async function restauraLocal(db: Executor, id: number, agora = Date.now()): Promise<boolean> {
  const r = await db.runAsync(
    "UPDATE locais SET arquivado_em = NULL, atualizado_em = ? WHERE id = ? AND arquivado_em IS NOT NULL",
    [agora, id],
  );
  return r.changes > 0;
}

/** Cores dos locais ativos, para sugerir uma cor ainda livre. */
export async function coresEmUso(db: Executor, exceto?: number): Promise<string[]> {
  const linhas = await db.getAllAsync<{ cor: string; id: number }>(
    "SELECT id, cor FROM locais WHERE arquivado_em IS NULL",
  );
  return linhas.filter((l) => l.id !== exceto).map((l) => l.cor);
}
