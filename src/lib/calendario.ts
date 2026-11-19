/**
 * Calendario do celular: o que um plantao vira como evento, e o que o app
 * guarda sobre a sincronizacao.
 *
 * Funcoes puras, sem banco e sem o modulo nativo. A sincronizacao (db/calendario.ts)
 * fala com o calendario por uma interface, e os testes usam um calendario falso;
 * aqui vive so a parte que decide o CONTEUDO do evento.
 *
 * A direcao e uma so: do app para o calendario. O plantao e a fonte da verdade.
 */
import { calculaDataRecebimento, type RegraPagamento } from "./pagamento.ts";
import { fimDoDia, formatData, inicioDoDia, somaDias } from "./datetime.ts";
import { formatBRL } from "./money.ts";
import { liquidoDoPlantao, tituloDoPlantao } from "./plantoes.ts";

/** Opcoes de lembrete: quantos minutos antes do plantao o calendario avisa. */
export const LEMBRETES: readonly { id: string; rotulo: string; minutos: number | null }[] = [
  { id: "nenhum", rotulo: "Sem lembrete", minutos: null },
  { id: "30", rotulo: "30 min antes", minutos: 30 },
  { id: "60", rotulo: "1 h antes", minutos: 60 },
  { id: "120", rotulo: "2 h antes", minutos: 120 },
  { id: "1440", rotulo: "1 dia antes", minutos: 1440 },
];

export const LEMBRETE_PADRAO_MIN = 60;

/** Quanto do passado e do futuro vai para o calendario. */
export const JANELA_PASSADO_DIAS = 30;
export const JANELA_FUTURO_DIAS = 180;

export function janelaDeSincronizacao(agora = Date.now()): { de: number; ate: number } {
  const hoje = inicioDoDia(agora);
  return { de: somaDias(hoje, -JANELA_PASSADO_DIAS), ate: fimDoDia(somaDias(hoje, JANELA_FUTURO_DIAS)) };
}

/** O que fica guardado sobre a ligacao com o calendario escolhido. */
export interface ConfigCalendario {
  calendarioId: string;
  calendarioNome: string;
  /** Conta dona do calendario (o e-mail do Google, por exemplo). */
  conta: string | null;
  /** Minutos antes do plantao; `null` = sem lembrete. */
  lembreteMin: number | null;
  /** Escreve o valor liquido e a data de recebimento na descricao do evento. */
  mostrarValor: boolean;
  ativadoEm: number;
  ultimaSincronizacao: number | null;
  ultimoErro: string | null;
}

export function serializaConfig(c: ConfigCalendario): string {
  return JSON.stringify(c);
}

/** Le a configuracao guardada; texto estragado ou incompleto vira `null` (como se nao houvesse). */
export function leConfig(texto: string | null): ConfigCalendario | null {
  if (!texto) return null;
  try {
    const x = JSON.parse(texto) as Partial<ConfigCalendario>;
    if (typeof x.calendarioId !== "string" || x.calendarioId === "") return null;
    return {
      calendarioId: x.calendarioId,
      calendarioNome: typeof x.calendarioNome === "string" ? x.calendarioNome : "Calendário",
      conta: typeof x.conta === "string" ? x.conta : null,
      lembreteMin: typeof x.lembreteMin === "number" && x.lembreteMin > 0 ? x.lembreteMin : null,
      mostrarValor: x.mostrarValor === true,
      ativadoEm: typeof x.ativadoEm === "number" ? x.ativadoEm : 0,
      ultimaSincronizacao: typeof x.ultimaSincronizacao === "number" ? x.ultimaSincronizacao : null,
      ultimoErro: typeof x.ultimoErro === "string" ? x.ultimoErro : null,
    };
  } catch {
    return null;
  }
}

/** O plantao com o necessario do local para virar evento. */
export interface PlantaoParaCalendario {
  id: number;
  /** Ver `PlantaoInput.unidade`: entra no titulo do evento ("Plantão · Itaim · Rede D'Or"). */
  unidade?: string | null;
  inicio: number;
  fim: number;
  valorBruto: number;
  descontoPercentual: number;
  observacao: string | null;
  local: { nome: string; apelido: string | null; endereco: string | null; regra: RegraPagamento };
}

export interface EventoCalendario {
  titulo: string;
  inicio: number;
  fim: number;
  /** Endereco do local, se houver: o calendario o transforma em link de mapa. */
  local: string | null;
  notas: string;
  lembreteMin: number | null;
}

export const RODAPE_NOTAS = "Criado pelo Meu Plantão";

export function montaEvento(p: PlantaoParaCalendario, cfg: Pick<ConfigCalendario, "lembreteMin" | "mostrarValor">): EventoCalendario {
  const linhas: string[] = [];
  if (p.observacao) linhas.push(p.observacao);

  // Dinheiro so aparece se a pessoa pediu: o calendario pode ser compartilhado.
  if (cfg.mostrarValor) {
    linhas.push(`Líquido: ${formatBRL(liquidoDoPlantao(p))}`);
    const quando = calculaDataRecebimento(p.local.regra, p.inicio);
    if (quando !== null) linhas.push(`Cai na conta: ${formatData(quando)}`);
  }
  linhas.push(RODAPE_NOTAS);

  return {
    // Sem o apelido de proposito: sem unidade o titulo continua o de sempre ("Plantão · Rede D'Or").
    titulo: `Plantão · ${tituloDoPlantao({ unidade: p.unidade, local: { nome: p.local.nome } })}`,
    inicio: p.inicio,
    fim: p.fim,
    local: p.local.endereco && p.local.endereco.trim() ? p.local.endereco.trim() : null,
    notas: linhas.join("\n"),
    lembreteMin: cfg.lembreteMin,
  };
}

/**
 * Impressao digital do que foi enviado: se igual a anterior, o evento ja esta
 * certo e nao se mexe nele (poupa chamadas ao calendario e nao sobrescreve nada
 * que a pessoa tenha ajustado la, enquanto o plantao nao mudar).
 */
export function assinaturaDoEvento(calendarioId: string, e: EventoCalendario): string {
  return JSON.stringify([calendarioId, e.titulo, e.inicio, e.fim, e.local, e.notas, e.lembreteMin]);
}

export function rotuloLembrete(minutos: number | null): string {
  return LEMBRETES.find((l) => l.minutos === minutos)?.rotulo ?? (minutos === null ? "Sem lembrete" : `${minutos} min antes`);
}
