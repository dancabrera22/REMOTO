/**
 * Unidade no banco: a migracao de quem ja tem dados, gravar e ler, as sugestoes e as escalas
 * (a unidade vai para cada plantao da escala, e uma edicao em serie nao a perde nem a
 * sobrescreve onde a pessoa mexeu a mao). Os comandos SQL sao os do app.
 */
import { criaLocal } from "../src/db/locais.ts";
import { atualizaPlantao, buscaPlantao, criaPlantao, listaPlantoesPeriodo, unidadesDoLocal } from "../src/db/plantoes.ts";
import { buscaSerie, criaSerie, editaSerie } from "../src/db/series.ts";
import { inicioDoDia, instante, somaDias } from "../src/lib/datetime.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado, migraAte } from "./esquema.mjs";
import { check, igual, report } from "./helpers.mjs";

const AGORA = instante(2026, 10, 15, 10);
const dia = (d, m, a = 2026) => instante(a, m - 1, d);

const novoLocal = (extra = {}) => ({ ...localVazio(), nome: "Rede D'Or", valorPadrao: 0, ...extra });
const novoPlantao = (localId, extra = {}) => ({
  localId,
  unidade: null,
  inicio: instante(2026, 10, 20, 7),
  fim: instante(2026, 10, 20, 19),
  valorBruto: 150000,
  descontoPercentual: 0,
  status: "agendado",
  observacao: null,
  ...extra,
});

const todos = (db, sql, ...p) => db.prepare(sql).all(...p).map((l) => ({ ...l }));
const daSerie = (db, serieId) => todos(db, "SELECT * FROM plantoes WHERE serie_id = ? ORDER BY ocorrencia_dia", serieId);

const tercas = (localId, extra = {}) => ({
  localId,
  unidade: "Itaim",
  inicioMin: 7 * 60,
  fimMin: 19 * 60,
  valorBruto: 150000,
  descontoPercentual: 0,
  observacao: null,
  regra: { tipo: "semanal", diasSemana: 1 << 2, cada: 1, diaDoMes: null, inicioDia: dia(17, 11), fimDia: null },
  ...extra,
});

