/**
 * Recorrencia: em que dias uma escala cai.
 *
 * Todas as datas esperadas foram conferidas a mao no calendario de 2026/2027
 * (1/11/2026 e domingo; 1/12/2026, terca; 1/1/2027, sexta; fev/2027 tem 28 dias).
 * As bordas sao as que quebram escala na pratica: virada de mes e de ano, dia 31
 * em mes curto, ano bissexto, data final inclusiva e o "fim de semana alternado".
 */
import { chaveDia, formatData, instante } from "../src/lib/datetime.ts";
import {
  DIAS_UTEIS,
  ESCALAS_COMUNS,
  FIM_DE_SEMANA,
  TODOS_OS_DIAS,
  alternaDia,
  contaDias,
  descreveRecorrencia,
  ocorrencias,
  plantaoDaSerie,
  proximasOcorrencias,
  temDia,
  temErrosSerie,
  validaSerie,
  diasDoRascunho,
  formatDiaCurto,
  rascunhoDaRegra,
  rascunhoInicial,
  regraDoRascunho,
} from "../src/lib/recorrencia.ts";
import { check, igual, report } from "./helpers.mjs";

const SEG = 1 << 1;
const TER = 1 << 2;
const QUA = 1 << 3;
const QUI = 1 << 4;
const SEX = 1 << 5;
const SAB = 1 << 6;
const DOM = 1 << 0;

const d = (ano, mes, dia) => instante(ano, mes - 1, dia);
const lista = (dias) => dias.map((x) => formatData(x).slice(0, 5)).join(" ");

const regra = (extra) => ({
  tipo: "intervalo",
  diasSemana: 0,
  cada: 2,
  diaDoMes: null,
  inicioDia: d(2026, 11, 1),
  fimDia: null,
  ...extra,
});

