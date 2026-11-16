/**
 * Acesso aos dados do Financeiro. Mesma regra das outras camadas: depende de
 * `Executor`, nao do `expo-sqlite`, para os testes rodarem os mesmos comandos.
 */
import { erroDataRecebimento, type PlantaoFinanceiro } from "../lib/financeiro.ts";
import type { StatusPlantao } from "../lib/plantoes.ts";
import type { AjusteDiaUtil, TipoRegra } from "../lib/pagamento.ts";
import type { Executor } from "./locais.ts";

interface Linha {
  id: number;
  local_id: number;
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  status: StatusPlantao;
  pago_em: number | null;
  local_nome: string;
  local_apelido: string | null;
  local_cor: string;
  regra_tipo: TipoRegra;
  regra_dia_pagamento: number | null;
  regra_dias_apos: number | null;
  regra_dia_fechamento: number | null;
  regra_meses_adiante: number;
  ajuste_dia_util: AjusteDiaUtil;
}

/**
 * Todo plantao que ainda pode render dinheiro (agendado ou realizado), com a
 * regra de pagamento do local. Inclui locais arquivados: o que eles devem
 * continua devido. Cancelado e trocado ficam de fora.
 *
 * Sem janela de datas de proposito: um atraso de seis meses precisa aparecer.
 */
export async function listaPlantoesFinanceiro(db: Executor): Promise<PlantaoFinanceiro[]> {
  const linhas = await db.getAllAsync<Linha>(
    `SELECT p.id, p.local_id, p.inicio, p.fim, p.valor_bruto, p.desconto_percentual,
            p.status, p.pago_em,
            l.nome AS local_nome, l.apelido AS local_apelido, l.cor AS local_cor,
            l.regra_tipo, l.regra_dia_pagamento, l.regra_dias_apos,
            l.regra_dia_fechamento, l.regra_meses_adiante, l.ajuste_dia_util
       FROM plantoes p
       JOIN locais l ON l.id = p.local_id
      WHERE p.status IN ('agendado', 'realizado')
      ORDER BY p.inicio, p.id`,
  );

  return linhas.map((l) => ({
    id: l.id,
    localId: l.local_id,
    inicio: l.inicio,
    fim: l.fim,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    status: l.status,
    pagoEm: l.pago_em,
    local: {
      nome: l.local_nome,
      apelido: l.local_apelido,
      cor: l.local_cor,
      regra: {
        tipo: l.regra_tipo,
        diaPagamento: l.regra_dia_pagamento,
        diasApos: l.regra_dias_apos,
        diaFechamento: l.regra_dia_fechamento,
        mesesAdiante: l.regra_meses_adiante,
        ajusteDiaUtil: l.ajuste_dia_util,
      },
    },
  }));
}

/** Abaixo do limite de variaveis do SQLite (999 nas versoes antigas), com folga para os outros parametros. */
const LOTE = 400;

function emLotes<T>(itens: readonly T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += LOTE) lotes.push(itens.slice(i, i + LOTE));
  return lotes;
}

const marcas = (n: number) => Array(n).fill("?").join(", ");

export interface ResultadoBaixa {
  /** Plantoes marcados como recebidos agora. */
  baixados: number;
  /** Ja estavam pagos, ou sao cancelados/trocados, ou nao existem: ficaram como estavam. */
  ignorados: number;
}

/**
 * Da baixa: marca os plantoes como recebidos em `pagoEm`. E o que um deposito
 * do hospital faz — um pagamento cobre varios plantoes de uma vez.
 *
 * Quem recebeu, trabalhou: plantao so agendado passa a realizado. Plantao que
 * ja esta pago nao e tocado (a data do primeiro recebimento vale), e cancelado
 * ou trocado nao tem o que receber. Tudo ou nada: se um lote falha, nenhum
 * plantao fica marcado.
 */
export async function baixaPlantoes(
  db: Executor,
  ids: readonly number[],
  pagoEm: number,
  agora = Date.now(),
): Promise<ResultadoBaixa> {
  const erro = erroDataRecebimento(pagoEm, agora);
  if (erro) throw new Error(erro);

  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return { baixados: 0, ignorados: 0 };

  return db.transacao(async (ex) => {
    let baixados = 0;
    for (const lote of emLotes(unicos)) {
      const r = await ex.runAsync(
        `UPDATE plantoes
            SET pago_em = ?, status = 'realizado', atualizado_em = ?
          WHERE id IN (${marcas(lote.length)})
            AND pago_em IS NULL
            AND status IN ('agendado', 'realizado')`,
        [pagoEm, agora, ...lote],
      );
      baixados += r.changes;
    }
    return { baixados, ignorados: unicos.length - baixados };
  });
}

/**
 * Desfaz a baixa (o deposito nao caiu, ou foi marcado errado). Os plantoes
 * seguem realizados, so deixam de constar como recebidos. Devolve quantos
 * deixaram de estar pagos.
 */
export async function desfazBaixa(db: Executor, ids: readonly number[], agora = Date.now()): Promise<number> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return 0;

  return db.transacao(async (ex) => {
    let desfeitos = 0;
    for (const lote of emLotes(unicos)) {
      const r = await ex.runAsync(
        `UPDATE plantoes SET pago_em = NULL, atualizado_em = ?
          WHERE id IN (${marcas(lote.length)}) AND pago_em IS NOT NULL`,
        [agora, ...lote],
      );
      desfeitos += r.changes;
    }
    return desfeitos;
  });
}
