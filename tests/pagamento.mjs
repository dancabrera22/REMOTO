/**
 * Regra de pagamento: o coracao do "quando eu vou receber".
 *
 * Datas conferidas a mao contra o calendario de 2026/2027. As bordas escolhidas
 * sao as que quebram calculo de data na pratica: dia 31 em fevereiro, virada de
 * ano, ano bissexto, fim de semana e o ultimo dia exato do ciclo de fechamento.
 */
import { formatData, formatDiaSemana, instante } from "../src/lib/datetime.ts";
import {
  REGRA_PADRAO,
  ajustaDiaUtil,
  calculaDataRecebimento,
  descreveAjuste,
  descreveRegra,
  validaRegra,
} from "../src/lib/pagamento.ts";
import { check, igual, report } from "./helpers.mjs";

const regra = (extra) => ({
  tipo: "dia_mes_seguinte",
  diaPagamento: 10,
  diasApos: null,
  diaFechamento: null,
  mesesAdiante: 1,
  ajusteDiaUtil: "nenhum",
  ...extra,
});

const paga = (r, ano, mes, dia, hora = 8) => {
  const ms = calculaDataRecebimento(r, instante(ano, mes - 1, dia, hora));
  return ms === null ? null : `${formatData(ms)} ${formatDiaSemana(ms)}`;
};