export function testes() {
  /* --------------------------- a cada N dias (12x36, 24x72) --------------------------- */

  const x1236 = regra({});
  igual("12x36 em novembro (dias impares)", lista(ocorrencias(x1236, d(2026, 11, 1), d(2026, 11, 30))), "01/11 03/11 05/11 07/11 09/11 11/11 13/11 15/11 17/11 19/11 21/11 23/11 25/11 27/11 29/11");
  igual("12x36 continua em dezembro sem reiniciar", lista(ocorrencias(x1236, d(2026, 12, 1), d(2026, 12, 7))), "01/12 03/12 05/12 07/12");
  igual("12x36 consultando so um trecho", lista(ocorrencias(x1236, d(2026, 11, 10), d(2026, 11, 14))), "11/11 13/11");
  igual("consulta que comeca num dia de folga", lista(ocorrencias(x1236, d(2026, 11, 2), d(2026, 11, 2))), "");
  igual("12x36 atravessa o ano", lista(ocorrencias(regra({ inicioDia: d(2026, 12, 30) }), d(2026, 12, 30), d(2027, 1, 5))), "30/12 01/01 03/01 05/01");
  igual("24x72 (a cada 4 dias)", lista(ocorrencias(regra({ cada: 4 }), d(2026, 11, 1), d(2026, 11, 20))), "01/11 05/11 09/11 13/11 17/11");
  igual("24x48 (a cada 3 dias)", lista(ocorrencias(regra({ cada: 3 }), d(2026, 11, 1), d(2026, 11, 13))), "01/11 04/11 07/11 10/11 13/11");
  igual("todo dia", ocorrencias(regra({ cada: 1 }), d(2026, 11, 1), d(2026, 11, 30)).length, 30);
  igual("nunca antes do inicio da escala", lista(ocorrencias(regra({ inicioDia: d(2026, 11, 10) }), d(2026, 11, 1), d(2026, 11, 14))), "10/11 12/11 14/11");
  igual("a data final e inclusiva", lista(ocorrencias(regra({ fimDia: d(2026, 11, 5) }), d(2026, 11, 1), d(2026, 12, 31))), "01/11 03/11 05/11");
  igual("data final num dia de folga", lista(ocorrencias(regra({ fimDia: d(2026, 11, 6) }), d(2026, 11, 1), d(2026, 12, 31))), "01/11 03/11 05/11");
  igual("intervalo vazio", ocorrencias(x1236, d(2026, 11, 20), d(2026, 11, 10)).length, 0);
  igual("a hora do argumento nao interfere", lista(ocorrencias(x1236, instante(2026, 10, 1, 23, 59), instante(2026, 10, 3, 0, 1))), "01/11 03/11");

  /* ---------------------------------- semanal ---------------------------------- */

  const semanal = (mascara, extra = {}) => regra({ tipo: "semanal", diasSemana: mascara, cada: 1, ...extra });

  const smq = ocorrencias(semanal(SEG | QUA | SEX), d(2026, 11, 1), d(2026, 11, 30));
  igual("seg, qua e sex em novembro: 13 dias", smq.length, 13);
  igual("comecando pela segunda 02/11", lista(smq.slice(0, 4)), "02/11 04/11 06/11 09/11");
  check("todos caem em seg, qua ou sex", smq.every((x) => [1, 3, 5].includes(new Date(x).getDay())));

  igual("escala que comeca no meio da semana", lista(ocorrencias(semanal(SEG | QUA, { inicioDia: d(2026, 11, 4) }), d(2026, 11, 1), d(2026, 11, 11))), "04/11 09/11 11/11");
  igual("so sabados", lista(ocorrencias(semanal(SAB), d(2026, 11, 1), d(2026, 11, 30))), "07/11 14/11 21/11 28/11");
  igual("so domingos", lista(ocorrencias(semanal(DOM), d(2026, 11, 1), d(2026, 11, 30))), "01/11 08/11 15/11 22/11 29/11");
  igual("de segunda a sexta tem 21 dias em novembro", ocorrencias(semanal(DIAS_UTEIS), d(2026, 11, 1), d(2026, 11, 30)).length, 21);
  igual("mascara vazia nao gera nada", ocorrencias(semanal(0), d(2026, 11, 1), d(2026, 11, 30)).length, 0);
  igual("mascara com bits fora da semana nao trava", ocorrencias(semanal(128), d(2026, 11, 1), d(2026, 11, 30)).length, 0);
  igual("semanal com passo invalido nao trava", ocorrencias(semanal(SEG, { cada: 0 }), d(2026, 11, 1), d(2026, 11, 30)).length, 0);

  // Semanas contadas a partir da PRIMEIRA ocorrencia, de segunda a domingo.
  igual("a cada 2 semanas, comecando num domingo, a primeira segunda ja entra", lista(ocorrencias(semanal(SEG, { cada: 2 }), d(2026, 11, 1), d(2026, 11, 30))), "02/11 16/11 30/11");
  igual("a cada 2 semanas, dois dias, comecando na quarta", lista(ocorrencias(semanal(SEG | QUA, { cada: 2, inicioDia: d(2026, 11, 4) }), d(2026, 11, 1), d(2026, 11, 30))), "04/11 16/11 18/11 30/11");
  igual("fim de semana alternado: sabado e domingo juntos", lista(ocorrencias(semanal(FIM_DE_SEMANA, { cada: 2, inicioDia: d(2026, 11, 14) }), d(2026, 11, 1), d(2026, 12, 20))), "14/11 15/11 28/11 29/11 12/12 13/12");
  igual("a cada 3 semanas", lista(ocorrencias(semanal(TER, { cada: 3, inicioDia: d(2026, 11, 3) }), d(2026, 11, 1), d(2026, 12, 31))), "03/11 24/11 15/12");
  igual("semanal respeita a data final", lista(ocorrencias(semanal(SEG, { fimDia: d(2026, 11, 16) }), d(2026, 11, 1), d(2026, 12, 31))), "02/11 09/11 16/11");
  igual("semanal atravessa o ano", lista(ocorrencias(semanal(SEX, { inicioDia: d(2026, 12, 25) }), d(2026, 12, 25), d(2027, 1, 15))), "25/12 01/01 08/01 15/01");

  /* ----------------------------------- mensal ----------------------------------- */

  const mensal = (dia, extra = {}) => regra({ tipo: "mensal", cada: 1, diaDoMes: dia, inicioDia: d(2026, 1, 15), ...extra });

  igual("dia 31: ultimo dia de cada mes", lista(ocorrencias(mensal(31), d(2026, 1, 1), d(2026, 6, 30))), "31/01 28/02 31/03 30/04 31/05 30/06");
  igual("dia 31 em fevereiro bissexto", lista(ocorrencias(mensal(31, { inicioDia: d(2028, 1, 1) }), d(2028, 2, 1), d(2028, 2, 29))), "29/02");
  igual("dia 15 mensal", lista(ocorrencias(mensal(15), d(2026, 1, 1), d(2026, 4, 30))), "15/01 15/02 15/03 15/04");
  igual("o primeiro mes pode ficar para tras do inicio", lista(ocorrencias(mensal(10), d(2026, 1, 1), d(2026, 4, 30))), "10/02 10/03 10/04");
  igual("a cada 2 meses", lista(ocorrencias(mensal(15, { cada: 2 }), d(2026, 1, 1), d(2026, 12, 31))), "15/01 15/03 15/05 15/07 15/09 15/11");
  igual("mensal atravessa o ano", lista(ocorrencias(mensal(20, { inicioDia: d(2026, 11, 1) }), d(2026, 11, 1), d(2027, 2, 28))), "20/11 20/12 20/01 20/02");
  igual("mensal respeita a data final", lista(ocorrencias(mensal(15, { fimDia: d(2026, 3, 15) }), d(2026, 1, 1), d(2026, 12, 31))), "15/01 15/02 15/03");
  igual("mensal sem dia nao gera", ocorrencias(mensal(null), d(2026, 1, 1), d(2026, 12, 31)).length, 0);
  igual("mensal consultando so um trecho", lista(ocorrencias(mensal(15), d(2026, 2, 1), d(2026, 2, 28))), "15/02");

  /* --------------------------------- mascara --------------------------------- */

  check("temDia", temDia(SEG | QUA, 1) && temDia(SEG | QUA, 3) && !temDia(SEG | QUA, 2));
  igual("alternaDia liga", alternaDia(SEG, 3), SEG | QUA);
  igual("alternaDia desliga", alternaDia(SEG | QUA, 1), QUA);
  igual("contaDias", contaDias(DIAS_UTEIS), 5);
  igual("a mascara de dias uteis e segunda a sexta", DIAS_UTEIS, SEG | TER | QUA | QUI | SEX);
  igual("a mascara de fim de semana", FIM_DE_SEMANA, SAB | DOM);

  /* --------------------------------- descricao --------------------------------- */

  const desc = (r) => descreveRecorrencia(r);
  igual("uma terca", desc(semanal(TER)), "Toda terça");
  igual("um sabado (masculino)", desc(semanal(SAB)), "Todo sábado");
  igual("um domingo (masculino)", desc(semanal(DOM)), "Todo domingo");
  igual("varios dias", desc(semanal(SEG | QUA | SEX)), "Toda semana: segunda, quarta e sexta");
  igual("dois dias", desc(semanal(SEG | QUI)), "Toda semana: segunda e quinta");
  igual("dias uteis", desc(semanal(DIAS_UTEIS)), "De segunda a sexta");
  igual("fim de semana", desc(semanal(FIM_DE_SEMANA)), "Sábados e domingos");
  igual("todos os dias", desc(semanal(TODOS_OS_DIAS)), "Todos os dias");
  igual("a cada 2 semanas", desc(semanal(SEG | QUA, { cada: 2 })), "A cada 2 semanas: segunda e quarta");
  igual("nenhum dia", desc(semanal(0)), "Nenhum dia escolhido");
  igual("a cada 2 dias", desc(x1236), "A cada 2 dias");
  igual("todo dia", desc(regra({ cada: 1 })), "Todo dia");
  igual("mensal", desc(mensal(15)), "Todo dia 15 do mês");
  igual("mensal a cada 2 meses", desc(mensal(15, { cada: 2 })), "A cada 2 meses, no dia 15");
  igual("com data final", desc(regra({ fimDia: d(2026, 12, 31) })), "A cada 2 dias · até 31/12/2026");

  /* ---------------------------------- validacao ---------------------------------- */

  const modelo = { localId: 1, inicioMin: 420, fimMin: 1140, valorBruto: 120000, descontoPercentual: 0, observacao: null };
  const erros = (r, m = {}) => Object.keys(validaSerie({ ...modelo, ...m, regra: r })).sort().join(",");

  igual("escala valida", erros(x1236), "");
  igual("local zero", Object.keys(validaSerie({ ...modelo, localId: 0, regra: x1236 })).join(), "localId");
  igual("semanal sem dia", erros(semanal(0)), "diasSemana");
  igual("semanal com mascara alem dos sete dias", erros(semanal(128)), "diasSemana");
  igual("semanal a cada 8 semanas e o maximo", erros(semanal(SEG, { cada: 8 })), "");
  igual("semanal a cada 9 semanas", erros(semanal(SEG, { cada: 9 })), "cada");
  igual("intervalo de 60 dias aceito", erros(regra({ cada: 60 })), "");
  igual("intervalo de 61 dias", erros(regra({ cada: 61 })), "cada");
  igual("intervalo zero", erros(regra({ cada: 0 })), "cada");
  igual("intervalo fracionado", erros(regra({ cada: 1.5 })), "cada");
  igual("mensal sem dia", erros(mensal(null)), "diaDoMes");
  igual("mensal dia 0", erros(mensal(0)), "diaDoMes");
  igual("mensal dia 32", erros(mensal(32)), "diaDoMes");
  igual("mensal dia 31", erros(mensal(31)), "");
  igual("mensal a cada 13 meses", erros(mensal(15, { cada: 13 })), "cada");
  igual("data final antes do inicio", erros(regra({ fimDia: d(2026, 10, 31) })), "fimDia");
  igual("data final igual ao inicio", erros(regra({ fimDia: d(2026, 11, 1) })), "");
  igual("horario fora do dia", erros(x1236, { inicioMin: 1440 }), "horario");
  igual("horario negativo", erros(x1236, { fimMin: -1 }), "horario");
  igual("valor negativo", erros(x1236, { valorBruto: -1 }), "valorBruto");
  igual("desconto acima de 100", erros(x1236, { descontoPercentual: 101 }), "descontoPercentual");
  check("temErrosSerie reconhece o erro", temErrosSerie(validaSerie({ ...modelo, regra: semanal(0) })));
  check("temErrosSerie reconhece a ausencia", !temErrosSerie(validaSerie({ ...modelo, regra: x1236 })));

  /* ------------------------------ previa e plantao ------------------------------ */

  igual("as 5 primeiras da 12x36", lista(proximasOcorrencias(x1236, 5)), "01/11 03/11 05/11 07/11 09/11");
  igual("previa de escala sem ocorrencia", proximasOcorrencias(semanal(0), 5).length, 0);

  const noite = plantaoDaSerie({ ...modelo, inicioMin: 1140, fimMin: 420 }, d(2026, 11, 14));
  igual("o plantao da escala entra no dia da ocorrencia", chaveDia(noite.inicio), "2026-11-14");
  igual("o noturno da escala termina no dia seguinte", chaveDia(noite.fim), "2026-11-15");
  igual("herda o valor", noite.valorBruto, 120000);
  igual("herda o local", noite.localId, 1);
  igual("nasce agendado", noite.status, "agendado");
  igual("o status pode ser pedido", plantaoDaSerie(modelo, d(2026, 11, 14), "realizado").status, "realizado");

  check("as escalas comuns cobrem 12x36, 24x48 e 24x72", ESCALAS_COMUNS.map((e) => e.cada).join() === "2,3,4");

  /* ------------------------------ rascunho do formulario ------------------------------ */

  const terca = d(2026, 11, 17);
  const nunca = rascunhoInicial();
  igual("nao repete: nao ha regra", regraDoRascunho(nunca, terca), null);

  const semTocar = { ...nunca, tipo: "semanal" };
  igual("semanal sem tocar nos dias acompanha o dia da data (terca)", regraDoRascunho(semTocar, terca).diasSemana, 1 << 2);
  igual("... e se a data muda para sabado, o dia muda junto", regraDoRascunho(semTocar, d(2026, 11, 21)).diasSemana, 1 << 6);
  igual("diasDoRascunho usa a data enquanto nada foi escolhido", diasDoRascunho(semTocar, terca), 1 << 2);
  igual("... e a escolha depois de tocar", diasDoRascunho({ ...semTocar, diasSemana: 0b0111110 }, terca), 0b0111110);

  igual("mensal sem tocar no dia usa o dia da data", regraDoRascunho({ ...nunca, tipo: "mensal" }, terca).diaDoMes, 17);
  igual("mensal com dia digitado usa o digitado", regraDoRascunho({ ...nunca, tipo: "mensal", diaDoMes: "31" }, terca).diaDoMes, 31);

  const ciclo = regraDoRascunho({ ...nunca, tipo: "intervalo", cada: "2", diasSemana: 0b101, diaDoMes: "9" }, terca);
  check("ciclo nao carrega dias da semana nem dia do mes", ciclo.diasSemana === 0 && ciclo.diaDoMes === null && ciclo.cada === 2);

  igual("passo vazio vira 0 (e a validacao recusa)", regraDoRascunho({ ...nunca, tipo: "intervalo", cada: "" }, terca).cada, 0);
  check(
    "... recusado por validaSerie",
    temErrosSerie(validaSerie({ ...modelo, regra: regraDoRascunho({ ...nunca, tipo: "intervalo", cada: "" }, terca) })),
  );
  igual("a data inicial vira meia-noite", regraDoRascunho(semTocar, instante(2026, 10, 17, 15, 40)).inicioDia, terca);
  igual("a data final tambem", regraDoRascunho({ ...semTocar, fimDia: instante(2026, 10, 20, 9) }, terca).fimDia, d(2026, 11, 20));

  // Ida e volta: editar uma escala existente nao deve mudar nada sozinho.
  for (const regra of [
    { tipo: "semanal", diasSemana: 0b0101010, cada: 2, diaDoMes: null, inicioDia: terca, fimDia: d(2027, 3, 1) },
    { tipo: "intervalo", diasSemana: 0, cada: 4, diaDoMes: null, inicioDia: terca, fimDia: null },
    { tipo: "mensal", diasSemana: 0, cada: 3, diaDoMes: 31, inicioDia: terca, fimDia: null },
  ]) {
    igual(`ida e volta (${regra.tipo}) preserva a regra`, JSON.stringify(regraDoRascunho(rascunhoDaRegra(regra), regra.inicioDia)), JSON.stringify(regra));
  }

  igual("data curta da previa", formatDiaCurto(terca), "ter 17/11");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
