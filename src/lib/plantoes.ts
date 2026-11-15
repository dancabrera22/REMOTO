/**
 * Plantoes: modelo, horarios, validacao e as contas da agenda.
 *
 * Sem banco, sem tela. Tudo que o formulario valida, a agenda soma e o
 * calendario pinta passa por aqui, e roda em Node nos testes.
 */
import { chaveDia, fimDoMes, formatDuracao, formatIntervalo, inicioDoMes, instante, minutosEntre } from "./datetime.ts";
import type { Local } from "./locais.ts";
import { valorEstimado, valorLiquido } from "./locais.ts";
import type { Centavos } from "./money.ts";

export type StatusPlantao = "agendado" | "realizado" | "cancelado" | "trocado";

export const STATUS_PLANTAO: readonly StatusPlantao[] = ["agendado", "realizado", "cancelado", "trocado"];

export const ROTULO_STATUS: Record<StatusPlantao, string> = {
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
  trocado: "Trocado",
};

export const DESCRICAO_STATUS: Record<StatusPlantao, string> = {
  agendado: "Ainda vai acontecer.",
  realizado: "Você trabalhou. Conta no que vai receber.",
  cancelado: "Não aconteceu. Não conta no que vai receber.",
  trocado: "Outra pessoa cobriu. Não conta no que vai receber.",
};

/** So plantoes que aconteceram (ou vao acontecer) entram em horas e valores. */
export function contaNoValor(status: StatusPlantao): boolean {
  return status === "agendado" || status === "realizado";
}

export interface PlantaoInput {
  localId: number;
  inicio: number;
  fim: number;
  valorBruto: Centavos;
  /** Copiado do local no lancamento; ver a migracao 2. */
  descontoPercentual: number;
  status: StatusPlantao;
  observacao: string | null;
}

export interface Plantao extends PlantaoInput {
  id: number;
  criadoEm: number;
  atualizadoEm: number;
}

/** O plantao com o necessario do local para desenhar a agenda sem outra consulta. */
export interface PlantaoComLocal extends Plantao {
  local: { nome: string; apelido: string | null; cor: string; arquivado: boolean };
}

export const LIMITE_OBSERVACAO = 300;
/** Plantao mais longo aceito: o formulario so monta ate 24 h, a validacao deixa folga. */
export const LIMITE_MINUTOS = 48 * 60;

/* --------------------------------- horarios --------------------------------- */

/**
 * "19:00" → 1140 (minutos desde a meia-noite). Devolve `null` para texto
 * incompleto ("19:0") ou impossivel ("25:00", "19:60").
 */
