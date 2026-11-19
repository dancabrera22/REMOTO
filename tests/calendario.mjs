/**
 * O que um plantao vira como evento do calendario (logica pura).
 */
import { JANELA_FUTURO_DIAS, JANELA_PASSADO_DIAS, LEMBRETES, RODAPE_NOTAS, assinaturaDoEvento, janelaDeSincronizacao, leConfig, montaEvento, rotuloLembrete, serializaConfig } from "../src/lib/calendario.ts";
import { fimDoDia, inicioDoDia, instante, somaDias } from "../src/lib/datetime.ts";
import { check, igual } from "./helpers.mjs";

const regra = (extra = {}) => ({ tipo: "dia_mes_seguinte", diaPagamento: 10, diasApos: null, diaFechamento: null, mesesAdiante: 1, ajusteDiaUtil: "proximo", ...extra });
const plantao = (extra = {}) => ({
  id: 1,
  inicio: instante(2026, 10, 20, 7),
  fim: instante(2026, 10, 20, 19),
  valorBruto: 100000,
  descontoPercentual: 10,
  observacao: null,
  local: { nome: "Hospital Central", apelido: "HC", endereco: "Av. Brasil, 100", regra: regra() },
  ...extra,
});
const cfg = (extra = {}) => ({ lembreteMin: 60, mostrarValor: false, ...extra });

