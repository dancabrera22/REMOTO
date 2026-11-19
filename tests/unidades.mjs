/**
 * Unidade do plantao ("Itaim", dentro do local "Rede D'Or"): o nome, a chave pela qual duas
 * grafias sao a mesma, o titulo que as listas mostram, as sugestoes e o valor que o
 * formulario propoe. Sem banco, sem tela.
 */
import {
  LIMITE_UNIDADE,
  chaveUnidade,
  normalizaUnidade,
  sugestoesDeUnidade,
  tituloDoPlantao,
  validaPlantao,
  valorParaUnidade,
} from "../src/lib/plantoes.ts";
import { instante } from "../src/lib/datetime.ts";
import { plantaoDaSerie, validaSerie } from "../src/lib/recorrencia.ts";
import { check, igual, report } from "./helpers.mjs";

const uso = (unidade, dia, h0, h1, valorBruto, status = "realizado") => ({
  unidade,
  inicio: instante(2026, 10, dia, h0),
  fim: instante(2026, 10, dia + (h1 <= h0 ? 1 : 0), h1),
  valorBruto,
  status,
});

const plantao = (extra = {}) => ({
  localId: 1,
  unidade: null,
  inicio: instante(2026, 10, 20, 7),
  fim: instante(2026, 10, 20, 19),
  valorBruto: 150000,
  descontoPercentual: 0,
  status: "agendado",
  observacao: null,
  ...extra,
});

