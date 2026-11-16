/**
 * Formato do backup e validacao do arquivo (sem banco): o que e aceito, o que
 * e recusado e com que mensagem. Restaurar apaga os dados, entao a dúvida
 * sempre pesa contra o arquivo.
 */
import { FORMATO, ORDEM_TABELAS, TABELAS, VERSAO_FORMATO, interpretaBackup, montaBackup, nomeDoArquivoDeBackup, resumoDoBackup, serializaBackup } from "../src/lib/backup.ts";
import { instante } from "../src/lib/datetime.ts";
import { check, igual } from "./helpers.mjs";

const local = (extra = {}) => ({
  id: 1, nome: "Hospital Central", apelido: "HC", cor: "#2F6FED", endereco: "Av. Brasil, 100", contato: null, observacao: null,
  modo_valor: "plantao", valor_padrao: 120000, regra_tipo: "dia_mes_seguinte", regra_dia_pagamento: 10, regra_dias_apos: null,
  regra_dia_fechamento: null, regra_meses_adiante: 1, ajuste_dia_util: "proximo", desconto_percentual: 11.5, criado_em: 1, atualizado_em: 2, arquivado_em: null,
  ...extra,
});
const serie = (extra = {}) => ({
  id: 1, local_id: 1, tipo: "semanal", dias_semana: 4, cada: 1, dia_do_mes: null, inicio_dia: 100, fim_dia: null, inicio_min: 420, fim_min: 1140,
  valor_bruto: 120000, desconto_percentual: 0, observacao: null, gerado_ate: 200, criado_em: 1, atualizado_em: 1, ...extra,
});
const plantao = (extra = {}) => ({
  id: 1, local_id: 1, inicio: 1000, fim: 5000, valor_bruto: 120000, desconto_percentual: 0, status: "realizado", observacao: null,
  criado_em: 1, atualizado_em: 1, serie_id: null, ocorrencia_dia: null, excecao: 0, pago_em: null, ...extra,
});

const dados = (extra = {}) => ({
  locais: [local()], series: [serie()], series_puladas: [{ serie_id: 1, ocorrencia_dia: 300 }],
  plantoes: [plantao(), plantao({ id: 2, serie_id: 1, ocorrencia_dia: 100, status: "agendado" })], ...extra,
});
const arquivo = (d = dados(), extra = {}) => ({ formato: FORMATO, versaoFormato: 1, esquema: 4, app: "1.0.0", criadoEm: 123, dados: d, ...extra });
const le = (obj) => interpretaBackup(typeof obj === "string" ? obj : JSON.stringify(obj));
const erro = (obj) => { const r = le(obj); return r.ok ? null : r.erro; };

