/**
 * Acesso aos plantoes. Mesma regra da camada de locais: depende de `Executor`,
 * nao do `expo-sqlite`, para os testes rodarem os mesmos comandos SQL do app.
 */
import {
  normalizaObservacao,
  normalizaUnidade,
  sugestoesDeUnidade,
  type PlantaoComLocal,
  type PlantaoInput,
  type StatusPlantao,
  type SugestaoDeUnidade,
} from "../lib/plantoes.ts";
import type { Executor } from "./locais.ts";
import { apagaPlantaoRegistrando, recalculaExcecao } from "./series.ts";

interface Linha {
  id: number;
  local_id: number;
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  status: StatusPlantao;
  observacao: string | null;
  unidade: string | null;
  criado_em: number;
  atualizado_em: number;
  serie_id: number | null;
  ocorrencia_dia: number | null;
  excecao: number;
  pago_em: number | null;
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
    unidade: l.unidade,
    inicio: l.inicio,
    fim: l.fim,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    status: l.status,
    observacao: l.observacao,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    serieId: l.serie_id,
    ocorrenciaDia: l.ocorrencia_dia,
    excecao: l.excecao === 1,
    pagoEm: l.pago_em,
    local: {
      nome: l.local_nome,
      apelido: l.local_apelido,
      cor: l.local_cor,
      arquivado: l.local_arquivado_em !== null,
    },
  };
}

const observacao = normalizaObservacao;

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
       local_id, unidade, inicio, fim, valor_bruto, desconto_percentual,
       status, observacao, criado_em, atualizado_em
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.localId,
      normalizaUnidade(e.unidade),
      e.inicio,
      e.fim,
      e.valorBruto,
      e.descontoPercentual,
      e.status,
      observacao(e.observacao),
      agora,
      agora,
    ],
  );
  return r.lastInsertRowId;
}

/**
 * `false` quando o plantao nao existe (apagado em outra tela, por exemplo).
 *
 * Se o plantao vem de uma escala, a situacao dele em relacao a escala e
 * recalculada: diferente do modelo vira "excecao" (edicoes em serie passam a
 * respeita-lo); igual ao modelo volta a fazer parte da escala.
 */
export async function atualizaPlantao(
  db: Executor,
  id: number,
  e: PlantaoInput,
  agora = Date.now(),
): Promise<boolean> {
  return db.transacao(async (ex) => {
    const r = await ex.runAsync(
      `UPDATE plantoes SET
         local_id = ?, unidade = ?, inicio = ?, fim = ?, valor_bruto = ?, desconto_percentual = ?,
         status = ?, observacao = ?, atualizado_em = ?,
         pago_em = CASE WHEN ? = 'realizado' THEN pago_em ELSE NULL END
       WHERE id = ?`,
      [
        e.localId,
        normalizaUnidade(e.unidade),
        e.inicio,
        e.fim,
        e.valorBruto,
        e.descontoPercentual,
        e.status,
        observacao(e.observacao),
        agora,
        e.status,
        id,
      ],
    );
    if (r.changes === 0) return false;
    await recalculaExcecao(ex, id);
    return true;
  });
}

/** Atalho da lista do dia: muda so a situacao, sem abrir o formulario. */
export async function mudaStatusPlantao(
  db: Executor,
  id: number,
  status: StatusPlantao,
  agora = Date.now(),
): Promise<boolean> {
  // Pago implica realizado: sair de "realizado" apaga a data do pagamento.
  const r = await db.runAsync(
    "UPDATE plantoes SET status = ?, atualizado_em = ?, pago_em = CASE WHEN ? = 'realizado' THEN pago_em ELSE NULL END WHERE id = ?",
    [status, agora, status, id],
  );
  return r.changes > 0;
}

/**
 * Marca o plantao como pago (`pagoEm` = quando o dinheiro entrou) ou desfaz
 * (`null`). Marcar como pago confirma o plantao: se estava so agendado, vira
 * realizado, pois ninguem recebe por um plantao que nao aconteceu. Cancelado e
 * trocado nao tem o que receber: devolve `false`.
 */
export async function marcaPagamento(
  db: Executor,
  id: number,
  pagoEm: number | null,
  agora = Date.now(),
): Promise<boolean> {
  if (pagoEm === null) {
    const r = await db.runAsync("UPDATE plantoes SET pago_em = NULL, atualizado_em = ? WHERE id = ?", [agora, id]);
    return r.changes > 0;
  }
  const r = await db.runAsync(
    "UPDATE plantoes SET pago_em = ?, status = 'realizado', atualizado_em = ? WHERE id = ? AND status IN ('agendado', 'realizado')",
    [pagoEm, agora, id],
  );
  return r.changes > 0;
}

/**
 * Exclui UM plantao. Se ele veio de uma escala, a ocorrencia fica registrada
 * como pulada: sem isso a agenda a recriaria na proxima vez que estendesse o
 * calendario. Para apagar varios da escala, ver `excluiDaSerie`.
 */
export async function excluiPlantao(db: Executor, id: number): Promise<boolean> {
  return db.transacao((ex) => apagaPlantaoRegistrando(ex, id));
}

/** Quantos plantoes existem num local; base para decidir sobre excluir/arquivar. */
export async function contaPlantoesDoLocal(db: Executor, localId: number): Promise<number> {
  const l = await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) AS total FROM plantoes WHERE local_id = ?", [localId]);
  return l?.total ?? 0;
}

/**
 * As unidades ja usadas num local (da mais recente para a mais antiga), cada uma com o
 * ultimo valor lancado: o formulario sugere o nome e ja preenche o valor. Le os 500
 * plantoes mais recentes com unidade — de sobra para uma agenda de anos.
 */
export async function unidadesDoLocal(db: Executor, localId: number): Promise<SugestaoDeUnidade[]> {
  const linhas = await db.getAllAsync<{
    unidade: string;
    inicio: number;
    fim: number;
    valor_bruto: number;
    status: StatusPlantao;
  }>(
    `SELECT unidade, inicio, fim, valor_bruto, status
       FROM plantoes
      WHERE local_id = ? AND unidade IS NOT NULL AND status IN ('agendado', 'realizado')
      ORDER BY inicio DESC, id DESC
      LIMIT 500`,
    [localId],
  );
  return sugestoesDeUnidade(
    linhas.map((l) => ({
      unidade: l.unidade,
      inicio: l.inicio,
      fim: l.fim,
      valorBruto: l.valor_bruto,
      status: l.status,
    })),
  );
}

/** Local do plantao lancado mais recentemente: vira a sugestao do proximo lancamento. */
export async function ultimoLocalUsado(db: Executor): Promise<number | null> {
  const l = await db.getFirstAsync<{ local_id: number }>(
    "SELECT local_id FROM plantoes ORDER BY criado_em DESC, id DESC LIMIT 1",
  );
  return l?.local_id ?? null;
}
