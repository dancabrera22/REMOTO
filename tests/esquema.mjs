/**
 * Esquema do banco, verificado contra um SQLite real.
 *
 * O Node 22 traz `node:sqlite` embutido, entao da para aplicar exatamente as
 * mesmas migracoes que rodam no celular e conferir o resultado — sem emulador,
 * sem aparelho, em menos de um segundo. E por isso que `src/db/migrations.ts`
 * nao importa nada do React Native.
 */
import { DatabaseSync } from "node:sqlite";
import { migracoes, versaoEsquema } from "../src/db/migrations.ts";
import { check, report } from "./helpers.mjs";

function bancoMigrado() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  let versao = db.prepare("PRAGMA user_version").get().user_version;
  for (const m of migracoes) {
    if (m.versao <= versao) continue;
    db.exec(m.sql);
    db.exec(`PRAGMA user_version = ${m.versao};`);
    versao = m.versao;
  }
  return { db, versao };
}

export function testes() {
  const { db, versao } = bancoMigrado();

  check("migracoes aplicam e marcam a versao", versao === versaoEsquema, `versao ${versao}`);

  const tabelas = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((r) => r.name);
  check("cria a tabela locais", tabelas.includes("locais"), tabelas.join(", "));

  const colunas = db.prepare("PRAGMA table_info(locais)").all();
  const nomes = colunas.map((c) => c.name);
  const esperadas = [
    "id", "nome", "apelido", "cor", "endereco", "contato", "observacao",
    "modo_valor", "valor_padrao",
    "regra_tipo", "regra_dia_pagamento", "regra_dias_apos", "regra_dia_fechamento",
    "regra_meses_adiante", "ajuste_dia_util", "desconto_percentual",
    "criado_em", "atualizado_em", "arquivado_em",
  ];
  const faltando = esperadas.filter((c) => !nomes.includes(c));
  check("locais tem todas as colunas previstas", faltando.length === 0, faltando.join(", "));

  // Insercao minima: so nome e os carimbos de tempo sao obrigatorios.
  const agora = Date.now();
  db.prepare("INSERT INTO locais (nome, criado_em, atualizado_em) VALUES (?, ?, ?)").run(
    "Hospital Central",
    agora,
    agora,
  );
  const local = db.prepare("SELECT * FROM locais WHERE nome = ?").get("Hospital Central");
  check(
    "padroes preenchem a regra de pagamento",
    local.modo_valor === "plantao" &&
      local.regra_tipo === "dia_mes_seguinte" &&
      local.regra_meses_adiante === 1 &&
      local.ajuste_dia_util === "proximo" &&
      local.desconto_percentual === 0 &&
      local.valor_padrao === 0,
    `${local.modo_valor}/${local.regra_tipo}/${local.ajuste_dia_util}`,
  );

  // Os CHECK existem para o banco nunca guardar um estado que o app nao sabe ler.
  const recusa = (sql, valores) => {
    try {
      db.prepare(sql).run(...valores);
      return false;
    } catch {
      return true;
    }
  };

  check(
    "recusa modo_valor fora do permitido",
    recusa("INSERT INTO locais (nome, modo_valor, criado_em, atualizado_em) VALUES (?, ?, ?, ?)", [
      "X", "mensal", agora, agora,
    ]),
  );
  check(
    "recusa regra_tipo desconhecida",
    recusa("INSERT INTO locais (nome, regra_tipo, criado_em, atualizado_em) VALUES (?, ?, ?, ?)", [
      "X", "quando_der", agora, agora,
    ]),
  );
  check(
    "recusa desconto acima de 100%",
    recusa(
      "INSERT INTO locais (nome, desconto_percentual, criado_em, atualizado_em) VALUES (?, ?, ?, ?)",
      ["X", 120, agora, agora],
    ),
  );
  check(
    "recusa nome nulo",
    recusa("INSERT INTO locais (nome, criado_em, atualizado_em) VALUES (?, ?, ?)", [
      null, agora, agora,
    ]),
  );

  const indices = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='locais'")
    .all()
    .map((r) => r.name);
  check("indice de locais ativos existe", indices.includes("idx_locais_ativos"), indices.join(", "));

  // Reaplicar as migracoes num banco ja migrado nao pode fazer nada.
  const antes = db.prepare("PRAGMA user_version").get().user_version;
  for (const m of migracoes) if (m.versao > antes) db.exec(m.sql);
  check("migrar de novo e inofensivo", db.prepare("PRAGMA user_version").get().user_version === antes);

  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
