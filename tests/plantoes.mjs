/**
 * Plantoes: horarios, validacao, conflitos e as contas da agenda.
 *
 * As bordas escolhidas sao as que quebram escala de saude na pratica: o noturno
 * que vira o dia (e o mes, e o ano), o de 24 horas, o plantao encostado no
 * outro (12x12) e o que comeca as 23:59 do ultimo dia do mes.
 */
import { chaveDia, formatData, instante, minutosEntre } from "../src/lib/datetime.ts";
import {
  conflitosCom,
  contaNoValor,
  descreveHorario,
  formatHoraMin,
  liquidoDoPlantao,
  marcadoresDoMes,
  mascaraHora,
  minutosDoDia,
  montaIntervalo,
  parseHora,
  precisaConfirmar,
  resumoDoMes,
  temErrosPlantao,
  validaPlantao,
  valorSugeridoPara,
} from "../src/lib/plantoes.ts";
import { check, igual, report } from "./helpers.mjs";

const AZUL = "#2F6FED";
const VERDE = "#1E9E5B";
const VERMELHO = "#D6453D";

let proximoId = 1;
const plantao = (extra = {}) => {
  const inicio = extra.inicio ?? instante(2026, 10, 14, 7);
  return {
    id: proximoId++,
    localId: 1,
    inicio,
    fim: extra.fim ?? instante(2026, 10, 14, 19),
    valorBruto: 120000,
    descontoPercentual: 0,
    status: "agendado",
    observacao: null,
    criadoEm: 0,
    atualizadoEm: 0,
    local: { nome: "Hospital Central", apelido: null, cor: AZUL, arquivado: false },
    ...extra,
  };
};

const entrada = (extra = {}) => {
  const { id, criadoEm, atualizadoEm, local, ...base } = plantao(extra);
  return base;
};

