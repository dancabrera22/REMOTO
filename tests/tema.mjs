import { gravaEscolhaTema, lerEscolhaTema } from "../src/db/tema.ts";
import { ESCOLHAS_TEMA, leEscolhaTema, temaEfetivo } from "../src/lib/tema.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

export async function testes() {
  igual("sem nada guardado, segue o sistema", leEscolhaTema(null), "sistema");
  igual("indefinido tambem", leEscolhaTema(undefined), "sistema");
  igual("texto vazio", leEscolhaTema(""), "sistema");
  igual("texto desconhecido volta ao padrao", leEscolhaTema("roxo"), "sistema");
  igual("maiuscula nao vale (o app so grava minuscula)", leEscolhaTema("ESCURO"), "sistema");
  igual("claro", leEscolhaTema("claro"), "claro");
  igual("escuro", leEscolhaTema("escuro"), "escuro");
  igual("sistema", leEscolhaTema("sistema"), "sistema");

  igual("claro fixo ignora o sistema escuro", temaEfetivo("claro", true), "light");
  igual("escuro fixo ignora o sistema claro", temaEfetivo("escuro", false), "dark");
  igual("do celular: sistema escuro", temaEfetivo("sistema", true), "dark");
  igual("do celular: sistema claro", temaEfetivo("sistema", false), "light");

  igual("tres opcoes na tela", ESCOLHAS_TEMA.length, 3);
  check("a primeira e a padrao", ESCOLHAS_TEMA[0].valor === "sistema");
  check("com rotulos diferentes", new Set(ESCOLHAS_TEMA.map((e) => e.rotulo)).size === 3);

  const { db } = bancoMigrado();
  const ex = adaptador(db);
  igual("banco novo: padrao", await lerEscolhaTema(ex), "sistema");
  await gravaEscolhaTema(ex, "escuro");
  igual("grava escuro", await lerEscolhaTema(ex), "escuro");
  await gravaEscolhaTema(ex, "claro");
  igual("troca para claro (sem linha duplicada)", `${await lerEscolhaTema(ex)}/${db.prepare("SELECT COUNT(*) AS n FROM config").get().n}`, "claro/1");
  await gravaEscolhaTema(ex, "sistema");
  igual("voltar ao padrao apaga a linha", db.prepare("SELECT COUNT(*) AS n FROM config").get().n, 0);
  db.prepare("INSERT INTO config (chave, valor) VALUES ('tema', 'lixo')").run();
  igual("valor estragado no banco vira o padrao", await lerEscolhaTema(ex), "sistema");

  db.prepare("INSERT OR REPLACE INTO config (chave, valor) VALUES ('calendario', '{}')").run();
  await gravaEscolhaTema(ex, "escuro");
  await gravaEscolhaTema(ex, "sistema");
  igual("nao mexe nas outras configuracoes", db.prepare("SELECT COUNT(*) AS n FROM config WHERE chave = 'calendario'").get().n, 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
