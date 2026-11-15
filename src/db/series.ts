/**
 * Escalas: plantoes que se repetem.
 *
 * Uma escala (`series`) guarda a REGRA ("toda terca", "12x36") e o MODELO de
 * cada plantao (local, horario, valor). Os plantoes em si continuam na tabela
 * `plantoes`, um por ocorrencia: a agenda, as somas e os recebimentos leem uma
 * tabela so e nao precisam saber o que e escala e o que e avulso.
 *
 * Como cada ocorrencia e uma linha de verdade, ela pode ser movida, ter outro
 * valor ou ser marcada como realizada sem mexer nas vizinhas. O que impede a
 * escala de desfazer esse trabalho ao ser editada:
 *   - `status <> 'agendado'` e fato consumado (trabalhou, cancelou, trocou, ou
 *     ja recebeu): nenhuma edicao ou exclusao em serie encosta nele;
 *   - `excecao = 1` e um plantao alterado so nele: edicoes em serie o poupam
 *     (excluir em serie o leva, porque o usuario pediu para apagar o futuro);
 *   - `series_puladas` lembra o que foi excluido uma a uma, senao a agenda
 *     recriaria o plantao quando estendesse o calendario.
 *
 * Tudo que escreve em varias linhas roda em `transacao`: um app fechado no
 * meio nao pode deixar a escala pela metade. E as edicoes reconciliam NO LUGAR
 * (atualizam, apagam e inserem o minimo), de modo que o id de um plantao que
 * continua existindo nao muda — a tela aberta nele nao perde o chao.
 *
 * Depende de `Executor`; nao importa `plantoes.ts` (ele e que importa este).
 */
import { inicioDoDia, somaDias } from "../lib/datetime.ts";
import { normalizaObservacao, type PlantaoInput } from "../lib/plantoes.ts";
import {
  HORIZONTE_INICIAL_DIAS,
  HORIZONTE_MAXIMO_DIAS,
  ocorrencias,
  plantaoDaSerie,
  temErrosSerie,
  validaSerie,
  type Serie,
  type SerieInput,
  type TipoRecorrencia,
} from "../lib/recorrencia.ts";
import type { Executor } from "./locais.ts";

type Param = string | number | null;

/** Alcance de uma edicao ou exclusao numa escala. */
export type EscopoSerie = "este" | "proximos" | "todos";

export const ROTULO_ESCOPO: Record<EscopoSerie, string> = {
  este: "Só este plantão",
  proximos: "Este e os próximos",
  todos: "Todos da escala",
};

/* ---------------------------------- linhas ---------------------------------- */

interface LinhaSerie {
  id: number;
  local_id: number;
  tipo: TipoRecorrencia;
  dias_semana: number;
  cada: number;
  dia_do_mes: number | null;
  inicio_dia: number;
  fim_dia: number | null;
  inicio_min: number;
  fim_min: number;
  valor_bruto: number;
  desconto_percentual: number;
  observacao: string | null;
  gerado_ate: number;
  criado_em: number;
  atualizado_em: number;
}

