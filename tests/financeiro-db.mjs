/**
 * Financeiro no banco: a consulta, a baixa em lote e o que nunca pode acontecer
 * (pagar o que nao houve, sobrescrever a data de quem ja recebeu, deixar um
 * lote pela metade). Os comandos SQL sao os do app.
 */
import { arquivaLocal, criaLocal } from "../src/db/locais.ts";
import { baixaPlantoes, desfazBaixa, listaPlantoesFinanceiro } from "../src/db/financeiro.ts";
import { inicioDoDia, instante } from "../src/lib/datetime.ts";
import { agrupaRecebimentos, itensFinanceiros } from "../src/lib/financeiro.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

const AGORA = instante(2026, 10, 16, 10); // segunda, 16/11/2026
const d = (ano, mes, dia) => instante(ano, mes - 1, dia);

const novoLocal = (extra = {}) => ({ ...localVazio(), nome: "Hospital Central", valorPadrao: 120000, ...extra });

async function cenario() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const a = await criaLocal(ex, novoLocal({ nome: "Hospital A", descontoPercentual: 10, cor: "#2F6FED" }), 1);
  const b = await criaLocal(ex, novoLocal({ nome: "UPA B", cor: "#1E9E5B" }), 2);
  return { db, ex, a, b };
}

let seq = 0;
function insere(db, localId, diaInicio, extra = {}) {
  seq += 1;
  const r = db
    .prepare(
      `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, desconto_percentual, status, pago_em, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(localId, diaInicio, diaInicio + 12 * 3600e3, extra.valor ?? 100000, extra.desconto ?? 0, extra.status ?? "realizado", extra.pagoEm ?? null);
  return Number(r.lastInsertRowid);
}

const linha = (db, id) => ({ ...db.prepare("SELECT status, pago_em, atualizado_em FROM plantoes WHERE id = ?").get(id) });
const foto = (db) => JSON.stringify(db.prepare("SELECT * FROM plantoes ORDER BY id").all().map((l) => ({ ...l })));
const rejeita = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

function comFalha(ex, contador, falhaEm) {
  const envolve = (base) => ({
    getAllAsync: (...a) => base.getAllAsync(...a),
    getFirstAsync: (...a) => base.getFirstAsync(...a),
    runAsync: (...a) => {
      contador.n += 1;
      if (contador.n === falhaEm) throw new Error(`falha injetada no comando ${contador.n}`);
      return base.runAsync(...a);
    },
    transacao: (fn) => base.transacao((interno) => fn(envolve(interno))),
  });
  return envolve(ex);
}

export async function testes() {
  /* --------------------------------- consulta --------------------------------- */

  {
    const { db, ex, a, b } = await cenario();
    const p1 = insere(db, a, d(2026, 10, 5), { desconto: 10 });
    insere(db, a, d(2026, 10, 6), { status: "cancelado" });
    insere(db, b, d(2026, 10, 7), { status: "trocado" });
    const p4 = insere(db, b, d(2026, 11, 20), { status: "agendado" });
    const p5 = insere(db, b, d(2026, 9, 1), { pagoEm: d(2026, 10, 3) });

    const lista = await listaPlantoesFinanceiro(ex);
    igual("so agendado e realizado entram", lista.length, 3);
    igual("em ordem de data", lista.map((p) => p.id).join(), `${p5},${p1},${p4}`);
    const x = lista.find((p) => p.id === p1);
    check("traz o desconto e o status", x.descontoPercentual === 10 && x.status === "realizado" && x.valorBruto === 100000);
    check("traz o local", x.local.nome === "Hospital A" && x.local.cor === "#2F6FED" && x.local.apelido === null);
    check("traz a regra de pagamento do local", x.local.regra.tipo === "dia_mes_seguinte" && x.local.regra.diaPagamento === 10 && x.local.regra.mesesAdiante === 1 && x.local.regra.ajusteDiaUtil === "proximo");
    igual("traz a data do pagamento", lista.find((p) => p.id === p5).pagoEm, d(2026, 10, 3));
    igual("e nulo quando nao foi pago", x.pagoEm, null);

    await arquivaLocal(ex, b, 9);
    igual("local arquivado continua na conta (o dinheiro ainda e devido)", (await listaPlantoesFinanceiro(ex)).length, 3);
  }

  /* ----------------------------------- baixa ----------------------------------- */

  {
    const { db, ex, a, b } = await cenario();
    const r1 = insere(db, a, d(2026, 10, 5));
    const r2 = insere(db, a, d(2026, 10, 20));
    const ag = insere(db, a, d(2026, 11, 10), { status: "agendado" });
    const canc = insere(db, a, d(2026, 10, 8), { status: "cancelado" });
    const troc = insere(db, b, d(2026, 10, 9), { status: "trocado" });
    const jaPago = insere(db, b, d(2026, 9, 1), { pagoEm: d(2026, 10, 3) });
    const intocado = insere(db, b, d(2026, 10, 25));

    const alvo = d(2026, 11, 12);
    const res = await baixaPlantoes(ex, [r1, r2, ag, canc, troc, jaPago, 99999], alvo, AGORA);
    igual("baixa tres plantoes (dois realizados e um agendado)", res.baixados, 3);
    igual("e ignora quatro (cancelado, trocado, ja pago, inexistente)", res.ignorados, 4);

    check("realizados ficam pagos na data", linha(db, r1).pago_em === alvo && linha(db, r2).pago_em === alvo);
    check("agendado vira realizado ao receber", linha(db, ag).status === "realizado" && linha(db, ag).pago_em === alvo);
    check("cancelado nao e pago", linha(db, canc).pago_em === null && linha(db, canc).status === "cancelado");
    check("trocado nao e pago", linha(db, troc).pago_em === null && linha(db, troc).status === "trocado");
    igual("quem ja tinha recebido mantem a data original", linha(db, jaPago).pago_em, d(2026, 10, 3));
    check("o que nao entrou no pedido fica como estava", linha(db, intocado).pago_em === null);
    igual("a data de edicao e atualizada so em quem mudou", linha(db, r1).atualizado_em, AGORA);
    igual("... e nao em quem foi ignorado", linha(db, jaPago).atualizado_em, 1);

    igual("repetir a baixa nao muda nada", (await baixaPlantoes(ex, [r1, r2], d(2026, 11, 14), AGORA)).baixados, 0);
    igual("... e a data continua a primeira", linha(db, r1).pago_em, alvo);
    const repetidos = await baixaPlantoes(ex, [intocado, intocado, intocado], alvo, AGORA);
    check("ids repetidos contam uma vez (nem ignorados a mais)", repetidos.baixados === 1 && repetidos.ignorados === 0, JSON.stringify(repetidos));
    igual("lista vazia: nada a fazer", JSON.stringify(await baixaPlantoes(ex, [], alvo, AGORA)), JSON.stringify({ baixados: 0, ignorados: 0 }));

    // A baixa chega ao motor: os itens passam a "recebido", na data do deposito.
    const itens = itensFinanceiros(await listaPlantoesFinanceiro(ex), AGORA);
    const recebidos = itens.filter((i) => i.estado === "recebido");
    igual("o motor ve os recebidos", recebidos.length, 5);
    check("e o grupo do deposito junta os plantoes do mesmo local", agrupaRecebimentos(itens).some((g) => g.estado === "recebido" && g.local.nome === "Hospital A" && g.itens.length === 3));
  }

  {
    // Data do recebimento.
    const { db, ex, a } = await cenario();
    const id = insere(db, a, d(2026, 10, 5));
    check("data no futuro e recusada", await rejeita(() => baixaPlantoes(ex, [id], d(2026, 11, 20), AGORA)));
    igual("... e nada foi marcado", linha(db, id).pago_em, null);
    check("data de hoje vale", (await baixaPlantoes(ex, [id], AGORA, AGORA)).baixados === 1);
    check("data invalida e recusada", await rejeita(() => baixaPlantoes(ex, [id], Number.NaN, AGORA)));
    const ontem = insere(db, a, d(2026, 10, 6));
    check("hoje as 23:59 vale", (await baixaPlantoes(ex, [ontem], instante(2026, 10, 16, 23, 59), AGORA)).baixados === 1);
    const amanha = insere(db, a, d(2026, 10, 7));
    check("amanha as 00:01 nao vale", await rejeita(() => baixaPlantoes(ex, [amanha], instante(2026, 10, 17, 0, 1), AGORA)));
  }

  {
    // Muitos plantoes: o lote respeita o limite de variaveis do SQLite.
    const { db, ex, a } = await cenario();
    const ids = [];
    for (let i = 0; i < 1000; i++) ids.push(insere(db, a, d(2026, 1, 1) + i * 3600e3));
    const r = await baixaPlantoes(ex, ids, d(2026, 11, 10), AGORA);
    igual("mil plantoes de uma vez", r.baixados, 1000);
    igual("todos pagos", db.prepare("SELECT COUNT(*) AS n FROM plantoes WHERE pago_em IS NOT NULL").get().n, 1000);
    igual("desfazer mil de uma vez", await desfazBaixa(ex, ids, AGORA), 1000);
    igual("nenhum segue pago", db.prepare("SELECT COUNT(*) AS n FROM plantoes WHERE pago_em IS NOT NULL").get().n, 0);
  }

  /* ----------------------------------- desfazer ----------------------------------- */

  {
    const { db, ex, a } = await cenario();
    const p1 = insere(db, a, d(2026, 10, 5), { pagoEm: d(2026, 11, 1) });
    const p2 = insere(db, a, d(2026, 10, 6), { pagoEm: d(2026, 11, 1) });
    const livre = insere(db, a, d(2026, 10, 7));
    igual("desfaz os pagos e so eles", await desfazBaixa(ex, [p1, livre], AGORA), 1);
    check("o desfeito segue realizado, sem data de pagamento", linha(db, p1).status === "realizado" && linha(db, p1).pago_em === null);
    igual("o outro continua pago", linha(db, p2).pago_em, d(2026, 11, 1));
    igual("desfazer de novo nao muda nada", await desfazBaixa(ex, [p1], AGORA), 0);
    igual("lista vazia", await desfazBaixa(ex, [], AGORA), 0);
    igual("depois de desfazer, volta a ser a receber para o motor", itensFinanceiros(await listaPlantoesFinanceiro(ex), AGORA).find((i) => i.id === p1).estado, "atrasado");
  }

  /* ------------------------------ falha no meio ------------------------------ */

  for (const [nome, operacao, esperado] of [
    ["baixa em lote", (ex, c) => baixaPlantoes(ex, c.ids, d(2026, 11, 10), AGORA), 3],
    ["desfazer em lote", (ex, c) => desfazBaixa(ex, c.pagos, AGORA), 3],
  ]) {
    const prepara = async () => {
      const c = await cenario();
      c.ids = [];
      c.pagos = [];
      for (let i = 0; i < 900; i++) c.ids.push(insere(c.db, c.a, d(2026, 1, 1) + i * 3600e3));
      for (let i = 0; i < 900; i++) c.pagos.push(insere(c.db, c.a, d(2026, 2, 1) + i * 3600e3, { pagoEm: d(2026, 3, 1) }));
      return c;
    };
    const contador = { n: 0 };
    const seco = await prepara();
    await operacao(comFalha(seco.ex, contador, Infinity), seco);
    const total = contador.n;
    igual(`${nome}: cada operacao e feita em ${esperado} lotes`, total, esperado);

    let preservou = 0;
    let estourou = 0;
    for (let n = 1; n <= total; n++) {
      const c = await prepara();
      const antes = foto(c.db);
      let erro = null;
      try {
        await operacao(comFalha(c.ex, { n: 0 }, n), c);
      } catch (e) {
        erro = e;
      }
      if (erro) estourou += 1;
      if (erro && foto(c.db) === antes) preservou += 1;
    }
    check(`${nome}: falha em qualquer lote nao deixa nada pela metade`, estourou === total && preservou === total, `${preservou}/${total} revertidos`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
