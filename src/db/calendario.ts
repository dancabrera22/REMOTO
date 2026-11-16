/**
 * Sincronizacao dos plantoes com o calendario do celular.
 *
 * O calendario e acessado por `ProvedorCalendario`, uma interface pequena: no
 * aparelho ela e implementada sobre o `expo-calendar`, nos testes sobre um
 * calendario falso em memoria. Assim a logica que importa — quando criar,
 * atualizar, remover e recuperar-se de falha — roda e e provada em Node.
 *
 * Principios:
 *  - Uma direcao so: o plantao manda, o calendario obedece.
 *  - Idempotente: rodar duas vezes seguidas nao muda nada na segunda. Falhou no
 *    meio? A proxima rodada termina o servico. Nao existe "transacao" no
 *    calendario do aparelho, entao o desenho evita precisar dela: o mapa
 *    plantao -> evento so e gravado DEPOIS de o evento existir.
 *  - So mexe no que e seu: apenas eventos que o app criou (e que estao no mapa).
 */
import {
  assinaturaDoEvento,
  janelaDeSincronizacao,
  leConfig,
  montaEvento,
  serializaConfig,
  type ConfigCalendario,
  type EventoCalendario,
  type PlantaoParaCalendario,
} from "../lib/calendario.ts";
import type { AjusteDiaUtil, TipoRegra } from "../lib/pagamento.ts";
import type { Executor } from "./locais.ts";

/* -------------------------------- o calendario -------------------------------- */

export interface CalendarioDisponivel {
  id: string;
  nome: string;
  /** Conta dona (e-mail do Google, "Local"...). */
  conta: string | null;
  cor: string | null;
  principal: boolean;
}

/** `pergunta`: a pessoa ainda nao decidiu e o app pode pedir. `negada`: so as configuracoes do sistema resolvem. */
export type PermissaoCalendario = "concedida" | "negada" | "pergunta";

export interface ProvedorCalendario {
  permissao(): Promise<PermissaoCalendario>;
  pedePermissao(): Promise<PermissaoCalendario>;
  /** So calendarios em que o app pode escrever. */
  listaCalendarios(): Promise<CalendarioDisponivel[]>;
  existeCalendario(id: string): Promise<boolean>;
  /** Ids dos eventos do calendario que tocam o periodo (para notar o que a pessoa apagou la). */
  idsDeEventos(calendarioId: string, de: number, ate: number): Promise<Set<string>>;
  criaEvento(calendarioId: string, evento: EventoCalendario): Promise<string>;
  /** `false` se o evento nao existe mais no calendario. */
  atualizaEvento(eventoId: string, evento: EventoCalendario): Promise<boolean>;
  /** Idempotente: apagar o que ja nao existe nao e erro. */
  apagaEvento(eventoId: string): Promise<void>;
}

/* ---------------------------------- config ---------------------------------- */

const CHAVE = "calendario";

export async function lerConfigCalendario(db: Executor): Promise<ConfigCalendario | null> {
  const l = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM config WHERE chave = ?", [CHAVE]);
  return leConfig(l?.valor ?? null);
}

async function gravaConfig(db: Executor, cfg: ConfigCalendario | null): Promise<void> {
  if (cfg === null) await db.runAsync("DELETE FROM config WHERE chave = ?", [CHAVE]);
  else await db.runAsync("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)", [CHAVE, serializaConfig(cfg)]);
}

/* ------------------------------------ mapa ------------------------------------ */

interface LinhaMapa {
  plantao_id: number;
  calendario_id: string;
  evento_id: string;
  assinatura: string;
  sincronizado_em: number;
}

export async function contaEventosMapeados(db: Executor): Promise<number> {
  const l = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM eventos_calendario");
  return l?.n ?? 0;
}

