/**
 * Backup e restauracao no banco. Depende de `Executor`, como as outras camadas.
 *
 * Restaurar e tudo-ou-nada: apaga e insere dentro de UMA transacao, entao um
 * arquivo que falhe no meio nao deixa os dados pela metade — o app volta ao
 * estado de antes.
 */
import {
  ORDEM_TABELAS,
  TABELAS,
  montaBackup,
  type ArquivoBackup,
  type DadosBackup,
  type Linha,
  type NomeTabela,
} from "../lib/backup.ts";
import type { Executor } from "./locais.ts";

/** Le as quatro tabelas, com as colunas do formato (nao `SELECT *`). */
export async function leDadosDoBanco(db: Executor): Promise<DadosBackup> {
  const dados = {} as DadosBackup;
  for (const tabela of ORDEM_TABELAS) {
    const colunas = TABELAS[tabela].map((c) => c.nome).join(", ");
    const ordem = tabela === "series_puladas" ? "serie_id, ocorrencia_dia" : "id";
    dados[tabela] = await db.getAllAsync<Linha>(`SELECT ${colunas} FROM ${tabela} ORDER BY ${ordem}`);
  }
  return dados;
}

export async function criaBackup(db: Executor, meta: { esquema: number; app: string }, agora = Date.now()): Promise<ArquivoBackup> {
  return montaBackup(await leDadosDoBanco(db), { ...meta, criadoEm: agora });
}

/** Variaveis por comando: abaixo do limite de 999 do SQLite, com folga. */
const VARIAVEIS_POR_COMANDO = 900;

async function insere(ex: Executor, tabela: NomeTabela, linhas: readonly Linha[]): Promise<void> {
  const colunas = TABELAS[tabela].map((c) => c.nome);
  const porLote = Math.max(1, Math.floor(VARIAVEIS_POR_COMANDO / colunas.length));
  const grupo = `(${colunas.map(() => "?").join(", ")})`;

  for (let k = 0; k < linhas.length; k += porLote) {
    const lote = linhas.slice(k, k + porLote);
    await ex.runAsync(
      `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES ${lote.map(() => grupo).join(", ")}`,
      lote.flatMap((l) => colunas.map((c) => l[c] as string | number | null)),
    );
  }
}

export interface ResultadoRestauracao {
  locais: number;
  plantoes: number;
  series: number;
}

/**
 * Troca TODOS os dados pelos do backup (ja validado por `interpretaBackup`).
 * O mapa de eventos do calendario nao e mexido: a proxima sincronizacao o
 * reconcilia (evento de plantao que sumiu e removido, o que mudou e atualizado).
 */
export async function restauraBackup(db: Executor, backup: ArquivoBackup): Promise<ResultadoRestauracao> {
  return db.transacao(async (ex) => {
    for (const tabela of [...ORDEM_TABELAS].reverse()) await ex.runAsync(`DELETE FROM ${tabela}`);
    for (const tabela of ORDEM_TABELAS) await insere(ex, tabela, backup.dados[tabela]);
    return { locais: backup.dados.locais.length, plantoes: backup.dados.plantoes.length, series: backup.dados.series.length };
  });
}

/** O que ha agora no banco: para mostrar "voce vai substituir X por Y". */
export async function contaDados(db: Executor): Promise<{ locais: number; plantoes: number; series: number }> {
  const q = async (t: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0;
  return { locais: await q("locais"), plantoes: await q("plantoes"), series: await q("series") };
}
