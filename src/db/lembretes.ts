/**
 * Sincronizacao dos lembretes do app com as notificacoes agendadas do celular.
 *
 * O sistema e acessado por `ProvedorLembretes`, uma interface pequena: no aparelho ela e
 * implementada sobre o `expo-notifications`, nos testes sobre um sistema falso em memoria. Assim a
 * logica que importa — quando criar, trocar, cancelar e recuperar-se de falha — roda e e provada
 * em Node. Mesmo espirito da sincronizacao do calendario, e mais simples: nao ha mapa para
 * guardar, porque o identificador de cada aviso ja diz o que ele e (ver `lib/lembretes.ts`).
 *
 * Principios:
 *  - O plantao manda; o agendado obedece.
 *  - Idempotente: rodar duas vezes seguidas nao muda nada na segunda. Falhou no meio? A proxima
 *    rodada termina o servico.
 *  - So mexe no que e seu: apenas identificadores do app (prefixo `lp:`); o aviso de teste e
 *    qualquer outra coisa agendada no aparelho ficam como estao.
 *  - Nunca lanca: o que deu errado vem no resultado e fica guardado para a tela mostrar.
 */
import { fimDoDia, somaDias } from "../lib/datetime.ts";
import {
  HORIZONTE_LEMBRETES_DIAS,
  diferencaDeLembretes,
  ehLembreteDoApp,
  leConfigLembretes,
  planejaLembretes,
  serializaConfigLembretes,
  type ConfigLembretes,
  type LembretePlanejado,
  type PlantaoParaLembrete,
} from "../lib/lembretes.ts";
import type { Executor } from "./locais.ts";

/* ---------------------------------- o sistema ---------------------------------- */

/** `pergunta`: a pessoa ainda nao decidiu e o app pode pedir. `negada`: so as configuracoes do sistema resolvem. */
export type PermissaoLembretes = "concedida" | "negada" | "pergunta";

export interface ProvedorLembretes {
  permissao(): Promise<PermissaoLembretes>;
  pedePermissao(): Promise<PermissaoLembretes>;
  /** Identificadores de tudo que esta agendado e e do app (prefixo `lp:`). */
  listaAgendados(): Promise<string[]>;
  /** Agenda (ou, com o mesmo identificador, substitui). */
  agenda(lembrete: LembretePlanejado): Promise<void>;
  /** Idempotente: cancelar o que ja nao existe nao e erro. */
  cancela(ids: readonly string[]): Promise<void>;
  /** O aviso de teste: toca daqui a poucos segundos e NAO tem identificador do app. */
  testeAgora(titulo: string, corpo: string, emSegundos: number): Promise<void>;
}

/* ---------------------------------- config ---------------------------------- */

const CHAVE = "lembretes";

export async function lerConfigLembretes(db: Executor): Promise<ConfigLembretes | null> {
  const l = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM config WHERE chave = ?", [CHAVE]);
  return leConfigLembretes(l?.valor ?? null);
}

async function gravaConfig(db: Executor, cfg: ConfigLembretes): Promise<void> {
  await db.runAsync("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)", [CHAVE, serializaConfigLembretes(cfg)]);
}

/* --------------------------------- consulta --------------------------------- */

interface LinhaPlantao {
  id: number;
  unidade: string | null;
  inicio: number;
  fim: number;
  local_nome: string;
  local_endereco: string | null;
}

/** Plantoes agendados que ainda vao comecar, ate o fim do prazo dos avisos. */
export async function listaPlantoesParaLembretes(db: Executor, agora: number): Promise<PlantaoParaLembrete[]> {
  const limite = fimDoDia(somaDias(agora, HORIZONTE_LEMBRETES_DIAS));
  const linhas = await db.getAllAsync<LinhaPlantao>(
    `SELECT p.id, p.unidade, p.inicio, p.fim, l.nome AS local_nome, l.endereco AS local_endereco
       FROM plantoes p
       JOIN locais l ON l.id = p.local_id
      WHERE p.status = 'agendado' AND p.inicio > ? AND p.inicio <= ?
      ORDER BY p.inicio, p.id`,
    [agora, limite],
  );
  return linhas.map((l) => ({
    id: l.id,
    unidade: l.unidade,
    inicio: l.inicio,
    fim: l.fim,
    status: "agendado",
    local: { nome: l.local_nome, endereco: l.local_endereco },
  }));
}

/* ------------------------------- sincronizacao ------------------------------- */

export type EstadoLembretes = "ok" | "desligado" | "sem_permissao" | "erro";