async function guardaMapa(db: Executor, plantaoId: number, calendarioId: string, eventoId: string, assinatura: string, agora: number) {
  await db.runAsync(
    "INSERT OR REPLACE INTO eventos_calendario (plantao_id, calendario_id, evento_id, assinatura, sincronizado_em) VALUES (?, ?, ?, ?, ?)",
    [plantaoId, calendarioId, eventoId, assinatura, agora],
  );
}

/* --------------------------------- consulta --------------------------------- */

interface LinhaPlantao {
  id: number;
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  observacao: string | null;
  local_nome: string;
  local_apelido: string | null;
  local_endereco: string | null;
  regra_tipo: TipoRegra;
  regra_dia_pagamento: number | null;
  regra_dias_apos: number | null;
  regra_dia_fechamento: number | null;
  regra_meses_adiante: number;
  ajuste_dia_util: AjusteDiaUtil;
}

/** Plantoes que valem um evento: agendados e realizados que comecam no periodo. */
export async function listaPlantoesParaCalendario(db: Executor, de: number, ate: number): Promise<PlantaoParaCalendario[]> {
  const linhas = await db.getAllAsync<LinhaPlantao>(
    `SELECT p.id, p.inicio, p.fim, p.valor_bruto, p.desconto_percentual, p.observacao,
            l.nome AS local_nome, l.apelido AS local_apelido, l.endereco AS local_endereco,
            l.regra_tipo, l.regra_dia_pagamento, l.regra_dias_apos,
            l.regra_dia_fechamento, l.regra_meses_adiante, l.ajuste_dia_util
       FROM plantoes p
       JOIN locais l ON l.id = p.local_id
      WHERE p.status IN ('agendado', 'realizado') AND p.inicio >= ? AND p.inicio <= ?
      ORDER BY p.inicio, p.id`,
    [de, ate],
  );
  return linhas.map((l) => ({
    id: l.id,
    inicio: l.inicio,
    fim: l.fim,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    observacao: l.observacao,
    local: {
      nome: l.local_nome,
      apelido: l.local_apelido,
      endereco: l.local_endereco,
      regra: {
        tipo: l.regra_tipo,
        diaPagamento: l.regra_dia_pagamento,
        diasApos: l.regra_dias_apos,
        diaFechamento: l.regra_dia_fechamento,
        mesesAdiante: l.regra_meses_adiante,
        ajusteDiaUtil: l.ajuste_dia_util,
      },
    },
  }));
}

/* ------------------------------- sincronizacao ------------------------------- */

export type EstadoSincronizacao = "ok" | "desligado" | "sem_permissao" | "sem_calendario" | "erro";

export interface ResultadoSincronizacao {
  estado: EstadoSincronizacao;
  criados: number;
  atualizados: number;
  /** Eventos que a pessoa apagou no calendario e o app refez. */
  recriados: number;
  removidos: number;
  /** Operacoes que falharam; a proxima sincronizacao tenta de novo. */
  falhas: number;
  mensagem: string | null;
}

const resultado = (estado: EstadoSincronizacao, extra: Partial<ResultadoSincronizacao> = {}): ResultadoSincronizacao => ({
  estado,
  criados: 0,
  atualizados: 0,
  recriados: 0,
  removidos: 0,
  falhas: 0,
  mensagem: null,
  ...extra,
});

const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function registraEstado(db: Executor, cfg: ConfigCalendario, agora: number, erro: string | null) {
  await gravaConfig(db, { ...cfg, ultimaSincronizacao: erro === null ? agora : cfg.ultimaSincronizacao, ultimoErro: erro });
}

/**
 * Deixa o calendario espelhando os plantoes. Nunca lanca: o que deu errado vem
 * no resultado, e tambem fica guardado em `ultimoErro` para a tela mostrar.
 */
