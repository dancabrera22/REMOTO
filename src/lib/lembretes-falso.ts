/**
 * Notificacoes de mentira, em memoria.
 *
 * Servem a dois fins: os testes da sincronizacao dos lembretes (que assim rodam em Node, sem
 * celular) e a versao web de desenvolvimento, onde nao ha notificacao agendada do aparelho (ver
 * `lembretes-provedor.ts`). Guardam o que um sistema de verdade guardaria e deixam injetar falhas.
 */
import type { PermissaoLembretes, ProvedorLembretes } from "../db/lembretes.ts";
import { ehLembreteDoApp, type LembretePlanejado } from "./lembretes.ts";

export interface TesteEnviado {
  titulo: string;
  corpo: string;
  emSegundos: number;
}

export interface LembretesFalso extends ProvedorLembretes {
  agendados: Map<string, LembretePlanejado>;
  /** Tudo que ja foi agendado fora do prefixo do app (para provar que nao e tocado). */
  deOutros: Set<string>;
  testes: TesteEnviado[];
  /** Tudo que o app mandou agendar e cancelar, na ordem (para provar o que NAO foi pedido). */
  pedidosDeAgendar: string[];
  pedidosDeCancelar: string[];
  permissaoAtual: PermissaoLembretes;
  /** O que `pedePermissao` responde (a pessoa tocou em Permitir ou em Negar). */
  respostaDoPedido: PermissaoLembretes;
  /** Quantas operacoes de escrita ja rodaram (agendar e cancelar). */
  escritas: number;
  /** Falha na N-esima escrita (1 = a primeira); `Infinity` = nunca. */
  falhaNaEscrita: number;
  /** Falha ao listar o que esta agendado. */
  falhaAoListar: boolean;
}

export function criaLembretesFalso(): LembretesFalso {
  const f: LembretesFalso = {
    agendados: new Map(),
    deOutros: new Set(),
    testes: [],
    pedidosDeAgendar: [],
    pedidosDeCancelar: [],
    permissaoAtual: "concedida",
    respostaDoPedido: "concedida",
    escritas: 0,
    falhaNaEscrita: Infinity,
    falhaAoListar: false,

    async permissao() {
      return f.permissaoAtual;
    },
    async pedePermissao() {
      if (f.permissaoAtual !== "concedida") f.permissaoAtual = f.respostaDoPedido;
      return f.permissaoAtual;
    },
    async listaAgendados() {
      if (f.falhaAoListar) throw new Error("O sistema não respondeu.");
      return [...f.agendados.keys(), ...f.deOutros].filter(ehLembreteDoApp);
    },
    async agenda(l) {
      escreve();
      f.pedidosDeAgendar.push(l.id);
      f.agendados.set(l.id, { ...l });
    },
    async cancela(ids) {
      escreve();
      f.pedidosDeCancelar.push(...ids);
      for (const id of ids) {
        f.agendados.delete(id);
        f.deOutros.delete(id);
      }
    },
    async testeAgora(titulo, corpo, emSegundos) {
      f.testes.push({ titulo, corpo, emSegundos });
    },
  };

  function escreve() {
    f.escritas += 1;
    if (f.escritas === f.falhaNaEscrita) throw new Error(`falha injetada na escrita ${f.escritas}`);
  }

  return f;
}
