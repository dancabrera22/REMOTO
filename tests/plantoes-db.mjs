/**
 * Plantoes no banco: a migracao, a integridade e as consultas da agenda.
 *
 * O primeiro bloco e o que mais importa: quem ja tem locais cadastrados (Etapa
 * 2) precisa chegar a tabela de plantoes sem perder nada. Os comandos SQL sao
 * os do app (via o adaptador do `node:sqlite`).
 */
import {
  atualizaPlantao,
  buscaPlantao,
  contaPlantoesDoLocal,
  criaPlantao,
  excluiPlantao,
  listaPlantoesPeriodo,
  mudaStatusPlantao,
} from "../src/db/plantoes.ts";
import { arquivaLocal, buscaLocal, criaLocal } from "../src/db/locais.ts";
import { fimDoDia, fimDoMes, inicioDoDia, inicioDoMes, instante } from "../src/lib/datetime.ts";
import { localVazio } from "../src/lib/locais.ts";
import { migracoes } from "../src/db/migrations.ts";
import { adaptador, bancoMigrado, migraAte } from "./esquema.mjs";
import { check, igual, report } from "./helpers.mjs";

const novoLocal = (extra = {}) => ({ ...localVazio(), nome: "Hospital Central", valorPadrao: 120000, ...extra });
const novoPlantao = (localId, extra = {}) => ({
  localId,
  inicio: instante(2026, 10, 14, 7),
  fim: instante(2026, 10, 14, 19),
  valorBruto: 120000,
  descontoPercentual: 0,
  status: "agendado",
  observacao: null,
  ...extra,
});

const rejeita = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