export async function sincroniza(db: Executor, prov: ProvedorCalendario, agora = Date.now()): Promise<ResultadoSincronizacao> {
  const cfg = await lerConfigCalendario(db);
  if (!cfg) return resultado("desligado");

  try {
    if ((await prov.permissao()) !== "concedida") {
      const msg = "O app não tem permissão para usar o calendário.";
      await registraEstado(db, cfg, agora, msg);
      return resultado("sem_permissao", { mensagem: msg });
    }
    if (!(await prov.existeCalendario(cfg.calendarioId))) {
      const msg = `O calendário “${cfg.calendarioNome}” não está mais disponível neste aparelho.`;
      await registraEstado(db, cfg, agora, msg);
      return resultado("sem_calendario", { mensagem: msg });
    }

    const r = resultado("ok");
    let primeiroErro: string | null = null;
    const falhou = (e: unknown) => {
      r.falhas += 1;
      primeiroErro ??= textoDoErro(e);
    };

    /* 1. O que sobrou no mapa: plantao apagado, cancelado ou trocado. */
    const orfaos = await db.getAllAsync<LinhaMapa>(
      `SELECT m.* FROM eventos_calendario m
         LEFT JOIN plantoes p ON p.id = m.plantao_id
        WHERE p.id IS NULL OR p.status NOT IN ('agendado', 'realizado')`,
    );
    for (const o of orfaos) {
      try {
        await prov.apagaEvento(o.evento_id);
        await db.runAsync("DELETE FROM eventos_calendario WHERE plantao_id = ?", [o.plantao_id]);
        r.removidos += 1;
      } catch (e) {
        falhou(e);
      }
    }

    /* 2. Cada plantao da janela: criar, atualizar ou deixar como esta. */
    const { de, ate } = janelaDeSincronizacao(agora);
    const plantoes = await listaPlantoesParaCalendario(db, de, ate);
    const mapa = new Map((await db.getAllAsync<LinhaMapa>("SELECT * FROM eventos_calendario")).map((l) => [l.plantao_id, l]));
    const presentes = await prov.idsDeEventos(cfg.calendarioId, de, ate);

    for (const p of plantoes) {
      const evento = montaEvento(p, cfg);
      const assinatura = assinaturaDoEvento(cfg.calendarioId, evento);
      const m = mapa.get(p.id);

      try {
        if (!m) {
          const id = await prov.criaEvento(cfg.calendarioId, evento);
          await guardaMapa(db, p.id, cfg.calendarioId, id, assinatura, agora);
          r.criados += 1;
        } else if (m.calendario_id !== cfg.calendarioId) {
          // Ficou de um calendario anterior: sai de la e nasce no atual.
          await prov.apagaEvento(m.evento_id);
          const id = await prov.criaEvento(cfg.calendarioId, evento);
          await guardaMapa(db, p.id, cfg.calendarioId, id, assinatura, agora);
          r.criados += 1;
        } else if (!presentes.has(m.evento_id)) {
          // A pessoa apagou no calendario: o app e a fonte da verdade, entao refaz.
          const id = await prov.criaEvento(cfg.calendarioId, evento);
          await guardaMapa(db, p.id, cfg.calendarioId, id, assinatura, agora);
          r.recriados += 1;
        } else if (m.assinatura !== assinatura) {
          if (await prov.atualizaEvento(m.evento_id, evento)) {
            await guardaMapa(db, p.id, cfg.calendarioId, m.evento_id, assinatura, agora);
            r.atualizados += 1;
          } else {
            const id = await prov.criaEvento(cfg.calendarioId, evento);
            await guardaMapa(db, p.id, cfg.calendarioId, id, assinatura, agora);
            r.recriados += 1;
          }
        }
      } catch (e) {
        falhou(e);
      }
    }

    await registraEstado(db, cfg, agora, primeiroErro);
    if (r.falhas > 0) {
      r.estado = "erro";
      r.mensagem = `${r.falhas} ${r.falhas === 1 ? "operação falhou" : "operações falharam"}: ${primeiroErro}`;
    }
    return r;
  } catch (e) {
    // Falha geral (o calendario nao respondeu): nada foi gravado pela metade.
    const msg = textoDoErro(e);
    await registraEstado(db, cfg, agora, msg).catch(() => undefined);
    return resultado("erro", { falhas: 1, mensagem: msg });
  }
}

