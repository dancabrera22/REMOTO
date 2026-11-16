/**
 * Feriados nacionais e dias sem expediente bancario.
 *
 * Existe por um motivo so: a data em que o dinheiro cai. Hospital paga por
 * transferencia em dia util, e "paga dia 20" numa sexta de Consciencia Negra
 * significa segunda-feira. Errar um dia aqui faz o app dizer "atrasado" para
 * quem so esta esperando a segunda.
 *
 * NAO cobre feriado estadual nem municipal (aniversario da cidade, padroeiro):
 * dependem de onde o plantao e, e nao ha tabela unica. Quem tem um caso desses
 * escolhe "manter a data" na regra do local.
 *
 * Funcao pura, sem banco nem tela. Imports com `.ts` para rodar em Node.
 */
import { chaveDia, inicioDoDia, instante, somaDias } from "./datetime.ts";

export interface Feriado {
  /** Meia-noite local do dia. */
  data: number;
  nome: string;
  /**
   * `nacional`: previsto em lei. `bancario`: ponto facultativo em que os bancos
   * nao abrem (Carnaval, Corpus Christi) e, por isso, nenhum pagamento compensa.
   */
  tipo: "nacional" | "bancario";
}

/**
 * Domingo de Pascoa (algoritmo gregoriano de Meeus/Jones/Butcher). Devolve o
 * mes (0-11) e o dia. As datas moveis do calendario brasileiro saem dele.
 */
export function pascoa(ano: number): { mes0: number; dia: number } {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); // 3 = marco, 4 = abril
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes0: mes - 1, dia };
}

/** Dia da Consciencia Negra virou feriado nacional em 2024 (Lei 14.759/2023). */
const ANO_CONSCIENCIA_NEGRA = 2024;

const cache = new Map<number, Map<string, Feriado>>();

/** Todos os feriados do ano, em ordem de data. */
export function feriadosDoAno(ano: number): Feriado[] {
  return [...tabelaDoAno(ano).values()].sort((x, y) => x.data - y.data);
}

function tabelaDoAno(ano: number): Map<string, Feriado> {
  const pronta = cache.get(ano);
  if (pronta) return pronta;

  const tabela = new Map<string, Feriado>();
  const poe = (data: number, nome: string, tipo: Feriado["tipo"]) => tabela.set(chaveDia(data), { data, nome, tipo });
  const fixo = (mes0: number, dia: number, nome: string) => poe(instante(ano, mes0, dia), nome, "nacional");

  fixo(0, 1, "Confraternização Universal");
  fixo(3, 21, "Tiradentes");
  fixo(4, 1, "Dia do Trabalho");
  fixo(8, 7, "Independência do Brasil");
  fixo(9, 12, "Nossa Senhora Aparecida");
  fixo(10, 2, "Finados");
  fixo(10, 15, "Proclamação da República");
  if (ano >= ANO_CONSCIENCIA_NEGRA) fixo(10, 20, "Consciência Negra");
  fixo(11, 25, "Natal");

  const { mes0, dia } = pascoa(ano);
  const domingoDePascoa = instante(ano, mes0, dia);
  poe(somaDias(domingoDePascoa, -2), "Sexta-feira Santa", "nacional");
  poe(somaDias(domingoDePascoa, -48), "Carnaval (segunda)", "bancario");
  poe(somaDias(domingoDePascoa, -47), "Carnaval (terça)", "bancario");
  poe(somaDias(domingoDePascoa, 60), "Corpus Christi", "bancario");

  cache.set(ano, tabela);
  return tabela;
}

/** O feriado do dia, ou `null`. */
export function feriadoEm(ms: number): Feriado | null {
  return tabelaDoAno(new Date(ms).getFullYear()).get(chaveDia(ms)) ?? null;
}

/** Segunda a sexta e nao feriado: dia em que o banco abre. */
export function ehDiaUtil(ms: number): boolean {
  const dia = new Date(ms).getDay();
  return dia !== 0 && dia !== 6 && feriadoEm(ms) === null;
}

/** O proprio dia, se for util; senao o primeiro util para a frente (`passo` = 1) ou para tras (-1). */
export function diaUtilMaisProximo(ms: number, passo: 1 | -1): number {
  let d = inicioDoDia(ms);
  // Feriados sao esparsos e fim de semana dura dois dias: o laco termina em poucos passos.
  while (!ehDiaUtil(d)) d = somaDias(d, passo);
  return d;
}
