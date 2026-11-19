/**
 * Manutencao das unidades de um local: contar o que uma unidade tem e RENOMEAR (ou juntar duas).
 *
 * O nome da unidade e digitado livremente em cada plantao, entao um erro de digitacao ("Itiam")
 * ou grafias diferentes ("itaim", "ITAIM") acabam espalhados por muitos plantoes. Renomear acerta
 * todos de uma vez, e e o que permite juntar duas unidades que eram a mesma.
 *
 * Mesma regra das outras camadas: depende de `Executor`, nao do `expo-sqlite`.
 */
import { chaveUnidade, normalizaUnidade } from "../lib/plantoes.ts";
import type { Executor } from "./locais.ts";
import { recalculaExcecao } from "./series.ts";

/** Abaixo do limite de variaveis do SQLite (999 nas versoes antigas), com folga para os outros parametros. */
const LOTE = 400;
const marcas = (n: number) => Array(n).fill("?").join(", ");

type Tabela = "plantoes" | "series";

/** As grafias, exatamente como estao gravadas, que contam como a unidade `chave` neste local. */
async function grafias(ex: Executor, tabela: Tabela, localId: number, chave: string): Promise<string[]> {
  const linhas = await ex.getAllAsync<{ unidade: string }>(
    `SELECT DISTINCT unidade FROM ${tabela} WHERE local_id = ? AND unidade IS NOT NULL`,
    [localId],
  );
  return linhas.map((l) => l.unidade).filter((u) => chaveUnidade(u) === chave);
}

export interface ContagemDaUnidade {
  /** Plantoes de qualquer situacao (inclusive cancelado e trocado). */
  plantoes: number;
  escalas: number;
}

/** O que uma unidade tem neste local: quanto seria atingido por renomea-la. */
export async function contaUnidade(db: Executor, localId: number, unidade: string): Promise<ContagemDaUnidade> {
  const chave = chaveUnidade(unidade);
  if (!chave) return { plantoes: 0, escalas: 0 };
  const conta = async (tabela: Tabela): Promise<number> => {
    const nomes = await grafias(db, tabela, localId, chave);
    if (nomes.length === 0) return 0;
    const l = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${tabela} WHERE local_id = ? AND unidade IN (${marcas(nomes.length)})`,
      [localId, ...nomes],
    );
    return l?.n ?? 0;
  };
  return { plantoes: await conta("plantoes"), escalas: await conta("series") };
}

/**
 * Faz toda grafia da unidade `de`, neste local, passar a ser `para` — nos plantoes e no modelo das
 * escalas. Se `para` ja e o nome de OUTRA unidade do local, as duas viram uma so. Devolve quantos
 * plantoes e quantas escalas mudaram (zero quando nada precisava mudar).
 *
 * Tudo numa transacao. Depois de renomear, plantoes de escala que antes eram "ajustados a mao"
 * so por causa da unidade (e agora batem com o modelo) voltam a fazer parte da escala, e o
 * contrario tambem; sem isso a marca de excecao ficaria mentindo.
 */
export async function renomeiaUnidade(
  db: Executor,
  localId: number,
  de: string,
  para: string,
  agora = Date.now(),
): Promise<ContagemDaUnidade> {
  const novo = normalizaUnidade(para);
  if (novo === null) throw new Error("Informe o novo nome da unidade.");
  const chave = chaveUnidade(de);
  if (!chave) throw new Error("Unidade não informada.");

  return db.transacao(async (ex) => {
    // Se o nome novo ja e de outra unidade (juntar), as grafias DELA tambem passam a ser exatamente `novo`:
    // sem isso as duas ficariam "Itaim" e "itaim" na mesma lista.
    const chaveNova = chaveUnidade(novo);
    const quais = async (tabela: Tabela): Promise<string[]> => {
      const nomes = await grafias(ex, tabela, localId, chave);
      if (chaveNova !== chave) nomes.push(...(await grafias(ex, tabela, localId, chaveNova)));
      return [...new Set(nomes)].filter((u) => u !== novo);
    };
    const nomesP = await quais("plantoes");
    const nomesS = await quais("series");

    const mudou = new Set<number>(); // escalas que passam a ter outro modelo
    let plantoes = 0;
    let escalas = 0;

    if (nomesS.length > 0) {
      const ids = await ex.getAllAsync<{ id: number }>(
        `SELECT id FROM series WHERE local_id = ? AND unidade IN (${marcas(nomesS.length)})`,
        [localId, ...nomesS],
      );
      for (const { id } of ids) mudou.add(id);
      const r = await ex.runAsync(
        `UPDATE series SET unidade = ?, atualizado_em = ? WHERE local_id = ? AND unidade IN (${marcas(nomesS.length)})`,
        [novo, agora, localId, ...nomesS],
      );
      escalas = r.changes;
    }

    if (nomesP.length > 0) {
      const deEscala = await ex.getAllAsync<{ serie_id: number }>(
        `SELECT DISTINCT serie_id FROM plantoes
          WHERE local_id = ? AND serie_id IS NOT NULL AND unidade IN (${marcas(nomesP.length)})`,
        [localId, ...nomesP],
      );
      for (const { serie_id } of deEscala) mudou.add(serie_id);
      const r = await ex.runAsync(
        `UPDATE plantoes SET unidade = ?, atualizado_em = ? WHERE local_id = ? AND unidade IN (${marcas(nomesP.length)})`,
        [novo, agora, localId, ...nomesP],
      );
      plantoes = r.changes;
    }

    // A marca de excecao dos plantoes das escalas atingidas.
    const series = [...mudou];
    for (let i = 0; i < series.length; i += LOTE) {
      const lote = series.slice(i, i + LOTE);
      const alvos = await ex.getAllAsync<{ id: number }>(
        `SELECT id FROM plantoes WHERE serie_id IN (${marcas(lote.length)})`,
        lote,
      );
      for (const { id } of alvos) await recalculaExcecao(ex, id);
    }

    return { plantoes, escalas };
  });
}
