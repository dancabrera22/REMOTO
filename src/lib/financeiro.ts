/**
 * Financeiro: quanto entra, quando, e o que esta atrasado.
 *
 * Funcoes puras sobre uma lista de plantoes ja lidos do banco. Cada plantao vira
 * um item com UMA situacao em relacao ao dinheiro:
 *
 *   recebido   o dinheiro caiu (`pagoEm`);
 *   atrasado   realizado, nao recebido, e o dia previsto pela regra do local ja passou;
 *   a_receber  realizado, nao recebido, dentro do prazo;
 *   previsto   ainda agendado: o app espera receber, mas o plantao nem foi confirmado.
 *
 * Cancelado e trocado nao tem o que receber e nem entram aqui.
 *
 * A data de um item no calendario financeiro e o dia em que o dinheiro CAIU
 * (se recebido) ou o dia previsto pela regra do local (se nao). O valor e o
 * liquido: o desconto do plantao ja foi abatido.
 */
import { chaveDia, fimDoMes, inicioDoDia, inicioDoMes, somaMeses } from "./datetime.ts";
import { calculaDataRecebimento, type RegraPagamento } from "./pagamento.ts";
import { chaveUnidade, contaNoValor, liquidoDoPlantao, normalizaUnidade, type StatusPlantao } from "./plantoes.ts";
import type { Centavos } from "./money.ts";

export type EstadoRecebimento = "recebido" | "atrasado" | "a_receber" | "previsto";

export const ROTULO_ESTADO: Record<EstadoRecebimento, string> = {
  recebido: "Recebido",
  atrasado: "Atrasado",
  a_receber: "A receber",
  previsto: "Previsto",
};

/** Do mais urgente ao menos: quando um grupo mistura situacoes, vale a primeira. */
const URGENCIA: readonly EstadoRecebimento[] = ["atrasado", "a_receber", "previsto", "recebido"];

/** O que a consulta do banco entrega por plantao (com o necessario do local). */
export interface PlantaoFinanceiro {
  id: number;
  localId: number;
  /** Ver `PlantaoInput.unidade`. */
  unidade?: string | null;
  inicio: number;
  fim: number;
  valorBruto: Centavos;
  descontoPercentual: number;
  status: StatusPlantao;
  pagoEm: number | null;
  local: { nome: string; apelido: string | null; cor: string; regra: RegraPagamento };
}

export interface ItemFinanceiro {
  id: number;
  localId: number;
  unidade: string | null;
  local: { nome: string; apelido: string | null; cor: string };
  inicio: number;
  fim: number;
  liquido: Centavos;
  status: StatusPlantao;
  pagoEm: number | null;
  /** O dia em que a regra do local manda pagar; `null` se a regra esta incompleta. */
  dataPrevista: number | null;
  /** O dia em que o item conta: o do recebimento, ou o previsto. `null` = sem previsao. */
  data: number | null;
  estado: EstadoRecebimento;
}

/** Monta os itens. `hoje` decide o que esta atrasado. */
export function itensFinanceiros(plantoes: readonly PlantaoFinanceiro[], hoje = Date.now()): ItemFinanceiro[] {
  const hojeDia = inicioDoDia(hoje);
  const itens: ItemFinanceiro[] = [];

  for (const p of plantoes) {
    if (!contaNoValor(p.status)) continue;

    const dataPrevista = calculaDataRecebimento(p.local.regra, p.inicio);
    let estado: EstadoRecebimento;
    if (p.pagoEm !== null) estado = "recebido";
    else if (p.status === "realizado") estado = dataPrevista !== null && dataPrevista < hojeDia ? "atrasado" : "a_receber";
    else estado = "previsto";

    itens.push({
      id: p.id,
      localId: p.localId,
      unidade: normalizaUnidade(p.unidade),
      local: { nome: p.local.nome, apelido: p.local.apelido, cor: p.local.cor },
      inicio: p.inicio,
      fim: p.fim,
      liquido: liquidoDoPlantao(p),
      status: p.status,
      pagoEm: p.pagoEm,
      dataPrevista,
      data: p.pagoEm !== null ? inicioDoDia(p.pagoEm) : dataPrevista,
      estado,
    });
  }
  return itens;
}

/* ---------------------------------- grupos ---------------------------------- */

/**
 * Plantoes do mesmo local que o mesmo pagamento cobre: e assim que o dinheiro
 * chega ("o hospital depositou o mes de outubro"), e assim que se da baixa.
 * Recebidos ficam em grupos proprios, pelo dia do recebimento.
 */
export interface GrupoRecebimento {
  chave: string;
  localId: number;
  local: ItemFinanceiro["local"];
  data: number;
  estado: EstadoRecebimento;
  itens: ItemFinanceiro[];
  total: Centavos;
  minutos: number;
}

/**
 * As unidades que um recebimento cobre, na ordem em que aparecem (uma vez cada, mesmo que
 * escritas de outro jeito). Vazio quando nenhum plantao do grupo tem unidade.
 */
export function unidadesDoGrupo(g: Pick<GrupoRecebimento, "itens">): string[] {
  const vistas = new Set<string>();
  const nomes: string[] = [];
  for (const i of g.itens) {
    const chave = chaveUnidade(i.unidade);
    if (!chave || vistas.has(chave)) continue;
    vistas.add(chave);
    nomes.push(i.unidade!);
  }
  return nomes;
}

