/**
 * Recorrencia: em que dias uma escala cai.
 *
 * Funcao pura, sem banco nem tela. Uma escala e uma REGRA (de que jeito se
 * repete) mais um MODELO (como e cada plantao: local, horario, valor). Daqui
 * sai so a primeira metade: dada a regra, quais sao os dias.
 *
 * Todo dia aqui e a meia-noite local (como em `datetime.ts`). A conta de dias
 * entre duas datas arredonda, entao uma mudanca de horario de verao no meio do
 * caminho nao desloca ocorrencia nenhuma.
 */
import {
  diasNoMes,
  formatData,
  formatDiaSemana,
  inicioDoDia,
  instante,
  somaDias,
} from "./datetime.ts";
import type { Centavos } from "./money.ts";
import { LIMITE_UNIDADE, montaIntervalo, normalizaUnidade, type PlantaoInput } from "./plantoes.ts";

export type TipoRecorrencia = "semanal" | "intervalo" | "mensal";

export interface RegraRecorrencia {
  tipo: TipoRecorrencia;
  /** Mascara dos dias da semana: bit 0 = domingo ... bit 6 = sabado. Usada em `semanal`. */
  diasSemana: number;
  /**
   * Passo da repeticao. `semanal`: a cada N semanas. `intervalo`: a cada N dias
   * (12x36 e a cada 2 dias, 24x72 a cada 4). `mensal`: a cada N meses.
   */
  cada: number;
  /** Dia do mes (1-31). Usado em `mensal`; 31 vira o ultimo dia nos meses curtos. */
  diaDoMes: number | null;
  /** Primeiro dia da escala (meia-noite local). */
  inicioDia: number;
  /** Ultimo dia possivel, inclusive, ou `null` para uma escala sem data final. */
  fimDia: number | null;
}

/** Como e cada plantao da escala. */
export interface ModeloSerie {
  localId: number;
  /** Ver `PlantaoInput.unidade`; todos os plantoes da escala a levam. */
  unidade: string | null;
  /** Minutos desde a meia-noite. Saida <= entrada significa que termina no dia seguinte. */
  inicioMin: number;
  fimMin: number;
  valorBruto: Centavos;
  descontoPercentual: number;
  observacao: string | null;
}

export interface SerieInput extends ModeloSerie {
  regra: RegraRecorrencia;
}

export interface Serie extends SerieInput {
  id: number;
  /** Ate que dia as ocorrencias ja viraram plantoes no banco. */
  geradoAte: number;
  criadoEm: number;
  atualizadoEm: number;
}

/* --------------------------------- limites --------------------------------- */

export const LIMITE_CADA: Record<TipoRecorrencia, number> = { semanal: 8, intervalo: 60, mensal: 12 };

/**
 * Ate onde a agenda cria plantoes de uma escala sem data final: tres anos a
 * partir de hoje. Alem disso nao ha o que ver, e criar linhas sem fim so para
 * "caso alguem olhe 2040" seria desperdicio.
 */
export const HORIZONTE_MAXIMO_DIAS = 3 * 365;

/** Quanto se materializa ao criar uma escala (a agenda estende sob demanda depois). */
export const HORIZONTE_INICIAL_DIAS = 180;

/** Teto de seguranca por chamada: nenhuma regra valida chega perto. */
const MAX_OCORRENCIAS = 5000;

/* ---------------------------- dias da semana (mascara) ---------------------------- */

export const TODOS_OS_DIAS = 0b1111111;
export const DIAS_UTEIS = 0b0111110; // segunda a sexta
export const FIM_DE_SEMANA = 0b1000001; // domingo e sabado

export const temDia = (mascara: number, diaSemana: number): boolean => ((mascara >> diaSemana) & 1) === 1;
export const alternaDia = (mascara: number, diaSemana: number): number => mascara ^ (1 << diaSemana);
export const contaDias = (mascara: number): number => [0, 1, 2, 3, 4, 5, 6].filter((d) => temDia(mascara, d)).length;

const NOMES_DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;