export interface ResultadoLembretes {
  estado: EstadoLembretes;
  criados: number;
  cancelados: number;
  /** Operacoes que falharam; a proxima sincronizacao tenta de novo. */
  falhas: number;
  mensagem: string | null;
}

const resultado = (estado: EstadoLembretes, extra: Partial<ResultadoLembretes> = {}): ResultadoLembretes => ({
  estado,
  criados: 0,
  cancelados: 0,
  falhas: 0,
  mensagem: null,
  ...extra,
});

const textoDoErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function registraEstado(db: Executor, cfg: ConfigLembretes, agora: number, erro: string | null) {
  await gravaConfig(db, { ...cfg, ultimaSincronizacao: erro === null ? agora : cfg.ultimaSincronizacao, ultimoErro: erro });
}

/**
 * Deixa os avisos agendados espelhando os plantoes. Desligado (sem config ou sem antecedencia):
 * cancela o que o app tinha agendado e pronto.
 */
export async function sincronizaLembretes(db: Executor, prov: ProvedorLembretes, agora = Date.now()): Promise<ResultadoLembretes> {
  let cfg: ConfigLembretes | null = null;
  try {
    cfg = await lerConfigLembretes(db);

    if (!cfg || cfg.antecedenciaMin === null) {
      const doApp = (await prov.listaAgendados()).filter(ehLembreteDoApp);
      if (doApp.length > 0) await prov.cancela(doApp);
      return resultado("desligado", { cancelados: doApp.length });
    }

    if ((await prov.permissao()) !== "concedida") {
      const msg = "O app não tem permissão para mostrar notificações.";
      await registraEstado(db, cfg, agora, msg);
      return resultado("sem_permissao", { mensagem: msg });
    }

    const plantoes = await listaPlantoesParaLembretes(db, agora);
    const desejados = planejaLembretes(plantoes, cfg.antecedenciaMin, agora);
    const { criar, cancelar } = diferencaDeLembretes(desejados, await prov.listaAgendados());

    const r = resultado("ok");
    let primeiroErro: string | null = null;
    const falhou = (e: unknown) => {
      r.falhas += 1;
      primeiroErro ??= textoDoErro(e);
    };

    // Primeiro sai o que sobrou: se algo falhar depois, no maximo falta um aviso (a proxima rodada cria),
    // e nunca sobra um aviso velho tocando.
    if (cancelar.length > 0) {
      try {
        await prov.cancela(cancelar);
        r.cancelados = cancelar.length;
      } catch (e) {
        falhou(e);
      }
    }
    for (const l of criar) {
      try {
        await prov.agenda(l);
        r.criados += 1;
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
    // Falha geral (o sistema nao respondeu): nada foi gravado pela metade.
    const msg = textoDoErro(e);
    if (cfg) await registraEstado(db, cfg, agora, msg).catch(() => undefined);
    return resultado("erro", { falhas: 1, mensagem: msg });
  }
}

/* ------------------------------ nao sobrepor ------------------------------ */

let emAndamento: Promise<ResultadoLembretes> | null = null;
let repetir = false;

/**
 * Pede uma sincronizacao sem nunca rodar duas ao mesmo tempo (editar um plantao dispara pedidos em
 * rajada). Se ja ha uma rodando, ela repete uma vez no fim, para pegar o que mudou enquanto andava.
 */
export function sincronizaLembretesSemSobrepor(
  db: Executor,
  prov: ProvedorLembretes,
  agora: () => number = Date.now,
): Promise<ResultadoLembretes> {
  if (emAndamento) {
    repetir = true;
    return emAndamento;
  }
  const rodada = (async () => {
    try {
      let r = await sincronizaLembretes(db, prov, agora());
      while (repetir) {
        repetir = false;
        r = await sincronizaLembretes(db, prov, agora());
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

/* --------------------------- ligar, trocar e desligar --------------------------- */

/**
 * Escolhe a antecedencia (ou `null` para desligar) e sincroniza. Quem chama pede antes a permissao
 * (a tela faz isso); sem ela, a configuracao fica guardada e a sincronizacao diz `sem_permissao`.
 */
export async function configuraLembretes(
  db: Executor,
  prov: ProvedorLembretes,
  antecedenciaMin: number | null,
  agora = Date.now(),
): Promise<ResultadoLembretes> {
  const atual = await lerConfigLembretes(db);
  await gravaConfig(db, {
    antecedenciaMin,
    ultimaSincronizacao: atual?.ultimaSincronizacao ?? null,
    ultimoErro: null,
  });
  return sincronizaLembretesSemSobrepor(db, prov, () => agora);
}
