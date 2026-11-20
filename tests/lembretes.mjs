/**
 * Lembretes do app: o que deve estar agendado (quais plantoes, quando toca, o que diz), a
 * identidade de cada aviso e a diferenca entre o que deveria estar e o que esta. Sem banco, sem
 * celular.
 */
import {
  ANTECEDENCIAS,
  ANTECEDENCIA_PADRAO_MIN,
  HORIZONTE_LEMBRETES_DIAS,
  MAXIMO_LEMBRETES,
  PREFIXO_LEMBRETE,
  diferencaDeLembretes,
  ehLembreteDoApp,
  idDoLembrete,
  impressaoDigital,
  leConfigLembretes,
  montaLembrete,
  planejaLembretes,
  serializaConfigLembretes,
  tempoFalta,
} from "../src/lib/lembretes.ts";
import { instante } from "../src/lib/datetime.ts";
import { check, igual, report } from "./helpers.mjs";

// "Agora" dos testes: domingo, 15/11/2026, 10h.
const AGORA = instante(2026, 10, 15, 10);
const MIN = 60_000;

const plantao = (id, extra = {}) => ({
  id,
  unidade: null,
  inicio: instante(2026, 10, 20, 7), // sexta 20/11, 07h
  fim: instante(2026, 10, 20, 19),
  status: "agendado",
  local: { nome: "Hospital Central", endereco: null },
  ...extra,
});