export function testes() {
  /* ------------------------------------ evento ------------------------------------ */

  const e = montaEvento(plantao(), cfg());
  igual("titulo: Plantao e o local", e.titulo, "Plantão · Hospital Central");
  igual("com unidade: Plantao, unidade e local", montaEvento(plantao({ unidade: "Itaim", local: { ...plantao().local, nome: "Rede D'Or" } }), cfg()).titulo, "Plantão · Itaim · Rede D'Or");
  igual("a unidade e normalizada no titulo", montaEvento(plantao({ unidade: "  Itaim   Central " }), cfg()).titulo, "Plantão · Itaim Central · Hospital Central");
  igual("so espacos: titulo de sempre (o apelido do local NAO entra: os eventos antigos nao mudam)", montaEvento(plantao({ unidade: "  " }), cfg()).titulo, "Plantão · Hospital Central");
  check("plantao com outra unidade tem outra assinatura (o evento no calendario e atualizado)", assinaturaDoEvento("cal", montaEvento(plantao({ unidade: "Itaim" }), cfg())) !== assinaturaDoEvento("cal", montaEvento(plantao({ unidade: "Central" }), cfg())));
  igual("o evento vai do inicio ao fim do plantao", `${e.inicio === plantao().inicio}/${e.fim === plantao().fim}`, "true/true");
  igual("o endereco do local vira o local do evento", e.local, "Av. Brasil, 100");
  igual("o lembrete acompanha a configuracao", e.lembreteMin, 60);
  igual("sem observacao e sem valor, so o rodape", e.notas, RODAPE_NOTAS);
  check("o valor NAO aparece quando nao foi pedido", !e.notas.includes("R$"));

  igual("sem lembrete", montaEvento(plantao(), cfg({ lembreteMin: null })).lembreteMin, null);
  igual("endereco vazio vira nulo", montaEvento(plantao({ local: { ...plantao().local, endereco: "   " } }), cfg()).local, null);
  igual("endereco ausente vira nulo", montaEvento(plantao({ local: { ...plantao().local, endereco: null } }), cfg()).local, null);
  igual("endereco e aparado", montaEvento(plantao({ local: { ...plantao().local, endereco: "  Rua A  " } }), cfg()).local, "Rua A");

  const comObs = montaEvento(plantao({ observacao: "Levar crachá" }), cfg());
  igual("a observacao vem antes do rodape", comObs.notas, `Levar crachá\n${RODAPE_NOTAS}`);

  const comValor = montaEvento(plantao({ observacao: "Troca" }), cfg({ mostrarValor: true }));
  igual("com valor: observacao, liquido, data e rodape", comValor.notas, `Troca\nLíquido: R$ 900,00\nCai na conta: 10/12/2026\n${RODAPE_NOTAS}`);
  const semData = montaEvento(plantao({ local: { ...plantao().local, regra: regra({ diaPagamento: null }) } }), cfg({ mostrarValor: true }));
  igual("regra incompleta: mostra o valor mas nao inventa data", semData.notas, `Líquido: R$ 900,00\n${RODAPE_NOTAS}`);
  igual("o liquido leva o desconto do plantao", montaEvento(plantao({ descontoPercentual: 0 }), cfg({ mostrarValor: true })).notas.includes("R$ 1.000,00"), true);

  /* ---------------------------------- assinatura ---------------------------------- */

  const base = montaEvento(plantao(), cfg());
  const sig = (ev, cal = "cal-1") => assinaturaDoEvento(cal, ev);
  igual("mesma entrada, mesma assinatura", sig(base), sig(montaEvento(plantao(), cfg())));
  const mudancas = {
    titulo: { ...base, titulo: "Outro" },
    inicio: { ...base, inicio: base.inicio + 1 },
    fim: { ...base, fim: base.fim + 1 },
    local: { ...base, local: "Rua B" },
    notas: { ...base, notas: "x" },
    lembrete: { ...base, lembreteMin: 30 },
    "sem lembrete": { ...base, lembreteMin: null },
  };
  for (const [campo, ev] of Object.entries(mudancas)) check(`a assinatura muda quando muda ${campo}`, sig(ev) !== sig(base));
  check("e quando muda o calendario", sig(base, "cal-2") !== sig(base, "cal-1"));
  check("lembrete 0 e sem lembrete sao coisas diferentes na assinatura", sig({ ...base, lembreteMin: null }) !== sig({ ...base, lembreteMin: 0 }));

  /* ----------------------------------- config ----------------------------------- */

  const c = { calendarioId: "cal-1", calendarioNome: "Pessoal", conta: "a@b.com", lembreteMin: 60, mostrarValor: true, ativadoEm: 5, ultimaSincronizacao: 9, ultimoErro: "x" };
  igual("ida e volta da configuracao", JSON.stringify(leConfig(serializaConfig(c))), JSON.stringify(c));
  igual("sem texto: sem configuracao", leConfig(null), null);
  igual("texto vazio", leConfig(""), null);
  igual("texto que nao e JSON", leConfig("{{{"), null);
  igual("sem calendario: invalida", leConfig(JSON.stringify({ lembreteMin: 60 })), null);
  igual("calendario vazio: invalida", leConfig(JSON.stringify({ calendarioId: "" })), null);
  const minima = leConfig(JSON.stringify({ calendarioId: "x" }));
  check("campos que faltam ganham padrao", minima.calendarioNome === "Calendário" && minima.conta === null && minima.lembreteMin === null && minima.mostrarValor === false && minima.ultimaSincronizacao === null && minima.ultimoErro === null);
  igual("lembrete invalido vira sem lembrete", leConfig(JSON.stringify({ calendarioId: "x", lembreteMin: -5 })).lembreteMin, null);
  igual("lembrete de texto vira sem lembrete", leConfig(JSON.stringify({ calendarioId: "x", lembreteMin: "60" })).lembreteMin, null);
  igual("mostrarValor so vale se for verdadeiro de fato", leConfig(JSON.stringify({ calendarioId: "x", mostrarValor: "sim" })).mostrarValor, false);

  /* ------------------------------------ janela ------------------------------------ */

  const agora = instante(2026, 10, 16, 15, 30);
  const { de, ate } = janelaDeSincronizacao(agora);
  igual("a janela comeca 30 dias atras, a meia-noite", de, somaDias(inicioDoDia(agora), -JANELA_PASSADO_DIAS));
  igual("e termina 180 dias adiante, no fim do dia", ate, fimDoDia(somaDias(inicioDoDia(agora), JANELA_FUTURO_DIAS)));
  igual("30 dias atras de 16/11 e 17/10", `${new Date(de).getDate()}/${new Date(de).getMonth() + 1}`, "17/10");
  igual("180 dias adiante de 16/11 e 15/05", `${new Date(ate).getDate()}/${new Date(ate).getMonth() + 1}`, "15/5");

  /* ----------------------------------- lembretes ----------------------------------- */

  igual("as opcoes de lembrete tem ids unicos", new Set(LEMBRETES.map((l) => l.id)).size, LEMBRETES.length);
  igual("a primeira opcao e sem lembrete", LEMBRETES[0].minutos, null);
  check("o resto vem em ordem crescente", LEMBRETES.slice(1).every((l, i, a) => i === 0 || a[i - 1].minutos < l.minutos));
  igual("rotulo de 1 h", rotuloLembrete(60), "1 h antes");
  igual("rotulo de sem lembrete", rotuloLembrete(null), "Sem lembrete");
  igual("rotulo de um valor fora da lista", rotuloLembrete(45), "45 min antes");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  testes();
  process.exit(report() ? 0 : 1);
}