/** Dias entre duas meias-noites, arredondado: imune a horario de verao. */
export const diasEntre = (a: number, b: number): number => Math.round((b - a) / 86_400_000);

/* ------------------------------- ocorrencias ------------------------------- */

/**
 * Os dias (meia-noite local, em ordem) em que a regra cai entre `deMs` e `ateMs`,
 * ambos inclusive. Nunca devolve dia antes do inicio da escala nem depois da
 * data final.
 */
export function ocorrencias(regra: RegraRecorrencia, deMs: number, ateMs: number): number[] {
  if (!(regra.cada >= 1) || !Number.isInteger(regra.cada)) return [];

  const inicio = inicioDoDia(regra.inicioDia);
  const de = Math.max(inicioDoDia(deMs), inicio);
  let ate = inicioDoDia(ateMs);
  if (regra.fimDia !== null) ate = Math.min(ate, inicioDoDia(regra.fimDia));
  if (ate < de) return [];

  const saida: number[] = [];

  switch (regra.tipo) {
    case "intervalo": {
      const primeiro = Math.ceil(diasEntre(inicio, de) / regra.cada);
      for (let k = primeiro; saida.length < MAX_OCORRENCIAS; k++) {
        const d = somaDias(inicio, k * regra.cada);
        if (d > ate) break;
        saida.push(d);
      }
      break;
    }

    case "semanal": {
      // So os sete primeiros bits contam; sem nenhum, o laco abaixo nunca acharia dia.
      if ((regra.diasSemana & TODOS_OS_DIAS) === 0) return [];
      // "A cada 2 semanas" conta a partir da semana da PRIMEIRA ocorrencia, que
      // sempre entra (e nao a partir do dia em que a escala comecou, que pode nem
      // ser um dia da escala). A semana vai de segunda a domingo: assim sabado e
      // domingo ficam na mesma, e "fim de semana alternado" da sab+dom, sab+dom —
      // e nao sab, dom da semana seguinte, sab...
      let primeiro = inicio;
      while (!temDia(regra.diasSemana, new Date(primeiro).getDay())) primeiro = somaDias(primeiro, 1);
      const semanaBase = somaDias(primeiro, -((new Date(primeiro).getDay() + 6) % 7));
      for (let d = de; d <= ate && saida.length < MAX_OCORRENCIAS; d = somaDias(d, 1)) {
        if (!temDia(regra.diasSemana, new Date(d).getDay())) continue;
        if (Math.floor(diasEntre(semanaBase, d) / 7) % regra.cada === 0) saida.push(d);
      }
      break;
    }

    case "mensal": {
      if (regra.diaDoMes === null) return [];
      const base = new Date(inicio);
      for (let m = 0; saida.length < MAX_OCORRENCIAS; m += regra.cada) {
        const ref = new Date(base.getFullYear(), base.getMonth() + m, 1);
        // Dia 31 vale em todo mes: nos curtos e o ultimo dia.
        const dia = Math.min(regra.diaDoMes, diasNoMes(ref.getFullYear(), ref.getMonth()));
        const d = instante(ref.getFullYear(), ref.getMonth(), dia);
        if (d > ate) break;
        if (d >= de) saida.push(d);
      }
      break;
    }
  }

  return saida;
}

/** As primeiras `n` ocorrencias da escala, para a previa do formulario. */
export function proximasOcorrencias(regra: RegraRecorrencia, n: number): number[] {
  const inicio = inicioDoDia(regra.inicioDia);
  return ocorrencias(regra, inicio, somaDias(inicio, 800)).slice(0, n);
}

/** Um plantao concreto da escala num dia: o modelo aplicado a uma data. */
export function plantaoDaSerie(modelo: ModeloSerie, dia: number, status: PlantaoInput["status"] = "agendado"): PlantaoInput {
  const { inicio, fim } = montaIntervalo(dia, modelo.inicioMin, modelo.fimMin);
  return {
    localId: modelo.localId,
    unidade: normalizaUnidade(modelo.unidade),
    inicio,
    fim,
    valorBruto: modelo.valorBruto,
    descontoPercentual: modelo.descontoPercentual,
    status,
    observacao: modelo.observacao,
  };
}

