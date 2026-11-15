import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";
import type { Executor } from "./locais";
import { migracoes } from "./migrations";

export const NOME_BANCO = "meu-plantao.db";

/**
 * Abre o banco e deixa o esquema na versao corrente.
 *
 * `user_version` do proprio SQLite e o marcador de versao: nao exige tabela
 * auxiliar, e atomico e sobrevive a qualquer coisa que o app faca.
 */
export async function abreBanco(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(NOME_BANCO);
  // WAL deixa leitura e escrita concorrentes (a agenda consulta enquanto o
  // formulario grava). `foreign_keys` nao vem ligado por padrao no SQLite.
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync("PRAGMA foreign_keys = ON;");
  await aplicaMigracoes(db);
  return db;
}

/** Aplica as migracoes pendentes em ordem. Devolve a versao final. */
export async function aplicaMigracoes(db: SQLite.SQLiteDatabase): Promise<number> {
  const linha = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  let atual = linha?.user_version ?? 0;

  for (const migracao of migracoes) {
    if (migracao.versao <= atual) continue;
    if (!Number.isInteger(migracao.versao)) {
      throw new Error(`Versao de migracao invalida: ${migracao.versao}`);
    }

    await db.withTransactionAsync(async () => {
      await db.execAsync(migracao.sql);
    });
    // PRAGMA nao aceita parametro; a versao vem do nosso proprio codigo e e
    // conferida como inteiro acima.
    await db.execAsync(`PRAGMA user_version = ${migracao.versao};`);
    atual = migracao.versao;
  }

  return atual;
}

export async function versaoAtual(db: SQLite.SQLiteDatabase): Promise<number> {
  const linha = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return linha?.user_version ?? 0;
}

export type Banco = SQLite.SQLiteDatabase;

const executores = new WeakMap<Banco, Executor>();

/**
 * Adapta o banco do Expo a `Executor`, a interface que o resto do app usa.
 *
 * O Expo exige `params` em toda chamada; `Executor` o torna opcional, porque
 * a maioria das consultas nao tem parametro. Os testes fazem a mesma ponte com
 * o `node:sqlite` — e por isso os mesmos comandos SQL rodam nos dois mundos.
 * O resultado e guardado por banco para a identidade ficar estavel entre
 * renderizacoes (as consultas dependem dela).
 */
export function executorDe(db: Banco): Executor {
  let ex = executores.get(db);
  if (!ex) {
    ex = criaExecutor(db, false);
    executores.set(db, ex);
  }
  return ex;
}

function criaExecutor(db: Banco, dentroDeTransacao: boolean): Executor {
  const ex: Executor = {
    getAllAsync: (sql, params = []) => db.getAllAsync(sql, params),
    getFirstAsync: (sql, params = []) => db.getFirstAsync(sql, params),
    runAsync: async (sql, params = []) => {
      const r = await db.runAsync(sql, params);
      return { lastInsertRowId: r.lastInsertRowId, changes: r.changes };
    },

    async transacao<T>(fn: (e: Executor) => Promise<T>): Promise<T> {
      if (dentroDeTransacao) return fn(ex);

      let resultado: T | undefined;
      let concluiu = false;

      if (Platform.OS === "web") {
        // Na web nao existe transacao exclusiva (o Expo documenta isso). A comum
        // serve: la o app so roda em desenvolvimento e os testes, onde uma
        // acao de cada vez acontece.
        await db.withTransactionAsync(async () => {
          // Um executor "ja dentro": transacao chamada de novo aqui so executa.
          resultado = await fn(criaExecutor(db, true));
          concluiu = true;
        });
      } else {
        // Exclusiva: abre uma conexao propria, entao nenhuma consulta da tela
        // se mistura aos passos da transacao.
        await db.withExclusiveTransactionAsync(async (txn) => {
          resultado = await fn(criaExecutor(txn, true));
          concluiu = true;
        });
      }

      if (!concluiu) throw new Error("A transação terminou sem concluir.");
      return resultado as T;
    },
  };
  return ex;
}
