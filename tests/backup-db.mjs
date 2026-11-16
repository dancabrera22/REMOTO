/**
 * Backup e restauracao no banco: ida e volta identica, substituicao total, e o
 * que nunca pode acontecer — restaurar pela metade.
 */
import { contaDados, criaBackup, leDadosDoBanco, restauraBackup } from "../src/db/backup.ts";
import { arquivaLocal, criaLocal } from "../src/db/locais.ts";
import { atualizaPlantao, buscaPlantao, criaPlantao, excluiPlantao, marcaPagamento, mudaStatusPlantao } from "../src/db/plantoes.ts";
import { criaSerie, editaSerie, garanteHorizonte } from "../src/db/series.ts";
import { instante, somaDias, inicioDoDia } from "../src/lib/datetime.ts";
import { interpretaBackup, serializaBackup } from "../src/lib/backup.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

const AGORA = instante(2026, 10, 16, 10);
const HOJE = inicioDoDia(AGORA);
const dia = (n, h = 7) => {
  const d = new Date(somaDias(HOJE, n));
  return instante(d.getFullYear(), d.getMonth(), d.getDate(), h);
};
const META = { esquema: 4, app: "1.0.0" };

/** Um banco com tudo: locais (um arquivado), escala com excecao e dia excluido, plantoes avulsos, pagos, cancelado. */
async function populado() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const a = await criaLocal(ex, { ...localVazio(), nome: "Hospital \"A\"; Central", apelido: "HC", valorPadrao: 120000, descontoPercentual: 11.5, endereco: "Av. Brasil, 100\nsala 2" }, 1);
  const b = await criaLocal(ex, { ...localVazio(), nome: "UPA Norte", cor: "#1E9E5B" }, 2);
  const c = await criaLocal(ex, { ...localVazio(), nome: "Clínica antiga" }, 3);
  await arquivaLocal(ex, c, 9);

  const { serieId } = await criaSerie(
    ex,
    {
      localId: a, inicioMin: 420, fimMin: 1140, valorBruto: 120000, descontoPercentual: 11.5, observacao: "escala fixa",
      regra: { tipo: "semanal", diasSemana: 1 << 2, cada: 1, diaDoMes: null, inicioDia: dia(2), fimDia: null },
    },
    AGORA,
  );
  const daSerie = db.prepare("SELECT id, ocorrencia_dia FROM plantoes WHERE serie_id = ? ORDER BY ocorrencia_dia").all(serieId);
  await excluiPlantao(ex, daSerie[1].id); // dia excluido (vira "pulada")
  const aj = await buscaPlantao(ex, daSerie[2].id);
  await atualizaPlantao(ex, aj.id, { ...aj, valorBruto: 99000, observacao: "valor combinado" }, AGORA); // excecao
  await mudaStatusPlantao(ex, daSerie[3].id, "realizado", AGORA);
  await marcaPagamento(ex, daSerie[4].id, dia(1), AGORA); // pago

  const avulso = await criaPlantao(ex, { localId: b, inicio: dia(-5), fim: dia(-5) + 12 * 3600e3, valorBruto: 50000, descontoPercentual: 0, status: "realizado", observacao: "Troca ✓" }, AGORA);
  await marcaPagamento(ex, avulso, dia(-1), AGORA);
  await criaPlantao(ex, { localId: b, inicio: dia(-9), fim: dia(-9) + 6 * 3600e3, valorBruto: 1, descontoPercentual: 0, status: "cancelado", observacao: null }, AGORA);
  await criaPlantao(ex, { localId: c, inicio: dia(-30), fim: dia(-30) + 3600e3, valorBruto: 7, descontoPercentual: 100, status: "trocado", observacao: null }, AGORA);
  return { db, ex, a, b, c, serieId };
}

const foto = (db) => JSON.stringify(["locais", "series", "series_puladas", "plantoes"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all().map((l) => ({ ...l }))));
const rejeita = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

function comFalha(ex, contador, falhaEm) {
  const envolve = (base) => ({
    getAllAsync: (...a) => base.getAllAsync(...a),
    getFirstAsync: (...a) => base.getFirstAsync(...a),
    runAsync: (...a) => {
      contador.n += 1;
      if (contador.n === falhaEm) throw new Error(`falha injetada no comando ${contador.n}`);
      return base.runAsync(...a);
    },
    transacao: (fn) => base.transacao((interno) => fn(envolve(interno))),
  });
  return envolve(ex);
}