export function testes() {
  /* --------------------------------- caminho feliz --------------------------------- */

  const b = montaBackup(dados(), { esquema: 4, app: "1.0.0", criadoEm: 999 });
  const r = interpretaBackup(serializaBackup(b));
  check("um backup montado e lido de volta", r.ok);
  igual("o resumo conta os locais", r.resumo.locais, 1);
  igual("... os plantoes", r.resumo.plantoes, 2);
  igual("... as escalas", r.resumo.series, 1);
  igual("... a data de criacao", r.resumo.criadoEm, 999);
  igual("... e a versao do app", r.resumo.app, "1.0.0");
  igual("ida e volta sem perder nada", JSON.stringify(r.backup.dados), JSON.stringify(dados()));
  igual("o formato e a versao", `${b.formato}/${b.versaoFormato}`, `${FORMATO}/${VERSAO_FORMATO}`);
  igual("resumoDoBackup bate com o da leitura", JSON.stringify(resumoDoBackup(b)), JSON.stringify(r.resumo));

  check("backup vazio e valido", le(arquivo({ locais: [], series: [], series_puladas: [], plantoes: [] })).ok);
  check("so locais, sem plantoes, e valido", le(arquivo({ locais: [local()], series: [], series_puladas: [], plantoes: [] })).ok);
  check("o BOM do inicio do arquivo e ignorado", interpretaBackup("\uFEFF" + JSON.stringify(arquivo())).ok);

  const estranho = interpretaBackup(JSON.stringify(arquivo(dados({ locais: [local({ nome: "Clínica \"Sul\" — 24h\nsetor; B", observacao: "linha 1\nlinha 2 ✓" })] }))));
  check("texto com aspas, quebra de linha e acento sobrevive", estranho.ok && estranho.backup.dados.locais[0].nome === "Clínica \"Sul\" — 24h\nsetor; B" && estranho.backup.dados.locais[0].observacao === "linha 1\nlinha 2 ✓");

  /* --------------------------------- compatibilidade --------------------------------- */

  const semPadroes = le(arquivo(dados({ locais: [{ id: 1, nome: "Mínimo", criado_em: 1, atualizado_em: 1 }], plantoes: [], series: [], series_puladas: [] })));
  check("local so com o essencial: os padroes do banco sao aplicados", semPadroes.ok && semPadroes.backup.dados.locais[0].cor === "#2D7D6F" && semPadroes.backup.dados.locais[0].modo_valor === "plantao" && semPadroes.backup.dados.locais[0].regra_meses_adiante === 1 && semPadroes.backup.dados.locais[0].ajuste_dia_util === "proximo" && semPadroes.backup.dados.locais[0].desconto_percentual === 0);
  check("e os campos que podem ser nulos viram nulo", semPadroes.backup.dados.locais[0].apelido === null && semPadroes.backup.dados.locais[0].arquivado_em === null);

  const comExtra = le(arquivo(dados({ plantoes: [plantao({ campo_novo: "de uma versao futura" })] })));
  check("coluna desconhecida e ignorada (nao quebra nem vai junto)", comExtra.ok && !("campo_novo" in comExtra.backup.dados.plantoes[0]));
  check("versao do esquema ausente nao impede", le({ ...arquivo(), esquema: undefined }).ok);

  /* ----------------------------------- nao e backup ----------------------------------- */

  check("texto que nao e JSON", /Não consegui ler/.test(erro("isto nao e json")));
  check("arquivo vazio", /Não consegui ler/.test(erro("")));
  check("JSON cortado no meio (download incompleto)", /Não consegui ler/.test(erro(JSON.stringify(arquivo()).slice(0, 80))));
  check("JSON de outro programa", /não é um backup do Meu Plantão/.test(erro({ nome: "outra coisa" })));
  check("uma lista no lugar do objeto", /não é um backup do Meu Plantão/.test(erro([1, 2, 3])));
  check("o numero 7", /não é um backup do Meu Plantão/.test(erro("7")));
  check("null", /não é um backup do Meu Plantão/.test(erro("null")));
  check("formato com outro nome", /não é um backup do Meu Plantão/.test(erro(arquivo(dados(), { formato: "outro-app" }))));

  /* ----------------------------------- versao ----------------------------------- */

  check("versao do formato mais nova: pede para atualizar o app", /versão mais nova do app/.test(erro(arquivo(dados(), { versaoFormato: VERSAO_FORMATO + 1 }))));
  check("versao do formato ausente", /não informa a versão/.test(erro({ ...arquivo(), versaoFormato: undefined })));
  check("versao do formato de texto", /não informa a versão/.test(erro(arquivo(dados(), { versaoFormato: "1" }))));
  check("versao do formato zero", /não informa a versão/.test(erro(arquivo(dados(), { versaoFormato: 0 }))));
  check("versao do formato fracionada", /não informa a versão/.test(erro(arquivo(dados(), { versaoFormato: 1.5 }))));

  /* ------------------------------------ estrutura ------------------------------------ */

  check("sem o bloco de dados", /sem os dados/.test(erro({ ...arquivo(), dados: undefined })));
  check("dados que nao sao objeto", /sem os dados/.test(erro(arquivo([]))));
  for (const t of ORDEM_TABELAS) {
    const d = dados();
    delete d[t];
    check(`tabela ${t} ausente: backup incompleto`, /incompleto/.test(erro(arquivo(d))));
  }
  check("tabela que nao e lista", /incompleto/.test(erro(arquivo(dados({ plantoes: {} })))));
  check("linha que nao e registro", /plantoes, linha 1: não é um registro/.test(erro(arquivo(dados({ plantoes: [5] })))));
  check("linha nula", /não é um registro/.test(erro(arquivo(dados({ locais: [null] })))));
  check("a mensagem diz a linha certa", /locais, linha 2/.test(erro(arquivo(dados({ locais: [local(), local({ id: 2, nome: 5 })] })))));

  /* --------------------------------------- campos --------------------------------------- */

  check("campo obrigatorio ausente", /falta o campo “nome”/.test(erro(arquivo(dados({ locais: [{ ...local(), nome: undefined }] })))));
  check("campo obrigatorio nulo", /falta o campo “inicio”/.test(erro(arquivo(dados({ plantoes: [plantao({ inicio: null })] })))));
  check("texto onde deveria ser numero", /“valor_bruto” está com um valor inválido/.test(erro(arquivo(dados({ plantoes: [plantao({ valor_bruto: "120000" })] })))));
  check("numero fracionado onde deveria ser inteiro", /“inicio” está com um valor inválido/.test(erro(arquivo(dados({ plantoes: [plantao({ inicio: 1.5 })] })))));
  check("numero onde deveria ser texto", /“nome” está com um valor inválido/.test(erro(arquivo(dados({ locais: [local({ nome: 42 })] })))));
  check("inteiro grande demais para ser seguro", /valor inválido/.test(erro('{"formato":"meu-plantao-backup","versaoFormato":1,"dados":{"locais":[],"series":[],"series_puladas":[],"plantoes":[{"id":1,"local_id":1,"inicio":99999999999999999999,"fim":1,"criado_em":1,"atualizado_em":1}]}}')));
  check("booleano nao vale como inteiro", /valor inválido/.test(erro(arquivo(dados({ plantoes: [plantao({ excecao: true })] })))));
  check("valor zero e valido (plantao sem valor definido)", le(arquivo(dados({ plantoes: [plantao({ valor_bruto: 0 })] }))).ok);
  check("desconto de 100% e valido (e o de 0%)", le(arquivo(dados({ plantoes: [plantao({ desconto_percentual: 100 }), plantao({ id: 3, desconto_percentual: 0 })] }))).ok);
  check("desconto fracionado e aceito (tipo numero)", le(arquivo(dados({ plantoes: [plantao({ desconto_percentual: 7.5 })] }))).ok);

  /* ---------------------------------- referencias ---------------------------------- */

  check("plantao de um local que nao esta no arquivo", /o local 9 não está no arquivo/.test(erro(arquivo(dados({ plantoes: [plantao({ local_id: 9 })] })))));
  check("escala de um local que nao esta no arquivo", /o local 9 não está no arquivo/.test(erro(arquivo(dados({ series: [serie({ local_id: 9 })] })))));
  check("plantao de uma escala que nao esta no arquivo", /a escala 9 não está no arquivo/.test(erro(arquivo(dados({ plantoes: [plantao({ serie_id: 9, ocorrencia_dia: 1 })] })))));
  check("plantao de escala sem o dia da ocorrencia", /sem o dia da ocorrência/.test(erro(arquivo(dados({ plantoes: [plantao({ serie_id: 1, ocorrencia_dia: null })] })))));
  check("dia pulado de uma escala que nao existe", /a escala 9 não está no arquivo/.test(erro(arquivo(dados({ series_puladas: [{ serie_id: 9, ocorrencia_dia: 1 }] })))));
  check("id de local repetido", /locais: o id 1 aparece mais de uma vez/.test(erro(arquivo(dados({ locais: [local(), local()] })))));
  check("id de plantao repetido", /plantoes: o id 1 aparece mais de uma vez/.test(erro(arquivo(dados({ plantoes: [plantao(), plantao()] })))));
  check("id de escala repetido", /series: o id 1 aparece mais de uma vez/.test(erro(arquivo(dados({ series: [serie(), serie()] })))));
  check("duas ocorrencias da escala no mesmo dia", /duas ocorrências no mesmo dia/.test(erro(arquivo(dados({ plantoes: [plantao({ id: 1, serie_id: 1, ocorrencia_dia: 5 }), plantao({ id: 2, serie_id: 1, ocorrencia_dia: 5 })] })))));
  check("dia pulado repetido", /repete um dia excluído/.test(erro(arquivo(dados({ series_puladas: [{ serie_id: 1, ocorrencia_dia: 3 }, { serie_id: 1, ocorrencia_dia: 3 }] })))));

  /* -------------------------------------- regras -------------------------------------- */

  check("situacao desconhecida", /situação desconhecida/.test(erro(arquivo(dados({ plantoes: [plantao({ status: "sumiu" })] })))));
  check("fim igual ao inicio", /o fim não vem depois do início/.test(erro(arquivo(dados({ plantoes: [plantao({ inicio: 5, fim: 5 })] })))));
  check("fim antes do inicio", /o fim não vem depois do início/.test(erro(arquivo(dados({ plantoes: [plantao({ inicio: 9, fim: 5 })] })))));
  check("valor negativo no plantao", /valor negativo/.test(erro(arquivo(dados({ plantoes: [plantao({ valor_bruto: -1 })] })))));
  check("valor negativo na escala", /valor negativo/.test(erro(arquivo(dados({ series: [serie({ valor_bruto: -1 })] })))));
  check("desconto acima de 100 no plantao", /desconto fora de 0% a 100%/.test(erro(arquivo(dados({ plantoes: [plantao({ desconto_percentual: 101 })] })))));
  check("desconto negativo no local", /desconto fora de 0% a 100%/.test(erro(arquivo(dados({ locais: [local({ desconto_percentual: -1 })] })))));
  check("desconto acima de 100 na escala", /desconto fora de 0% a 100%/.test(erro(arquivo(dados({ series: [serie({ desconto_percentual: 120 })] })))));
  check("excecao com valor estranho", /marca de exceção inválida/.test(erro(arquivo(dados({ plantoes: [plantao({ excecao: 2 })] })))));
  check("pago sem estar realizado", /só plantão realizado pode estar pago/.test(erro(arquivo(dados({ plantoes: [plantao({ status: "agendado", pago_em: 5 })] })))));
  check("pago e cancelado", /só plantão realizado pode estar pago/.test(erro(arquivo(dados({ plantoes: [plantao({ status: "cancelado", pago_em: 5 })] })))));
  check("modo de valor desconhecido", /modo de valor desconhecido/.test(erro(arquivo(dados({ locais: [local({ modo_valor: "mensal" })] })))));
  check("regra de pagamento desconhecida", /regra de pagamento desconhecida/.test(erro(arquivo(dados({ locais: [local({ regra_tipo: "quando_der" })] })))));
  check("ajuste de dia util desconhecido", /ajuste de dia útil desconhecido/.test(erro(arquivo(dados({ locais: [local({ ajuste_dia_util: "talvez" })] })))));
  check("tipo de repeticao desconhecido", /tipo de repetição desconhecido/.test(erro(arquivo(dados({ series: [serie({ tipo: "anual" })] })))));
  check("a mensagem de erro diz que o backup e invalido", /^Backup com dados inválidos/.test(erro(arquivo(dados({ plantoes: [plantao({ status: "sumiu" })] })))));

  /* ------------------------------------- colunas ------------------------------------- */

  igual("as colunas do plantao sao as do banco (14)", TABELAS.plantoes.length, 14);
  igual("as de local (19)", TABELAS.locais.length, 19);
  igual("as de escala (16)", TABELAS.series.length, 16);
  check("nenhuma coluna repetida", Object.values(TABELAS).every((cols) => new Set(cols.map((c) => c.nome)).size === cols.length));

  /* --------------------------------------- nome --------------------------------------- */

  igual("nome do arquivo de backup", nomeDoArquivoDeBackup(instante(2026, 10, 16, 15)), "meu-plantao-backup-2026-11-16.json");
  igual("com dia e mes de um digito", nomeDoArquivoDeBackup(instante(2027, 0, 5)), "meu-plantao-backup-2027-01-05.json");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  testes();
  process.exit(report() ? 0 : 1);
}