export function agrupaRecebimentos(itens: readonly ItemFinanceiro[]): GrupoRecebimento[] {
  const mapa = new Map<string, GrupoRecebimento>();

  for (const item of itens) {
    if (item.data === null) continue;
    const recebido = item.estado === "recebido";
    const chave = `${item.localId}|${recebido ? "r" : "n"}|${chaveDia(item.data)}`;

    let g = mapa.get(chave);
    if (!g) {
      g = { chave, localId: item.localId, local: item.local, data: item.data, estado: item.estado, itens: [], total: 0, minutos: 0 };
      mapa.set(chave, g);
    }
    g.itens.push(item);
    g.total += item.liquido;
    g.minutos += Math.round((item.fim - item.inicio) / 60_000);
    if (URGENCIA.indexOf(item.estado) < URGENCIA.indexOf(g.estado)) g.estado = item.estado;
  }

  const grupos = [...mapa.values()];
  for (const g of grupos) g.itens.sort((a, b) => a.inicio - b.inicio || a.id - b.id);
  return grupos.sort((a, b) => a.data - b.data || a.local.nome.localeCompare(b.local.nome, "pt-BR") || a.localId - b.localId);
}

/* ---------------------------------- somas ---------------------------------- */

export interface ResumoFinanceiro {
  recebido: Centavos;
  /** Realizado e ainda nao recebido, dentro do prazo. */
  aReceber: Centavos;
  /** Realizado, nao recebido, prazo vencido. */
  atrasado: Centavos;
  /** Ainda agendado. */
  previsto: Centavos;
  /** O que ainda vai entrar: aReceber + atrasado + previsto. */
  aEntrar: Centavos;
  /** O mes inteiro: o que entrou mais o que ainda vai entrar. */
  total: Centavos;
  /** Quantos plantoes entram na conta. */
  plantoes: number;
}

const resumoVazio = (): ResumoFinanceiro => ({ recebido: 0, aReceber: 0, atrasado: 0, previsto: 0, aEntrar: 0, total: 0, plantoes: 0 });

function soma(itens: readonly ItemFinanceiro[]): ResumoFinanceiro {
  const r = resumoVazio();
  for (const i of itens) {
    r.plantoes += 1;
    if (i.estado === "recebido") r.recebido += i.liquido;
    else if (i.estado === "atrasado") r.atrasado += i.liquido;
    else if (i.estado === "a_receber") r.aReceber += i.liquido;
    else r.previsto += i.liquido;
  }
  r.aEntrar = r.aReceber + r.atrasado + r.previsto;
  r.total = r.recebido + r.aEntrar;
  return r;
}

/** Itens cuja data (de recebimento ou prevista) cai no mes de `mesMs`. */
export function itensDoMes(itens: readonly ItemFinanceiro[], mesMs: number): ItemFinanceiro[] {
  const de = inicioDoMes(mesMs);
  const ate = fimDoMes(mesMs);
  return itens.filter((i) => i.data !== null && i.data >= de && i.data <= ate);
}

export function resumoDoMesFinanceiro(itens: readonly ItemFinanceiro[], mesMs: number): ResumoFinanceiro {
  return soma(itensDoMes(itens, mesMs));
}

/** Tudo que esta atrasado, de qualquer mes. */
export function itensAtrasados(itens: readonly ItemFinanceiro[]): ItemFinanceiro[] {
  return itens.filter((i) => i.estado === "atrasado");
}

export interface ResumoAtrasos {
  plantoes: number;
  total: Centavos;
  /** O dia previsto mais antigo que ainda nao foi pago; `null` sem atrasos. */
  desde: number | null;
}

export function resumoDosAtrasos(itens: readonly ItemFinanceiro[]): ResumoAtrasos {
  const a = itensAtrasados(itens);
  return {
    plantoes: a.length,
    total: a.reduce((s, i) => s + i.liquido, 0),
    desde: a.reduce<number | null>((m, i) => (i.data === null ? m : m === null || i.data < m ? i.data : m), null),
  };
}

export interface PrevisaoMes {
  mes: number;
  resumo: ResumoFinanceiro;
}

/** O mes de `deMs` e os `quantos - 1` seguintes: a visao "como vem por ai". */
export function previsaoDosMeses(itens: readonly ItemFinanceiro[], deMs: number, quantos: number): PrevisaoMes[] {
  const base = inicioDoMes(deMs);
  return Array.from({ length: quantos }, (_, k) => {
    const mes = somaMeses(base, k);
    return { mes, resumo: resumoDoMesFinanceiro(itens, mes) };
  });
}

/* ------------------------------- data da baixa ------------------------------- */

/** Mensagem de erro se `pagoEm` nao pode ser a data de um recebimento; `null` se vale. */
export function erroDataRecebimento(pagoEm: number, agora = Date.now()): string | null {
  if (!Number.isFinite(pagoEm)) return "Informe a data em que o dinheiro caiu.";
  // Um dia de folga: "hoje" pode chegar como meia-noite de amanha em outro fuso.
  if (inicioDoDia(pagoEm) > inicioDoDia(agora)) return "A data do recebimento não pode ser no futuro.";
  return null;
}
