/**
 * Feriados e dia util: as datas moveis (Pascoa e derivadas) conferidas contra
 * o calendario de verdade, e o que isso faz com a data de recebimento.
 */
import { chaveDia, instante } from "../src/lib/datetime.ts";
import { diaUtilMaisProximo, ehDiaUtil, feriadoEm, feriadosDoAno, pascoa } from "../src/lib/feriados.ts";
import { ajustaDiaUtil, calculaDataRecebimento } from "../src/lib/pagamento.ts";
import { check, igual } from "./helpers.mjs";

const d = (ano, mes, dia) => instante(ano, mes - 1, dia);
const dd = (ms) => `${String(new Date(ms).getDate()).padStart(2, "0")}/${String(new Date(ms).getMonth() + 1).padStart(2, "0")}/${new Date(ms).getFullYear()}`;
const sem = (ms) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(ms).getDay()];
const fmt = (ms) => `${dd(ms)} ${sem(ms)}`;

export function testes() {
  /* ----------------------------------- pascoa ----------------------------------- */

  const conhecidas = [
    [2000, 4, 23], [2019, 4, 21], [2023, 4, 9], [2024, 3, 31], [2025, 4, 20],
    [2026, 4, 5], [2027, 3, 28], [2028, 4, 16], [2029, 4, 1], [2030, 4, 21], [2038, 4, 25],
    // Anos em que a correcao do algoritmo age (sem ela, a data erra por uma semana).
    [1981, 4, 19], [2049, 4, 18], [2076, 4, 19],
  ];
  for (const [ano, mes, dia] of conhecidas) {
    const p = pascoa(ano);
    igual(`Pascoa de ${ano}`, `${p.dia}/${p.mes0 + 1}`, `${dia}/${mes}`);
  }
  check("Pascoa sempre cai num domingo (1990 a 2060)", Array.from({ length: 71 }, (_, i) => 1990 + i).every((a) => { const p = pascoa(a); return new Date(a, p.mes0, p.dia).getDay() === 0; }));

  /* ------------------------------ datas moveis de 2026 ------------------------------ */

  const de2026 = feriadosDoAno(2026);
  const nome = (n) => de2026.find((f) => f.nome === n)?.data;
  igual("Carnaval 2026 (segunda)", fmt(nome("Carnaval (segunda)")), "16/02/2026 seg");
  igual("Carnaval 2026 (terca)", fmt(nome("Carnaval (terça)")), "17/02/2026 ter");
  igual("Sexta-feira Santa 2026", fmt(nome("Sexta-feira Santa")), "03/04/2026 sex");
  igual("Corpus Christi 2026", fmt(nome("Corpus Christi")), "04/06/2026 qui");
  igual("Carnaval 2027 (segunda)", fmt(feriadosDoAno(2027).find((f) => f.nome === "Carnaval (segunda)").data), "08/02/2027 seg");
  igual("Sexta-feira Santa 2027", fmt(feriadosDoAno(2027).find((f) => f.nome === "Sexta-feira Santa").data), "26/03/2027 sex");
  igual("Corpus Christi 2027", fmt(feriadosDoAno(2027).find((f) => f.nome === "Corpus Christi").data), "27/05/2027 qui");

  /* ----------------------------------- fixos ----------------------------------- */

  igual("2026 tem 13 dias sem expediente (10 nacionais + 3 bancarios)", de2026.length, 13);
  igual("... dos quais 10 nacionais", de2026.filter((f) => f.tipo === "nacional").length, 10);
  check("estao em ordem de data", de2026.every((f, i) => i === 0 || de2026[i - 1].data < f.data));
  for (const [mes, dia, nomeEsperado] of [
    [1, 1, "Confraternização Universal"], [4, 21, "Tiradentes"], [5, 1, "Dia do Trabalho"],
    [9, 7, "Independência do Brasil"], [10, 12, "Nossa Senhora Aparecida"], [11, 2, "Finados"],
    [11, 15, "Proclamação da República"], [11, 20, "Consciência Negra"], [12, 25, "Natal"],
  ]) {
    igual(`${dia}/${mes} e ${nomeEsperado}`, feriadoEm(d(2026, mes, dia))?.nome, nomeEsperado);
  }
  igual("um dia comum nao e feriado", feriadoEm(d(2026, 11, 18)), null);
  igual("Consciencia Negra so vale a partir de 2024 (2023: nao)", feriadoEm(d(2023, 11, 20)), null);
  igual("... e em 2024 vale", feriadoEm(d(2024, 11, 20))?.nome, "Consciência Negra");
  igual("2023 tem um feriado a menos", feriadosDoAno(2023).length, 12);
  check("a hora do dia nao importa", feriadoEm(instante(2026, 10, 20, 23, 59))?.nome === "Consciência Negra");
  check("mesma chave de dia para qualquer hora", chaveDia(d(2026, 11, 20)) === chaveDia(instante(2026, 10, 20, 18)));
  igual("o ano vira certo: 1/1/2027", feriadoEm(d(2027, 1, 1))?.nome, "Confraternização Universal");
  igual("31/12 nao e feriado", feriadoEm(d(2026, 12, 31)), null);

  /* ---------------------------------- dia util ---------------------------------- */

  check("segunda comum e dia util", ehDiaUtil(d(2026, 11, 16)));
  check("sabado nao", !ehDiaUtil(d(2026, 11, 14)));
  check("domingo nao", !ehDiaUtil(d(2026, 11, 15)));
  check("feriado no meio da semana nao (sexta, Consciencia Negra)", !ehDiaUtil(d(2026, 11, 20)));
  check("Carnaval nao", !ehDiaUtil(d(2026, 2, 16)) && !ehDiaUtil(d(2026, 2, 17)));
  check("Quarta de Cinzas e dia util", ehDiaUtil(d(2026, 2, 18)));
  igual("diaUtilMaisProximo de um dia util e ele mesmo", fmt(diaUtilMaisProximo(d(2026, 11, 18), 1)), "18/11/2026 qua");

  /* ----------------------- o que isso faz com o recebimento ----------------------- */

  igual("sexta feriado, proximo: segunda", fmt(ajustaDiaUtil(d(2026, 11, 20), "proximo")), "23/11/2026 seg");
  igual("sexta feriado, anterior: quinta", fmt(ajustaDiaUtil(d(2026, 11, 20), "anterior")), "19/11/2026 qui");
  igual("feriado de quinta, proximo: sexta (e nao segunda)", fmt(ajustaDiaUtil(d(2026, 6, 4), "proximo")), "05/06/2026 sex");
  igual("feriado de segunda, anterior: sexta anterior", fmt(ajustaDiaUtil(d(2026, 4, 21), "anterior")), "20/04/2026 seg");
  igual("sabado de Carnaval, proximo: atravessa dois feriados ate quarta", fmt(ajustaDiaUtil(d(2026, 2, 14), "proximo")), "18/02/2026 qua");
  igual("sabado de Carnaval, anterior: sexta", fmt(ajustaDiaUtil(d(2026, 2, 14), "anterior")), "13/02/2026 sex");
  igual("Natal de sexta, proximo: 28/12", fmt(ajustaDiaUtil(d(2026, 12, 25), "proximo")), "28/12/2026 seg");
  igual("Ano Novo de sexta, proximo: 4/1", fmt(ajustaDiaUtil(d(2027, 1, 1), "proximo")), "04/01/2027 seg");
  igual("Ano Novo de sexta, anterior: 31/12", fmt(ajustaDiaUtil(d(2027, 1, 1), "anterior")), "31/12/2026 qui");
  igual("'manter' nao mexe nem em feriado", fmt(ajustaDiaUtil(d(2026, 11, 20), "nenhum")), "20/11/2026 sex");

  const regra = (extra = {}) => ({ tipo: "dia_mes_seguinte", diaPagamento: 20, diasApos: null, diaFechamento: null, mesesAdiante: 1, ajusteDiaUtil: "proximo", ...extra });
  igual("regra 'paga dia 20' em novembro/2026 cai na segunda 23", fmt(calculaDataRecebimento(regra({ mesesAdiante: 0 }), d(2026, 11, 3))), "23/11/2026 seg");
  igual("... e com 'manter', no proprio feriado", fmt(calculaDataRecebimento(regra({ mesesAdiante: 0, ajusteDiaUtil: "nenhum" }), d(2026, 11, 3))), "20/11/2026 sex");
  igual("'dias apos' tambem respeita feriado", fmt(calculaDataRecebimento({ ...regra(), tipo: "dias_apos", diasApos: 7, diaPagamento: null }, d(2026, 11, 13))), "23/11/2026 seg");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  testes();
  process.exit(report() ? 0 : 1);
}
