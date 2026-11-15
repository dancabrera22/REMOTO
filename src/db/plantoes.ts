/**
 * Acesso aos plantoes. Mesma regra da camada de locais: depende de `Executor`,
 * nao do `expo-sqlite`, para os testes rodarem os mesmos comandos SQL do app.
 */
import { LIMITE_OBSERVACAO, type PlantaoComLocal, type PlantaoInput, type StatusPlantao } from "../lib/plantoes.ts";
import type { Executor } from "./locais.ts";

interface Linha {
  id: number;
  local_id: number;
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  status: StatusPlantao;
  observacao: string | null;
  criado_em: number;
  atualizado_em: number;
  local_nome: string;
  local_apelido: string | null;
  local_cor: string;
  local_arquivado_em: number | null;
}

const SELECT = `
  SELECT p.*,
         l.nome AS local_nome, l.apelido AS local_apelido,
         l.cor AS local_cor, l.arquivado_em AS local_arquivado_em
    FROM plantoes p
    JOIN locais l ON l.id = p.local_id`;

function paraPlantao(l: Linha): PlantaoComLocal {
  return {
    id: l.id,
    localId: l.local_id,
    inicio: l.inicio,
    fim: l.fim,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    status: l.status,
    observacao: l.observacao,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    local: {
      nome: l.local_nome,
      apelido: l.local_apelido,
      cor: l.local_cor,
      arquivado: l.local_arquivado_em !== null,
    },
  };
}

function observacao(valor: string | null): string | null {
  const t = (valor ?? "").trim();
  return t ? t.slice(0, LIMITE_OBSERVACAO) : null;
}

/**
 * Plantoes que COMECAM entre `deMs` e `ateMs` (inclusive), em ordem de horario.
 * Um noturno que entra as 19h do ultimo dia do mes pertence a esse mes, mesmo
 * saindo no seguinte.
 */
export async function listaPlantoesPeriodo(db: Executor, deMs: number, ateMs: number): Promise<PlantaoComLocal[]> {
  const linhas = await db.getAllAsync<Linha>(
    `${SELECT} WHERE p.inicio >= ? AND p.inicio <= ? ORDER BY p.inicio, p.id`,
    [deMs, ateMs],
  );
  return linhas.map(paraPlantao);
}

export async function buscaPlantao(db: Executor, id: number): Promise<PlantaoComLocal | null> {
  const linha = await db.getFirstAsync<Linha>(`${SELECT} WHERE p.id = ?`, [id]);
  return linha ? paraPlantao(linha) : null;
}

export async function criaPlantao(db: Executor, e: PlantaoInput, agora = Date.now()): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO plantoes (
       local_id, inicio, fim, valor_bruto, desconto_percentual,
       status, observacao, criado_em, atualizado_em
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.localId, e.inicio, e.fim, e.valorBruto, e.descontoPercentual, e.status, observacao(e.observacao), agora, agora],
  );
  return r.lastInsertRowId;
}

/** `false` quando o plantao nao existe (apagado em outra tela, por exemplo). */
export async function atualizaPlantao(
  db: Executor,
  id: number,
  e: PlantaoInput,
  agora = Date.now(),
): Promise<boolean> {
  const r = await db.runAsync(
    `UPDATE plantoes SET
       local_id = ?, inicio = ?, fim = ?, valor_bruto = ?, desconto_percentual = ?,
       status = ?, observacao = ?, atualizado_em = ?
     WHERE id = ?`,
    [e.localId, e.inicio, e.fim, e.valorBruto, e.descontoPercentual, e.status, observacao(e.observacao), agora, id],
  );
  return r.changes > 0;
}

/** Atalho da lista do dia: muda so a situacao, sem abrir o formulario. */
export async function mudaStatusPlantao(
  db: Executor,
  id: number,
  status: StatusPlantao,
  agora = Date.now(),
): Promise<boolean> {
  const r = await db.runAsync("UPDATE plantoes SET status = ?, atualizado_em = ? WHERE id = ?", [status, agora, id]);
  return r.changes > 0;
}

export async function excluiPlantao(db: Executor, id: number): Promise<boolean> {
  const r = await db.runAsync("DELETE FROM plantoes WHERE id = ?", [id]);
  return r.changes > 0;
}

/** Quantos plantoes existem num local; base para decidir sobre excluir/arquivar. */
export async function contaPlantoesDoLocal(db: Executor, localId: number): Promise<number> {
  const l = await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) AS total FROM plantoes WHERE local_id = ?", [localId]);
  return l?.total ?? 0;
}

/** Local do plantao lancado mais recentemente: vira a sugestao do proximo lancamento. */
export async function ultimoLocalUsado(db: Executor): Promise<number | null> {
  const l = await db.getFirstAsync<{ local_id: number }>(
    "SELECT local_id FROM plantoes ORDER BY criado_em DESC, id DESC LIMIT 1",
  );
  return l?.local_id ?? null;
}
