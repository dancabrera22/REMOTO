import { ESCOLHA_PADRAO, leEscolhaTema, type EscolhaTema } from "../lib/tema.ts";
import type { Executor } from "./locais.ts";

const CHAVE = "tema";

export async function lerEscolhaTema(db: Executor): Promise<EscolhaTema> {
  const l = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM config WHERE chave = ?", [CHAVE]);
  return leEscolhaTema(l?.valor);
}

/** O padrao nao precisa ficar gravado: voltar a "do celular" apaga a linha. */
export async function gravaEscolhaTema(db: Executor, escolha: EscolhaTema): Promise<void> {
  if (escolha === ESCOLHA_PADRAO) await db.runAsync("DELETE FROM config WHERE chave = ?", [CHAVE]);
  else await db.runAsync("INSERT OR REPLACE INTO config (chave, valor) VALUES (?, ?)", [CHAVE, escolha]);
}