/* -------------------------------- validacao -------------------------------- */

export type ErrosSerie = Partial<
  Record<"diasSemana" | "cada" | "diaDoMes" | "fimDia" | "localId" | "unidade" | "horario" | "valorBruto" | "descontoPercentual", string>
>;

export function validaSerie(s: SerieInput): ErrosSerie {
  const erros: ErrosSerie = {};
  const r = s.regra;

  if (!Number.isInteger(s.localId) || s.localId <= 0) erros.localId = "Escolha o local.";
  if ((s.unidade ?? "").replace(/\s+/g, " ").trim().length > LIMITE_UNIDADE) erros.unidade = `Use até ${LIMITE_UNIDADE} caracteres.`;
  if (
    !Number.isInteger(s.inicioMin) ||
    !Number.isInteger(s.fimMin) ||
    s.inicioMin < 0 ||
    s.inicioMin > 1439 ||
    s.fimMin < 0 ||
    s.fimMin > 1439
  ) {
    erros.horario = "Informe os dois horários.";
  }
  if (!Number.isInteger(s.valorBruto) || s.valorBruto < 0) erros.valorBruto = "O valor não pode ser negativo.";
  if (!Number.isFinite(s.descontoPercentual) || s.descontoPercentual < 0 || s.descontoPercentual > 100) {
    erros.descontoPercentual = "Informe de 0% a 100%.";
  }

  const limite = LIMITE_CADA[r.tipo];
  if (!Number.isInteger(r.cada) || r.cada < 1 || r.cada > limite) {
    erros.cada =
      r.tipo === "semanal"
        ? `Use de 1 a ${limite} semanas.`
        : r.tipo === "intervalo"
          ? `Use de 1 a ${limite} dias.`
          : `Use de 1 a ${limite} meses.`;
  }

  if (r.tipo === "semanal" && (!Number.isInteger(r.diasSemana) || r.diasSemana < 1 || r.diasSemana > TODOS_OS_DIAS)) {
    erros.diasSemana = "Escolha pelo menos um dia da semana.";
  }
  if (r.tipo === "mensal" && (r.diaDoMes === null || !Number.isInteger(r.diaDoMes) || r.diaDoMes < 1 || r.diaDoMes > 31)) {
    erros.diaDoMes = "Informe um dia entre 1 e 31.";
  }
  if (r.fimDia !== null && r.fimDia < r.inicioDia) erros.fimDia = "A data final não pode vir antes da primeira.";

  return erros;
}

export const temErrosSerie = (e: ErrosSerie): boolean => Object.values(e).some(Boolean);

/* -------------------------------- descricao -------------------------------- */

function listaPtBr(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** "Toda segunda e quarta", "A cada 2 dias", "Todo dia 15" — mais " · até 31/12/2026" se houver fim. */
export function descreveRecorrencia(r: RegraRecorrencia): string {
  let base: string;

  switch (r.tipo) {
    case "semanal": {
      const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => temDia(r.diasSemana, d));
      const nomes = listaPtBr(dias.map((d) => NOMES_DIA[d]!));

      if (dias.length === 0) {
        base = "Nenhum dia escolhido";
      } else if (r.cada > 1) {
        base = `A cada ${r.cada} semanas: ${nomes}`;
      } else if (r.diasSemana === TODOS_OS_DIAS) {
        base = "Todos os dias";
      } else if (r.diasSemana === DIAS_UTEIS) {
        base = "De segunda a sexta";
      } else if (r.diasSemana === FIM_DE_SEMANA) {
        base = "Sábados e domingos";
      } else if (dias.length === 1) {
        // domingo e sabado sao masculinos: "todo sabado", mas "toda terca".
        base = `${dias[0] === 0 || dias[0] === 6 ? "Todo" : "Toda"} ${nomes}`;
      } else {
        base = `Toda semana: ${nomes}`;
      }
      break;
    }

    case "intervalo":
      base = r.cada === 1 ? "Todo dia" : `A cada ${r.cada} dias`;
      break;

    case "mensal":
      base =
        r.diaDoMes === null
          ? "Todo mês"
          : r.cada === 1
            ? `Todo dia ${r.diaDoMes} do mês`
            : `A cada ${r.cada} meses, no dia ${r.diaDoMes}`;
      break;
  }

  return r.fimDia !== null ? `${base} · até ${formatData(r.fimDia)}` : base;
}