export function testes() {
  /* --------------------------- dia fixo do mes --------------------------- */

  igual("dia 10 do mes seguinte", paga(regra({}), 2026, 11, 14), "10/12/2026 qui");
  igual("vira o ano", paga(regra({}), 2026, 12, 31), "10/01/2027 dom");
  igual("no mesmo mes", paga(regra({ mesesAdiante: 0 }), 2026, 11, 3), "10/11/2026 ter");
  igual("dois meses depois", paga(regra({ mesesAdiante: 2 }), 2026, 11, 15), "10/01/2027 dom");

  // Dia 31 vale para todos os meses: em fevereiro e o ultimo dia.
  igual("dia 31 em fevereiro (comum)", paga(regra({ diaPagamento: 31 }), 2026, 1, 15), "28/02/2026 sáb");
  igual("dia 31 em fevereiro (bissexto)", paga(regra({ diaPagamento: 31 }), 2028, 1, 15), "29/02/2028 ter");
  igual("dia 31 em mes de 30 dias", paga(regra({ diaPagamento: 31 }), 2026, 3, 10), "30/04/2026 qui");

  /* ------------------------------ fim de semana ------------------------------ */

  // 05/12/2026 e sabado; 06/12/2026 e domingo.
  const sabado = (ajusteDiaUtil) => regra({ diaPagamento: 5, ajusteDiaUtil });
  igual("sabado, mantendo", paga(sabado("nenhum"), 2026, 11, 20), "05/12/2026 sáb");
  igual("sabado, proximo dia util", paga(sabado("proximo"), 2026, 11, 20), "07/12/2026 seg");
  igual("sabado, dia util anterior", paga(sabado("anterior"), 2026, 11, 20), "04/12/2026 sex");

  const domingo = (ajusteDiaUtil) => regra({ diaPagamento: 6, ajusteDiaUtil });
  igual("domingo, proximo dia util", paga(domingo("proximo"), 2026, 11, 20), "07/12/2026 seg");
  igual("domingo, dia util anterior", paga(domingo("anterior"), 2026, 11, 20), "04/12/2026 sex");

  igual("dia util nao e mexido (proximo)", paga(regra({ ajusteDiaUtil: "proximo" }), 2026, 11, 14), "10/12/2026 qui");
  igual("dia util nao e mexido (anterior)", paga(regra({ ajusteDiaUtil: "anterior" }), 2026, 11, 14), "10/12/2026 qui");

  // O ajuste pode atravessar a virada do mes: 28/02/2026 e sabado.
  igual(
    "ajuste atravessa o mes",
    paga(regra({ diaPagamento: 31, ajusteDiaUtil: "proximo" }), 2026, 1, 15),
    "02/03/2026 seg",
  );
  igual(
    "ajuste para tras tambem",
    paga(regra({ diaPagamento: 31, ajusteDiaUtil: "anterior" }), 2026, 1, 15),
    "27/02/2026 sex",
  );

  igual(
    "ajustaDiaUtil direto: quinta nao muda",
    formatData(ajustaDiaUtil(instante(2026, 11, 10), "proximo")),
    "10/12/2026",
  );

  /* ------------------------------- dias apos ------------------------------- */

  const dias = (n, ajusteDiaUtil = "nenhum") => regra({ tipo: "dias_apos", diasApos: n, diaPagamento: null, ajusteDiaUtil });
  igual("30 dias apos", paga(dias(30), 2026, 11, 14), "14/12/2026 seg");
  igual("30 dias atravessando o ano", paga(dias(30), 2026, 12, 20), "19/01/2027 ter");
  igual("a hora do plantao nao interfere", paga(dias(30), 2026, 11, 14, 23), "14/12/2026 seg");
  igual("zero dias: no proprio dia", paga(dias(0), 2026, 11, 14), "14/11/2026 sáb");
  igual("zero dias com ajuste de fim de semana", paga(dias(0, "proximo"), 2026, 11, 14), "16/11/2026 seg");

  /* ------------------------------- fechamento ------------------------------- */

  const fecha = (diaFechamento, diaPagamento, mesesAdiante = 1) =>
    regra({ tipo: "fechamento", diaFechamento, diaPagamento, mesesAdiante });

  igual("antes do fechamento", paga(fecha(20, 10), 2026, 11, 18), "10/12/2026 qui");
  igual("no dia exato do fechamento ainda entra no ciclo", paga(fecha(20, 10), 2026, 11, 20), "10/12/2026 qui");
  igual("um dia depois cai no ciclo seguinte", paga(fecha(20, 10), 2026, 11, 21), "10/01/2027 dom");
  igual("ciclo que atravessa o ano", paga(fecha(20, 10), 2026, 12, 25), "10/02/2027 qua");
  igual("fechamento dia 31 em mes de 30 dias fecha no 30", paga(fecha(31, 10), 2026, 11, 30), "10/12/2026 qui");
  igual("fechamento dia 31 em mes de 31 dias", paga(fecha(31, 10), 2026, 10, 31), "10/11/2026 ter");
  igual("pagamento no mesmo mes, antes do fechamento", paga(fecha(15, 20, 0), 2026, 11, 10), "20/11/2026 sex");
  igual("pagamento no mesmo mes, depois do fechamento", paga(fecha(15, 20, 0), 2026, 11, 16), "20/12/2026 dom");

  /* ----------------------------- regra incompleta ----------------------------- */

  igual("sem dia de pagamento", calculaDataRecebimento(regra({ diaPagamento: null }), instante(2026, 10, 14)), null);
  igual("sem prazo em dias", calculaDataRecebimento(regra({ tipo: "dias_apos", diasApos: null }), instante(2026, 10, 14)), null);
  igual("fechamento sem dia de fechamento", calculaDataRecebimento(fecha(null, 10), instante(2026, 10, 14)), null);

  /* -------------------------------- validacao -------------------------------- */

  const erros = (r) => Object.keys(validaRegra(r)).sort().join(",");

  igual("regra padrao e valida", erros(REGRA_PADRAO), "");
  igual("dia 0 recusado", erros(regra({ diaPagamento: 0 })), "diaPagamento");
  igual("dia 32 recusado", erros(regra({ diaPagamento: 32 })), "diaPagamento");
  igual("dia fracionado recusado", erros(regra({ diaPagamento: 10.5 })), "diaPagamento");
  igual("dia vazio recusado", erros(regra({ diaPagamento: null })), "diaPagamento");
  igual("dia 31 aceito", erros(regra({ diaPagamento: 31 })), "");
  igual("meses acima de 12 recusado", erros(regra({ mesesAdiante: 13 })), "mesesAdiante");
  igual("meses negativo recusado", erros(regra({ mesesAdiante: -1 })), "mesesAdiante");

  igual("365 dias aceito", erros(dias(365)), "");
  igual("366 dias recusado", erros(dias(366)), "diasApos");
  igual("dias negativo recusado", erros(dias(-1)), "diasApos");
  igual("em dias_apos o dia de pagamento nao e exigido", erros(dias(30)), "");

  igual("fechamento valido", erros(fecha(20, 10)), "");
  igual("fechamento sem dia de fechamento", erros(fecha(null, 10)), "diaFechamento");
  igual("mesmo mes: pagar antes de fechar e recusado", erros(fecha(20, 10, 0)), "diaPagamento");
  igual("mesmo mes: pagar no dia do fechamento tambem", erros(fecha(20, 20, 0)), "diaPagamento");
  igual("mesmo mes: depois do fechamento e aceito", erros(fecha(20, 21, 0)), "");

  /* -------------------------------- descricao -------------------------------- */

  igual("descricao: mes seguinte", descreveRegra(regra({})), "Paga dia 10 do mês seguinte");
  igual("descricao: mesmo mes", descreveRegra(regra({ mesesAdiante: 0 })), "Paga dia 10 no mesmo mês");
  igual("descricao: dois meses", descreveRegra(regra({ mesesAdiante: 2 })), "Paga dia 10 2 meses depois");
  igual("descricao: dias apos", descreveRegra(dias(30)), "Paga 30 dias após o plantão");
  igual("descricao: um dia apos", descreveRegra(dias(1)), "Paga 1 dia após o plantão");
  igual("descricao: no dia", descreveRegra(dias(0)), "Paga no dia do plantão");
  igual("descricao: fechamento", descreveRegra(fecha(20, 10)), "Fecha dia 20 · paga dia 10 do mês seguinte");
  igual("descricao: incompleta", descreveRegra(regra({ diaPagamento: null })), "Regra incompleta");
  check("ajustes tem texto proprio", new Set(["nenhum", "proximo", "anterior"].map(descreveAjuste)).size === 3);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
