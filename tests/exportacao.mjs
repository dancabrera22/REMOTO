/**
 * Exportacao para planilha: o formato que o Excel/Planilhas brasileiro abre
 * direto, e o que nunca pode virar comando ao abrir o arquivo.
 */
import { listaPlantoesParaExportar, anosComPlantoes } from "../src/db/exportacao.ts";
import { criaLocal } from "../src/db/locais.ts";
import { CABECALHO, celulaCsv, linhaCsv, montaCsv, nomeDoArquivoCsv } from "../src/lib/exportacao.ts";
import { instante } from "../src/lib/datetime.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

const BOM = String.fromCharCode(0xfeff);
const regra = (extra = {}) => ({ tipo: "dia_mes_seguinte", diaPagamento: 10, diasApos: null, diaFechamento: null, mesesAdiante: 1, ajusteDiaUtil: "proximo", ...extra });
const linha = (extra = {}) => ({
  inicio: instante(2026, 10, 20, 7),
  fim: instante(2026, 10, 20, 19),
  localNome: "Hospital Central",
  status: "realizado",
  valorBruto: 120000,
  descontoPercentual: 10,
  pagoEm: null,
  observacao: null,
  emEscala: false,
  regra: regra(),
  ...extra,
});

export async function testes() {
  /* ----------------------------------- celula ----------------------------------- */

  igual("texto simples nao muda", celulaCsv("Hospital Central"), "Hospital Central");
  igual("com ponto e virgula, vai entre aspas", celulaCsv("A; B"), "\"A; B\"");
  igual("aspas sao dobradas", celulaCsv("o \"bom\""), "\"o \"\"bom\"\"\"");
  igual("quebra de linha, entre aspas", celulaCsv("a\nb"), "\"a\nb\"");
  igual("retorno de carro, entre aspas", celulaCsv("a\rb"), "\"a\rb\"");
  igual("virgula comum nao precisa de aspas (o separador e ponto e virgula)", celulaCsv("1,5"), "1,5");
  igual("acento e unicode passam", celulaCsv("Clínica São José ✓"), "Clínica São José ✓");
  igual("celula vazia", celulaCsv(""), "");

  // Injecao de formula: nada que a planilha interprete como comando.
  igual("comeca com = : ganha apostrofo", celulaCsv("=SOMA(A1:A9)"), "'=SOMA(A1:A9)");
  igual("comeca com + : ganha apostrofo", celulaCsv("+55 11 99999"), "'+55 11 99999");
  igual("comeca com - : ganha apostrofo", celulaCsv("-2+3"), "'-2+3");
  igual("comeca com @ : ganha apostrofo", celulaCsv("@cmd"), "'@cmd");
  igual("comeca com tab : ganha apostrofo", celulaCsv("\t=1"), "'\t=1");
  igual("a formula perigosa com aspas e ponto e virgula fica segura e entre aspas", celulaCsv("=HYPERLINK(\"http://x\";\"a\")"), "\"'=HYPERLINK(\"\"http://x\"\";\"\"a\"\")\"");
  igual("= no meio do texto e inofensivo", celulaCsv("a=b"), "a=b");
  igual("hifen no meio tambem", celulaCsv("UPA - Norte"), "UPA - Norte");

  /* ------------------------------------ linha ------------------------------------ */

  const cab = CABECALHO.join(";");
  igual("o cabecalho tem 16 colunas", CABECALHO.length, 16);
  igual("e esta na ordem prometida", cab, "Data;Dia;Início;Fim;Horas;Local;Unidade;Situação;Conta no valor;Valor bruto;Desconto (%);Valor líquido;Recebimento previsto;Pago em;Observação;Escala");

  igual(
    "uma linha completa, tal qual a planilha vai ver",
    linhaCsv(linha({ observacao: "Troca", emEscala: true })),
    "20/11/2026;sex;20/11/2026 07:00;20/11/2026 19:00;12;Hospital Central;;Realizado;Sim;1200,00;10;1080,00;10/12/2026;;Troca;Sim",
  );
  igual(
    "com unidade, ela vem logo depois do local",
    linhaCsv(linha({ localNome: "Rede D'Or", unidade: "Itaim", observacao: "Troca", emEscala: true })),
    "20/11/2026;sex;20/11/2026 07:00;20/11/2026 19:00;12;Rede D'Or;Itaim;Realizado;Sim;1200,00;10;1080,00;10/12/2026;;Troca;Sim",
  );
  check("unidade que parece formula fica inofensiva", linhaCsv(linha({ unidade: "=1+1" })).includes(";'=1+1;"));
  check("unidade com ponto e virgula fica entre aspas (nao quebra a coluna)", linhaCsv(linha({ unidade: "A;B" })).includes(';"A;B";'));
  igual("e o numero de campos continua batendo", linhaCsv(linha({ unidade: "A;B" })).split(";").length - 1, CABECALHO.length);
  igual("o numero de campos bate com o cabecalho", linhaCsv(linha()).split(";").length, CABECALHO.length);

  const noturno = linha({ inicio: instante(2026, 10, 20, 19), fim: instante(2026, 10, 21, 7) });
  check("noturno: a data e a de ENTRADA, o fim cai no dia seguinte", linhaCsv(noturno).startsWith("20/11/2026;sex;20/11/2026 19:00;21/11/2026 07:00;12;"));
  check("24 horas", linhaCsv(linha({ inicio: instante(2026, 10, 20, 7), fim: instante(2026, 10, 21, 7) })).includes(";24;"));
  check("duracao fracionada com virgula (7h30)", linhaCsv(linha({ fim: instante(2026, 10, 20, 14, 30) })).includes(";7,5;"));
  check("20 minutos: 0,33 (arredonda para duas casas)", linhaCsv(linha({ fim: instante(2026, 10, 20, 7, 20) })).includes(";0,33;"));
  check("40 minutos: 0,67", linhaCsv(linha({ fim: instante(2026, 10, 20, 7, 40) })).includes(";0,67;"));
  check("observacao ausente sai vazia (nao a palavra null)", linhaCsv(linha()).endsWith(";10/12/2026;;;Não") && !linhaCsv(linha()).includes("null"));
  check("quinze minutos: 0,25", linhaCsv(linha({ fim: instante(2026, 10, 20, 7, 15) })).includes(";0,25;"));
  check("dinheiro com duas casas e virgula, sem R$ nem milhar", /;1200,00;/.test(linhaCsv(linha())) && !linhaCsv(linha()).includes("R$") && !linhaCsv(linha()).includes("1.200"));
  check("valor com centavos", linhaCsv(linha({ valorBruto: 123456, descontoPercentual: 0 })).includes(";1234,56;0;1234,56;"));
  check("desconto fracionado com virgula", linhaCsv(linha({ descontoPercentual: 11.5 })).includes(";11,5;"));
  check("valor zero", linhaCsv(linha({ valorBruto: 0 })).includes(";0,00;10;0,00;"));
  check("liquido considera o desconto de 100%", linhaCsv(linha({ descontoPercentual: 100 })).includes(";1200,00;100;0,00;"));

  check("pago: traz a data do pagamento", linhaCsv(linha({ pagoEm: instante(2026, 11, 5) })).includes(";10/12/2026;05/12/2026;"));
  check("nao pago: a coluna fica vazia", linhaCsv(linha()).includes(";10/12/2026;;"));

  const cancelado = linhaCsv(linha({ status: "cancelado" }));
  check("cancelado: aparece, mas nao conta no valor", cancelado.includes(";Cancelado;Não;"));
  check("... e nao tem recebimento previsto", cancelado.includes(";Não;1200,00;10;1080,00;;;"));
  check("trocado idem", linhaCsv(linha({ status: "trocado" })).includes(";Trocado;Não;"));
  check("agendado conta no valor e tem previsao", linhaCsv(linha({ status: "agendado" })).includes(";Agendado;Sim;1200,00;10;1080,00;10/12/2026;"));
  check("regra incompleta: sem data de recebimento", linhaCsv(linha({ regra: regra({ diaPagamento: null }) })).includes(";1080,00;;;"));
  check("previsao respeita feriado (dia 20 de novembro cai na segunda)", linhaCsv(linha({ inicio: instante(2026, 9, 5, 7), fim: instante(2026, 9, 5, 19), regra: regra({ diaPagamento: 20 }) })).includes(";23/11/2026;"));

  check("observacao com ponto e virgula e quebra de linha vai entre aspas", linhaCsv(linha({ observacao: "a; b\nc" })).includes(";\"a; b\nc\";"));
  check("nome de local que parece formula fica inofensivo", linhaCsv(linha({ localNome: "=1+1" })).includes(";'=1+1;"));
  check("observacao que parece formula tambem", linhaCsv(linha({ observacao: "@SOMA(1)" })).includes(";'@SOMA(1);"));

  /* ------------------------------------ arquivo ------------------------------------ */

  const csv = montaCsv([linha(), linha({ inicio: instante(2026, 10, 21, 7), fim: instante(2026, 10, 21, 19) })]);
  check("comeca com a marca de UTF-8 (o Excel reconhece os acentos)", csv.startsWith(BOM));
  check("linhas terminadas em CRLF", csv.split("\r\n").length === 4 && !csv.replace(/\r\n/g, "").includes("\n"));
  igual("cabecalho + 2 linhas + final vazio", csv.split("\r\n").length - 1, 3);
  check("o cabecalho vem logo depois do BOM", csv.slice(1).startsWith(cab + "\r\n"));
  check("termina com quebra de linha", csv.endsWith("\r\n"));
  igual("sem plantoes: so o cabecalho", montaCsv([]), BOM + cab + "\r\n");
  igual("a ordem recebida e mantida", montaCsv([linha({ localNome: "B" }), linha({ localNome: "A" })]).split("\r\n").slice(1, 3).map((l) => l.split(";")[5]).join(), "B,A");
  check("observacao com quebra de linha nao quebra as linhas do arquivo (esta entre aspas)", montaCsv([linha({ observacao: "x\ny" })]).split("\r\n").length === 3);

  igual("nome do arquivo de um ano", nomeDoArquivoCsv(2026), "meu-plantao-plantoes-2026.csv");
  igual("nome do arquivo de todos", nomeDoArquivoCsv(null), "meu-plantao-plantoes-todos.csv");

  /* ------------------------------------- banco ------------------------------------- */

  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const a = await criaLocal(ex, { ...localVazio(), nome: "Hospital A", valorPadrao: 100000 }, 1);
  const b = await criaLocal(ex, { ...localVazio(), nome: "UPA B", valorPadrao: 50000 }, 2);
  const insere = (localId, inicio, extra = {}) =>
    db
      .prepare("INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, desconto_percentual, status, observacao, pago_em, serie_id, ocorrencia_dia, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 1, 1)")
      .run(localId, inicio, inicio + 12 * 3600e3, extra.valor ?? 100000, extra.status ?? "realizado", extra.obs ?? null, extra.pagoEm ?? null, extra.serie ?? null, extra.ocorrencia ?? null);

  db.prepare("INSERT INTO series (local_id, tipo, dias_semana, cada, inicio_dia, inicio_min, fim_min, valor_bruto, criado_em, atualizado_em) VALUES (?, 'semanal', 4, 1, 1, 420, 1140, 0, 1, 1)").run(a);
  insere(a, instante(2025, 11, 31, 7)); // 31/12/2025
  insere(a, instante(2026, 0, 1, 7)); // 01/01/2026 (segundo exato do ano novo, local)
  db.prepare("UPDATE plantoes SET unidade = 'Itaim' WHERE inicio = ?").run(instante(2026, 0, 1, 7));
  insere(b, instante(2026, 5, 10, 7), { status: "cancelado" });
  insere(a, instante(2026, 11, 31, 19), { obs: "ultimo do ano", pagoEm: instante(2027, 0, 5) });
  insere(a, instante(2027, 0, 1, 7), { status: "agendado", serie: 1, ocorrencia: 5 });

  const tudo = await listaPlantoesParaExportar(ex, null);
  igual("sem filtro: todos os anos, todas as situacoes", tudo.length, 5);
  igual("em ordem de data", tudo.map((l) => l.inicio).join(), [...tudo.map((l) => l.inicio)].sort((x, y) => x - y).join());
  const de2026 = await listaPlantoesParaExportar(ex, 2026);
  igual("so 2026 (inclui 1 de janeiro e 31 de dezembro, exclui 31/12/2025 e 1/1/2027)", de2026.length, 3);
  check("o primeiro de 2026 e o de 1 de janeiro", de2026[0].inicio === instante(2026, 0, 1, 7));
  check("o ultimo e o de 31 de dezembro 19h", de2026[2].inicio === instante(2026, 11, 31, 19));
  igual("2025 tem um", (await listaPlantoesParaExportar(ex, 2025)).length, 1);
  igual("ano sem plantoes", (await listaPlantoesParaExportar(ex, 2020)).length, 0);
  igual("traz o nome do local", de2026[1].localNome, "UPA B");
  igual("traz a unidade (quando ha)", de2026[0].unidade, "Itaim");
  igual("e nula quando nao ha", de2026[1].unidade, null);
  check("a unidade chega a planilha, na coluna certa", montaCsv(de2026).split("\r\n")[1].split(";")[6] === "Itaim");
  igual("traz a situacao", de2026[1].status, "cancelado");
  igual("traz o pagamento e a observacao", `${de2026[2].pagoEm === instante(2027, 0, 5)}/${de2026[2].observacao}`, "true/ultimo do ano");
  igual("e se e de escala", `${tudo[0].emEscala}/${tudo[4].emEscala}`, "false/true");
  check("traz a regra de pagamento do local", de2026[0].regra.tipo === "dia_mes_seguinte" && de2026[0].regra.diaPagamento === 10 && de2026[0].regra.mesesAdiante === 1);

  const csvDoBanco = montaCsv(de2026);
  igual("o CSV do banco tem cabecalho + 3 linhas", csvDoBanco.split("\r\n").length - 1, 4);
  check("o valor de cada linha chega (R$ 1000)", csvDoBanco.includes(";1000,00;0;1000,00;"));

  igual("anos com plantoes, do mais novo ao mais antigo", (await anosComPlantoes(ex)).join(), "2027,2026,2025");
  const { db: vazio } = bancoMigrado();
  igual("sem plantoes, sem anos", (await anosComPlantoes(adaptador(vazio))).length, 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
