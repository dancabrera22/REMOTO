/**
 * Motor financeiro: situacao de cada plantao, grupos de recebimento e somas.
 *
 * "Hoje" e 16/11/2026 (segunda). Tres locais com regras diferentes:
 *   A  paga dia 10 do mes seguinte, desconto de 10%
 *   B  paga 30 dias apos o plantao, sem ajuste de dia util
 *   C  paga dia 20 do mes seguinte (cai em feriado: 20/11/2026 e Consciencia Negra)
 * Todo plantao vale R$ 1.000,00 bruto e dura 12 h.
 */
import { agrupaRecebimentos, itensAtrasados, itensDoMes, itensFinanceiros, previsaoDosMeses, resumoDoMesFinanceiro, resumoDosAtrasos } from "../src/lib/financeiro.ts";
import { instante } from "../src/lib/datetime.ts";
import { check, igual } from "./helpers.mjs";

const d = (ano, mes, dia) => instante(ano, mes - 1, dia);
const HOJE = instante(2026, 10, 16, 10);

const regra = (extra) => ({ tipo: "dia_mes_seguinte", diaPagamento: 10, diasApos: null, diaFechamento: null, mesesAdiante: 1, ajusteDiaUtil: "proximo", ...extra });
const LOCAL = {
  A: { nome: "Hospital A", apelido: null, cor: "#2F6FED", regra: regra({}) },
  B: { nome: "UPA B", apelido: "B", cor: "#1E9E5B", regra: regra({ tipo: "dias_apos", diasApos: 30, diaPagamento: null, ajusteDiaUtil: "nenhum" }) },
  C: { nome: "Clinica C", apelido: null, cor: "#C2410C", regra: regra({ diaPagamento: 20 }) },
};
const LOCAL_ID = { A: 1, B: 2, C: 3 };

let seq = 0;
const plantao = (loc, dia, extra = {}) => ({
  id: ++seq,
  localId: LOCAL_ID[loc],
  inicio: instante(dia[0], dia[1] - 1, dia[2], 7),
  fim: instante(dia[0], dia[1] - 1, dia[2], 19),
  valorBruto: 100000,
  descontoPercentual: loc === "A" ? 10 : 0,
  status: "realizado",
  pagoEm: null,
  local: LOCAL[loc],
  ...extra,
});