function paraSerie(l: LinhaSerie): Serie {
  return {
    id: l.id,
    localId: l.local_id,
    inicioMin: l.inicio_min,
    fimMin: l.fim_min,
    valorBruto: l.valor_bruto,
    descontoPercentual: l.desconto_percentual,
    observacao: l.observacao,
    regra: {
      tipo: l.tipo,
      diasSemana: l.dias_semana,
      cada: l.cada,
      diaDoMes: l.dia_do_mes,
      inicioDia: l.inicio_dia,
      fimDia: l.fim_dia,
    },
    geradoAte: l.gerado_ate,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

/**
 * Colunas na ordem do INSERT/UPDATE. So guarda o que o tipo da regra usa: uma
 * escala "a cada N dias" nao carrega dias da semana esquecidos de outra regra.
 */
function colunas(s: SerieInput): Param[] {
  const r = s.regra;
  return [
    s.localId,
    r.tipo,
    r.tipo === "semanal" ? r.diasSemana : 0,
    r.cada,
    r.tipo === "mensal" ? r.diaDoMes : null,
    inicioDoDia(r.inicioDia),
    r.fimDia === null ? null : inicioDoDia(r.fimDia),
    s.inicioMin,
    s.fimMin,
    s.valorBruto,
    s.descontoPercentual,
    normalizaObservacao(s.observacao),
  ];
}

const SET_SERIE = `local_id = ?, tipo = ?, dias_semana = ?, cada = ?, dia_do_mes = ?,
  inicio_dia = ?, fim_dia = ?, inicio_min = ?, fim_min = ?,
  valor_bruto = ?, desconto_percentual = ?, observacao = ?`;

function garanteValida(s: SerieInput): void {
  if (temErrosSerie(validaSerie(s))) throw new Error("A escala tem campos inválidos.");
}

async function carregaSerie(ex: Executor, id: number): Promise<Serie | null> {
  const l = await ex.getFirstAsync<LinhaSerie>("SELECT * FROM series WHERE id = ?", [id]);
  return l ? paraSerie(l) : null;
}

export async function buscaSerie(db: Executor, id: number): Promise<Serie | null> {
  return carregaSerie(db, id);
}

/** Quantas escalas ativas (sem data final vencida) um local tem: aviso ao arquivar. */
export async function contaSeriesAtivasDoLocal(db: Executor, localId: number, agora = Date.now()): Promise<number> {
  const l = await db.getFirstAsync<{ total: number }>(
    "SELECT COUNT(*) AS total FROM series WHERE local_id = ? AND (fim_dia IS NULL OR fim_dia >= ?)",
    [localId, inicioDoDia(agora)],
  );
  return l?.total ?? 0;
}

/* -------------------------------- horizonte -------------------------------- */

/**
 * Ate que dia (meia-noite) vale materializar: o pedido, limitado a data final
 * da escala, se houver. O teto de tres anos e aplicado uma vez so, em
 * `garanteHorizonte` — o unico caminho em que o pedido vem de fora (a agenda).
 */
function limiteDoHorizonte(serie: Serie, ate: number): number {
  const limite = inicioDoDia(ate);
  return serie.regra.fimDia === null ? limite : Math.min(limite, inicioDoDia(serie.regra.fimDia));
}

const INSERE_OCORRENCIA = `
  INSERT OR IGNORE INTO plantoes (
    local_id, inicio, fim, valor_bruto, desconto_percentual, status, observacao,
    criado_em, atualizado_em, serie_id, ocorrencia_dia, excecao
  ) VALUES (?, ?, ?, ?, ?, 'agendado', ?, ?, ?, ?, ?, 0)`;

async function insereOcorrencia(ex: Executor, serie: Serie, dia: number, agora: number): Promise<number> {
  const p = plantaoDaSerie(serie, dia);
  const r = await ex.runAsync(INSERE_OCORRENCIA, [
    p.localId,
    p.inicio,
    p.fim,
    p.valorBruto,
    p.descontoPercentual,
    p.observacao,
    agora,
    agora,
    serie.id,
    dia,
  ]);
  return r.changes;
}

async function diasPulados(ex: Executor, serieId: number): Promise<Set<number>> {
  const linhas = await ex.getAllAsync<{ ocorrencia_dia: number }>(
    "SELECT ocorrencia_dia FROM series_puladas WHERE serie_id = ?",
    [serieId],
  );
  return new Set(linhas.map((l) => l.ocorrencia_dia));
}

/**
 * Cria os plantoes que faltam entre o que ja foi gerado e `ate`. So acrescenta:
 * nunca mexe no que existe. Devolve quantos criou.
 */
async function estende(ex: Executor, serie: Serie, ate: number, agora: number): Promise<number> {
  const alvo = limiteDoHorizonte(serie, ate);
  if (alvo <= serie.geradoAte) return 0;

  const dias = ocorrencias(serie.regra, somaDias(serie.geradoAte, 1), alvo);
  const pulados = await diasPulados(ex, serie.id);

  let criados = 0;
  for (const dia of dias) {
    if (pulados.has(dia)) continue;
    criados += await insereOcorrencia(ex, serie, dia, agora);
  }

  await ex.runAsync("UPDATE series SET gerado_ate = ? WHERE id = ? AND gerado_ate < ?", [alvo, serie.id, alvo]);
  return criados;
}

/**
 * A agenda chama ao abrir um mes: escalas sem data final recebem plantoes ate
 * o fim dele. Devolve quantos plantoes criou (0 na imensa maioria das vezes, e
 * a consulta que decide isso e barata). Escalas de local arquivado nao crescem.
 */
export async function garanteHorizonte(db: Executor, ateMs: number, agora = Date.now()): Promise<number> {
  const alvo = Math.min(inicioDoDia(ateMs), somaDias(inicioDoDia(agora), HORIZONTE_MAXIMO_DIAS));
  const pendentes = await db.getAllAsync<{ id: number }>(
    `SELECT s.id FROM series s
       JOIN locais l ON l.id = s.local_id
      WHERE l.arquivado_em IS NULL
        AND s.gerado_ate < ?
        AND (s.fim_dia IS NULL OR s.gerado_ate < s.fim_dia)`,
    [alvo],
  );
  if (pendentes.length === 0) return 0;

  return db.transacao(async (ex) => {
    let total = 0;
    for (const { id } of pendentes) {
      // Relê dentro da transacao: outra chamada pode ter estendido no intervalo.
      const serie = await carregaSerie(ex, id);
      if (serie) total += await estende(ex, serie, alvo, agora);
    }
    return total;
  });
}

/* --------------------------------- criacao --------------------------------- */

export async function criaSerie(
  db: Executor,
  entrada: SerieInput,
  agora = Date.now(),
): Promise<{ serieId: number; criados: number }> {
  garanteValida(entrada);
  return db.transacao(async (ex) => {
    const r = await ex.runAsync(
      `INSERT INTO series (
         local_id, tipo, dias_semana, cada, dia_do_mes, inicio_dia, fim_dia,
         inicio_min, fim_min, valor_bruto, desconto_percentual, observacao,
         gerado_ate, criado_em, atualizado_em
       ) VALUES (${Array(15).fill("?").join(", ")})`,
      [...colunas(entrada), 0, agora, agora],
    );
    const serie = await carregaSerie(ex, r.lastInsertRowId);
    if (!serie) throw new Error("A escala não foi gravada.");
    const criados = await estende(ex, serie, somaDias(inicioDoDia(agora), HORIZONTE_INICIAL_DIAS), agora);
    return { serieId: serie.id, criados };
  });
}

/* ------------------------------- reconciliacao ------------------------------- */

interface Existente {
  id: number;
  ocorrencia_dia: number | null;
  status: string;
  excecao: number;
  local_id: number;
  inicio: number;
  fim: number;
  valor_bruto: number;
  desconto_percentual: number;
  observacao: string | null;
}

const protegido = (e: Existente): boolean => e.status !== "agendado" || e.excecao === 1;

/** O plantao existente difere do que o modelo da escala produziria? (A situacao nao conta.) */
function difere(e: Existente, p: PlantaoInput): boolean {
  return (
    e.local_id !== p.localId ||
    e.inicio !== p.inicio ||
    e.fim !== p.fim ||
    e.valor_bruto !== p.valorBruto ||
    e.desconto_percentual !== p.descontoPercentual ||
    (e.observacao ?? null) !== (p.observacao ?? null)
  );
}

/**
 * Deixa os plantoes da escala de acordo com a regra e o modelo atuais, no
 * lugar: atualiza o que mudou, apaga o que a regra nao produz mais, cria o que
 * falta. Fatos (`status` diferente de agendado) e excecoes ficam como estao.
 */
async function reconcilia(ex: Executor, serieId: number, agora: number): Promise<void> {
  const serie = await carregaSerie(ex, serieId);
  if (!serie) throw new Error("Escala não encontrada.");

  const hoje = inicioDoDia(agora);
  const alvo = limiteDoHorizonte(serie, Math.max(serie.geradoAte, somaDias(hoje, HORIZONTE_INICIAL_DIAS)));
  const desejados = ocorrencias(serie.regra, serie.regra.inicioDia, alvo);
  const desejadosSet = new Set(desejados);

  const existentes = await ex.getAllAsync<Existente>(
    `SELECT id, ocorrencia_dia, status, excecao, local_id, inicio, fim,
            valor_bruto, desconto_percentual, observacao
       FROM plantoes WHERE serie_id = ?`,
    [serieId],
  );
  const pulados = await diasPulados(ex, serieId);
  const ocupados = new Set<number>();

  for (const e of existentes) {
    if (e.ocorrencia_dia !== null) ocupados.add(e.ocorrencia_dia);

    if (protegido(e)) {
      // Uma excecao que, depois da edicao, ficou igual ao modelo volta a ser normal.
      if (e.status === "agendado" && e.excecao === 1 && e.ocorrencia_dia !== null) {
        if (!difere(e, plantaoDaSerie(serie, e.ocorrencia_dia))) {
          await ex.runAsync("UPDATE plantoes SET excecao = 0 WHERE id = ?", [e.id]);
        }
      }
      continue;
    }

    if (e.ocorrencia_dia === null || !desejadosSet.has(e.ocorrencia_dia)) {
      await ex.runAsync("DELETE FROM plantoes WHERE id = ?", [e.id]);
      continue;
    }

    const p = plantaoDaSerie(serie, e.ocorrencia_dia);
    if (difere(e, p)) {
      await ex.runAsync(
        `UPDATE plantoes SET local_id = ?, inicio = ?, fim = ?, valor_bruto = ?,
                desconto_percentual = ?, observacao = ?, atualizado_em = ?
          WHERE id = ?`,
        [p.localId, p.inicio, p.fim, p.valorBruto, p.descontoPercentual, p.observacao, agora, e.id],
      );
    }
  }

  for (const dia of desejados) {
    if (ocupados.has(dia) || pulados.has(dia)) continue;
    await insereOcorrencia(ex, serie, dia, agora);
  }

  // Pode diminuir (data final encurtada): estender de novo recria o que faltar.
  await ex.runAsync("UPDATE series SET gerado_ate = ? WHERE id = ?", [alvo, serieId]);
}

/**
 * Recalcula se UM plantao da escala difere do modelo. Chamada ao salvar o
 * plantao: o que ficou diferente vira excecao (edicoes em serie o poupam); o
 * que voltou a ser igual ao modelo volta para a escala.
 */
export async function recalculaExcecao(ex: Executor, plantaoId: number): Promise<void> {
  const p = await ex.getFirstAsync<Existente & { serie_id: number | null }>(
    `SELECT id, serie_id, ocorrencia_dia, status, excecao, local_id, inicio, fim,
            valor_bruto, desconto_percentual, observacao
       FROM plantoes WHERE id = ?`,
    [plantaoId],
  );
  if (!p || p.serie_id === null || p.ocorrencia_dia === null) return;
  const serie = await carregaSerie(ex, p.serie_id);
  if (!serie) return;

  const excecao = difere(p, plantaoDaSerie(serie, p.ocorrencia_dia)) ? 1 : 0;
  if (excecao !== p.excecao) await ex.runAsync("UPDATE plantoes SET excecao = ? WHERE id = ?", [excecao, plantaoId]);
}

/* ---------------------------------- edicao ---------------------------------- */

interface Ancora {
  serie_id: number;
  ocorrencia_dia: number;
}

async function ancoraDe(ex: Executor, plantaoId: number): Promise<Ancora | null> {
  const p = await ex.getFirstAsync<{ serie_id: number | null; ocorrencia_dia: number | null }>(
    "SELECT serie_id, ocorrencia_dia FROM plantoes WHERE id = ?",
    [plantaoId],
  );
  if (!p || p.serie_id === null || p.ocorrencia_dia === null) return null;
  return { serie_id: p.serie_id, ocorrencia_dia: p.ocorrencia_dia };
}

/**
 * Edita a escala a partir de um plantao dela.
 *
 *   todos     — a escala inteira passa a ser `novo`.
 *   proximos  — a escala e DIVIDIDA no dia do plantao: a antiga termina na
 *               vespera, uma nova (com `novo`) comeca nele. O que ja era
 *               realizado ou ajustado a mao dali em diante vai junto.
 *
 * (Editar so um plantao nao passa por aqui: e `atualizaPlantao`.)
 * Devolve o id da escala que ficou valendo, ou `null` se o plantao nao e de escala.
 */
export async function editaSerie(
  db: Executor,
  plantaoId: number,
  escopo: Exclude<EscopoSerie, "este">,
  novo: SerieInput,
  agora = Date.now(),
): Promise<number | null> {
  return db.transacao(async (ex) => {
    const ancora = await ancoraDe(ex, plantaoId);
    if (!ancora) return null;
    const serie = await carregaSerie(ex, ancora.serie_id);
    if (!serie) return null;

    const dia = ancora.ocorrencia_dia;
    // "Este e os proximos" a partir do primeiro dia da escala e a escala toda.
    const divide = escopo === "proximos" && dia > serie.regra.inicioDia;

    if (!divide) {
      garanteValida(novo);
      await ex.runAsync(`UPDATE series SET ${SET_SERIE}, atualizado_em = ? WHERE id = ?`, [
        ...colunas(novo),
        agora,
        serie.id,
      ]);
      await reconcilia(ex, serie.id, agora);
      return serie.id;
    }

    const depois: SerieInput = { ...novo, regra: { ...novo.regra, inicioDia: dia } };
    garanteValida(depois);

    // 1. A antiga termina na vespera.
    const vespera = somaDias(dia, -1);
    await ex.runAsync(
      "UPDATE series SET fim_dia = ?, gerado_ate = MIN(gerado_ate, ?), atualizado_em = ? WHERE id = ?",
      [vespera, vespera, agora, serie.id],
    );

    // 2. A nova continua de onde a antiga tinha gerado.
    const r = await ex.runAsync(
      `INSERT INTO series (
         local_id, tipo, dias_semana, cada, dia_do_mes, inicio_dia, fim_dia,
         inicio_min, fim_min, valor_bruto, desconto_percentual, observacao,
         gerado_ate, criado_em, atualizado_em
       ) VALUES (${Array(15).fill("?").join(", ")})`,
      [...colunas(depois), serie.geradoAte, agora, agora],
    );
    const novaId = r.lastInsertRowId;

    // 3. Tudo dali em diante muda de escala, mantendo os ids dos plantoes.
    await ex.runAsync("UPDATE plantoes SET serie_id = ? WHERE serie_id = ? AND ocorrencia_dia >= ?", [
      novaId,
      serie.id,
      dia,
    ]);
    await ex.runAsync("UPDATE series_puladas SET serie_id = ? WHERE serie_id = ? AND ocorrencia_dia >= ?", [
      novaId,
      serie.id,
      dia,
    ]);

    // 4. E a nova regra vale sobre isso.
    await reconcilia(ex, novaId, agora);
    return novaId;
  });
}

/* --------------------------------- exclusao --------------------------------- */

/**
 * Apaga UM plantao e, se ele era de escala, deixa registrado que a ocorrencia
 * foi excluida (senao a agenda a recriaria). Serve tambem para avulsos.
 */
export async function apagaPlantaoRegistrando(ex: Executor, plantaoId: number): Promise<boolean> {
  const ancora = await ancoraDe(ex, plantaoId);
  if (ancora) {
    await ex.runAsync("INSERT OR IGNORE INTO series_puladas (serie_id, ocorrencia_dia) VALUES (?, ?)", [
      ancora.serie_id,
      ancora.ocorrencia_dia,
    ]);
  }
  const r = await ex.runAsync("DELETE FROM plantoes WHERE id = ?", [plantaoId]);
  return r.changes > 0;
}

export interface ResultadoExclusao {
  /** Plantoes apagados. */
  removidos: number;
  /** Realizados (ou pagos) que ficaram, agora avulsos. */
  mantidos: number;
}

/**
 * Exclui da escala. Em serie (`proximos`, `todos`) so cai o que ainda esta
 * agendado: plantao realizado, trocado, cancelado ou pago e historico e fica,
 * como avulso. Excecoes agendadas caem junto: quem apaga o futuro quer o futuro
 * apagado.
 */
export async function excluiDaSerie(
  db: Executor,
  plantaoId: number,
  escopo: EscopoSerie,
  agora = Date.now(),
): Promise<ResultadoExclusao | null> {
  return db.transacao(async (ex) => {
    const ancora = await ancoraDe(ex, plantaoId);
    if (!ancora) return null;
    const serie = await carregaSerie(ex, ancora.serie_id);
    if (!serie) return null;

    if (escopo === "este") {
      const ok = await apagaPlantaoRegistrando(ex, plantaoId);
      return { removidos: ok ? 1 : 0, mantidos: 0 };
    }

    const dia = ancora.ocorrencia_dia;
    const tudo = escopo === "todos" || dia <= serie.regra.inicioDia;
    const de = tudo ? Number.NEGATIVE_INFINITY : dia;
    // -Infinity nao e parametro SQL valido; um piso baixo basta.
    const piso = tudo ? -8.64e15 : de;

    const apagados = await ex.runAsync(
      "DELETE FROM plantoes WHERE serie_id = ? AND ocorrencia_dia >= ? AND status = 'agendado'",
      [serie.id, piso],
    );
    // O que sobrou (fatos) deixa de pertencer a escala.
    const soltos = await ex.runAsync(
      "UPDATE plantoes SET serie_id = NULL, ocorrencia_dia = NULL, excecao = 0 WHERE serie_id = ? AND ocorrencia_dia >= ?",
      [serie.id, piso],
    );
    await ex.runAsync("DELETE FROM series_puladas WHERE serie_id = ? AND ocorrencia_dia >= ?", [serie.id, piso]);

    if (tudo) {
      await ex.runAsync("DELETE FROM series WHERE id = ?", [serie.id]);
    } else {
      const vespera = somaDias(dia, -1);
      await ex.runAsync(
        "UPDATE series SET fim_dia = ?, gerado_ate = MIN(gerado_ate, ?), atualizado_em = ? WHERE id = ?",
        [vespera, vespera, agora, serie.id],
      );
    }
    return { removidos: apagados.changes, mantidos: soltos.changes };
  });
}

/* --------------------------------- impacto --------------------------------- */

export interface Impacto {
  /** Plantoes que a acao vai alterar ou apagar. */
  alteraveis: number;
  /** Realizados, cancelados, trocados ou pagos: ficam como estao. */
  realizados: number;
  /** Ajustados a mao (so numa edicao em serie): ficam como estao. */
  ajustados: number;
}

/**
 * O que uma edicao ou exclusao em serie vai atingir. A tela mostra isto antes
 * de confirmar: "vai alterar 24 plantoes e manter 3 ja realizados".
 */
export async function contaImpacto(
  db: Executor,
  plantaoId: number,
  escopo: EscopoSerie,
  acao: "editar" | "excluir",
): Promise<Impacto | null> {
  const ancora = await ancoraDe(db, plantaoId);
  if (!ancora) return null;

  if (escopo === "este") return { alteraveis: 1, realizados: 0, ajustados: 0 };

  const serie = await carregaSerie(db, ancora.serie_id);
  if (!serie) return null;
  const tudo = escopo === "todos" || ancora.ocorrencia_dia <= serie.regra.inicioDia;
  const piso = tudo ? -8.64e15 : ancora.ocorrencia_dia;

  const linhas = await db.getAllAsync<{ status: string; excecao: number }>(
    "SELECT status, excecao FROM plantoes WHERE serie_id = ? AND ocorrencia_dia >= ?",
    [serie.id, piso],
  );

  const r: Impacto = { alteraveis: 0, realizados: 0, ajustados: 0 };
  for (const l of linhas) {
    if (l.status !== "agendado") r.realizados += 1;
    else if (l.excecao === 1 && acao === "editar") r.ajustados += 1;
    else r.alteraveis += 1;
  }
  return r;
}
