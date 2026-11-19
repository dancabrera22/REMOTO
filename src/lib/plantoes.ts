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
  /**
   * O nome que a pessoa da ao lugar dentro do local ("Itaim", na rede Rede D'Or), ou `null`.
   * Digitado livremente; ver `normalizaUnidade`. O valor deste plantao e proprio dele.
   */
  unidade: string | null;
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
  /** De que escala veio (`null` = lancado avulso). */
  serieId: number | null;
  /**
   * O dia que a REGRA da escala deu a este plantao. Nao muda se ele for movido
   * para outra data: e a identidade dele dentro da escala.
   */
  ocorrenciaDia: number | null;
  /** `true` quando foi alterado so nele e difere do modelo da escala. */
  excecao: boolean;
  /** Quando o pagamento caiu (`null` = ainda nao recebeu). Implica status "realizado". */
  pagoEm: number | null;
}

/** O plantao com o necessario do local para desenhar a agenda sem outra consulta. */
export interface PlantaoComLocal extends Plantao {
  local: { nome: string; apelido: string | null; cor: string; arquivado: boolean };
}

export const LIMITE_UNIDADE = 60;

/** Unidade opcional: espacos repetidos viram um, vazia vira `null`, e o limite e aplicado antes de gravar. */
export function normalizaUnidade(valor: string | null | undefined): string | null {
  const t = (valor ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, LIMITE_UNIDADE).trim() : null;
}

/**
 * A chave pela qual duas grafias contam como a mesma unidade: sem acento, sem maiuscula,
 * sem espaco sobrando. "Itaim", "itaim " e "ITAIM" sao a mesma; "Itaim" e "Itaim 2" nao.
 */
export function chaveUnidade(valor: string | null | undefined): string {
  const n = normalizaUnidade(valor) ?? "";
  const semAcento = typeof n.normalize === "function" ? n.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : n;
  return semAcento.toLowerCase();
}

/**
 * Como o plantao se chama nas listas: "Itaim · Rede D'Or" (a unidade vem primeiro, e ela que
 * diz onde voce estara) ou so o local, como sempre foi, quando nao ha unidade.
 */
export function tituloDoPlantao(p: {
  unidade?: string | null;
  local: { nome: string; apelido?: string | null };
}): string {
  const u = normalizaUnidade(p.unidade);
  if (u) return `${u} · ${p.local.nome}`;
  return p.local.apelido ? `${p.local.nome} · ${p.local.apelido}` : p.local.nome;
}

export const LIMITE_OBSERVACAO = 300;

/** Observacao opcional: vazia vira `null` e o limite e aplicado antes de gravar. */
export function normalizaObservacao(valor: string | null): string | null {
  const t = (valor ?? "").trim();
  return t ? t.slice(0, LIMITE_OBSERVACAO) : null;
}
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

export type ErrosPlantao = Partial<
  Record<"localId" | "unidade" | "horario" | "valorBruto" | "descontoPercentual" | "status" | "observacao", string>
>;

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

  // Mede a unidade como o formulario a digita (espacos repetidos ja contam como um).
  if ((entrada.unidade ?? "").replace(/\s+/g, " ").trim().length > LIMITE_UNIDADE) {
    erros.unidade = `Use até ${LIMITE_UNIDADE} caracteres.`;
  }

  if (!erros.horario && contaNoValor(entrada.status)) {
    const colide = conflitosCom(entrada, existentes, ignoraId);
    if (colide.length) {
      const p = colide[0];
      avisos.conflito = `Conflita com ${tituloDoPlantao(p)} (${descreveHorario(p.inicio, p.fim)}).`;
    }
  }

  return { erros, avisos };
}

export function temErrosPlantao(erros: ErrosPlantao): boolean {
  return Object.values(erros).some(Boolean);
}

/* ---------------------------------- valores ---------------------------------- */

/* ----------------------- unidades: sugestoes e ultimo valor ----------------------- */

/** Um plantao ja lancado com unidade: o que as sugestoes do formulario leem. */
export interface UsoDeUnidade {
  unidade: string;
  inicio: number;
  fim: number;
  valorBruto: Centavos;
  status: StatusPlantao;
}

export interface SugestaoDeUnidade {
  /** A grafia do uso mais recente ("Itaim", mesmo que antes tenha sido "itaim"). */
  unidade: string;
  chave: string;
  /** Inicio do plantao mais recente dessa unidade. */
  ultimoUso: number;
  usos: number;
  /** O valor mais recente de cada duracao (em minutos): 12 h e 24 h na mesma unidade valem diferente. */
  valorPorMinutos: Record<number, Centavos>;
  /** O valor do uso mais recente, de qualquer duracao, e quantos minutos ele tinha. */
  ultimoValor: Centavos;
  ultimosMinutos: number;
}

/**
 * Agrupa os plantoes de um local por unidade, da mais recente para a mais antiga.
 * So conta o que aconteceu ou vai acontecer: cancelado e trocado nao dizem quanto vale.
 */