/* ---------------------------------- atalhos ---------------------------------- */

/** Escalas que todo mundo conhece: preenchem o passo da repeticao de uma vez. */
export const ESCALAS_COMUNS = [
  { id: "12x36", rotulo: "12×36", detalhe: "trabalha 12 h, folga 36 h: a cada 2 dias", cada: 2 },
  { id: "24x48", rotulo: "24×48", detalhe: "trabalha 24 h, folga 48 h: a cada 3 dias", cada: 3 },
  { id: "24x72", rotulo: "24×72", detalhe: "trabalha 24 h, folga 72 h: a cada 4 dias", cada: 4 },
] as const;

/* ------------------------- rascunho do formulario ------------------------- */

export type TipoRascunho = "nunca" | TipoRecorrencia;

/**
 * O que o formulario de repeticao guarda enquanto a pessoa digita: numeros como
 * texto (um campo vazio nao pode virar 0 no meio da digitacao) e escolhas que
 * ainda nao foram tocadas como `null`/vazio, para acompanharem a data do
 * plantao: trocar o dia no formulario nao deixa "toda terca" para tras.
 */
export interface RascunhoRepeticao {
  tipo: TipoRascunho;
  /** `null` = so o dia da semana da data do plantao. */
  diasSemana: number | null;
  cada: string;
  /** Vazio = o dia do mes da data do plantao. */
  diaDoMes: string;
  fimDia: number | null;
}

export function rascunhoInicial(): RascunhoRepeticao {
  return { tipo: "nunca", diasSemana: null, cada: "1", diaDoMes: "", fimDia: null };
}

/** O rascunho de uma escala que ja existe, para edita-la no mesmo formulario. */
export function rascunhoDaRegra(r: RegraRecorrencia): RascunhoRepeticao {
  return {
    tipo: r.tipo,
    diasSemana: r.tipo === "semanal" ? r.diasSemana : null,
    cada: String(r.cada),
    diaDoMes: r.tipo === "mensal" && r.diaDoMes !== null ? String(r.diaDoMes) : "",
    fimDia: r.fimDia,
  };
}

/** Dias da semana de fato escolhidos (a data do plantao, enquanto nada foi tocado). */
export function diasDoRascunho(r: RascunhoRepeticao, dataMs: number): number {
  return r.diasSemana ?? 1 << new Date(dataMs).getDay();
}

/**
 * A regra que o rascunho representa a partir de `inicioDia`, ou `null` quando
 * nao repete. Campos invalidos viram valores que `validaSerie` recusa (passo 0),
 * em vez de serem "corrigidos" em silencio.
 */
export function regraDoRascunho(r: RascunhoRepeticao, inicioDia: number): RegraRecorrencia | null {
  if (r.tipo === "nunca") return null;
  const inicio = inicioDoDia(inicioDia);
  return {
    tipo: r.tipo,
    diasSemana: r.tipo === "semanal" ? diasDoRascunho(r, inicio) : 0,
    cada: r.cada.trim() === "" ? 0 : Number(r.cada),
    diaDoMes: r.tipo === "mensal" ? (r.diaDoMes.trim() === "" ? new Date(inicio).getDate() : Number(r.diaDoMes)) : null,
    inicioDia: inicio,
    fimDia: r.fimDia === null ? null : inicioDoDia(r.fimDia),
  };
}

/** "ter 17/11" — as datas da previa de uma escala. */
export function formatDiaCurto(ms: number): string {
  return `${formatDiaSemana(ms)} ${formatData(ms).slice(0, 5)}`;
}