export async function testes() {
  /* ------------------------ atualizacao de quem ja tem dados ------------------------ */

  const v1 = bancoMigrado(1);
  igual("o banco da Etapa 2 esta na versao 1", v1.versao, 1);
  const ex1 = adaptador(v1.db);
  const idAntigo = await criaLocal(ex1, novoLocal({ nome: "Local da Etapa 2", apelido: "E2" }), 111);
  await criaLocal(ex1, novoLocal({ nome: "Outro", valorPadrao: 90000 }), 222);

  igual("antes: nao existe tabela de plantoes", v1.db.prepare("SELECT name FROM sqlite_master WHERE name='plantoes'").all().length, 0);

  const versaoFinal = migraAte(v1.db);
  igual("atualizar leva a versao corrente", versaoFinal, migracoes[migracoes.length - 1].versao);
  igual("depois: a tabela de plantoes existe", v1.db.prepare("SELECT name FROM sqlite_master WHERE name='plantoes'").all().length, 1);

  const preservado = await buscaLocal(ex1, idAntigo);
  igual("o local cadastrado antes continua la", preservado?.nome, "Local da Etapa 2");
  igual("com o apelido", preservado?.apelido, "E2");
  igual("e o carimbo de criacao intacto", preservado?.criadoEm, 111);
  const total = v1.db.prepare("SELECT COUNT(*) AS n FROM locais").get().n;
  igual("nenhum local foi perdido", total, 2);

  const pAposAtualizar = await criaPlantao(ex1, novoPlantao(idAntigo));
  check("e o banco atualizado ja aceita plantoes", pAposAtualizar > 0);

  /* -------------------------------- esquema novo -------------------------------- */

  const { db } = bancoMigrado();
  const ex = adaptador(db);

  const colunas = db.prepare("PRAGMA table_info(plantoes)").all().map((c) => c.name);
  const esperadas = ["id", "local_id", "inicio", "fim", "valor_bruto", "desconto_percentual", "status", "observacao", "criado_em", "atualizado_em"];
  igual("plantoes tem todas as colunas previstas", esperadas.filter((c) => !colunas.includes(c)).join(","), "");

  const indices = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='plantoes'").all().map((r) => r.name);
  check("indices por inicio e por local existem", indices.includes("idx_plantoes_inicio") && indices.includes("idx_plantoes_local"), indices.join(", "));

  const local = await criaLocal(ex, novoLocal({ cor: "#2F6FED", nome: "Hospital Central", apelido: "HC" }));
  const outro = await criaLocal(ex, novoLocal({ cor: "#1E9E5B", nome: "UPA Norte" }));

  /* ----------------------------------- integridade ----------------------------------- */

  check("recusa plantao de um local inexistente (chave estrangeira)", await rejeita(() => criaPlantao(ex, novoPlantao(9999))));
  check("recusa fim igual ao inicio", await rejeita(() => criaPlantao(ex, novoPlantao(local, { fim: instante(2026, 10, 14, 7) }))));
  check("recusa fim antes do inicio", await rejeita(() => criaPlantao(ex, novoPlantao(local, { fim: instante(2026, 10, 14, 6) }))));
  check("recusa situacao desconhecida", await rejeita(() => criaPlantao(ex, novoPlantao(local, { status: "talvez" }))));
  check("recusa valor negativo", await rejeita(() => criaPlantao(ex, novoPlantao(local, { valorBruto: -1 }))));
  check("recusa desconto acima de 100", await rejeita(() => criaPlantao(ex, novoPlantao(local, { descontoPercentual: 101 }))));
  check("recusa excluir um local que tem plantoes", await rejeita(async () => {
    await criaPlantao(ex, novoPlantao(local));
    db.prepare("DELETE FROM locais WHERE id = ?").run(local);
  }));
  igual("e o local segue la depois da tentativa", (await buscaLocal(ex, local))?.nome, "Hospital Central");

  /* ------------------------------------ gravar e ler ------------------------------------ */

  const { db: db2 } = bancoMigrado();
  const e2 = adaptador(db2);
  const L1 = await criaLocal(e2, novoLocal({ cor: "#2F6FED", nome: "Hospital Central", apelido: "HC" }));
  const L2 = await criaLocal(e2, novoLocal({ cor: "#1E9E5B", nome: "UPA Norte" }));

  const id = await criaPlantao(
    e2,
    novoPlantao(L1, { valorBruto: 123456, descontoPercentual: 11.5, status: "realizado", observacao: "  trocou com o Dr. X  " }),
    5000,
  );
  const lido = await buscaPlantao(e2, id);
  igual("valor em centavos inteiros", lido.valorBruto, 123456);
  igual("desconto fracionado", lido.descontoPercentual, 11.5);
  igual("situacao", lido.status, "realizado");
  igual("observacao sem espacos nas pontas", lido.observacao, "trocou com o Dr. X");
  igual("carimbo de criacao", lido.criadoEm, 5000);
  igual("traz o nome do local junto", lido.local.nome, "Hospital Central");
  igual("traz o apelido", lido.local.apelido, "HC");
  igual("traz a cor do local", lido.local.cor, "#2F6FED");
  igual("local ativo nao vem como arquivado", lido.local.arquivado, false);

  igual("observacao vazia vira nula", (await buscaPlantao(e2, await criaPlantao(e2, novoPlantao(L1, { observacao: "   " }))))?.observacao, null);
  igual("observacao acima do limite e truncada", (await buscaPlantao(e2, await criaPlantao(e2, novoPlantao(L1, { observacao: "x".repeat(900) }))))?.observacao.length, 300);
  igual("buscar inexistente devolve null", await buscaPlantao(e2, 9999), null);

  /* ------------------------------------- copia do valor ------------------------------------- */

  // O motivo de o valor morar no plantao: reajustar o local nao pode mexer no que ja foi lancado.
  const antes = (await buscaPlantao(e2, id)).valorBruto;
  db2.prepare("UPDATE locais SET valor_padrao = 999999, desconto_percentual = 50 WHERE id = ?").run(L1);
  igual("reajustar o local nao muda plantoes ja lancados (valor)", (await buscaPlantao(e2, id)).valorBruto, antes);
  igual("nem o desconto", (await buscaPlantao(e2, id)).descontoPercentual, 11.5);

  /* ------------------------------------ atualizar ------------------------------------ */

  check(
    "atualizar devolve true",
    await atualizaPlantao(e2, id, novoPlantao(L2, { valorBruto: 50000, status: "agendado" }), 9000),
  );
  const mudou = await buscaPlantao(e2, id);
  igual("trocou de local", mudou.local.nome, "UPA Norte");
  igual("novo valor", mudou.valorBruto, 50000);
  igual("preserva a criacao", mudou.criadoEm, 5000);
  igual("carimba a alteracao", mudou.atualizadoEm, 9000);
  check("atualizar inexistente devolve false", !(await atualizaPlantao(e2, 9999, novoPlantao(L1))));

  check("mudar so a situacao", await mudaStatusPlantao(e2, id, "cancelado", 9500));
  igual("situacao mudou", (await buscaPlantao(e2, id)).status, "cancelado");
  igual("e o carimbo", (await buscaPlantao(e2, id)).atualizadoEm, 9500);
  igual("o resto ficou como estava", (await buscaPlantao(e2, id)).valorBruto, 50000);
  check("mudar situacao de inexistente devolve false", !(await mudaStatusPlantao(e2, 9999, "realizado")));
  check("situacao invalida e recusada pelo banco", await rejeita(() => mudaStatusPlantao(e2, id, "talvez")));

  /* ------------------------------------ periodo ------------------------------------ */

  const { db: db3 } = bancoMigrado();
  const e3 = adaptador(db3);
  const A = await criaLocal(e3, novoLocal({ nome: "A", cor: "#2F6FED" }));

  const nov = (d, h = 7, extra = {}) => novoPlantao(A, { inicio: instante(2026, 10, d, h), fim: instante(2026, 10, d, h + 1), ...extra });
  await criaPlantao(e3, nov(30, 19, { inicio: instante(2026, 10, 30, 19), fim: instante(2026, 10, 31, 7) }));
  const ultimoMinuto = await criaPlantao(e3, novoPlantao(A, { inicio: instante(2026, 10, 30, 23, 59), fim: instante(2026, 10, 31, 6) }));
  const primeiroMinuto = await criaPlantao(e3, novoPlantao(A, { inicio: instante(2026, 11, 1, 0, 0), fim: instante(2026, 11, 1, 6) }));
  await criaPlantao(e3, nov(1, 7));
  await criaPlantao(e3, nov(15, 13));
  await criaPlantao(e3, nov(15, 7));
  await criaPlantao(e3, novoPlantao(A, { inicio: instante(2026, 9, 31, 22), fim: instante(2026, 10, 1, 6) })); // 31/10 22h: sai em novembro

  const novembro = await listaPlantoesPeriodo(e3, inicioDoMes(instante(2026, 10, 14)), fimDoMes(instante(2026, 10, 14)));
  const dias = novembro.map((p) => `${new Date(p.inicio).getDate()}@${new Date(p.inicio).getHours()}`).join(" ");
  igual("novembro, em ordem de horario", dias, "1@7 15@7 15@13 30@19 30@23");
  check("plantao das 23:59 do dia 30 e de novembro", novembro.some((p) => p.id === ultimoMinuto));
  check("plantao das 00:00 de 01/12 NAO e de novembro", !novembro.some((p) => p.id === primeiroMinuto));
  check("plantao de 31/10 22h NAO e de novembro, mesmo saindo em novembro", !dias.includes("31"));

  const dezembro = await listaPlantoesPeriodo(e3, inicioDoMes(instante(2026, 11, 14)), fimDoMes(instante(2026, 11, 14)));
  igual("o das 00:00 de dezembro e de dezembro", dezembro.length, 1);

  const so15 = await listaPlantoesPeriodo(e3, inicioDoDia(instante(2026, 10, 15)), fimDoDia(instante(2026, 10, 15)));
  igual("um dia so", so15.length, 2);
  igual("periodo vazio devolve lista vazia", (await listaPlantoesPeriodo(e3, instante(2030, 0, 1), instante(2030, 0, 2))).length, 0);

  // Empate de horario: a ordem e estavel, pelo id.
  const { db: db4 } = bancoMigrado();
  const e4 = adaptador(db4);
  const B = await criaLocal(e4, novoLocal({ nome: "B" }));
  const p1 = await criaPlantao(e4, novoPlantao(B));
  const p2 = await criaPlantao(e4, novoPlantao(B));
  igual("empate de horario desempata pelo id", (await listaPlantoesPeriodo(e4, 0, Date.now() * 2)).map((p) => p.id).join(), `${p1},${p2}`);

  /* --------------------------------- local arquivado --------------------------------- */

  await criaPlantao(e4, novoPlantao(B, { inicio: instante(2026, 10, 20, 7), fim: instante(2026, 10, 20, 19) }));
  await arquivaLocal(e4, B);
  const comArquivado = await listaPlantoesPeriodo(e4, 0, Date.now() * 2);
  igual("plantoes de local arquivado continuam na agenda", comArquivado.length, 3);
  check("e sinalizam que o local esta arquivado", comArquivado.every((p) => p.local.arquivado === true));
  igual("contagem de plantoes do local", await contaPlantoesDoLocal(e4, B), 3);
  igual("local sem plantoes", await contaPlantoesDoLocal(e4, 12345), 0);

  /* ------------------------------------- excluir ------------------------------------- */

  check("excluir devolve true", await excluiPlantao(e4, p1));
  igual("some do banco", await buscaPlantao(e4, p1), null);
  check("excluir de novo devolve false", !(await excluiPlantao(e4, p1)));
  igual("os outros ficam", (await listaPlantoesPeriodo(e4, 0, Date.now() * 2)).length, 2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await testes();
  process.exit(report() ? 0 : 1);
}
