/**
 * Dinheiro e datas: as duas bibliotecas que a recorrencia (Etapa 4) e a
 * previsao de recebimento (Etapa 5) vao usar em cada conta. Erro aqui vira
 * valor errado na tela, entao sao testadas desde a fundacao.
 */
import {
  aplicaDesconto,
  centavosDeDigitos,
  formatBRL,
  formatBRLCompacto,
  leValorEscrito,
  valorPorHora,
} from "../src/lib/money.ts";
import {
  chaveDia,
  deChaveDia,
  diasRelativos,
  formatData,
  formatDuracao,
  formatIntervalo,
  formatMesAno,
  gradeDoMes,
  instante,
  mesmoDia,
  minutosEntre,
  somaDias,
  somaMeses,
} from "../src/lib/datetime.ts";
import { check, igual, report } from "./helpers.mjs";

export function testes() {
  /* ------------------------------- dinheiro ------------------------------- */

  igual("zero", formatBRL(0), "R$ 0,00");
  igual("centavos", formatBRL(5), "R$ 0,05");
  igual("milhar", formatBRL(123456), "R$ 1.234,56");
  igual("milhao", formatBRL(100000000), "R$ 1.000.000,00");
  igual("negativo", formatBRL(-5000), "-R$ 50,00");
  igual("compacto esconde centavos zerados", formatBRLCompacto(120000), "R$ 1.200");
  igual("compacto mantem centavos reais", formatBRLCompacto(120050), "R$ 1.200,50");

  igual("digitos entram pela direita", centavosDeDigitos("1234"), 1234);
  igual("digitos ignoram o que nao e numero", centavosDeDigitos("R$ 1.2a34"), 1234);
  igual("campo vazio vale zero", centavosDeDigitos(""), 0);

  igual("le pt-BR com milhar", leValorEscrito("1.234,56"), 123456);
  igual("le pt-BR sem milhar", leValorEscrito("1234,56"), 123456);
  igual("le decimal com ponto", leValorEscrito("1234.56"), 123456);
  igual("ponto como milhar", leValorEscrito("1.234"), 123400);
  igual("inteiro puro", leValorEscrito("1234"), 123400);
  igual("com prefixo", leValorEscrito("R$ 90"), 9000);
  igual("texto invalido", leValorEscrito("abc"), null);

  igual("desconto de 11%", aplicaDesconto(100000, 11), 89000);
  igual("desconto zero nao mexe", aplicaDesconto(123456, 0), 123456);
  igual("plantao de 12h a R$ 100/h", valorPorHora(10000, 720), 120000);
  igual("hora e meia proporcional", valorPorHora(10000, 90), 15000);

  // O motivo de guardar centavos inteiros: somar cem vezes R$ 0,07 tem que
  // fechar exatamente, e com ponto flutuante nao fecha.
  let soma = 0;
  for (let i = 0; i < 100; i++) soma += 7;
  igual("cem vezes sete centavos", formatBRL(soma), "R$ 7,00");

  /* --------------------------------- datas --------------------------------- */

  const sabado = instante(2026, 10, 14); // 14/11/2026
  igual("data pt-BR", formatData(sabado), "14/11/2026");
  igual("mes por extenso", formatMesAno(sabado), "novembro de 2026");
  igual("hoje", diasRelativos(sabado, sabado), "hoje");
  igual("amanha", diasRelativos(somaDias(sabado, 1), sabado), "amanhã");
  igual("tres dias", diasRelativos(somaDias(sabado, 3), sabado), "em 3 dias");
  igual("passado", diasRelativos(somaDias(sabado, -2), sabado), "há 2 dias");

  // Virada de mes preservando o dia: a base de "paga no dia 31".
  igual("31/01 + 1 mes cai no fim de fevereiro", formatData(somaMeses(instante(2026, 0, 31), 1)), "28/02/2026");
  igual("31/12 + 2 meses", formatData(somaMeses(instante(2026, 11, 31), 2)), "28/02/2027");
  igual("31/01 + 1 mes em ano bissexto", formatData(somaMeses(instante(2028, 0, 31), 1)), "29/02/2028");
  igual("15/03 + 1 mes", formatData(somaMeses(instante(2026, 2, 15), 1)), "15/04/2026");
  igual("volta um mes", formatData(somaMeses(instante(2026, 2, 31), -1)), "28/02/2026");

  // Plantao noturno: entra num dia, sai no outro.
  const inicioNoite = instante(2026, 10, 14, 19, 0);
  const fimNoite = instante(2026, 10, 15, 7, 0);
  igual("noturno marca a virada", formatIntervalo(inicioNoite, fimNoite), "19:00 → 07:00 +1");
  igual("diurno nao marca", formatIntervalo(instante(2026, 10, 14, 7, 0), instante(2026, 10, 14, 19, 0)), "07:00 → 19:00");
  igual("doze horas", minutosEntre(inicioNoite, fimNoite), 720);
  igual("duracao cheia", formatDuracao(720), "12h");
  igual("duracao quebrada", formatDuracao(750), "12h30");
  igual("menos de uma hora", formatDuracao(45), "45min");

  igual("chave do dia", chaveDia(sabado), "2026-11-14");
  check("chave volta para o mesmo dia", mesmoDia(deChaveDia(chaveDia(sabado)), sabado));

  /* ------------------------------ grade do mes ------------------------------ */

  const grade = gradeDoMes(sabado, sabado);
  const celulas = grade.flat();
  igual("novembro de 2026 cabe em 5 semanas", grade.length, 5);
  check("toda semana tem sete dias", grade.every((s) => s.length === 7));
  igual("comeca no domingo", formatData(celulas[0].ms), "01/11/2026");
  igual("termina no sabado", formatData(celulas[celulas.length - 1].ms), "05/12/2026");
  check(
    "dias sao consecutivos, sem furo nem repeticao",
    celulas.every((c, i) => i === 0 || mesmoDia(c.ms, somaDias(celulas[i - 1].ms, 1))),
  );
  igual("trinta dias dentro do mes", celulas.filter((c) => !c.foraDoMes).length, 30);
  igual("so um dia marcado como hoje", celulas.filter((c) => c.hoje).length, 1);
  check("o hoje marcado e o certo", celulas.find((c) => c.hoje)?.dia === 14);

  // Fevereiro de 2026 comeca num domingo e tem 28 dias: exatamente 4 semanas.
  const fev = gradeDoMes(instante(2026, 1, 10), sabado);
  igual("fevereiro de 2026 fecha em 4 semanas", fev.length, 4);
  igual("sem dias de outro mes", fev.flat().filter((c) => c.foraDoMes).length, 0);

  // Mes que atravessa seis semanas (maio de 2027 comeca num sabado).
  const maio = gradeDoMes(instante(2027, 4, 15), sabado);
  check("mes longo usa as semanas necessarias", maio.length >= 5 && maio.length <= 6, `${maio.length} semanas`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