export function testes() {
  /* ----------------------------------- hora ----------------------------------- */

  igual("parse: 19:00", parseHora("19:00"), 1140);
  igual("parse: 07:30", parseHora("07:30"), 450);
  igual("parse: 7:05 (sem zero a esquerda)", parseHora("7:05"), 425);
  igual("parse: meia-noite", parseHora("00:00"), 0);
  igual("parse: ultimo minuto do dia", parseHora("23:59"), 1439);
  igual("parse: 24:00 nao existe", parseHora("24:00"), null);
  igual("parse: 25:00 nao existe", parseHora("25:00"), null);
  igual("parse: 19:60 nao existe", parseHora("19:60"), null);
  igual("parse: incompleto", parseHora("19:0"), null);
  igual("parse: vazio", parseHora(""), null);
  igual("parse: texto", parseHora("abc"), null);

  igual("formata 1140", formatHoraMin(1140), "19:00");
  igual("formata 0", formatHoraMin(0), "00:00");
  igual("formata 425", formatHoraMin(425), "07:05");

  igual("mascara: 1", mascaraHora("1"), "1");
  igual("mascara: 19", mascaraHora("19"), "19");
  igual("mascara: 190", mascaraHora("190"), "19:0");
  igual("mascara: 1900", mascaraHora("1900"), "19:00");
  igual("mascara: ignora o que nao e digito", mascaraHora("1a9:0b0"), "19:00");
  igual("mascara: corta no quinto digito", mascaraHora("190012"), "19:00");
  igual("mascara: refaz com os dois pontos digitados", mascaraHora("19:00"), "19:00");
  igual("ida e volta", formatHoraMin(parseHora("07:45")), "07:45");
  igual("minutos do dia", minutosDoDia(instante(2026, 10, 14, 19, 30)), 1170);

  /* ------------------------------- montar intervalo ------------------------------- */

  const dia = instante(2026, 10, 14);
  const hora = (ms) => `${formatData(ms)} ${formatHoraMin(minutosDoDia(ms))}`;

  const diurno = montaIntervalo(dia, 7 * 60, 19 * 60);
  igual("diurno: entra", hora(diurno.inicio), "14/11/2026 07:00");
  igual("diurno: sai no mesmo dia", hora(diurno.fim), "14/11/2026 19:00");
  igual("diurno: nao vira o dia", diurno.viraDia, false);
  igual("diurno: 12 horas", minutosEntre(diurno.inicio, diurno.fim), 720);

  const noturno = montaIntervalo(dia, 19 * 60, 7 * 60);
  igual("noturno: entra", hora(noturno.inicio), "14/11/2026 19:00");
  igual("noturno: sai no dia seguinte", hora(noturno.fim), "15/11/2026 07:00");
  igual("noturno: marca a virada", noturno.viraDia, true);
  igual("noturno: 12 horas", minutosEntre(noturno.inicio, noturno.fim), 720);

  const cheio = montaIntervalo(dia, 7 * 60, 7 * 60);
  igual("24h: mesma hora vira o dia", hora(cheio.fim), "15/11/2026 07:00");
  igual("24h: 1440 minutos", minutosEntre(cheio.inicio, cheio.fim), 1440);

  const madrugada = montaIntervalo(dia, 0, 6 * 60);
  igual("00h as 06h fica no mesmo dia", madrugada.viraDia, false);

  const virouMes = montaIntervalo(instante(2026, 10, 30), 19 * 60, 7 * 60);
  igual("noturno atravessa o mes", hora(virouMes.fim), "01/12/2026 07:00");
  const virouAno = montaIntervalo(instante(2026, 11, 31), 19 * 60, 7 * 60);
  igual("noturno atravessa o ano", hora(virouAno.fim), "01/01/2027 07:00");
  const bissexto = montaIntervalo(instante(2028, 1, 28), 19 * 60, 7 * 60);
  igual("noturno em fevereiro bissexto", hora(bissexto.fim), "29/02/2028 07:00");

  igual("descricao diurno", descreveHorario(diurno.inicio, diurno.fim), "07:00 → 19:00 · 12h");
  igual("descricao noturno", descreveHorario(noturno.inicio, noturno.fim), "19:00 → 07:00 +1 · 12h");
  igual("descricao 24h", descreveHorario(cheio.inicio, cheio.fim), "07:00 → 07:00 +1 · 24h");

  /* ------------------------------- validacao ------------------------------- */

  const v = (extra = {}, existentes = [], ignora) => validaPlantao(entrada(extra), existentes, ignora);
  const erro = (extra) => Object.keys(v(extra).erros).sort().join(",");

  igual("plantao valido", erro({}), "");
  igual("sem local", erro({ localId: 0 }), "localId");
  igual("fim antes do inicio", erro({ fim: instante(2026, 10, 14, 6) }), "horario");
  igual("fim igual ao inicio", erro({ fim: instante(2026, 10, 14, 7) }), "horario");
  igual("plantao de 49h recusado", erro({ fim: instante(2026, 10, 16, 8) }), "horario");
  igual("plantao de 48h aceito", erro({ fim: instante(2026, 10, 16, 7) }), "");
  igual("valor negativo", erro({ valorBruto: -1 }), "valorBruto");
  igual("valor zero aceito", erro({ valorBruto: 0 }), "");
  igual("valor fracionado (centavo quebrado) recusado", erro({ valorBruto: 10.5 }), "valorBruto");
  igual("desconto acima de 100", erro({ descontoPercentual: 101 }), "descontoPercentual");
  igual("status invalido", erro({ status: "talvez" }), "status");
  igual("observacao longa", erro({ observacao: "x".repeat(301) }), "observacao");
  check("temErros reconhece erro", temErrosPlantao(v({ localId: 0 }).erros));
  check("temErros reconhece ausencia", !temErrosPlantao(v().erros));

  /* -------------------------------- conflitos -------------------------------- */

  const outro = plantao({
    inicio: instante(2026, 10, 14, 13),
    fim: instante(2026, 10, 14, 19, 0),
    local: { nome: "UPA Norte", apelido: null, cor: VERDE, arquivado: false },
  });
  const doze = { inicio: instante(2026, 10, 14, 7), fim: instante(2026, 10, 14, 19) };

  igual("sobreposicao e detectada", conflitosCom(doze, [outro]).length, 1);
  check("o aviso nomeia o outro local", v({}, [outro]).avisos.conflito?.includes("UPA Norte"));
  check("conflito nao e erro: nao impede salvar", !temErrosPlantao(v({}, [outro]).erros));

  const encostado = plantao({ inicio: instante(2026, 10, 14, 19), fim: instante(2026, 10, 15, 7) });
  igual("plantao que comeca quando o outro termina nao conflita (12x12)", conflitosCom(doze, [encostado]).length, 0);
  const encostadoAntes = plantao({ inicio: instante(2026, 10, 13, 19), fim: instante(2026, 10, 14, 7) });
  igual("nem o que termina quando este comeca", conflitosCom(doze, [encostadoAntes]).length, 0);

  const avancaUmMinuto = plantao({ inicio: instante(2026, 10, 14, 18, 59), fim: instante(2026, 10, 15, 7) });
  igual("um minuto de sobreposicao ja conta", conflitosCom(doze, [avancaUmMinuto]).length, 1);

  igual("cancelado nao ocupa horario", conflitosCom(doze, [{ ...outro, status: "cancelado" }]).length, 0);
  igual("trocado nao ocupa horario", conflitosCom(doze, [{ ...outro, status: "trocado" }]).length, 0);
  igual("realizado ocupa", conflitosCom(doze, [{ ...outro, status: "realizado" }]).length, 1);
  igual("editar um plantao nao conflita com ele mesmo", conflitosCom(doze, [outro], outro.id).length, 0);
  check(
    "plantao cancelado sendo salvo nao gera aviso",
    !v({ status: "cancelado" }, [outro]).avisos.conflito,
  );

  const atravessa = plantao({ inicio: instante(2026, 10, 13, 19), fim: instante(2026, 10, 14, 9) });
  igual("noturno da vespera invade o diurno seguinte", conflitosCom(doze, [atravessa]).length, 1);

  /* ---------------------------------- valores ---------------------------------- */

  igual("valor sugerido: plantao fechado", valorSugeridoPara({ modoValor: "plantao", valorPadrao: 120000 }, doze.inicio, doze.fim), 120000);
  igual("valor sugerido: por hora, 12h", valorSugeridoPara({ modoValor: "hora", valorPadrao: 10000 }, doze.inicio, doze.fim), 120000);
  igual("valor sugerido: por hora, 24h", valorSugeridoPara({ modoValor: "hora", valorPadrao: 10000 }, cheio.inicio, cheio.fim), 240000);
  igual("liquido com desconto", liquidoDoPlantao({ valorBruto: 120000, descontoPercentual: 11 }), 106800);
  check("agendado conta no valor", contaNoValor("agendado"));
  check("realizado conta no valor", contaNoValor("realizado"));
  check("cancelado nao conta", !contaNoValor("cancelado"));
  check("trocado nao conta", !contaNoValor("trocado"));

  /* ------------------------------ precisa confirmar ------------------------------ */

  const agora = instante(2026, 10, 14, 20);
  check("agendado que ja terminou precisa confirmar", precisaConfirmar({ status: "agendado", fim: instante(2026, 10, 14, 19) }, agora));
  check("agendado em andamento nao", !precisaConfirmar({ status: "agendado", fim: instante(2026, 10, 15, 7) }, agora));
  check("realizado nao", !precisaConfirmar({ status: "realizado", fim: instante(2026, 10, 14, 19) }, agora));
  check("cancelado nao", !precisaConfirmar({ status: "cancelado", fim: instante(2026, 10, 14, 19) }, agora));

  /* --------------------------------- marcadores --------------------------------- */

  const lista = [
    plantao({ inicio: instante(2026, 10, 14, 19), fim: instante(2026, 10, 15, 7), local: { nome: "UPA", apelido: null, cor: VERDE, arquivado: false } }),
    plantao({ inicio: instante(2026, 10, 14, 7), fim: instante(2026, 10, 14, 13) }),
    plantao({ inicio: instante(2026, 10, 14, 13), fim: instante(2026, 10, 14, 19) }),
    plantao({ inicio: instante(2026, 10, 20, 7), status: "cancelado", fim: instante(2026, 10, 20, 19) }),
    plantao({ inicio: instante(2026, 10, 21, 7), status: "trocado", fim: instante(2026, 10, 21, 19) }),
    plantao({ inicio: instante(2026, 10, 22, 7), status: "realizado", fim: instante(2026, 10, 22, 19), local: { nome: "Clinica", apelido: null, cor: VERMELHO, arquivado: false } }),
  ];
  const marc = marcadoresDoMes(lista);

  igual("dia com tres plantoes de dois locais: duas cores", marc[chaveDia(instante(2026, 10, 14))].cores.length, 2);
  igual("a cor segue a ordem em que o dia acontece", marc[chaveDia(instante(2026, 10, 14))].cores.join(), `${AZUL},${VERDE}`);
  igual("mesmo local duas vezes nao repete a cor", marc[chaveDia(instante(2026, 10, 14))].cores.filter((c) => c === AZUL).length, 1);
  check("noturno marca so o dia em que comeca", !marc[chaveDia(instante(2026, 10, 15))]);
  check("cancelado nao pinta o dia", !marc[chaveDia(instante(2026, 10, 20))]);
  check("trocado nao pinta o dia", !marc[chaveDia(instante(2026, 10, 21))]);
  igual("realizado pinta com a cor do local", marc[chaveDia(instante(2026, 10, 22))].cores.join(), VERMELHO);
  igual("so os dias 14 e 22 ficam marcados", Object.keys(marc).length, 2);

  /* ---------------------------------- resumo do mes ---------------------------------- */

  const mes = [
    plantao({ inicio: instante(2026, 10, 1, 7), fim: instante(2026, 10, 1, 19), valorBruto: 100000, descontoPercentual: 10, status: "realizado" }),
    plantao({ inicio: instante(2026, 10, 15, 19), fim: instante(2026, 10, 16, 7), valorBruto: 100000, descontoPercentual: 10, status: "realizado" }),
    plantao({ inicio: instante(2026, 10, 30, 7), fim: instante(2026, 10, 30, 19), valorBruto: 100000, descontoPercentual: 10, status: "agendado" }),
    plantao({ inicio: instante(2026, 10, 10, 7), fim: instante(2026, 10, 10, 19), valorBruto: 999900, status: "cancelado" }),
    plantao({ inicio: instante(2026, 10, 11, 7), fim: instante(2026, 10, 11, 19), valorBruto: 999900, status: "trocado" }),
    // fora do mes: 23:59 de outubro e 00:00 de dezembro
    plantao({ inicio: instante(2026, 9, 31, 23, 59), fim: instante(2026, 10, 1, 5), valorBruto: 500000, status: "realizado" }),
    plantao({ inicio: instante(2026, 11, 1, 0, 0), fim: instante(2026, 11, 1, 6), valorBruto: 500000, status: "realizado" }),
  ];
  const r = resumoDoMes(mes, instante(2026, 10, 14), instante(2026, 10, 20));

  igual("conta so os plantoes validos do mes", r.plantoes, 3);
  igual("soma as horas (3 x 12h)", r.minutos, 3 * 720);
  igual("soma o bruto", r.bruto, 300000);
  igual("soma o liquido, com o desconto de cada plantao", r.liquido, 270000);
  igual("cancelado e trocado nao entram", r.bruto, 300000);
  igual("plantao das 23:59 do ultimo dia do mes anterior fica fora", r.plantoes, 3);
  igual("so o do dia 30 segue agendado e ja nao terminou", r.aConfirmar, 0);

  const aposFim = resumoDoMes(mes, instante(2026, 10, 14), instante(2026, 11, 2));
  igual("agendado que ja terminou aparece como a confirmar", aposFim.aConfirmar, 1);

  const vazio = resumoDoMes([], instante(2026, 10, 14));
  igual("mes sem plantoes: tudo zero", `${vazio.plantoes}/${vazio.minutos}/${vazio.liquido}`, "0/0/0");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
