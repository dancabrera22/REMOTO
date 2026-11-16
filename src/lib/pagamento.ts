/**
 * Regra de pagamento de um local: responde "quando esse plantao vai ser pago".
 *
 * Funcao pura, sem banco nem tela. Nasceu na Etapa 2, porque o formulario de
 * local precisa mostrar na hora "um plantao hoje seria pago em tal dia" — quem
 * cadastra uma regra de fechamento (fecha dia 20, paga dia 10) so confia nela se
 * ver o resultado. A Etapa 5 usa a mesma funcao para a previsao financeira.
 *
 * Os imports levam `.ts` para o Node conseguir rodar este arquivo nos testes
 * sem empacotador.
 */
import { diasNoMes, inicioDoDia, instante, somaDias } from "./datetime.ts";
import { diaUtilMaisProximo } from "./feriados.ts";

export type TipoRegra = "dia_mes_seguinte" | "dias_apos" | "fechamento";
export type AjusteDiaUtil = "nenhum" | "proximo" | "anterior";

export interface RegraPagamento {
  tipo: TipoRegra;
  /** Dia do mes em que o pagamento cai (1-31). Usado por `dia_mes_seguinte` e `fechamento`. */
  diaPagamento: number | null;
  /** Dias corridos apos o plantao (0-365). Usado por `dias_apos`. */
  diasApos: number | null;
  /** Dia do mes em que o ciclo fecha (1-31). Usado por `fechamento`. */
  diaFechamento: number | null;
  /** Quantos meses depois do mes do plantao (ou do fechamento) o pagamento cai. */
  mesesAdiante: number;
  /** O que fazer quando a data cai em fim de semana ou feriado. */
  ajusteDiaUtil: AjusteDiaUtil;
}

export const REGRA_PADRAO: RegraPagamento = {
  tipo: "dia_mes_seguinte",
  diaPagamento: 10,
  diasApos: null,
  diaFechamento: null,
  mesesAdiante: 1,
  ajusteDiaUtil: "proximo",
};

/**
 * Dia `dia` do mes `mes0`, aceitando mes fora de 0-11 (13 vira janeiro do ano
 * seguinte) e prendendo o dia ao tamanho do mes: dia 31 em fevereiro e dia 28.
 * E o que faz "paga dia 31" funcionar em todos os meses.
 */
function diaNoMesClamp(ano: number, mes0: number, dia: number): number {
  const base = new Date(ano, mes0, 1);
  const a = base.getFullYear();
  const m = base.getMonth();
  return instante(a, m, Math.min(Math.max(dia, 1), diasNoMes(a, m)));
}

/**
 * Empurra sabado, domingo e feriado nacional (ou dia sem expediente bancario:
 * Carnaval, Corpus Christi) para o dia util mais proximo, para a frente ou para
 * tras. Feriado estadual e municipal nao entram: ver `feriados.ts`.
 */
export function ajustaDiaUtil(ms: number, modo: AjusteDiaUtil): number {
  if (modo === "nenhum") return ms;
  return diaUtilMaisProximo(ms, modo === "proximo" ? 1 : -1);
}

/**
 * Data prevista de recebimento de um plantao realizado em `plantaoMs`.
 * Devolve `null` quando a regra esta incompleta (campo obrigatorio vazio).
 */
export function calculaDataRecebimento(regra: RegraPagamento, plantaoMs: number): number | null {
  const d = new Date(plantaoMs);
  let data: number;

  switch (regra.tipo) {
    case "dia_mes_seguinte": {
      if (regra.diaPagamento === null) return null;
      data = diaNoMesClamp(d.getFullYear(), d.getMonth() + regra.mesesAdiante, regra.diaPagamento);
      break;
    }

    case "dias_apos": {
      if (regra.diasApos === null) return null;
      data = somaDias(inicioDoDia(plantaoMs), regra.diasApos);
      break;
    }

    case "fechamento": {
      if (regra.diaFechamento === null || regra.diaPagamento === null) return null;
      // Plantao ate o dia do fechamento (inclusive) entra no ciclo que fecha
      // neste mes; depois dele, no ciclo do mes seguinte. Fechamento dia 31
      // num mes de 30 dias dispensa tratamento: todo dia do mes e <= 31, entao
      // o ciclo naturalmente fecha no ultimo dia.
      const mesDoFechamento = d.getDate() <= regra.diaFechamento ? d.getMonth() : d.getMonth() + 1;
      data = diaNoMesClamp(d.getFullYear(), mesDoFechamento + regra.mesesAdiante, regra.diaPagamento);
      break;
    }
  }

  return ajustaDiaUtil(data, regra.ajusteDiaUtil);
}