export function parseHora(texto: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 1140 → "19:00". */
export function formatHoraMin(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Mascara de digitacao: so os digitos contam e os dois pontos aparecem sozinhos.
 * "1" → "1", "19" → "19", "190" → "19:0", "1900" → "19:00". Quem digita nunca
 * precisa procurar a tecla de dois pontos.
 */
export function mascaraHora(texto: string): string {
  const d = texto.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** Minutos desde a meia-noite de um instante. */
export function minutosDoDia(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Instantes de inicio e fim de um plantao a partir do dia e dos dois horarios.
 *
 * Se o horario de saida nao vem depois do de entrada, o plantao termina no dia
 * seguinte: 19:00 → 07:00 e um noturno, e 07:00 → 07:00 e um de 24 horas. E a
 * unica regra de que um plantao de saude precisa — ninguem digita "dia seguinte".
 */
export function montaIntervalo(
  diaMs: number,
  inicioMin: number,
  fimMin: number,
): { inicio: number; fim: number; viraDia: boolean } {
  const d = new Date(diaMs);
  const [ano, mes, dia] = [d.getFullYear(), d.getMonth(), d.getDate()];
  const viraDia = fimMin <= inicioMin;
  return {
    inicio: instante(ano, mes, dia, Math.floor(inicioMin / 60), inicioMin % 60),
    fim: instante(ano, mes, dia + (viraDia ? 1 : 0), Math.floor(fimMin / 60), fimMin % 60),
    viraDia,
  };
}

/** "07:00 → 19:00 · 12h" / "19:00 → 07:00 +1 · 12h". */
export function descreveHorario(inicio: number, fim: number): string {
  return `${formatIntervalo(inicio, fim)} · ${formatDuracao(minutosEntre(inicio, fim))}`;
}

/** Atalhos dos turnos mais comuns; preenchem os dois horarios de uma vez. */
export const TURNOS_COMUNS = [
  { rotulo: "Diurno 7–19", inicio: 7 * 60, fim: 19 * 60 },
  { rotulo: "Noturno 19–7", inicio: 19 * 60, fim: 7 * 60 },
  { rotulo: "24 h", inicio: 7 * 60, fim: 7 * 60 },
  { rotulo: "Manhã 7–13", inicio: 7 * 60, fim: 13 * 60 },
  { rotulo: "Tarde 13–19", inicio: 13 * 60, fim: 19 * 60 },
] as const;

/* -------------------------------- validacao -------------------------------- */

export type ErrosPlantao = Partial<Record<"localId" | "horario" | "valorBruto" | "descontoPercentual" | "status" | "observacao", string>>;

export interface ResultadoValidacaoPlantao {
  erros: ErrosPlantao;
  /** Nao impedem salvar. */
  avisos: { conflito?: string };
}

/** Dois plantoes se sobrepoem quando cada um comeca antes de o outro terminar. */
function sobrepoe(a: { inicio: number; fim: number }, b: { inicio: number; fim: number }): boolean {
  return a.inicio < b.fim && b.inicio < a.fim;
}

/**
 * Plantoes que colidem com o intervalo. Cancelado e trocado nao ocupam o
 * horario, e plantoes encostados (um termina as 19h, o outro comeca as 19h)
 * nao colidem — e a escala 12x12 de sempre.
 */
export function conflitosCom(
  intervalo: { inicio: number; fim: number },
  existentes: readonly PlantaoComLocal[],
  ignoraId?: number,
): PlantaoComLocal[] {
  return existentes.filter((p) => p.id !== ignoraId && contaNoValor(p.status) && sobrepoe(intervalo, p));
}

export function validaPlantao(
  entrada: PlantaoInput,
  existentes: readonly PlantaoComLocal[] = [],
  ignoraId?: number,
): ResultadoValidacaoPlantao {
  const erros: ErrosPlantao = {};
  const avisos: ResultadoValidacaoPlantao["avisos"] = {};

  if (!Number.isInteger(entrada.localId) || entrada.localId <= 0) erros.localId = "Escolha o local.";

  const minutos = minutosEntre(entrada.inicio, entrada.fim);
  if (!Number.isFinite(entrada.inicio) || !Number.isFinite(entrada.fim) || entrada.fim <= entrada.inicio) {
    erros.horario = "O fim precisa vir depois do início.";
  } else if (minutos > LIMITE_MINUTOS) {
    erros.horario = "Plantão longo demais (máximo de 48 h).";
  }

  if (!Number.isInteger(entrada.valorBruto) || entrada.valorBruto < 0) erros.valorBruto = "O valor não pode ser negativo.";

  if (
    !Number.isFinite(entrada.descontoPercentual) ||
    entrada.descontoPercentual < 0 ||
    entrada.descontoPercentual > 100
  ) {
    erros.descontoPercentual = "Informe de 0% a 100%.";
  }

  if (!STATUS_PLANTAO.includes(entrada.status)) erros.status = "Situação inválida.";

  if ((entrada.observacao ?? "").length > LIMITE_OBSERVACAO) {
    erros.observacao = `Use até ${LIMITE_OBSERVACAO} caracteres.`;
  }

  if (!erros.horario && contaNoValor(entrada.status)) {
    const colide = conflitosCom(entrada, existentes, ignoraId);
    if (colide.length) {
      const p = colide[0];
      avisos.conflito = `Conflita com ${p.local.nome} (${descreveHorario(p.inicio, p.fim)}).`;
    }
  }

  return { erros, avisos };
}

export function temErrosPlantao(erros: ErrosPlantao): boolean {
  return Object.values(erros).some(Boolean);
}

/* ---------------------------------- valores ---------------------------------- */

/** Valor sugerido para um plantao neste local, nesta duracao. */
export function valorSugeridoPara(local: Pick<Local, "modoValor" | "valorPadrao">, inicio: number, fim: number): Centavos {
  return valorEstimado(local.modoValor, local.valorPadrao, minutosEntre(inicio, fim));
}

export function liquidoDoPlantao(p: Pick<PlantaoInput, "valorBruto" | "descontoPercentual">): Centavos {
  return valorLiquido(p.valorBruto, p.descontoPercentual);
}

/** Plantao que ja terminou mas continua "agendado": falta confirmar se aconteceu. */
export function precisaConfirmar(p: Pick<PlantaoInput, "status" | "fim">, agora = Date.now()): boolean {
  return p.status === "agendado" && p.fim < agora;
}

/* ---------------------------------- agenda ---------------------------------- */

export interface MarcadorDia {
  cores: string[];
}

/**
 * Cores para os pontinhos do calendario: uma por local, na ordem em que o dia
 * acontece, sem repetir. Cancelado e trocado nao pintam — o dia esta livre.
 * Um noturno marca so o dia em que comeca.
 */
export function marcadoresDoMes(plantoes: readonly PlantaoComLocal[]): Record<string, MarcadorDia> {
  const ordenados = [...plantoes].filter((p) => contaNoValor(p.status)).sort((a, b) => a.inicio - b.inicio || a.id - b.id);
  const mapa: Record<string, MarcadorDia> = {};
  for (const p of ordenados) {
    const chave = chaveDia(p.inicio);
    const marcador = (mapa[chave] ??= { cores: [] });
    if (!marcador.cores.includes(p.local.cor)) marcador.cores.push(p.local.cor);
  }
  return mapa;
}

export interface ResumoMes {
  plantoes: number;
  minutos: number;
  bruto: Centavos;
  liquido: Centavos;
  /** Ja terminaram e seguem "agendado": aguardam confirmacao. */
  aConfirmar: number;
}

/** Soma o que acontece no mes de `referenciaMs` (pelo dia de inicio de cada plantao). */
export function resumoDoMes(
  plantoes: readonly Pick<PlantaoInput, "inicio" | "fim" | "valorBruto" | "descontoPercentual" | "status">[],
  referenciaMs: number,
  agora = Date.now(),
): ResumoMes {
  const de = inicioDoMes(referenciaMs);
  const ate = fimDoMes(referenciaMs);
  const r: ResumoMes = { plantoes: 0, minutos: 0, bruto: 0, liquido: 0, aConfirmar: 0 };

  for (const p of plantoes) {
    if (p.inicio < de || p.inicio > ate || !contaNoValor(p.status)) continue;
    r.plantoes += 1;
    r.minutos += minutosEntre(p.inicio, p.fim);
    r.bruto += p.valorBruto;
    r.liquido += liquidoDoPlantao(p);
    if (precisaConfirmar(p, agora)) r.aConfirmar += 1;
  }
  return r;
}