export function testes() {
  seq = 0;
  const p1 = plantao("A", [2026, 10, 5]); // paga 10/11, ja passou: atrasado
  const p2 = plantao("A", [2026, 10, 20]); // paga 10/11: atrasado (mesmo grupo)
  const p3 = plantao("A", [2026, 11, 10]); // paga 10/12: a receber
  const p4 = plantao("A", [2026, 11, 25], { status: "agendado" }); // paga 10/12: previsto
  const p5 = plantao("A", [2026, 9, 3], { pagoEm: d(2026, 10, 12) }); // recebido
  const p6 = plantao("A", [2026, 10, 8], { status: "cancelado" }); // fora
  const p7 = plantao("B", [2026, 10, 20]); // +30 = 19/11: a receber
  const p8 = plantao("B", [2026, 12, 1], { status: "agendado" }); // 31/12: previsto
  const p9 = plantao("B", [2026, 9, 1]); // +30 = 01/10: atrasado
  const p10 = plantao("C", [2026, 10, 5]); // dia 20/11 e feriado: segunda 23/11
  const p11 = plantao("C", [2026, 10, 6], { status: "trocado" }); // fora
  const todos = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11];

  const itens = itensFinanceiros(todos, HOJE);
  const por = (p) => itens.find((i) => i.id === p.id);
  const dia = (ms) => (ms === null ? null : `${String(new Date(ms).getDate()).padStart(2, "0")}/${String(new Date(ms).getMonth() + 1).padStart(2, "0")}`);

  /* ------------------------------- situacao de cada um ------------------------------- */

  igual("cancelado e trocado nao viram item", itens.length, 9);
  check("cancelado fora", por(p6) === undefined);
  check("trocado fora", por(p11) === undefined);

  igual("p1: realizado com prazo vencido = atrasado", por(p1).estado, "atrasado");
  igual("p1: o prazo era 10/11", dia(por(p1).dataPrevista), "10/11");
  igual("p3: realizado dentro do prazo = a receber", por(p3).estado, "a_receber");
  igual("p3: paga 10/12", dia(por(p3).dataPrevista), "10/12");
  igual("p4: agendado = previsto", por(p4).estado, "previsto");
  igual("p5: com pagamento = recebido", por(p5).estado, "recebido");
  igual("p5: conta no dia do recebimento, nao no previsto", dia(por(p5).data), "12/10");
  igual("p7: por dias apos (+30) cai em 19/11, ainda no prazo", `${dia(por(p7).dataPrevista)} ${por(p7).estado}`, "19/11 a_receber");
  igual("p9: +30 em 01/10, vencido", `${dia(por(p9).dataPrevista)} ${por(p9).estado}`, "01/10 atrasado");
  igual("p10: a regra pediu dia 20 (feriado) e o ajuste leva para segunda 23", dia(por(p10).dataPrevista), "23/11");
  igual("liquido de A tem o desconto de 10%", por(p1).liquido, 90000);
  igual("liquido de B nao tem desconto", por(p7).liquido, 100000);
  igual("o item sabe de que local e", por(p7).local.nome, "UPA B");

  // Bordas do "atrasado": o proprio dia ainda e prazo.
  const venceHoje = itensFinanceiros([plantao("B", [2026, 10, 17])], d(2026, 11, 16)); // 17/10 + 30 = 16/11
  igual("prazo que vence hoje nao esta atrasado", venceHoje[0].estado, "a_receber");
  const ontem = itensFinanceiros([plantao("B", [2026, 10, 16])], d(2026, 11, 16)); // 16/10 + 30 = 15/11
  igual("prazo que venceu ontem esta atrasado", ontem[0].estado, "atrasado");
  igual("a hora de 'hoje' nao muda isso (23:59)", itensFinanceiros([plantao("B", [2026, 10, 17])], instante(2026, 10, 16, 23, 59))[0].estado, "a_receber");

  // Agendado que ja terminou: nao e atraso (nem se confirmou que aconteceu).
  const velhoAgendado = itensFinanceiros([plantao("A", [2026, 8, 1], { status: "agendado" })], HOJE)[0];
  igual("agendado com prazo vencido segue previsto (falta confirmar)", velhoAgendado.estado, "previsto");

  // Regra incompleta: o item existe, sem data.
  const semRegra = itensFinanceiros([plantao("A", [2026, 10, 5], { local: { ...LOCAL.A, regra: regra({ diaPagamento: null }) } })], HOJE)[0];
  check("regra incompleta: sem data prevista e sem data no calendario", semRegra.dataPrevista === null && semRegra.data === null);
  igual("... e nao conta como atrasado", semRegra.estado, "a_receber");

  /* ----------------------------------- grupos ----------------------------------- */

  const grupos = agrupaRecebimentos(itens);
  igual("7 grupos", grupos.length, 7);
  igual(
    "em ordem de data",
    grupos.map((g) => `${dia(g.data)}:${g.local.nome}`).join(" | "),
    "01/10:UPA B | 12/10:Hospital A | 10/11:Hospital A | 19/11:UPA B | 23/11:Clinica C | 10/12:Hospital A | 31/12:UPA B",
  );
  const g1011 = grupos.find((g) => dia(g.data) === "10/11");
  igual("o grupo de 10/11 junta os dois plantoes de A", g1011.itens.length, 2);
  igual("... soma o liquido (2 x 900)", g1011.total, 180000);
  igual("... e as horas (2 x 12 h)", g1011.minutos, 1440);
  igual("... e esta atrasado", g1011.estado, "atrasado");
  const g1012 = grupos.find((g) => dia(g.data) === "10/12");
  igual("grupo com a receber e previsto vale o mais urgente", g1012.estado, "a_receber");
  igual("... soma os dois", g1012.total, 180000);
  igual("os plantoes do grupo vem em ordem de data", g1012.itens.map((i) => i.id).join(), `${p3.id},${p4.id}`);
  igual("o recebido tem grupo proprio", grupos.find((g) => g.estado === "recebido").itens[0].id, p5.id);

  // A ordem de chegada nao pode importar: o menos urgente primeiro, e itens fora de ordem de data.
  const invertido = agrupaRecebimentos(itensFinanceiros([p4, p3], HOJE));
  igual("o grupo vale o mais urgente mesmo que o menos urgente chegue primeiro", invertido[0].estado, "a_receber");
  igual("os itens do grupo saem em ordem de data mesmo que cheguem fora dela", invertido[0].itens.map((i) => i.id).join(), `${p3.id},${p4.id}`);
  const doisA = agrupaRecebimentos(itensFinanceiros([plantao("A", [2026, 10, 20]), plantao("A", [2026, 10, 5])], HOJE));
  check("... (dois plantoes do mesmo grupo)", doisA[0].itens[0].inicio < doisA[0].itens[1].inicio);

  // Mesmo local, mesmo dia: recebido e a receber nao se misturam.
  const misto = agrupaRecebimentos(itensFinanceiros([plantao("A", [2026, 10, 1], { pagoEm: d(2026, 12, 10) }), plantao("A", [2026, 11, 10])], HOJE));
  igual("recebido e a receber no mesmo dia ficam em grupos separados", misto.length, 2);

  // Locais diferentes na mesma data: ordem alfabetica.
  const empate = agrupaRecebimentos(itensFinanceiros([plantao("C", [2026, 10, 5]), plantao("A", [2026, 10, 5])], HOJE).map((i) => ({ ...i, data: d(2026, 11, 23) })));
  igual("mesma data, locais diferentes: alfabetico", empate.map((g) => g.local.nome).join(), "Clinica C,Hospital A");
  igual("item sem data nao entra em grupo nenhum", agrupaRecebimentos([semRegra]).length, 0);

  /* ------------------------------------ somas ------------------------------------ */

  const nov = resumoDoMesFinanceiro(itens, d(2026, 11, 15));
  igual("novembro: nada recebido", nov.recebido, 0);
  igual("novembro: a receber (p7 + p10)", nov.aReceber, 200000);
  igual("novembro: atrasado (p1 + p2)", nov.atrasado, 180000);
  igual("novembro: nada previsto", nov.previsto, 0);
  igual("novembro: o que ainda vai entrar", nov.aEntrar, 380000);
  igual("novembro: total", nov.total, 380000);
  igual("novembro: 4 plantoes", nov.plantoes, 4);

  const dez = resumoDoMesFinanceiro(itens, d(2026, 12, 1));
  igual("dezembro: a receber (p3)", dez.aReceber, 90000);
  igual("dezembro: previsto (p4 + p8)", dez.previsto, 190000);
  igual("dezembro: aEntrar", dez.aEntrar, 280000);

  const out = resumoDoMesFinanceiro(itens, d(2026, 10, 31));
  igual("outubro: recebido (p5)", out.recebido, 90000);
  igual("outubro: atrasado (p9)", out.atrasado, 100000);
  igual("outubro: total soma recebido e a entrar", out.total, 190000);
  igual("o ultimo dia do mes conta no mes", itensDoMes(itens, d(2026, 10, 1)).length, 2);
  igual("mes sem nada", resumoDoMesFinanceiro(itens, d(2027, 5, 1)).total, 0);

  // Virada de mes: o recebido de 31/10 e de 01/11 nao se misturam.
  const virada = itensFinanceiros([
    plantao("A", [2026, 9, 1], { pagoEm: instante(2026, 9, 31, 23, 50) }),
    plantao("A", [2026, 9, 2], { pagoEm: instante(2026, 10, 1, 0, 10) }),
  ], HOJE);
  igual("recebido em 31/10 conta em outubro", resumoDoMesFinanceiro(virada, d(2026, 10, 15)).recebido, 90000);
  igual("recebido em 01/11 conta em novembro", resumoDoMesFinanceiro(virada, d(2026, 11, 15)).recebido, 90000);

  check("as somas fecham: aEntrar = aReceber + atrasado + previsto", [nov, dez, out].every((r) => r.aEntrar === r.aReceber + r.atrasado + r.previsto));
  igual("a soma dos meses e o total dos itens com data", [d(2026, 10, 1), d(2026, 11, 1), d(2026, 12, 1)].reduce((s, m) => s + resumoDoMesFinanceiro(itens, m).total, 0), itens.reduce((s, i) => s + i.liquido, 0));

  /* ---------------------------------- atrasados ---------------------------------- */

  igual("tres itens atrasados (p1, p2, p9)", itensAtrasados(itens).length, 3);
  const atr = resumoDosAtrasos(itens);
  igual("total em atraso", atr.total, 280000);
  igual("quantidade", atr.plantoes, 3);
  igual("o mais antigo era esperado em 01/10", dia(atr.desde), "01/10");
  const nenhum = resumoDosAtrasos(itensFinanceiros([p3], HOJE));
  check("sem atrasos: zero e sem data", nenhum.plantoes === 0 && nenhum.total === 0 && nenhum.desde === null);

  /* ------------------------------------ meses ------------------------------------ */

  const prev = previsaoDosMeses(itens, d(2026, 10, 20), 3);
  igual("tres meses a partir de outubro", prev.length, 3);
  igual("meses em ordem", prev.map((m) => dia(m.mes)).join(), "01/10,01/11,01/12");
  igual("totais de cada mes", prev.map((m) => m.resumo.total).join(), "190000,380000,280000");
  igual("a virada de ano funciona", dia(previsaoDosMeses(itens, d(2026, 12, 5), 2)[1].mes), "01/01");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  testes();
  process.exit(report() ? 0 : 1);
}
