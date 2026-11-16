/**
 * O calendario do aparelho, pelo `expo-calendar`.
 *
 * Camada fina de proposito: tudo que e decisao (o que criar, quando atualizar)
 * esta em `db/calendario.ts` e e testado em Node. Aqui so se traduz para as
 * chamadas do modulo nativo, que so existe no Android/iOS.
 *
 * Importa de `expo-calendar/legacy`: as funcoes de mesmo nome exportadas pelo
 * pacote principal viraram avisos de migracao que LANCAM erro ao serem chamadas.
 */
import type { CalendarioDisponivel, PermissaoCalendario, ProvedorCalendario } from "@/db/calendario";
import type { EventoCalendario } from "./calendario";

type Modulo = typeof import("expo-calendar/legacy");

let carregando: Promise<Modulo> | null = null;
/** Carrega o modulo so quando preciso: na web ele nao existe e importa-lo cedo quebraria a tela. */
const modulo = (): Promise<Modulo> => (carregando ??= import("expo-calendar/legacy"));

function fusoHorario(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

function detalhes(C: Modulo, e: EventoCalendario) {
  return {
    title: e.titulo,
    startDate: new Date(e.inicio),
    endDate: new Date(e.fim),
    location: e.local ?? undefined,
    notes: e.notas,
    timeZone: fusoHorario(),
    // Lista vazia tambem vale: ao atualizar, e o que tira um lembrete que existia.
    alarms: e.lembreteMin === null ? [] : [{ relativeOffset: -e.lembreteMin, method: C.AlarmMethod.ALERT }],
  };
}

async function existe(C: Modulo, id: string): Promise<boolean> {
  try {
    await C.getEventAsync(id);
    return true;
  } catch {
    return false;
  }
}

export function criaProvedorExpo(): ProvedorCalendario {
  const traduzPermissao = (p: { granted: boolean; canAskAgain: boolean }): PermissaoCalendario =>
    p.granted ? "concedida" : p.canAskAgain ? "pergunta" : "negada";

  return {
    async permissao() {
      return traduzPermissao(await (await modulo()).getCalendarPermissionsAsync());
    },

    async pedePermissao() {
      return traduzPermissao(await (await modulo()).requestCalendarPermissionsAsync());
    },

    async listaCalendarios() {
      const C = await modulo();
      const todos = await C.getCalendarsAsync(C.EntityTypes.EVENT);
      return todos
        .filter((c) => c.allowsModifications)
        .map<CalendarioDisponivel>((c) => ({
          id: c.id,
          nome: c.title,
          conta: c.source?.name ?? c.ownerAccount ?? null,
          cor: c.color ?? null,
          principal: c.isPrimary === true,
        }))
        .sort((a, b) => Number(b.principal) - Number(a.principal) || (a.conta ?? "").localeCompare(b.conta ?? "") || a.nome.localeCompare(b.nome));
    },

    async existeCalendario(id) {
      const C = await modulo();
      const todos = await C.getCalendarsAsync(C.EntityTypes.EVENT);
      return todos.some((c) => c.id === id && c.allowsModifications);
    },

    async idsDeEventos(calendarioId, de, ate) {
      const C = await modulo();
      const eventos = await C.getEventsAsync([calendarioId], new Date(de), new Date(ate));
      return new Set(eventos.map((e) => e.id));
    },

    async criaEvento(calendarioId, evento) {
      const C = await modulo();
      return C.createEventAsync(calendarioId, detalhes(C, evento));
    },

    async atualizaEvento(eventoId, evento) {
      const C = await modulo();
      if (!(await existe(C, eventoId))) return false;
      await C.updateEventAsync(eventoId, detalhes(C, evento));
      return true;
    },

    async apagaEvento(eventoId) {
      const C = await modulo();
      if (!(await existe(C, eventoId))) return; // ja nao existe: o que se queria foi feito
      await C.deleteEventAsync(eventoId);
    },
  };
}