/* ------------------------------ nao sobrepor ------------------------------ */

let emAndamento: Promise<ResultadoSincronizacao> | null = null;
let repetir = false;

/**
 * Pede uma sincronizacao sem nunca rodar duas ao mesmo tempo (editar um plantao
 * dispara pedidos em rajada). Se ja ha uma rodando, ela repete uma vez no fim,
 * para pegar o que mudou enquanto andava — varios pedidos viram uma repeticao so.
 */
export function sincronizaSemSobrepor(db: Executor, prov: ProvedorCalendario, agora: () => number = Date.now): Promise<ResultadoSincronizacao> {
  if (emAndamento) {
    repetir = true;
    return emAndamento;
  }
  const rodada = (async () => {
    try {
      let r = await sincroniza(db, prov, agora());
      while (repetir) {
        repetir = false;
        r = await sincroniza(db, prov, agora());
      }
      return r;
    } finally {
      emAndamento = null;
      repetir = false;
    }
  })();
  emAndamento = rodada;
  return rodada;
}

/* ---------------------------- conectar e desconectar ---------------------------- */

export interface EscolhaDeCalendario {
  calendario: CalendarioDisponivel;
  lembreteMin: number | null;
  mostrarValor: boolean;
}

/** Remove do calendario todos os eventos que o app criou, e esquece o mapa. Devolve quantos removeu. */
async function removeEventosDoApp(db: Executor, prov: ProvedorCalendario): Promise<{ removidos: number; falhas: number }> {
  const linhas = await db.getAllAsync<LinhaMapa>("SELECT * FROM eventos_calendario");
  let removidos = 0;
  let falhas = 0;
  for (const l of linhas) {
    try {
      await prov.apagaEvento(l.evento_id);
      await db.runAsync("DELETE FROM eventos_calendario WHERE plantao_id = ?", [l.plantao_id]);
      removidos += 1;
    } catch {
      falhas += 1;
    }
  }
  return { removidos, falhas };
}

/**
 * Liga a sincronizacao (ou troca o calendario / as opcoes) e ja sincroniza.
 * Trocar de calendario leva os eventos junto: saem do antigo, nascem no novo.
 */
export async function conectaCalendario(
  db: Executor,
  prov: ProvedorCalendario,
  escolha: EscolhaDeCalendario,
  agora = Date.now(),
): Promise<ResultadoSincronizacao> {
  const antes = await lerConfigCalendario(db);
  if (antes && antes.calendarioId !== escolha.calendario.id) {
    await removeEventosDoApp(db, prov);
  }

  await gravaConfig(db, {
    calendarioId: escolha.calendario.id,
    calendarioNome: escolha.calendario.nome,
    conta: escolha.calendario.conta,
    lembreteMin: escolha.lembreteMin,
    mostrarValor: escolha.mostrarValor,
    ativadoEm: antes?.ativadoEm ?? agora,
    ultimaSincronizacao: antes?.ultimaSincronizacao ?? null,
    ultimoErro: null,
  });
  return sincronizaSemSobrepor(db, prov, () => agora);
}

export interface ResultadoDesconexao {
  /** Eventos apagados do calendario. */
  removidos: number;
  /** Eventos que nao foi possivel apagar (ficam no calendario; o app os esquece). */
  falhas: number;
}

/**
 * Para de sincronizar. Com `removerEventos`, apaga do calendario o que o app
 * criou; sem ele, os eventos ficam la como eventos comuns, sem ligacao com o app.
 */
export async function desconectaCalendario(
  db: Executor,
  prov: ProvedorCalendario,
  opcoes: { removerEventos: boolean },
): Promise<ResultadoDesconexao> {
  const r = opcoes.removerEventos ? await removeEventosDoApp(db, prov) : { removidos: 0, falhas: 0 };
  await db.runAsync("DELETE FROM eventos_calendario");
  await gravaConfig(db, null);
  return r;
}