export async function testes() {
  /* ------------------------ quem ja tem dados (banco da versao 4) ------------------------ */

  const v4 = bancoMigrado(4);
  const ex4 = adaptador(v4.db);
  const locAntigo = await criaLocal(ex4, novoLocal({ nome: "Hospital Central", apelido: "HC", valorPadrao: 120000 }), 111);
  v4.db
    .prepare(
      `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, desconto_percentual, status, observacao, criado_em, atualizado_em)
       VALUES (?, ?, ?, 120000, 11.5, 'realizado', 'plantao de antes', 222, 333)`,
    )
    .run(locAntigo, instante(2026, 9, 3, 19), instante(2026, 9, 4, 7));
  v4.db
    .prepare(
      `INSERT INTO series (local_id, tipo, dias_semana, cada, inicio_dia, inicio_min, fim_min, valor_bruto, observacao, gerado_ate, criado_em, atualizado_em)
       VALUES (?, 'semanal', 4, 1, ?, 420, 1140, 120000, 'escala antiga', 0, 444, 444)`,
    )
    .run(locAntigo, dia(17, 11));
  igual("o banco antigo esta na versao 4", v4.versao, 4);
  check("e ainda nao tem a coluna", !todos(v4.db, "PRAGMA table_info(plantoes)").some((c) => c.name === "unidade"));

  migraAte(v4.db);
  check("depois de atualizar, plantoes tem a coluna unidade", todos(v4.db, "PRAGMA table_info(plantoes)").some((c) => c.name === "unidade"));
  check("e as escalas tambem", todos(v4.db, "PRAGMA table_info(series)").some((c) => c.name === "unidade"));
  const antigo = todos(v4.db, "SELECT * FROM plantoes")[0];
  igual("o plantao de antes continua la, sem unidade", antigo.unidade, null);
  igual("com o valor de antes", antigo.valor_bruto, 120000);
  igual("o desconto de antes", antigo.desconto_percentual, 11.5);
  igual("a observacao de antes", antigo.observacao, "plantao de antes");
  igual("o carimbo de antes", antigo.atualizado_em, 333);
  igual("a escala de antes continua la, sem unidade", todos(v4.db, "SELECT unidade, observacao FROM series")[0].observacao, "escala antiga");
  igual("e sem unidade", todos(v4.db, "SELECT unidade FROM series")[0].unidade, null);
  igual("o local antigo continua com o valor padrao dele", todos(v4.db, "SELECT valor_padrao FROM locais")[0].valor_padrao, 120000);

  const lido = await buscaPlantao(ex4, antigo.id);
  igual("o plantao antigo e lido com unidade nula", lido?.unidade, null);
  const novoDepois = await criaPlantao(ex4, novoPlantao(locAntigo, { unidade: "Itaim" }));
  igual("e o banco atualizado ja grava unidade", (await buscaPlantao(ex4, novoDepois))?.unidade, "Itaim");

  /* ------------------------------- gravar e ler ------------------------------- */

  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const rede = await criaLocal(ex, novoLocal(), 1);
  const outra = await criaLocal(ex, novoLocal({ nome: "Hospital Central" }), 2);

  const a = await criaPlantao(ex, novoPlantao(rede, { unidade: "  Itaim   " }));
  igual("a unidade e gravada normalizada", (await buscaPlantao(ex, a))?.unidade, "Itaim");
  const b = await criaPlantao(ex, novoPlantao(rede, { unidade: "   " }));
  igual("so espacos vira sem unidade", (await buscaPlantao(ex, b))?.unidade, null);
  const c = await criaPlantao(ex, novoPlantao(rede, { unidade: undefined }));
  igual("campo ausente tambem", (await buscaPlantao(ex, c))?.unidade, null);

  await atualizaPlantao(ex, a, novoPlantao(rede, { unidade: "Central" }));
  igual("editar muda a unidade", (await buscaPlantao(ex, a))?.unidade, "Central");
  await atualizaPlantao(ex, a, novoPlantao(rede, { unidade: null }));
  igual("e tirar a unidade tambem", (await buscaPlantao(ex, a))?.unidade, null);

  const lista = await listaPlantoesPeriodo(ex, instante(2026, 10, 1), instante(2026, 10, 30));
  check("a lista da agenda traz a unidade de cada plantao", lista.every((p) => "unidade" in p));

  /* ---------------------------------- sugestoes ---------------------------------- */

  const ini = (d, h) => instante(2026, 9, d, h);
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Itaim", inicio: ini(2, 7), fim: ini(2, 19), valorBruto: 140000, status: "realizado" }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "itaim", inicio: ini(9, 7), fim: ini(9, 19), valorBruto: 150000, status: "realizado" }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Itaim", inicio: ini(12, 7), fim: ini(13, 7), valorBruto: 280000, status: "realizado" }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Central", inicio: ini(6, 7), fim: ini(6, 19), valorBruto: 120000, status: "realizado" }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Cancelada", inicio: ini(20, 7), fim: ini(20, 19), valorBruto: 1, status: "cancelado" }));
  await criaPlantao(ex, novoPlantao(outra, { unidade: "Outro hospital", inicio: ini(21, 7), fim: ini(21, 19), valorBruto: 99900, status: "realizado" }));

  const sug = await unidadesDoLocal(ex, rede);
  igual("so as unidades DESTE local, sem as canceladas", sug.map((s) => s.unidade).join(","), "Itaim,Central");
  igual("o ultimo valor de 12 h do Itaim", sug[0].valorPorMinutos[12 * 60], 150000);
  igual("o de 24 h", sug[0].valorPorMinutos[24 * 60], 280000);
  igual("a grafia: a do uso mais recente (a de 12/10 foi a de 24 h, 'Itaim')", sug[0].unidade, "Itaim");
  igual("quantos usos", sug[0].usos, 3);
  igual("o outro local tem as dele", (await unidadesDoLocal(ex, outra)).map((s) => s.unidade).join(","), "Outro hospital");
  igual("local sem unidade: lista vazia", (await unidadesDoLocal(ex, 9999)).length, 0);

  // O limite de 500 leituras nao pode esconder o que importa: vale o mais RECENTE, e cancelado nao ocupa vaga.
  {
    const { db: dbg } = bancoMigrado();
    const exg = adaptador(dbg);
    const loc = await criaLocal(exg, novoLocal(), 1);
    const insere = dbg.prepare(
      `INSERT INTO plantoes (local_id, unidade, inicio, fim, valor_bruto, status, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
    );
    const base = instante(2020, 0, 1, 7);
    for (let k = 0; k < 520; k++) insere.run(loc, "Velha", base + k * 86400e3, base + k * 86400e3 + 12 * 3600e3, 10000 + k, "realizado");
    const recente = instante(2026, 10, 1, 7);
    insere.run(loc, "Nova", recente, recente + 12 * 3600e3, 150000, "realizado");
    for (let k = 0; k < 510; k++) insere.run(loc, "Fantasma", recente + (k + 1) * 86400e3, recente + (k + 1) * 86400e3 + 3600e3, 1, "cancelado");
    const grande = await unidadesDoLocal(exg, loc);
    igual("com mais de 500 plantoes, a unidade mais recente nao some", grande.some((u) => u.unidade === "Nova"), true);
    igual("e o cancelado nao toma o lugar de ninguem (nem vira unidade)", grande.map((u) => u.unidade).join(","), "Nova,Velha");
    igual("o valor de Nova e o dela", grande[0].ultimoValor, 150000);
  }

  /* ------------------------------------ escalas ------------------------------------ */

  const { db: db2 } = bancoMigrado();
  const ex2 = adaptador(db2);
  const loc2 = await criaLocal(ex2, novoLocal(), 1);

  const { serieId, criados } = await criaSerie(ex2, tercas(loc2), AGORA);
  check("a escala criou plantoes", criados > 10, String(criados));
  igual("a escala guarda a unidade", (await buscaSerie(ex2, serieId))?.unidade, "Itaim");
  igual("todos os plantoes dela a levam", daSerie(db2, serieId).every((p) => p.unidade === "Itaim"), true);

  // uma excecao e um fato consumado
  const todosOsPlantoes = daSerie(db2, serieId);
  const [p1, p2, p3, p4] = todosOsPlantoes;
  await atualizaPlantao(ex2, p2.id, novoPlantao(loc2, { unidade: "Central", inicio: p2.inicio, fim: p2.fim, valorBruto: 150000 }));
  igual("trocar a unidade de UM plantao o torna excecao", todos(db2, "SELECT excecao FROM plantoes WHERE id = ?", p2.id)[0].excecao, 1);
  await atualizaPlantao(ex2, p3.id, novoPlantao(loc2, { unidade: "Itaim", inicio: p3.inicio, fim: p3.fim, valorBruto: 150000, status: "realizado" }));
  igual("outro ficou realizado (fato)", todos(db2, "SELECT status FROM plantoes WHERE id = ?", p3.id)[0].status, "realizado");

  // editar a escala toda: unidade nova
  await editaSerie(ex2, p1.id, "todos", tercas(loc2, { unidade: "Pinheiros" }), AGORA);
  const depois = daSerie(db2, serieId);
  igual("a escala passa a ter a unidade nova", (await buscaSerie(ex2, serieId))?.unidade, "Pinheiros");
  const porId = (id) => depois.find((p) => p.id === id);
  igual("o plantao normal muda de unidade, mantendo o id", porId(p1.id)?.unidade, "Pinheiros");
  igual("o plantao seguinte tambem", porId(p4.id)?.unidade, "Pinheiros");
  igual("a excecao (ajustada a mao) NAO e sobrescrita", porId(p2.id)?.unidade, "Central");
  igual("o realizado NAO e sobrescrito", porId(p3.id)?.unidade, "Itaim");
  igual("ninguem foi apagado nem duplicado", depois.length, todosOsPlantoes.length);

  // tirar a unidade da escala
  await editaSerie(ex2, p1.id, "todos", tercas(loc2, { unidade: null }), AGORA);
  igual("tirar a unidade da escala limpa os plantoes normais", porId(p1.id) && daSerie(db2, serieId).find((p) => p.id === p1.id)?.unidade, null);

  // excecao que volta a ser igual ao modelo volta a ser normal
  await atualizaPlantao(ex2, p2.id, novoPlantao(loc2, { unidade: null, inicio: p2.inicio, fim: p2.fim, valorBruto: 150000 }));
  igual("a excecao que volta a ser igual ao modelo deixa de ser excecao", todos(db2, "SELECT excecao FROM plantoes WHERE id = ?", p2.id)[0].excecao, 0);

  // "este e os proximos" divide a escala: a nova tem a unidade nova, a antiga fica como estava
  const { db: db3 } = bancoMigrado();
  const ex3 = adaptador(db3);
  const loc3 = await criaLocal(ex3, novoLocal(), 1);
  const { serieId: s3 } = await criaSerie(ex3, tercas(loc3, { unidade: "Itaim" }), AGORA);
  const lista3 = daSerie(db3, s3);
  const meio = lista3[5];
  const novaId = await editaSerie(ex3, meio.id, "proximos", tercas(loc3, { unidade: "Central", regra: { ...tercas(loc3).regra, inicioDia: meio.ocorrencia_dia } }), AGORA);
  check("dividiu em duas escalas", novaId !== s3 && novaId !== null);
  const depois3 = todos(db3, "SELECT id, serie_id, ocorrencia_dia, unidade FROM plantoes ORDER BY ocorrencia_dia");
  igual("antes do corte: Itaim", depois3.filter((p) => p.ocorrencia_dia < meio.ocorrencia_dia).every((p) => p.unidade === "Itaim"), true);
  igual("do corte em diante: Central", depois3.filter((p) => p.ocorrencia_dia >= meio.ocorrencia_dia).every((p) => p.unidade === "Central"), true);
  igual("a escala antiga continua Itaim", (await buscaSerie(ex3, s3))?.unidade, "Itaim");
  igual("a nova e Central", (await buscaSerie(ex3, novaId))?.unidade, "Central");

  // a agenda estende a escala sem data final: os novos plantoes tambem levam a unidade
  const { garanteHorizonte } = await import("../src/db/series.ts");
  const antes = daSerie(db3, novaId).length;
  await garanteHorizonte(ex3, somaDias(inicioDoDia(AGORA), 400), AGORA);
  const estendida = daSerie(db3, novaId);
  check("a agenda estendeu a escala", estendida.length > antes, `${antes} -> ${estendida.length}`);
  igual("e os plantoes novos levam a unidade", estendida.every((p) => p.unidade === "Central"), true);

}

if (import.meta.url === `file://${process.argv[1]}`) {
  await testes();
  process.exit(report() ? 0 : 1);
}
