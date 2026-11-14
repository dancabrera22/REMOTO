/**
 * Locais: validacao, sugestao de cor e persistencia.
 *
 * A parte de banco usa um adaptador fino sobre o `node:sqlite`: `src/db/locais.ts`
 * so conhece a interface `Executor`, entao os comandos SQL que rodam aqui sao
 * exatamente os que rodam no celular.
 */
import { criaLocal, atualizaLocal, arquivaLocal, buscaLocal, coresEmUso, listaLocais, restauraLocal } from "../src/db/locais.ts";
import {
  descreveValor,
  localVazio,
  proximaCor,
  temErros,
  validaLocal,
  valorEstimado,
  valorLiquido,
} from "../src/lib/locais.ts";
import { formatPercentual, lePercentual, percentualParaCampo } from "../src/lib/money.ts";
import { coresLocais } from "../src/theme/tokens.ts";
import { bancoMigrado } from "./esquema.mjs";
import { check, igual, report } from "./helpers.mjs";

function adaptador(db) {
  return {
    async getAllAsync(sql, params = []) {
      return db.prepare(sql).all(...params).map((l) => ({ ...l }));
    },
    async getFirstAsync(sql, params = []) {
      const l = db.prepare(sql).get(...params);
      return l ? { ...l } : null;
    },
    async runAsync(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  };
}

const novo = (extra = {}) => ({ ...localVazio(), nome: "Hospital Central", ...extra });
const rejeita = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

export async function testes() {
  const HEX = coresLocais.map((c) => c.hex);

  /* ------------------------------- cor sugerida ------------------------------- */

  igual("sem locais, sugere a primeira cor", proximaCor([]), HEX[0]);
  igual("pula as cores em uso", proximaCor([HEX[0], HEX[1]]), HEX[2]);
  igual("ignora maiusculas ao comparar", proximaCor([HEX[0].toLowerCase()]), HEX[1]);
  igual("aproveita buraco no meio", proximaCor([HEX[0], HEX[2]]), HEX[1]);
  igual("paleta esgotada: recomeca, em vez de falhar", proximaCor(HEX), HEX[0]);
  igual("local novo ja nasce com cor livre", localVazio([HEX[0]]).cor, HEX[1]);

  /* -------------------------------- validacao -------------------------------- */

  const ok = (e, outros = []) => validaLocal(e, outros);
  check("local minimo valido", !temErros(ok(novo()).erros));
  check("nome vazio recusado", ok(novo({ nome: "   " })).erros.nome);
  check("nome longo demais recusado", ok(novo({ nome: "x".repeat(61) })).erros.nome);
  check("nome no limite aceito", !ok(novo({ nome: "x".repeat(60) })).erros.nome);
  check("apelido longo demais recusado", ok(novo({ apelido: "x".repeat(21) })).erros.apelido);
  check("cor invalida recusada", ok(novo({ cor: "azul" })).erros.cor);
  check("cor sem # recusada", ok(novo({ cor: "2F6FED" })).erros.cor);
  check("valor negativo recusado", ok(novo({ valorPadrao: -1 })).erros.valorPadrao);
  check("valor zero aceito (sem padrao)", !ok(novo({ valorPadrao: 0 })).erros.valorPadrao);
  check("desconto acima de 100 recusado", ok(novo({ descontoPercentual: 101 })).erros.descontoPercentual);
  check("desconto negativo recusado", ok(novo({ descontoPercentual: -1 })).erros.descontoPercentual);
  check("desconto fracionado aceito", !ok(novo({ descontoPercentual: 11.5 })).erros.descontoPercentual);
  check(
    "erros da regra aparecem na validacao do local",
    ok(novo({ regra: { ...novo().regra, diaPagamento: 40 } })).erros.diaPagamento,
  );

  const outros = [{ id: 7, nome: "Hospital São Lucas", cor: HEX[3] }];
  check(
    "nome repetido avisa, ignorando acento e caixa",
    ok(novo({ nome: "hospital sao lucas" }), outros).avisos.nome,
  );
  check("nome repetido nao impede salvar", !temErros(ok(novo({ nome: "hospital sao lucas" }), outros).erros));
  check("nome diferente nao avisa", !ok(novo({ nome: "UPA Norte" }), outros).avisos.nome);
  check("cor repetida avisa quem ja usa", ok(novo({ cor: HEX[3] }), outros).avisos.cor?.includes("Hospital São Lucas"));
  check("cor livre nao avisa", !ok(novo({ cor: HEX[4] }), outros).avisos.cor);

  /* ------------------------------ valores e texto ------------------------------ */

  igual("plantao fechado nao depende da duracao", valorEstimado("plantao", 120000, 30), 120000);
  igual("por hora: 12h a R$ 100", valorEstimado("hora", 10000), 120000);
  igual("por hora: duracao informada", valorEstimado("hora", 10000, 360), 60000);
  igual("liquido com 11%", valorLiquido(120000, 11), 106800);
  igual("descricao por plantao", descreveValor("plantao", 120000), "R$ 1.200 por plantão");
  igual("descricao por hora", descreveValor("hora", 15050), "R$ 150,50 por hora");
  igual("descricao sem valor", descreveValor("plantao", 0), "Sem valor padrão");

  igual("percentual inteiro", lePercentual("11"), 11);
  igual("percentual com virgula", lePercentual("11,5"), 11.5);
  igual("percentual com ponto", lePercentual("11.5"), 11.5);
  igual("percentual com sinal", lePercentual("11%"), 11);
  igual("percentual vazio", lePercentual(""), null);
  igual("percentual texto", lePercentual("abc"), null);
  igual("percentual negativo nao passa", lePercentual("-5"), null);
  igual("formata inteiro", formatPercentual(11), "11%");
  igual("formata fracionado", formatPercentual(11.5), "11,5%");
  igual("campo zerado fica vazio", percentualParaCampo(0), "");
  igual("campo fracionado volta com virgula", percentualParaCampo(11.5), "11,5");

  /* -------------------------------- persistencia -------------------------------- */

  const { db } = bancoMigrado();
  const ex = adaptador(db);

  const completo = novo({
    nome: "  Hospital Central  ",
    apelido: "HC",
    cor: HEX[7],
    endereco: "Av. Brasil, 100",
    contato: "(11) 4000-0000",
    observacao: "Pedir passe na portaria",
    modoValor: "hora",
    valorPadrao: 123456,
    descontoPercentual: 11.5,
    regra: { tipo: "fechamento", diaPagamento: 10, diasApos: null, diaFechamento: 20, mesesAdiante: 1, ajusteDiaUtil: "anterior" },
  });
  const id = await criaLocal(ex, completo, 1000);
  check("cria e devolve o id", Number.isInteger(id) && id > 0);

  const lido = await buscaLocal(ex, id);
  igual("nome sai sem os espacos das pontas", lido.nome, "Hospital Central");
  igual("apelido", lido.apelido, "HC");
  igual("cor", lido.cor, HEX[7]);
  igual("endereco", lido.endereco, "Av. Brasil, 100");
  igual("modo de valor", lido.modoValor, "hora");
  igual("valor em centavos inteiros", lido.valorPadrao, 123456);
  igual("desconto fracionado", lido.descontoPercentual, 11.5);
  igual("regra: tipo", lido.regra.tipo, "fechamento");
  igual("regra: fechamento", lido.regra.diaFechamento, 20);
  igual("regra: pagamento", lido.regra.diaPagamento, 10);
  igual("regra: ajuste", lido.regra.ajusteDiaUtil, "anterior");
  igual("carimbo de criacao", lido.criadoEm, 1000);
  igual("nao nasce arquivado", lido.arquivadoEm, null);

  const vazio = await buscaLocal(ex, await criaLocal(ex, novo({ nome: "UPA", apelido: "  ", endereco: "", contato: null }), 1));
  igual("apelido so com espacos vira nulo", vazio.apelido, null);
  igual("texto vazio vira nulo", vazio.endereco, null);

  const enorme = await buscaLocal(ex, await criaLocal(ex, novo({ nome: "x".repeat(200), observacao: "y".repeat(900) }), 1));
  igual("banco trunca nome acima do limite", enorme.nome.length, 60);
  igual("banco trunca observacao acima do limite", enorme.observacao.length, 300);

  check("o CHECK do banco recusa desconto de 150%", await rejeita(() => criaLocal(ex, novo({ nome: "Z", descontoPercentual: 150 }))));

  // Trocar o tipo da regra nao pode deixar campo do tipo antigo no banco.
  await atualizaLocal(
    ex,
    id,
    { ...completo, regra: { tipo: "dias_apos", diaPagamento: 10, diasApos: 30, diaFechamento: 20, mesesAdiante: 1, ajusteDiaUtil: "nenhum" } },
    2000,
  );
  const trocado = await buscaLocal(ex, id);
  igual("dias_apos guarda o prazo", trocado.regra.diasApos, 30);
  igual("dias_apos descarta o dia de fechamento", trocado.regra.diaFechamento, null);
  igual("dias_apos descarta o dia de pagamento", trocado.regra.diaPagamento, null);
  igual("atualizar preserva a criacao", trocado.criadoEm, 1000);
  igual("atualizar muda o carimbo de alteracao", trocado.atualizadoEm, 2000);

  check("atualizar local inexistente devolve false", !(await atualizaLocal(ex, 9999, completo)));
  igual("buscar inexistente devolve null", await buscaLocal(ex, 9999), null);

  /* ---------------------------------- listagem ---------------------------------- */

  const { db: db2 } = bancoMigrado();
  const e2 = adaptador(db2);
  for (const nome of ["Zé Maria", "Beta", "Álvaro", "alfa"]) await criaLocal(e2, novo({ nome, cor: HEX[0] }));
  igual(
    "ordem alfabetica ignora acento e caixa",
    (await listaLocais(e2, { arquivados: false })).map((l) => l.nome).join(" | "),
    "alfa | Álvaro | Beta | Zé Maria",
  );

  const beta = (await listaLocais(e2, { arquivados: false })).find((l) => l.nome === "Beta");
  check("arquivar funciona", await arquivaLocal(e2, beta.id, 500));
  check("arquivar duas vezes nao refaz", !(await arquivaLocal(e2, beta.id, 600)));
  igual("some da lista de ativos", (await listaLocais(e2, { arquivados: false })).length, 3);
  igual("aparece nos arquivados", (await listaLocais(e2, { arquivados: true })).map((l) => l.nome).join(), "Beta");
  igual("guarda quando foi arquivado", (await buscaLocal(e2, beta.id)).arquivadoEm, 500);
  check("restaurar funciona", await restauraLocal(e2, beta.id, 700));
  check("restaurar um ativo nao faz nada", !(await restauraLocal(e2, beta.id, 800)));
  igual("volta para a lista de ativos", (await listaLocais(e2, { arquivados: false })).length, 4);

  const { db: db3 } = bancoMigrado();
  const e3 = adaptador(db3);
  const a = await criaLocal(e3, novo({ nome: "A", cor: HEX[0] }));
  await criaLocal(e3, novo({ nome: "B", cor: HEX[1] }));
  const c = await criaLocal(e3, novo({ nome: "C", cor: HEX[2] }));
  await arquivaLocal(e3, c);
  igual("cores em uso ignoram os arquivados", (await coresEmUso(e3)).sort().join(), [HEX[0], HEX[1]].sort().join());
  igual("cores em uso podem excluir o local editado", (await coresEmUso(e3, a)).join(), HEX[1]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await testes();
  process.exit(report() ? 0 : 1);
}