export async function testes() {
  /* ---------------------------- o que vai para o arquivo ---------------------------- */

  const origem = await populado();
  const backup = await criaBackup(origem.ex, META, AGORA);
  igual("o backup leva os 3 locais", backup.dados.locais.length, 3);
  igual("a escala", backup.dados.series.length, 1);
  igual("o dia excluido", backup.dados.series_puladas.length, 1);
  igual("e todos os plantoes do banco", backup.dados.plantoes.length, origem.db.prepare("SELECT COUNT(*) AS n FROM plantoes").get().n);
  check("inclusive cancelado, trocado e pago", ["cancelado", "trocado"].every((st) => backup.dados.plantoes.some((p) => p.status === st)) && backup.dados.plantoes.some((p) => p.pago_em !== null));
  check("e o de escala ajustado a mao", backup.dados.plantoes.some((p) => p.excecao === 1 && p.serie_id !== null));
  igual("data de criacao", backup.criadoEm, AGORA);
  check("so as colunas do formato (sem extras)", Object.keys(backup.dados.plantoes[0]).join() === "id,local_id,inicio,fim,valor_bruto,desconto_percentual,status,observacao,criado_em,atualizado_em,serie_id,ocorrencia_dia,excecao,pago_em");
  check("local arquivado vai junto", backup.dados.locais.some((l) => l.arquivado_em !== null));
  check("o desconto fracionado nao perde precisao", backup.dados.locais.some((l) => l.desconto_percentual === 11.5));

  {
    // Uma migracao futura que acrescente coluna nao pode vazar para o arquivo: o backup tem so as colunas do formato.
    const { db: futuro, ex: exFuturo } = await populado();
    futuro.exec("ALTER TABLE plantoes ADD COLUMN coluna_de_uma_versao_futura TEXT DEFAULT 'x'");
    futuro.exec("ALTER TABLE locais ADD COLUMN outra_coluna_futura INTEGER DEFAULT 1");
    const bFuturo = await criaBackup(exFuturo, META, AGORA);
    check("coluna que o formato nao conhece nao vai para o backup", !("coluna_de_uma_versao_futura" in bFuturo.dados.plantoes[0]) && !("outra_coluna_futura" in bFuturo.dados.locais[0]));
    check("e o arquivo continua valido", interpretaBackup(serializaBackup(bFuturo)).ok);
  }

  const texto = serializaBackup(backup);
  const lido = interpretaBackup(texto);
  check("o arquivo gerado passa na propria validacao", lido.ok, lido.ok ? "" : lido.erro);

  /* -------------------------------- ida e volta identica -------------------------------- */

  {
    const { db: novo } = bancoMigrado();
    const exNovo = adaptador(novo);
    const r = await restauraBackup(exNovo, lido.backup);
    igual("restaurar num banco vazio: conta os locais", r.locais, 3);
    igual("... os plantoes", r.plantoes, backup.dados.plantoes.length);
    igual("... e as escalas", r.series, 1);
    igual("o banco restaurado e IDENTICO ao original (as quatro tabelas, linha a linha)", foto(novo), foto(origem.db));
    igual("e um novo backup do restaurado e igual ao primeiro", JSON.stringify((await criaBackup(exNovo, META, AGORA)).dados), JSON.stringify(backup.dados));
  }

  /* ------------------------------ substitui o que existia ------------------------------ */

  {
    const { db, ex } = await populado();
    await criaLocal(ex, { ...localVazio(), nome: "Local que nao esta no backup" }, 5);
    await criaPlantao(ex, { localId: 4, inicio: dia(40), fim: dia(40) + 3600e3, valorBruto: 5, descontoPercentual: 0, status: "agendado", observacao: null }, AGORA);
    const antes = await contaDados(ex);
    check("antes de restaurar ha mais dados que no backup", antes.locais === 4);

    await restauraBackup(ex, lido.backup);
    igual("depois, so existe o que estava no backup", foto(db), foto(origem.db));
    igual("o local que nao estava no backup sumiu", db.prepare("SELECT COUNT(*) AS n FROM locais WHERE nome LIKE 'Local que nao%'").get().n, 0);
    igual("contaDados confere", JSON.stringify(await contaDados(ex)), JSON.stringify({ locais: 3, plantoes: backup.dados.plantoes.length, series: 1 }));
  }

  {
    // Backup de um banco vazio restaura um banco vazio (e apaga o que havia).
    const vazio = bancoMigrado();
    const bVazio = await criaBackup(adaptador(vazio.db), META, AGORA);
    const cheio = await populado();
    await restauraBackup(cheio.ex, interpretaBackup(serializaBackup(bVazio)).backup);
    igual("restaurar um backup vazio esvazia tudo", JSON.stringify(await contaDados(cheio.ex)), JSON.stringify({ locais: 0, plantoes: 0, series: 0 }));
  }

  /* --------------------- o app continua funcionando depois de restaurar --------------------- */

  {
    const { db: novo } = bancoMigrado();
    const ex = adaptador(novo);
    await restauraBackup(ex, lido.backup);

    const maiorLocal = novo.prepare("SELECT MAX(id) AS m FROM locais").get().m;
    const idNovo = await criaLocal(ex, { ...localVazio(), nome: "Depois da restauracao" }, 9);
    check("um local novo recebe id maior que os restaurados (sem colidir)", idNovo > maiorLocal);
    const maiorPlantao = novo.prepare("SELECT MAX(id) AS m FROM plantoes").get().m;
    const pNovo = await criaPlantao(ex, { localId: idNovo, inicio: dia(60), fim: dia(60) + 3600e3, valorBruto: 1, descontoPercentual: 0, status: "agendado", observacao: null }, AGORA);
    check("e um plantao novo tambem", pNovo > maiorPlantao);

    // A escala restaurada segue viva: o dia excluido nao volta, a edicao em serie funciona, estender nao duplica.
    const serieId = novo.prepare("SELECT id FROM series").get().id;
    const pulado = novo.prepare("SELECT ocorrencia_dia FROM series_puladas").get().ocorrencia_dia;
    await garanteHorizonte(ex, somaDias(HOJE, 400), AGORA);
    igual("estender a escala restaurada nao recria o dia que foi excluido", novo.prepare("SELECT COUNT(*) AS n FROM plantoes WHERE serie_id = ? AND ocorrencia_dia = ?").get(serieId, pulado).n, 0);
    igual("nem duplica ocorrencias", novo.prepare("SELECT COUNT(*) AS n FROM (SELECT ocorrencia_dia FROM plantoes WHERE serie_id = ? GROUP BY ocorrencia_dia HAVING COUNT(*) > 1)").get(serieId).n, 0);

    const primeiro = novo.prepare("SELECT id FROM plantoes WHERE serie_id = ? AND status = 'agendado' AND excecao = 0 ORDER BY ocorrencia_dia LIMIT 1").get(serieId).id;
    const s = novo.prepare("SELECT * FROM series WHERE id = ?").get(serieId);
    const r = await editaSerie(ex, primeiro, "todos", {
      localId: s.local_id, inicioMin: s.inicio_min, fimMin: s.fim_min, valorBruto: 150000, descontoPercentual: 0, observacao: null,
      regra: { tipo: "semanal", diasSemana: s.dias_semana, cada: 1, diaDoMes: null, inicioDia: s.inicio_dia, fimDia: null },
    }, AGORA);
    igual("editar a escala restaurada funciona", r, serieId);
    igual("o plantao pago da escala continua com o valor antigo", novo.prepare("SELECT valor_bruto FROM plantoes WHERE serie_id = ? AND pago_em IS NOT NULL").get(serieId).valor_bruto, 120000);
    igual("e o ajustado a mao tambem", novo.prepare("SELECT valor_bruto FROM plantoes WHERE serie_id = ? AND excecao = 1").get(serieId).valor_bruto, 99000);
  }

  /* ----------------------------- o calendario nao e tocado ----------------------------- */

  {
    const { db, ex } = await populado();
    db.prepare("INSERT INTO eventos_calendario (plantao_id, calendario_id, evento_id, assinatura, sincronizado_em) VALUES (1, 'cal', 'ev', 'x', 1)").run();
    db.prepare("INSERT INTO config (chave, valor) VALUES ('calendario', '{\"calendarioId\":\"cal\"}')").run();
    await restauraBackup(ex, lido.backup);
    igual("o mapa de eventos do calendario continua (a sincronizacao o reconcilia)", db.prepare("SELECT COUNT(*) AS n FROM eventos_calendario").get().n, 1);
    igual("a configuracao do calendario tambem", db.prepare("SELECT COUNT(*) AS n FROM config").get().n, 1);
  }

  /* ----------------------------------- muitos dados ----------------------------------- */

  {
    const { db } = bancoMigrado();
    const ex = adaptador(db);
    const localId = await criaLocal(ex, { ...localVazio(), nome: "Grande" }, 1);
    const grande = { locais: db.prepare("SELECT * FROM locais").all().map((l) => ({ ...l })), series: [], series_puladas: [], plantoes: [] };
    for (let k = 1; k <= 3000; k++) {
      grande.plantoes.push({ id: k, local_id: localId, inicio: 1000 + k * 10, fim: 1005 + k * 10, valor_bruto: k, desconto_percentual: 0, status: "realizado", observacao: k % 7 === 0 ? `obs ${k}` : null, criado_em: 1, atualizado_em: 1, serie_id: null, ocorrencia_dia: null, excecao: 0, pago_em: k % 5 === 0 ? 1 : null });
    }
    const b = interpretaBackup(JSON.stringify({ formato: "meu-plantao-backup", versaoFormato: 1, esquema: 4, app: "x", criadoEm: 1, dados: grande }));
    check("tres mil plantoes passam na validacao", b.ok, b.ok ? "" : b.erro);

    const { db: alvo } = bancoMigrado();
    // Nenhum comando pode passar de 999 variaveis: e o limite do SQLite em muitos aparelhos Android.
    let maiorComando = 0;
    const base = adaptador(alvo);
    const medido = { ...base, runAsync: (sql, params = []) => { maiorComando = Math.max(maiorComando, params.length); return base.runAsync(sql, params); }, transacao: (fn) => base.transacao((interno) => fn({ ...interno, runAsync: medido.runAsync })) };
    const r = await restauraBackup(medido, b.backup);
    check("nenhum comando passa de 999 variaveis (limite do SQLite em aparelhos antigos)", maiorComando > 0 && maiorComando <= 999, `${maiorComando}`);
    igual("tres mil plantoes restaurados (em varios comandos)", r.plantoes, 3000);
    igual("todos la, com o conteudo", alvo.prepare("SELECT COUNT(*) AS n, SUM(valor_bruto) AS s FROM plantoes").get().n, 3000);
    igual("a soma dos valores bate", Number(alvo.prepare("SELECT SUM(valor_bruto) AS s FROM plantoes").get().s), (3000 * 3001) / 2);
    igual("e os pagos", alvo.prepare("SELECT COUNT(*) AS n FROM plantoes WHERE pago_em IS NOT NULL").get().n, 600);
  }

  /* --------------------------------- falha no meio --------------------------------- */

  {
    // Para CADA comando da restauracao: se falha ali, os dados de antes ficam intactos.
    const prepara = () => populado();
    const contador = { n: 0 };
    const seco = await prepara();
    await restauraBackup(comFalha(seco.ex, contador, Infinity), lido.backup);
    const total = contador.n;
    check("a restauracao tem varios comandos (apagar 4 tabelas e inserir em lotes)", total >= 8, `${total}`);

    let intactos = 0;
    let estouraram = 0;
    for (let n = 1; n <= total; n++) {
      const c = await prepara();
      await criaLocal(c.ex, { ...localVazio(), nome: "So existe antes" }, 7); // diferenca em relacao ao backup
      const antes = foto(c.db);
      let erro = null;
      try {
        await restauraBackup(comFalha(c.ex, { n: 0 }, n), lido.backup);
      } catch (e) {
        erro = e;
      }
      if (erro) estouraram += 1;
      if (erro && foto(c.db) === antes) intactos += 1;
    }
    check(`falha em qualquer dos ${total} comandos deixa os dados exatamente como estavam`, estouraram === total && intactos === total, `${intactos}/${total} intactos`);
  }

  {
    // Passa na validacao do arquivo, mas o BANCO recusa (a escala tem passo 61; o limite e 60): tudo volta.
    const { db, ex } = await populado();
    const antes = foto(db);
    const ruim = JSON.parse(JSON.stringify(lido.backup));
    ruim.dados.series[0].cada = 61;
    const validado = interpretaBackup(JSON.stringify(ruim));
    check("a validacao do arquivo nao pega esse caso (so o banco)", validado.ok);
    check("restaurar e recusado pelo banco", await rejeita(() => restauraBackup(ex, validado.backup)));
    igual("e o banco fica exatamente como estava", foto(db), antes);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
