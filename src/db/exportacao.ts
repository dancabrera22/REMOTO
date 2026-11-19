/**
 * Leitura dos plantoes para exportar. Mesma regra das outras camadas: depende
 * de `Executor`, nao do `expo-sqlite`.
 */
import type { LinhaExportacao } from "../lib/exportacao.ts";
import type { AjusteDiaUtil, TipoRegra } from "../lib/pagamento.ts";
import type { StatusPlantao } from "../lib/plantoes.ts";
import type { Executor } from "./locais.ts";

interface Linha {
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  status: StatusPlantao;
  pago_em: number | null;
  observacao: string | null;
  serie_id: number | null;
  unidade: string | null;
  local_nome: string;
  regra_tipo: TipoRegra;
  regra_dia_pagamento: number | null;
  regra_dias_apos: number | null;
  regra_dia_fechamento: number | null;
  regra_meses_adiante: number;
  ajuste_dia_util: AjusteDiaUtil;
}

/** Todos os plantoes (de qualquer situacao) do ano, ou de todos os anos se `ano` for `null`, em ordem de data. */
export async function listaPlantoesParaExportar(db: Executor, ano: number | null): Promise<LinhaExportacao[]> {
  const filtro = ano === null ? "" : "WHERE p.inicio >= ? AND p.inicio < ?";
  const params = ano === null ? [] : [new Date(ano, 0, 1).getTime(), new Date(ano + 1, 0, 1).getTime()];

  const linhas = await db.getAllAsync<Linha>(
    `SELECT p.inicio, p.fim, p.valor_bruto, p.desconto_percentual, p.status, p.pago_em, p.observacao, p.serie_id, p.unidade,
            l.nome AS local_nome, l.regra_tipo, l.regra_dia_pagamento, l.regra_dias_apos,
            l.regra_dia_fechamento, l.regra_meses_adiante, l.ajuste_dia_util
       FROM plantoes p
       JOIN locais l ON l.id = p.local_id
       ${filtro}
      ORDER BY p.inicio, p.id`,
    params,
  );

  return linhas.map((l) => ({
    inicio: l.inicio,
    fim: l.fim,
    localNome: l.local_nome,
    unidade: l.unidade,
    status: l.status,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    pagoEm: l.pago_em,
    observacao: l.observacao,
    emEscala: l.serie_id !== null,
    regra: {
      tipo: l.regra_tipo,
      diaPagamento: l.regra_dia_pagamento,
      diasApos: l.regra_dias_apos,
      diaFechamento: l.regra_dia_fechamento,
      mesesAdiante: l.regra_meses_adiante,
      ajusteDiaUtil: l.ajuste_dia_util,
    },
  }));
}

/** Os anos em que ha plantao, do mais novo ao mais antigo (para escolher o que exportar). */
export async function anosComPlantoes(db: Executor): Promise<number[]> {
  const l = await db.getFirstAsync<{ minimo: number | null; maximo: number | null }>(
    "SELECT MIN(inicio) AS minimo, MAX(inicio) AS maximo FROM plantoes",
  );
  if (!l || l.minimo === null || l.maximo === null) return [];
  const de = new Date(l.minimo).getFullYear();
  const ate = new Date(l.maximo).getFullYear();
  return Array.from({ length: ate - de + 1 }, (_, k) => ate - k);
}
