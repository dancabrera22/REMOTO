/**
 * Lembretes do proprio app: uma notificacao antes de cada plantao.
 *
 * Funcoes puras, sem banco e sem o modulo nativo. Aqui vive so a parte que decide O QUE deve
 * estar agendado: quais plantoes ganham aviso, quando ele toca e o que diz. A sincronizacao
 * (db/lembretes.ts) conversa com o sistema por uma interface, e os testes usam um sistema falso.
 *
 * O desenho e SEM ESTADO: o que ja esta agendado no aparelho e comparado com o que deveria estar,
 * pelo identificador. O identificador carrega o plantao, a hora do aviso e uma impressao digital do
 * texto — se qualquer coisa que a pessoa veria muda (horario, unidade, endereco...), o
 * identificador muda, o aviso antigo e cancelado e o novo e agendado. Nao ha mapa para ficar
 * desatualizado, e uma rodada que falhou no meio e terminada pela seguinte.
 */
import { formatData, formatDiaSemana, fimDoDia, somaDias } from "./datetime.ts";
import { descreveHorario, tituloDoPlantao } from "./plantoes.ts";

/** So os plantoes que comecam dentro deste prazo ganham aviso agendado: a agenda se refaz a cada abertura do app. */
export const HORIZONTE_LEMBRETES_DIAS = 45;

/** Teto de avisos agendados ao mesmo tempo (os mais proximos primeiro). */
export const MAXIMO_LEMBRETES = 150;

/** Todo identificador de aviso do app comeca assim; o resto (o aviso de teste, por exemplo) nao e mexido. */
export const PREFIXO_LEMBRETE = "lp:";

export const ANTECEDENCIAS: readonly { minutos: number | null; rotulo: string }[] = [
  { minutos: null, rotulo: "Sem lembrete" },
  { minutos: 30, rotulo: "30 min antes" },
  { minutos: 60, rotulo: "1 h antes" },
  { minutos: 120, rotulo: "2 h antes" },
  { minutos: 1440, rotulo: "1 dia antes" },
];

export const ANTECEDENCIA_PADRAO_MIN = 60;

/** "30 min", "1 h", "2 h", "1 dia": o tempo que falta, como o aviso o escreve. */
export function tempoFalta(minutos: number): string {
  if (minutos % 1440 === 0) return `${minutos / 1440} ${minutos === 1440 ? "dia" : "dias"}`;
  if (minutos % 60 === 0) return `${minutos / 60} h`;
  return `${minutos} min`;
}

/* ---------------------------------- config ---------------------------------- */

export interface ConfigLembretes {
  /** Minutos antes do plantao; `null` = lembretes desligados. */
  antecedenciaMin: number | null;
  ultimaSincronizacao: number | null;
  ultimoErro: string | null;
}

export function serializaConfigLembretes(c: ConfigLembretes): string {
  return JSON.stringify(c);
}

/** Le o que esta guardado; texto estragado vira `null` (como se nunca tivesse sido ligado). */
export function leConfigLembretes(texto: string | null): ConfigLembretes | null {
  if (!texto) return null;
  try {
    const x = JSON.parse(texto) as Partial<ConfigLembretes> | null;
    if (typeof x !== "object" || x === null) return null;
    return {
      antecedenciaMin: typeof x.antecedenciaMin === "number" && Number.isFinite(x.antecedenciaMin) && x.antecedenciaMin > 0 ? x.antecedenciaMin : null,
      ultimaSincronizacao: typeof x.ultimaSincronizacao === "number" ? x.ultimaSincronizacao : null,
      ultimoErro: typeof x.ultimoErro === "string" ? x.ultimoErro : null,
    };
  } catch {
    return null;
  }
}

/* --------------------------------- planejar --------------------------------- */

/** O plantao com o necessario do local para virar aviso. */
export interface PlantaoParaLembrete {
  id: number;
  unidade?: string | null;
  inicio: number;
  fim: number;
  /** Se informado, so "agendado" ganha aviso. */
  status?: string;
  local: { nome: string; endereco: string | null };
}

export interface LembretePlanejado {
  id: string;
  plantaoId: number;
  /** Instante em que o aviso toca. */
  quando: number;
  titulo: string;
  corpo: string;
}

/** Impressao digital curta (FNV-1a, 32 bits) do texto: igual se o texto e igual, diferente se muda. */
export function impressaoDigital(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function idDoLembrete(plantaoId: number, quando: number, titulo: string, corpo: string): string {
  return `${PREFIXO_LEMBRETE}${plantaoId}:${quando}:${impressaoDigital(`${titulo}\n${corpo}`)}`;
}

export function ehLembreteDoApp(id: string): boolean {
  return id.startsWith(PREFIXO_LEMBRETE);
}

/**
 * O texto do aviso. O VALOR nao entra: a notificacao aparece com a tela bloqueada, e dinheiro nao
 * e coisa para se ler por cima do ombro de ninguem.
 */
export function montaLembrete(p: PlantaoParaLembrete, antecedenciaMin: number): { titulo: string; corpo: string } {
  const titulo = `Plantão em ${tempoFalta(antecedenciaMin)} — ${tituloDoPlantao({ unidade: p.unidade, local: { nome: p.local.nome } })}`;
  const linhas = [`${formatDiaSemana(p.inicio)}, ${formatData(p.inicio).slice(0, 5)} · ${descreveHorario(p.inicio, p.fim)}`];
  const endereco = p.local.endereco?.trim();
  if (endereco) linhas.push(endereco);
  return { titulo, corpo: linhas.join("\n") };
}

/**
 * Os avisos que deveriam estar agendados agora: plantoes agendados que comecam dentro do prazo e
 * cujo aviso ainda esta no futuro (um plantao daqui a 20 minutos nao ganha o "1 h antes").
 * Os mais proximos primeiro, ate o teto.
 */
export function planejaLembretes(
  plantoes: readonly PlantaoParaLembrete[],
  antecedenciaMin: number | null,
  agora = Date.now(),
): LembretePlanejado[] {
  if (antecedenciaMin === null || !(antecedenciaMin > 0)) return [];
  const limite = fimDoDia(somaDias(agora, HORIZONTE_LEMBRETES_DIAS));

  const itens: LembretePlanejado[] = [];
  for (const p of plantoes) {
    if (p.status !== undefined && p.status !== "agendado") continue;
    if (p.inicio > limite) continue;
    const quando = p.inicio - antecedenciaMin * 60_000;
    if (quando <= agora) continue;
    const { titulo, corpo } = montaLembrete(p, antecedenciaMin);
    itens.push({ id: idDoLembrete(p.id, quando, titulo, corpo), plantaoId: p.id, quando, titulo, corpo });
  }
  itens.sort((a, b) => a.quando - b.quando || a.plantaoId - b.plantaoId);
  return itens.slice(0, MAXIMO_LEMBRETES);
}

export interface DiferencaDeLembretes {
  criar: LembretePlanejado[];
  /** Identificadores agendados que nao devem mais existir (so os do app). */
  cancelar: string[];
}

/** O que falta criar e o que sobrou, comparando o que deveria estar agendado com o que esta. */
export function diferencaDeLembretes(desejados: readonly LembretePlanejado[], agendados: readonly string[]): DiferencaDeLembretes {
  const doApp = agendados.filter(ehLembreteDoApp);
  const tem = new Set(doApp);
  const quer = new Set(desejados.map((d) => d.id));
  return {
    criar: desejados.filter((d) => !tem.has(d.id)),
    cancelar: [...new Set(doApp)].filter((id) => !quer.has(id)),
  };
}
