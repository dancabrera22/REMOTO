/**
 * Calendario de mentira, em memoria.
 *
 * Serve a dois fins: os testes da sincronizacao (que assim rodam em Node, sem
 * celular) e a versao web de desenvolvimento, onde nao existe calendario do
 * aparelho (ver `calendario-provedor.ts`). Guarda tudo que um calendario de
 * verdade guardaria e deixa injetar falhas.
 */
import type { CalendarioDisponivel, PermissaoCalendario, ProvedorCalendario } from "../db/calendario.ts";
import type { EventoCalendario } from "./calendario.ts";

export interface EventoGuardado extends EventoCalendario {
  id: string;
  calendarioId: string;
}

export interface CalendarioFalso extends ProvedorCalendario {
  calendarios: CalendarioDisponivel[];
  eventos: Map<string, EventoGuardado>;
  permissaoAtual: PermissaoCalendario;
  /** O que `pedePermissao` responde (a pessoa tocou em Permitir ou em Negar). */
  respostaDoPedido: PermissaoCalendario;
  /** Quantas operacoes de escrita ja rodaram (criar, atualizar, apagar). */
  escritas: number;
  /** Quantas operacoes simultaneas ja houve no maximo (detecta sincronizacao em paralelo). */
  maximoSimultaneas: number;
  /** Falha na N-esima escrita (1 = a primeira); `Infinity` = nunca. */
  falhaNaEscrita: number;
  /** Ate quando as chamadas demoram, em ms (para provar que nao se sobrepoem). */
  latencia: number;
  /** Roda no meio de uma sincronizacao (ao listar os eventos): simula a pessoa mexendo nos plantoes enquanto ela anda. */
  aoListarEventos: (() => void | Promise<void>) | null;
}

export function criaCalendarioFalso(calendarios?: CalendarioDisponivel[]): CalendarioFalso {
  let proximo = 1;
  let simultaneas = 0;

  const f: CalendarioFalso = {
    calendarios: calendarios ?? [
      { id: "cal-1", nome: "Pessoal", conta: "pessoa@gmail.com", cor: "#2F6FED", principal: true },
      { id: "cal-2", nome: "Trabalho", conta: "pessoa@gmail.com", cor: "#1E9E5B", principal: false },
    ],
    eventos: new Map(),
    permissaoAtual: "concedida",
    respostaDoPedido: "concedida",
    escritas: 0,
    maximoSimultaneas: 0,
    falhaNaEscrita: Infinity,
    latencia: 0,
    aoListarEventos: null,

    async permissao() {
      return f.permissaoAtual;
    },
    async pedePermissao() {
      if (f.permissaoAtual !== "concedida") f.permissaoAtual = f.respostaDoPedido;
      return f.permissaoAtual;
    },
    async listaCalendarios() {
      return f.calendarios.map((c) => ({ ...c }));
    },
    async existeCalendario(id) {
      return f.calendarios.some((c) => c.id === id);
    },
    async idsDeEventos(calendarioId, de, ate) {
      await f.aoListarEventos?.();
      await passo();
      return new Set([...f.eventos.values()].filter((e) => e.calendarioId === calendarioId && e.fim >= de && e.inicio <= ate).map((e) => e.id));
    },
    async criaEvento(calendarioId, ev) {
      await escreve();
      if (!f.calendarios.some((c) => c.id === calendarioId)) throw new Error("Calendário inexistente.");
      const id = `ev-${proximo++}`;
      f.eventos.set(id, { ...ev, id, calendarioId });
      return id;
    },
    async atualizaEvento(eventoId, ev) {
      await escreve();
      const atual = f.eventos.get(eventoId);
      if (!atual) return false;
      f.eventos.set(eventoId, { ...ev, id: eventoId, calendarioId: atual.calendarioId });
      return true;
    },
    async apagaEvento(eventoId) {
      await escreve();
      f.eventos.delete(eventoId);
    },
  };

  async function passo() {
    simultaneas += 1;
    f.maximoSimultaneas = Math.max(f.maximoSimultaneas, simultaneas);
    try {
      if (f.latencia > 0) await new Promise((r) => setTimeout(r, f.latencia));
    } finally {
      simultaneas -= 1;
    }
  }

  async function escreve() {
    f.escritas += 1;
    if (f.escritas === f.falhaNaEscrita) throw new Error(`falha injetada na escrita ${f.escritas}`);
    await passo();
  }

  return f;
}