/* ------------------------------- validacao ------------------------------- */

export type ErrosRegra = Partial<
  Record<"diaPagamento" | "diasApos" | "diaFechamento" | "mesesAdiante", string>
>;

const inteiroEntre = (n: number | null, min: number, max: number): n is number =>
  n !== null && Number.isInteger(n) && n >= min && n <= max;

export function validaRegra(regra: RegraPagamento): ErrosRegra {
  const erros: ErrosRegra = {};

  if (!inteiroEntre(regra.mesesAdiante, 0, 12)) {
    erros.mesesAdiante = "Use um número de 0 a 12 meses.";
  }

  if (regra.tipo === "dia_mes_seguinte" || regra.tipo === "fechamento") {
    if (!inteiroEntre(regra.diaPagamento, 1, 31)) {
      erros.diaPagamento = "Informe um dia entre 1 e 31.";
    }
  }

  if (regra.tipo === "dias_apos" && !inteiroEntre(regra.diasApos, 0, 365)) {
    erros.diasApos = "Informe de 0 a 365 dias.";
  }

  if (regra.tipo === "fechamento") {
    if (!inteiroEntre(regra.diaFechamento, 1, 31)) {
      erros.diaFechamento = "Informe um dia entre 1 e 31.";
    } else if (
      !erros.diaPagamento &&
      regra.mesesAdiante === 0 &&
      regra.diaPagamento !== null &&
      regra.diaPagamento <= regra.diaFechamento
    ) {
      // Pagar no mesmo mes do fechamento, num dia que vem antes dele, significa
      // pagar um ciclo que ainda nem fechou.
      erros.diaPagamento = "No mesmo mês, o pagamento precisa vir depois do fechamento.";
    }
  }

  return erros;
}

/* -------------------------------- descricao ------------------------------- */

function quandoMes(meses: number): string {
  if (meses === 0) return "no mesmo mês";
  if (meses === 1) return "do mês seguinte";
  return `${meses} meses depois`;
}

/** Frase curta para listas: "Paga dia 10 do mês seguinte". */
export function descreveRegra(regra: RegraPagamento): string {
  switch (regra.tipo) {
    case "dia_mes_seguinte":
      return regra.diaPagamento === null
        ? "Regra incompleta"
        : `Paga dia ${regra.diaPagamento} ${quandoMes(regra.mesesAdiante)}`;

    case "dias_apos": {
      if (regra.diasApos === null) return "Regra incompleta";
      if (regra.diasApos === 0) return "Paga no dia do plantão";
      return `Paga ${regra.diasApos} ${regra.diasApos === 1 ? "dia" : "dias"} após o plantão`;
    }

    case "fechamento":
      return regra.diaFechamento === null || regra.diaPagamento === null
        ? "Regra incompleta"
        : `Fecha dia ${regra.diaFechamento} · paga dia ${regra.diaPagamento} ${quandoMes(regra.mesesAdiante)}`;
  }
}

export function descreveAjuste(ajuste: AjusteDiaUtil): string {
  switch (ajuste) {
    case "nenhum":
      return "Mantém a data, mesmo em fim de semana ou feriado";
    case "proximo":
      return "Fim de semana ou feriado passa para o próximo dia útil";
    case "anterior":
      return "Fim de semana ou feriado volta para o dia útil anterior";
  }
}