export function testes() {
  /* ----------------------------------- opcoes ----------------------------------- */

  igual("o prazo e de 45 dias", HORIZONTE_LEMBRETES_DIAS, 45);
  igual("o teto e de 150 avisos", MAXIMO_LEMBRETES, 150);
  igual("a antecedencia padrao e 1 h", ANTECEDENCIA_PADRAO_MIN, 60);
  igual("as opcoes de antecedencia: sem, 30 min, 1 h, 2 h, 1 dia", ANTECEDENCIAS.map((a) => a.minutos).join(), ",30,60,120,1440");
  igual("a primeira desliga", ANTECEDENCIAS[0].minutos, null);
  igual("30 min", tempoFalta(30), "30 min");
  igual("1 h", tempoFalta(60), "1 h");
  igual("2 h", tempoFalta(120), "2 h");
  igual("1 dia", tempoFalta(1440), "1 dia");
  igual("2 dias", tempoFalta(2880), "2 dias");
  igual("90 min nao vira hora quebrada", tempoFalta(90), "90 min");

  /* ------------------------------ impressao digital ------------------------------ */

  igual("igual para o mesmo texto", impressaoDigital("abc"), impressaoDigital("abc"));
  check("diferente se o texto muda", impressaoDigital("abc") !== impressaoDigital("abd"));
  check("diferente se so a ordem muda", impressaoDigital("ab") !== impressaoDigital("ba"));
  igual("sempre 8 caracteres", impressaoDigital("").length, 8);
  igual("o texto com acento tambem", impressaoDigital("Plantão · Itaim").length, 8);

  /* ------------------------------------ texto ------------------------------------ */

  const m = montaLembrete(plantao(1, { unidade: "Itaim", local: { nome: "Rede D'Or", endereco: null } }), 60);
  igual("titulo: quanto falta, a unidade e o local", m.titulo, "Plantão em 1 h — Itaim · Rede D'Or");
  igual("corpo: dia, data e horario com a duracao", m.corpo, "sex, 20/11 · 07:00 → 19:00 · 12h");
  igual("sem unidade: so o local", montaLembrete(plantao(1), 30).titulo, "Plantão em 30 min — Hospital Central");
  igual("com endereco, ele vem na segunda linha", montaLembrete(plantao(1, { local: { nome: "Hospital Central", endereco: "  Av. Brasil, 100 " } }), 60).corpo, "sex, 20/11 · 07:00 → 19:00 · 12h\nAv. Brasil, 100");
  igual("endereco so de espacos nao vira linha", montaLembrete(plantao(1, { local: { nome: "H", endereco: "   " } }), 60).corpo.includes("\n"), false);
  igual("noturno mostra a virada", montaLembrete(plantao(1, { inicio: instante(2026, 10, 20, 19), fim: instante(2026, 10, 21, 7) }), 60).corpo, "sex, 20/11 · 19:00 → 07:00 +1 · 12h");
  igual("um dia antes", montaLembrete(plantao(1), 1440).titulo, "Plantão em 1 dia — Hospital Central");
  check("NUNCA tem valor em dinheiro (a notificacao aparece com a tela bloqueada)", !/R\$|\d,\d{2}/.test(`${m.titulo} ${m.corpo}`));
  igual("unidade com espacos sobrando e normalizada", montaLembrete(plantao(1, { unidade: "  Itaim   Central " }), 60).titulo, "Plantão em 1 h — Itaim Central · Hospital Central");

  /* ----------------------------------- planejar ----------------------------------- */

  const p1 = plantao(1);
  const l1 = planejaLembretes([p1], 60, AGORA);
  igual("um plantao futuro ganha um aviso", l1.length, 1);
  igual("que toca uma hora antes", l1[0].quando, p1.inicio - 60 * MIN);
  igual("e e do plantao certo", l1[0].plantaoId, 1);
  check("o identificador e do app", ehLembreteDoApp(l1[0].id) && l1[0].id.startsWith(PREFIXO_LEMBRETE));
  igual("desligado: nenhum aviso", planejaLembretes([p1], null, AGORA).length, 0);
  igual("antecedencia zero: nenhum", planejaLembretes([p1], 0, AGORA).length, 0);
  igual("antecedencia negativa: nenhum", planejaLembretes([p1], -5, AGORA).length, 0);

  igual("so plantao agendado (cancelado nao)", planejaLembretes([plantao(1, { status: "cancelado" })], 60, AGORA).length, 0);
  igual("nem realizado", planejaLembretes([plantao(1, { status: "realizado" })], 60, AGORA).length, 0);
  igual("nem trocado", planejaLembretes([plantao(1, { status: "trocado" })], 60, AGORA).length, 0);
  igual("sem a informacao de situacao, vale (a consulta ja filtrou)", planejaLembretes([plantao(1, { status: undefined })], 60, AGORA).length, 1);

  // aviso que cairia no passado
  const em20min = plantao(2, { inicio: AGORA + 20 * MIN, fim: AGORA + 20 * MIN + 12 * 60 * MIN });
  igual("plantao daqui a 20 min nao ganha o aviso de 1 h antes (ja passou)", planejaLembretes([em20min], 60, AGORA).length, 0);
  igual("mas ganha o de 15 min", planejaLembretes([em20min], 15, AGORA).length, 1);
  const exato = plantao(3, { inicio: AGORA + 60 * MIN, fim: AGORA + 13 * 60 * MIN });
  igual("o aviso que tocaria agora mesmo nao e agendado", planejaLembretes([exato], 60, AGORA).length, 0);
  const umMinutoDepois = plantao(4, { inicio: AGORA + 61 * MIN, fim: AGORA + 13 * 60 * MIN });
  igual("um minuto depois, e", planejaLembretes([umMinutoDepois], 60, AGORA).length, 1);
  igual("plantao que ja comecou: nenhum", planejaLembretes([plantao(5, { inicio: AGORA - MIN, fim: AGORA + 600 * MIN })], 30, AGORA).length, 0);

  // horizonte
  const dentro = plantao(6, { inicio: instante(2026, 10 + 1, 15 + 14, 7), fim: instante(2026, 10 + 1, 15 + 14, 19) }); // 45 dias depois (dia 29/12)
  const dia45 = instante(2026, 10, 15 + HORIZONTE_LEMBRETES_DIAS, 23, 0);
  igual("o ultimo dia do prazo conta (ate 23h)", planejaLembretes([plantao(7, { inicio: dia45, fim: dia45 + 3600e3 })], 60, AGORA).length, 1);
  const dia46 = instante(2026, 10, 15 + HORIZONTE_LEMBRETES_DIAS + 1, 7);
  igual("o dia seguinte ao prazo, nao", planejaLembretes([plantao(8, { inicio: dia46, fim: dia46 + 3600e3 })], 60, AGORA).length, 0);
  void dentro;

  // ordem e teto
  const bagunca = [plantao(30, { inicio: instante(2026, 10, 25, 7), fim: instante(2026, 10, 25, 19) }), plantao(10), plantao(20, { inicio: instante(2026, 10, 22, 7), fim: instante(2026, 10, 22, 19) })];
  igual("os mais proximos primeiro", planejaLembretes(bagunca, 60, AGORA).map((l) => l.plantaoId).join(), "10,20,30");
  const empate = [plantao(9), plantao(3)];
  igual("empate de horario: pelo id", planejaLembretes(empate, 60, AGORA).map((l) => l.plantaoId).join(), "3,9");

  const muitos = Array.from({ length: MAXIMO_LEMBRETES + 40 }, (_, k) => plantao(k + 1, { inicio: instante(2026, 10, 16, 7) + k * 30 * MIN, fim: instante(2026, 10, 16, 8) + k * 30 * MIN }));
  const limitados = planejaLembretes(muitos, 30, AGORA);
  igual(`o teto de ${MAXIMO_LEMBRETES} avisos`, limitados.length, MAXIMO_LEMBRETES);
  igual("fica com os mais proximos", `${limitados[0].plantaoId}..${limitados[MAXIMO_LEMBRETES - 1].plantaoId}`, `1..${MAXIMO_LEMBRETES}`);
  igual("identificadores todos diferentes", new Set(limitados.map((l) => l.id)).size, MAXIMO_LEMBRETES);

  /* -------------------------- identidade: o que muda o aviso -------------------------- */

  const base = planejaLembretes([p1], 60, AGORA)[0].id;
  igual("o mesmo plantao, o mesmo identificador (idempotente)", planejaLembretes([plantao(1)], 60, AGORA)[0].id, base);
  igual("rodar de novo mais tarde (o aviso ainda no futuro) nao muda o identificador", planejaLembretes([p1], 60, AGORA + 3 * 60 * MIN)[0].id, base);
  check("mudar o horario muda o identificador", planejaLembretes([plantao(1, { inicio: p1.inicio + 30 * MIN, fim: p1.fim + 30 * MIN })], 60, AGORA)[0].id !== base);
  check("mudar so o fim muda (o texto traz a duracao)", planejaLembretes([plantao(1, { fim: p1.fim + 60 * MIN })], 60, AGORA)[0].id !== base);
  check("dar uma unidade muda", planejaLembretes([plantao(1, { unidade: "Itaim" })], 60, AGORA)[0].id !== base);
  check("mudar o nome do local muda", planejaLembretes([plantao(1, { local: { nome: "Outro", endereco: null } })], 60, AGORA)[0].id !== base);
  check("mudar o endereco muda", planejaLembretes([plantao(1, { local: { nome: "Hospital Central", endereco: "Rua A" } })], 60, AGORA)[0].id !== base);
  check("mudar a antecedencia muda", planejaLembretes([p1], 120, AGORA)[0].id !== base);
  check("outro plantao, outro identificador (mesmo horario)", planejaLembretes([plantao(2)], 60, AGORA)[0].id !== base);
  igual("o id e montavel a mao (plantao, hora, impressao)", idDoLembrete(1, 5, "t", "c"), `lp:1:5:${impressaoDigital("t\nc")}`);

  /* ------------------------------------ diferenca ------------------------------------ */

  const [a, b] = planejaLembretes([plantao(1), plantao(2, { inicio: instante(2026, 10, 21, 7), fim: instante(2026, 10, 21, 19) })], 60, AGORA);
  let d = diferencaDeLembretes([a, b], []);
  igual("nada agendado: cria os dois", `${d.criar.length}/${d.cancelar.length}`, "2/0");
  d = diferencaDeLembretes([a, b], [a.id, b.id]);
  igual("ja esta tudo: nada a fazer", `${d.criar.length}/${d.cancelar.length}`, "0/0");
  d = diferencaDeLembretes([a], [a.id, b.id]);
  igual("sobrou um: cancela so ele", `${d.criar.length}/${d.cancelar.join()}`, `0/${b.id}`);
  d = diferencaDeLembretes([b], [a.id]);
  igual("trocou: cria o novo e cancela o velho", `${d.criar[0].id === b.id}/${d.cancelar.join()}`, `true/${a.id}`);
  d = diferencaDeLembretes([a], ["teste", "outra-coisa", `${PREFIXO_LEMBRETE}9:9:abc`]);
  igual("NUNCA cancela o que nao e do app (aviso de teste, de outras partes)", d.cancelar.join(), `${PREFIXO_LEMBRETE}9:9:abc`);
  d = diferencaDeLembretes([a], [a.id, a.id]);
  igual("agendado em duplicidade nao gera pedido", `${d.criar.length}/${d.cancelar.length}`, "0/0");
  d = diferencaDeLembretes([], [a.id, a.id, b.id]);
  igual("e cancela cada um uma vez so", d.cancelar.length, 2);
  igual("desligado (nada desejado): cancela tudo que e do app", diferencaDeLembretes([], [a.id, b.id, "teste"]).cancelar.length, 2);

  /* ------------------------------------ config ------------------------------------ */

  const cfg = { antecedenciaMin: 60, ultimaSincronizacao: 123, ultimoErro: null };
  igual("ida e volta", JSON.stringify(leConfigLembretes(serializaConfigLembretes(cfg))), JSON.stringify(cfg));
  igual("nada guardado", leConfigLembretes(null), null);
  igual("texto vazio", leConfigLembretes(""), null);
  igual("texto estragado", leConfigLembretes("{nao e json"), null);
  igual("json que nao e objeto", leConfigLembretes("42"), null);
  igual("null em json", leConfigLembretes("null"), null);
  igual("desligado e guardado como nulo", leConfigLembretes(JSON.stringify({ antecedenciaMin: null }))?.antecedenciaMin, null);
  igual("antecedencia zero vira desligado", leConfigLembretes(JSON.stringify({ antecedenciaMin: 0 }))?.antecedenciaMin, null);
  igual("antecedencia de texto vira desligado", leConfigLembretes(JSON.stringify({ antecedenciaMin: "60" }))?.antecedenciaMin, null);
  igual("antecedencia negativa vira desligado", leConfigLembretes(JSON.stringify({ antecedenciaMin: -60 }))?.antecedenciaMin, null);
  igual("campos que faltam ficam nulos", JSON.stringify(leConfigLembretes("{}")), JSON.stringify({ antecedenciaMin: null, ultimaSincronizacao: null, ultimoErro: null }));
  igual("erro guardado e lido", leConfigLembretes(JSON.stringify({ antecedenciaMin: 30, ultimoErro: "x" }))?.ultimoErro, "x");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