export function sugestoesDeUnidade(usos: readonly UsoDeUnidade[]): SugestaoDeUnidade[] {
  const ordenados = [...usos]
    .filter((u) => contaNoValor(u.status) && normalizaUnidade(u.unidade) !== null)
    .sort((a, b) => b.inicio - a.inicio);

  const mapa = new Map<string, SugestaoDeUnidade>();
  for (const u of ordenados) {
    const nome = normalizaUnidade(u.unidade)!;
    const chave = chaveUnidade(nome);
    const minutos = minutosEntre(u.inicio, u.fim);
    const atual = mapa.get(chave);
    if (!atual) {
      mapa.set(chave, {
        unidade: nome,
        chave,
        ultimoUso: u.inicio,
        usos: 1,
        valorPorMinutos: { [minutos]: u.valorBruto },
        ultimoValor: u.valorBruto,
        ultimosMinutos: minutos,
      });
      continue;
    }
    atual.usos += 1;
    // Veio do mais recente para o mais antigo: o primeiro valor visto de cada duracao e o mais novo.
    if (!(minutos in atual.valorPorMinutos)) atual.valorPorMinutos[minutos] = u.valorBruto;
  }
  return [...mapa.values()].sort(
    (a, b) => b.ultimoUso - a.ultimoUso || a.unidade.localeCompare(b.unidade, "pt-BR"),
  );
}

export type SituacaoDoRenomear = "vazio" | "igual" | "renomear" | "mesclar";

/**
 * O que acontece se a unidade `de` passar a se chamar `para`, olhando as outras unidades do local:
 *   vazio     o nome novo e vazio (nao serve);
 *   igual     o mesmo nome, nada a fazer;
 *   renomear  um nome livre — ou so a mesma unidade com outra grafia ("itaim" -> "Itaim");
 *   mesclar   ja existe OUTRA unidade com esse nome: os plantoes das duas viram uma so.
 */
export function situacaoDoRenomear(
  sugestoes: readonly Pick<SugestaoDeUnidade, "chave">[],
  de: string,
  para: string,
): SituacaoDoRenomear {
  const novo = normalizaUnidade(para);
  if (novo === null) return "vazio";
  if (novo === normalizaUnidade(de)) return "igual";
  const chaveNova = chaveUnidade(novo);
  if (chaveNova === chaveUnidade(de)) return "renomear";
  return sugestoes.some((s) => s.chave === chaveNova) ? "mesclar" : "renomear";
}

export type OrigemDoValor = "unidade" | "unidade_outra_duracao" | "local" | "nenhuma";

export interface ValorSugerido {
  valor: Centavos;
  origem: OrigemDoValor;
  /** De que duracao era o plantao de onde veio o valor (so quando veio de uma unidade). */
  minutos?: number;
}

/**
 * Que valor o formulario propoe. Em ordem: o ultimo valor daquela unidade NESSA duracao;
 * o ultimo valor da unidade, de outra duracao (a tela avisa que a duracao difere);
 * o valor padrao do local; nada. A pessoa pode trocar o valor de qualquer um deles.
 */
export function valorParaUnidade(opcoes: {
  unidade: string | null;
  inicio: number;
  fim: number;
  sugestoes: readonly SugestaoDeUnidade[];
  local: Pick<Local, "modoValor" | "valorPadrao"> | null;
}): ValorSugerido {
  const minutos = minutosEntre(opcoes.inicio, opcoes.fim);
  const chave = chaveUnidade(opcoes.unidade);
  const s = chave ? opcoes.sugestoes.find((x) => x.chave === chave) : undefined;
  if (s) {
    if (minutos in s.valorPorMinutos) return { valor: s.valorPorMinutos[minutos]!, origem: "unidade", minutos };
    return { valor: s.ultimoValor, origem: "unidade_outra_duracao", minutos: s.ultimosMinutos };
  }
  if (opcoes.local && opcoes.local.valorPadrao > 0) {
    return { valor: valorSugeridoPara(opcoes.local, opcoes.inicio, opcoes.fim), origem: "local" };
  }
  return { valor: 0, origem: "nenhuma" };
}

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
  /** Parte do liquido que ja caiu na conta (plantoes marcados como pagos). */
  recebido: Centavos;
  /** Ja terminaram e seguem "agendado": aguardam confirmacao. */
  aConfirmar: number;
}

/** Soma o que acontece no mes de `referenciaMs` (pelo dia de inicio de cada plantao). */
export function resumoDoMes(
  plantoes: readonly (Pick<PlantaoInput, "inicio" | "fim" | "valorBruto" | "descontoPercentual" | "status"> & {
    pagoEm?: number | null;
  })[],
  referenciaMs: number,
  agora = Date.now(),
): ResumoMes {
  const de = inicioDoMes(referenciaMs);
  const ate = fimDoMes(referenciaMs);
  const r: ResumoMes = { plantoes: 0, minutos: 0, bruto: 0, liquido: 0, recebido: 0, aConfirmar: 0 };

  for (const p of plantoes) {
    if (p.inicio < de || p.inicio > ate || !contaNoValor(p.status)) continue;
    r.plantoes += 1;
    r.minutos += minutosEntre(p.inicio, p.fim);
    r.bruto += p.valorBruto;
    r.liquido += liquidoDoPlantao(p);
    if (p.pagoEm != null) r.recebido += liquidoDoPlantao(p);
    if (precisaConfirmar(p, agora)) r.aConfirmar += 1;
  }
  return r;
}