export function testes() {
  /* ------------------------------- o nome da unidade ------------------------------- */

  igual("vazio vira nulo", normalizaUnidade(""), null);
  igual("so espacos vira nulo", normalizaUnidade("   \t "), null);
  igual("nulo e indefinido tambem", normalizaUnidade(undefined), null);
  igual("tira os espacos das pontas", normalizaUnidade("  Itaim  "), "Itaim");
  igual("espacos repetidos viram um so", normalizaUnidade("Itaim    Central"), "Itaim Central");
  igual("quebra de linha vira espaco", normalizaUnidade("Itaim\nCentral"), "Itaim Central");
  igual("acentos e maiusculas ficam como a pessoa digitou", normalizaUnidade("São Luís"), "São Luís");
  igual("o limite e aplicado", normalizaUnidade("x".repeat(100))?.length, LIMITE_UNIDADE);
  igual("e nao deixa espaco sobrando no corte", normalizaUnidade("a".repeat(59) + " b"), "a".repeat(59));

  /* --------------------------- a chave: mesma unidade, outra grafia --------------------------- */

  igual("maiuscula nao importa", chaveUnidade("ITAIM"), chaveUnidade("itaim"));
  igual("espaco sobrando nao importa", chaveUnidade("  itaim "), chaveUnidade("Itaim"));
  igual("acento nao importa", chaveUnidade("São Luís"), chaveUnidade("sao luis"));
  igual("a chave e minuscula e sem acento", chaveUnidade("São Luís"), "sao luis");
  check("unidades diferentes tem chaves diferentes", chaveUnidade("Itaim") !== chaveUnidade("Itaim 2"));
  igual("vazio tem chave vazia", chaveUnidade(null), "");

  /* ------------------------------- o titulo nas listas ------------------------------- */

  const rede = { nome: "Rede D'Or", apelido: null };
  igual("com unidade: unidade e local", tituloDoPlantao({ unidade: "Itaim", local: rede }), "Itaim · Rede D'Or");
  igual("sem unidade: so o local, como sempre foi", tituloDoPlantao({ unidade: null, local: rede }), "Rede D'Or");
  igual("unidade so de espacos conta como nenhuma", tituloDoPlantao({ unidade: "   ", local: rede }), "Rede D'Or");
  igual("sem unidade, o apelido do local continua aparecendo", tituloDoPlantao({ local: { nome: "Hospital Central", apelido: "HC" } }), "Hospital Central · HC");
  igual("com unidade, o apelido nao entra (seria nome demais)", tituloDoPlantao({ unidade: "Itaim", local: { nome: "Rede D'Or", apelido: "RD" } }), "Itaim · Rede D'Or");
  igual("plantao antigo (sem o campo) funciona", tituloDoPlantao({ local: rede }), "Rede D'Or");

  /* ----------------------------------- validacao ----------------------------------- */

  igual("unidade normal nao da erro", validaPlantao(plantao({ unidade: "Itaim" })).erros.unidade, undefined);
  igual("sem unidade nao da erro", validaPlantao(plantao()).erros.unidade, undefined);
  check("unidade de 61 caracteres da erro", Boolean(validaPlantao(plantao({ unidade: "x".repeat(61) })).erros.unidade));
  igual("espacos repetidos nao estouram o limite", validaPlantao(plantao({ unidade: "a" + " ".repeat(80) + "b" })).erros.unidade, undefined);
  const outro = [{ id: 9, ...plantao({ unidade: "Itaim", inicio: instante(2026, 10, 20, 7), fim: instante(2026, 10, 20, 13) }), local: { nome: "Rede D'Or", apelido: null, cor: "#000", arquivado: false }, status: "agendado" }];
  check("o aviso de conflito diz QUAL unidade", (validaPlantao(plantao(), outro).avisos.conflito ?? "").includes("Itaim · Rede D'Or"), validaPlantao(plantao(), outro).avisos.conflito);

  // escalas
  const modelo = { localId: 1, unidade: "Itaim", inicioMin: 420, fimMin: 1140, valorBruto: 150000, descontoPercentual: 0, observacao: null };
  const regra = { tipo: "semanal", diasSemana: 1 << 2, cada: 1, diaDoMes: null, inicioDia: instante(2026, 10, 17), fimDia: null };
  igual("o plantao de uma escala leva a unidade do modelo", plantaoDaSerie(modelo, instante(2026, 10, 17)).unidade, "Itaim");
  igual("e a normaliza", plantaoDaSerie({ ...modelo, unidade: "  Itaim   Central " }, instante(2026, 10, 17)).unidade, "Itaim Central");
  igual("modelo antigo, sem o campo, vira sem unidade", plantaoDaSerie({ ...modelo, unidade: undefined }, instante(2026, 10, 17)).unidade, null);
  igual("escala com unidade valida passa", validaSerie({ ...modelo, regra }).unidade, undefined);
  check("escala com unidade longa demais nao passa", Boolean(validaSerie({ ...modelo, unidade: "x".repeat(61), regra }).unidade));

  /* ---------------------------------- sugestoes ---------------------------------- */

  igual("sem plantoes, sem sugestoes", sugestoesDeUnidade([]).length, 0);

  const usos = [
    uso("Itaim", 2, 7, 19, 140000), // 12 h, antigo
    uso("Itaim", 9, 7, 19, 150000), // 12 h, mais novo: este e o valor de 12 h
    uso("Itaim", 5, 7, 7, 280000), // 24 h
    uso("itaim ", 12, 19, 7, 160000), // 12 h noturno, o MAIS recente, outra grafia
    uso("Central", 6, 7, 19, 120000),
    uso("Central", 20, 7, 19, 125000, "cancelado"), // cancelado nao diz quanto vale
    uso("Pinheiros", 1, 7, 19, 100000, "trocado"), // so trocado: nem aparece
  ];
  const s = sugestoesDeUnidade(usos);
  igual("duas unidades (cancelado e trocado nao contam, e as grafias se juntam)", s.length, 2);
  igual("a mais recente primeiro", s[0].unidade, "itaim");
  igual("a grafia e a do uso mais recente", s[0].unidade, "itaim");
  igual("a outra vem depois", s[1].unidade, "Central");
  igual("quantos usos", s[0].usos, 4);
  igual("o ultimo valor de 12 h e o do plantao mais novo de 12 h", s[0].valorPorMinutos[12 * 60], 160000);
  igual("o de 24 h e o unico de 24 h", s[0].valorPorMinutos[24 * 60], 280000);
  igual("o ultimo valor (qualquer duracao) e o do uso mais recente", s[0].ultimoValor, 160000);
  igual("e quantos minutos ele tinha", s[0].ultimosMinutos, 12 * 60);
  igual("Central: o cancelado nao conta", s[1].usos, 1);
  igual("e o valor e o do plantao que valeu", s[1].ultimoValor, 120000);
  const ordem = sugestoesDeUnidade([...usos].reverse());
  igual("a ordem de entrada nao importa", JSON.stringify(ordem), JSON.stringify(s));
  igual("unidade vazia nao vira sugestao", sugestoesDeUnidade([uso("  ", 3, 7, 19, 100)]).length, 0);
  const empate = sugestoesDeUnidade([uso("Beta", 3, 7, 19, 100), uso("Alfa", 3, 7, 19, 100)]);
  igual("empate de data: ordem alfabetica", empate.map((x) => x.unidade).join(","), "Alfa,Beta");

  /* ------------------------------- o valor proposto ------------------------------- */

  const local = { modoValor: "plantao", valorPadrao: 90000 };
  const dia = (h0, h1) => ({ inicio: instante(2026, 10, 25, h0), fim: instante(2026, 10, 25 + (h1 <= h0 ? 1 : 0), h1) });

  let v = valorParaUnidade({ unidade: "Itaim", ...dia(7, 19), sugestoes: s, local });
  igual("unidade conhecida, mesma duracao: o ultimo valor dela", v.valor, 160000);
  igual("e diz de onde veio", v.origem, "unidade");

  v = valorParaUnidade({ unidade: "ITAIM", ...dia(7, 7), sugestoes: s, local });
  igual("em maiuscula e o mesmo (24 h)", v.valor, 280000);

  v = valorParaUnidade({ unidade: "Itaim", ...dia(7, 13), sugestoes: s, local });
  igual("duracao que ela nunca teve (6 h): o ultimo valor, de outra duracao", v.valor, 160000);
  igual("e AVISA que a duracao e outra", v.origem, "unidade_outra_duracao");
  igual("dizendo de quantos minutos era", v.minutos, 12 * 60);

  v = valorParaUnidade({ unidade: "Nova", ...dia(7, 19), sugestoes: s, local });
  igual("unidade nova: o valor padrao do local", v.valor, 90000);
  igual("origem: o local", v.origem, "local");

  v = valorParaUnidade({ unidade: null, ...dia(7, 19), sugestoes: s, local });
  igual("sem unidade: o valor do local", v.valor, 90000);

  v = valorParaUnidade({ unidade: "Nova", ...dia(7, 19), sugestoes: s, local: { modoValor: "hora", valorPadrao: 10000 } });
  igual("local que paga por hora: valor da hora x duracao (12 h)", v.valor, 120000);

  v = valorParaUnidade({ unidade: "Nova", ...dia(7, 19), sugestoes: s, local: { modoValor: "plantao", valorPadrao: 0 } });
  igual("sem valor padrao e sem historico: nada", v.origem, "nenhuma");
  igual("e valor zero", v.valor, 0);

  v = valorParaUnidade({ unidade: "Itaim", ...dia(7, 19), sugestoes: s, local: null });
  igual("sem local escolhido ainda, a unidade conhecida ainda vale", v.valor, 160000);
  v = valorParaUnidade({ unidade: "Nova", ...dia(7, 19), sugestoes: [], local: null });
  igual("sem local e sem historico: nada", v.origem, "nenhuma");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testes();
  process.exit(report() ? 0 : 1);
}
