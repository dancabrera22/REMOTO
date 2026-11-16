/**
 * Datas e horas em pt-BR.
 *
 * Instantes trafegam e sao gravados como epoch em milissegundos; a exibicao
 * sempre acontece no fuso do aparelho. Para agrupar e indexar por dia usamos a
 * "chave do dia" (`2026-11-14`), calculada no fuso local — e o que faz
 * "plantoes de 14/11" significar o que o usuario espera, e nao um intervalo UTC
 * deslocado em tres horas.
 *
 * Como em `money.ts`, nada de `Intl`: os nomes de mes e dia da semana estao
 * aqui, garantindo saida identica em qualquer aparelho.
 */

export const diasSemanaMinimo = ["D", "S", "T", "Q", "Q", "S", "S"] as const;
export const diasSemanaCurto = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const diasSemanaLongo = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

export const mesesCurto = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
] as const;

export const mesesLongo = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
] as const;

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/* ------------------------------- formatacao ------------------------------- */

export function formatData(ms: number): string {
  const d = new Date(ms);
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDataCurta(ms: number): string {
  const d = new Date(ms);
  return `${doisDigitos(d.getDate())} ${mesesCurto[d.getMonth()]}`;
}

export function formatDiaSemana(ms: number): string {
  return diasSemanaCurto[new Date(ms).getDay()];
}

export function formatDiaSemanaLongo(ms: number): string {
  return diasSemanaLongo[new Date(ms).getDay()];
}

export function formatHora(ms: number): string {
  const d = new Date(ms);
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

export function formatMesAno(ms: number): string {
  const d = new Date(ms);
  return `${mesesLongo[d.getMonth()]} de ${d.getFullYear()}`;
}

export function formatMesAnoCurto(ms: number): string {
  const d = new Date(ms);
  return `${mesesCurto[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * "07:00 → 19:00", e "19:00 → 07:00 +1" quando o plantao vira a madrugada —
 * caso comum o bastante para merecer marcacao propria em vez de confundir.
 */
export function formatIntervalo(inicioMs: number, fimMs: number): string {
  const viraDia = !mesmoDia(inicioMs, fimMs);
  return `${formatHora(inicioMs)} → ${formatHora(fimMs)}${viraDia ? " +1" : ""}`;
}

export function minutosEntre(inicioMs: number, fimMs: number): number {
  return Math.max(0, Math.round((fimMs - inicioMs) / 60000));
}

export function formatDuracao(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (!h) return `${m}min`;
  return m ? `${h}h${doisDigitos(m)}` : `${h}h`;
}

/* ------------------------------- aritmetica ------------------------------- */

export function inicioDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function fimDoDia(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function somaDias(ms: number, dias: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + dias);
  return d.getTime();
}

/**
 * Soma meses preservando o dia quando possivel. 31/01 + 1 mes vira 28/02 (ou
 * 29/02), e nao 03/03 como o `setMonth` cru faria — exatamente o que se espera
 * de uma regra do tipo "paga no dia 31".
 */
export function somaMeses(ms: number, meses: number): number {
  const d = new Date(ms);
  const diaDesejado = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  d.setDate(Math.min(diaDesejado, diasNoMes(d.getFullYear(), d.getMonth())));
  return d.getTime();
}

export function diasNoMes(ano: number, mes0: number): number {
  return new Date(ano, mes0 + 1, 0).getDate();
}

export function inicioDoMes(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
}

export function fimDoMes(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
}

export function mesmoDia(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  );
}

/** Instante local correspondente a uma data e hora, sem passar por UTC. */
export function instante(ano: number, mes0: number, dia: number, hora = 0, minuto = 0): number {
  return new Date(ano, mes0, dia, hora, minuto, 0, 0).getTime();
}

/* --------------------------- chave do dia (indice) --------------------------- */

export function chaveDia(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

export function deChaveDia(chave: string): number {
  const [ano, mes, dia] = chave.split("-").map(Number);
  return instante(ano, mes - 1, dia);
}

/* ------------------------------ grade do mes ------------------------------ */

export interface CelulaDia {
  /** Meia-noite local do dia. */
  ms: number;
  chave: string;
  dia: number;
  /** Dia de um mes vizinho, mostrado para completar a semana. */
  foraDoMes: boolean;
  hoje: boolean;
  fimDeSemana: boolean;
}

/**
 * Semanas completas cobrindo o mes de `referenciaMs`, comecando no domingo.
 *
 * Recebe um instante qualquer dentro do mes em vez de (ano, mes) de proposito:
 * indice de mes base zero e uma das fontes classicas de erro de calendario, e
 * nao ter que escolher no ponto de chamada elimina a categoria inteira.
 */
export function gradeDoMes(referenciaMs: number, hojeMs = Date.now()): CelulaDia[][] {
  const base = new Date(referenciaMs);
  const ano = base.getFullYear();
  const mes0 = base.getMonth();

  const primeiro = new Date(ano, mes0, 1);
  const inicio = somaDias(primeiro.getTime(), -primeiro.getDay());

  const semanas: CelulaDia[][] = [];
  let cursor = inicio;

  // Seis semanas cobrem qualquer mes; paramos antes se a ultima ficou vazia.
  for (let semana = 0; semana < 6; semana++) {
    const linha: CelulaDia[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      linha.push({
        ms: cursor,
        chave: chaveDia(cursor),
        dia: d.getDate(),
        foraDoMes: d.getMonth() !== mes0,
        hoje: mesmoDia(cursor, hojeMs),
        fimDeSemana: d.getDay() === 0 || d.getDay() === 6,
      });
      cursor = somaDias(cursor, 1);
    }
    semanas.push(linha);
    if (linha.every((c) => c.foraDoMes) && semana >= 4) {
      semanas.pop();
      break;
    }
  }

  return semanas;
}

/**
 * O dia que fica selecionado ao abrir um mes: hoje, se for o mes de hoje; senao, o dia 1.
 * Mora aqui (e nao na tela) porque duas partes precisam concordar: a agenda, que
 * seleciona o dia, e o calendario, que mostra esse dia no mes que entra deslizando
 * — assim o destaque chega junto com o mes, em vez de aparecer so depois.
 */
export function diaAoAbrirMes(mesMs: number, hojeMs: number): number {
  return inicioDoMes(mesMs) === inicioDoMes(hojeMs) ? inicioDoDia(hojeMs) : inicioDoMes(mesMs);
}

/** Quantas semanas a grade do mes tem (4, 5 ou 6) — a mesma conta de `gradeDoMes`, sem montar as celulas. */
export function linhasDoMes(mesMs: number): number {
  const d = new Date(mesMs);
  const primeiroDia = new Date(d.getFullYear(), d.getMonth(), 1).getDay();
  return Math.ceil((primeiroDia + diasNoMes(d.getFullYear(), d.getMonth())) / 7);
}

/** Altura de um mes de `linhas` semanas, sendo `alturaDaLinha` a de uma semana e `espaco` o vao entre elas. */
export function alturaDoMes(linhas: number, alturaDaLinha: number, espaco: number): number {
  return linhas * alturaDaLinha + Math.max(0, linhas - 1) * espaco;
}

/** O inverso: dada a altura medida de um mes, quanto mede cada semana. */
export function alturaDaLinha(alturaMedida: number, linhas: number, espaco: number): number {
  return (alturaMedida - Math.max(0, linhas - 1) * espaco) / Math.max(1, linhas);
}

/** "hoje", "amanhã", "em 3 dias", "há 2 dias" — para listas e avisos. */
export function diasRelativos(ms: number, hojeMs = Date.now()): string {
  const diff = Math.round((inicioDoDia(ms) - inicioDoDia(hojeMs)) / 86400000);
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff === -1) return "ontem";
  if (diff > 1) return `em ${diff} dias`;
  return `há ${Math.abs(diff)} dias`;
}
