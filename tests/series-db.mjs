/**
 * Escalas no banco: criar, estender, editar (so este / proximos / todos),
 * excluir, e o que NUNCA pode acontecer — perder o que voce ja trabalhou ou
 * recebeu, duplicar plantao, deixar a escala pela metade.
 *
 * Os comandos SQL sao os do app (via o adaptador do `node:sqlite`).
 */
import { arquivaLocal, criaLocal } from "../src/db/locais.ts";
import { atualizaPlantao, buscaPlantao, excluiPlantao, marcaPagamento, mudaStatusPlantao } from "../src/db/plantoes.ts";
import {
  buscaSerie,
  contaImpacto,
  contaSeriesAtivasDoLocal,
  criaSerie,
  editaSerie,
  excluiDaSerie,
  garanteHorizonte,
} from "../src/db/series.ts";
import { inicioDoDia, instante, somaDias } from "../src/lib/datetime.ts";
import { localVazio } from "../src/lib/locais.ts";
import { HORIZONTE_MAXIMO_DIAS } from "../src/lib/recorrencia.ts";
import { adaptador, bancoMigrado, migraAte } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

/** "Hoje" fixo dos testes: domingo, 15/11/2026. */
const AGORA = instante(2026, 10, 15, 10);
const HOJE = inicioDoDia(AGORA);
const HORIZONTE = somaDias(HOJE, 180); // 14/05/2027

const dia = (d, m, a = 2026) => instante(a, m - 1, d);

/** Instante de `h` horas no dia `diaMs`, somando `dias` dias de calendario. */
const hora = (diaMs, h, dias = 0) => {
  const d = new Date(diaMs);
  return instante(d.getFullYear(), d.getMonth(), d.getDate() + dias, h);
};

const novoLocal = (extra = {}) => ({ ...localVazio(), nome: "Hospital Central", valorPadrao: 120000, ...extra });

/** Toda terca, das 7h as 19h, a partir de 17/11/2026 (uma terca). */
const tercas = (localId, extra = {}) => ({
  localId,
  inicioMin: 7 * 60,
  fimMin: 19 * 60,
  valorBruto: 120000,
  descontoPercentual: 0,
  observacao: null,
  regra: { tipo: "semanal", diasSemana: 1 << 2, cada: 1, diaDoMes: null, inicioDia: dia(17, 11), fimDia: null },
  ...extra,
});

async function cenario() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const localId = await criaLocal(ex, novoLocal(), 1);
  return { db, ex, localId };
}

const todos = (db, sql, ...p) => db.prepare(sql).all(...p).map((l) => ({ ...l }));
const doDia = (db, serieId, d) =>
  todos(db, "SELECT * FROM plantoes WHERE serie_id = ? AND ocorrencia_dia = ?", serieId, d)[0] ?? null;
const daSerie = (db, serieId) =>
  todos(db, "SELECT * FROM plantoes WHERE serie_id = ? ORDER BY ocorrencia_dia", serieId);
const contagem = (db, sql, ...p) => Object.values(db.prepare(sql).get(...p))[0];

/** Tudo que as escalas tocam, para comparar antes e depois. */
const foto = (db) =>
  JSON.stringify({
    plantoes: todos(db, "SELECT * FROM plantoes ORDER BY id"),
    series: todos(db, "SELECT * FROM series ORDER BY id"),
    puladas: todos(db, "SELECT * FROM series_puladas ORDER BY serie_id, ocorrencia_dia"),
  });

const rejeita = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

/**
 * Executor que falha no N-esimo comando de escrita. `contador.n` guarda quantos
 * comandos de escrita ja rodaram; `falhaEm` e o que deve estourar (ou Infinity).
 */
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
  /* --------------------- atualizacao de quem ja tem plantoes --------------------- */

  {
    const v2 = bancoMigrado(2);
    const ex = adaptador(v2.db);
    const localId = await criaLocal(ex, novoLocal(), 1);
    v2.db
      .prepare(
        `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, desconto_percentual, status, criado_em, atualizado_em)
         VALUES (?, ?, ?, 120000, 0, 'realizado', 5, 5)`,
      )
      .run(localId, hora(dia(10, 11), 7), hora(dia(10, 11), 19));

    migraAte(v2.db);
    const p = await buscaPlantao(ex, 1);
    check("atualizar da v2 preserva o plantao avulso", p !== null && p.valorBruto === 120000 && p.status === "realizado");
    check(
      "o plantao antigo nao pertence a escala nem esta pago",
      p.serieId === null && p.ocorrenciaDia === null && p.excecao === false && p.pagoEm === null,
    );
  }

  /* ------------------------------------ criar ------------------------------------ */

  {
    const { db, ex, localId } = await cenario();
    const r = await criaSerie(ex, tercas(localId), AGORA);
    const linhas = daSerie(db, r.serieId);

    igual("criar materializa as tercas ate o horizonte de 180 dias", r.criados, 26);
    igual("uma linha por ocorrencia", linhas.length, 26);
    igual("a primeira e 17/11", linhas[0].ocorrencia_dia, dia(17, 11));
    igual("a ultima e 11/05/2027", linhas[25].ocorrencia_dia, dia(11, 5, 2027));
    check("todas agendadas, sem excecao, sem pagamento", linhas.every((l) => l.status === "agendado" && l.excecao === 0 && l.pago_em === null));
    check(
      "horario do modelo aplicado em cada dia",
      linhas.every((l) => l.inicio === hora(l.ocorrencia_dia, 7) && l.fim === hora(l.ocorrencia_dia, 19)),
    );
    check("valor e desconto copiados do modelo", linhas.every((l) => l.valor_bruto === 120000 && l.desconto_percentual === 0));

    const serie = await buscaSerie(ex, r.serieId);
    igual("a escala anota ate onde gerou", serie.geradoAte, HORIZONTE);
    igual("a regra volta do banco como foi enviada (dias)", serie.regra.diasSemana, 1 << 2);
    igual("a regra volta do banco como foi enviada (tipo)", serie.regra.tipo, "semanal");

    const p = await buscaPlantao(ex, linhas[0].id);
    check("o plantao sabe de que escala veio", p.serieId === r.serieId && p.ocorrenciaDia === dia(17, 11) && p.excecao === false);

    igual("so os campos do tipo sao gravados (dia do mes fica nulo)", todos(db, "SELECT dia_do_mes FROM series")[0].dia_do_mes, null);
  }

  {
    const { db, ex, localId } = await cenario();
    const invalida = tercas(localId, { regra: { ...tercas(localId).regra, diasSemana: 0 } });
    check("escala invalida e recusada", await rejeita(() => criaSerie(ex, invalida, AGORA)));
    igual("e nao deixa nada gravado", contagem(db, "SELECT COUNT(*) FROM series") + contagem(db, "SELECT COUNT(*) FROM plantoes"), 0);

    const intervalo = tercas(localId, {
      regra: { tipo: "intervalo", diasSemana: 127, cada: 2, diaDoMes: 15, inicioDia: dia(17, 11), fimDia: null },
    });
    const r = await criaSerie(ex, intervalo, AGORA);
    const s = todos(db, "SELECT * FROM series WHERE id = ?", r.serieId)[0];
    check("tipo 'intervalo' nao guarda dias da semana nem dia do mes", s.dias_semana === 0 && s.dia_do_mes === null);
  }

  /* ----------------------------------- estender ----------------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);

    igual("estender ate onde ja foi gerado nao cria nada", await garanteHorizonte(ex, HORIZONTE, AGORA), 0);
    igual("... nem para antes", await garanteHorizonte(ex, somaDias(HOJE, 30), AGORA), 0);

    const ate1ano = somaDias(HOJE, 365);
    const criados = await garanteHorizonte(ex, ate1ano, AGORA);
    igual("estender um ano cria as tercas que faltam", criados, 26);
    igual("ficam 52 tercas", daSerie(db, serieId).length, 52);
    igual("a ultima e 09/11/2027", daSerie(db, serieId)[51].ocorrencia_dia, dia(9, 11, 2027));

    igual("repetir a mesma extensao nao duplica", await garanteHorizonte(ex, ate1ano, AGORA), 0);
    igual("... e continua 52", daSerie(db, serieId).length, 52);

    await garanteHorizonte(ex, somaDias(HOJE, 10 * 365), AGORA);
    const teto = somaDias(HOJE, HORIZONTE_MAXIMO_DIAS);
    igual("o horizonte nunca passa de tres anos", (await buscaSerie(ex, serieId)).geradoAte, teto);
    check("nenhum plantao alem do teto", daSerie(db, serieId).every((l) => l.ocorrencia_dia <= teto));
    const maximo = daSerie(db, serieId).length;
    igual("pedir dez anos de novo nao cria mais", await garanteHorizonte(ex, somaDias(HOJE, 10 * 365), AGORA), 0);
    igual("... e a conta nao muda", daSerie(db, serieId).length, maximo);
  }

  {
    // Escala com data final: gera ate ela e nunca mais volta a ser candidata.
    const { db, ex, localId } = await cenario();
    const fim = tercas(localId);
    fim.regra.fimDia = dia(24, 11);
    const r = await criaSerie(ex, fim, AGORA);
    igual("escala com data final cria so ate ela", r.criados, 2);
    igual("gerado_ate para na data final", (await buscaSerie(ex, r.serieId)).geradoAte, dia(24, 11));
    igual("e a agenda nao cria mais nada", await garanteHorizonte(ex, somaDias(HOJE, 400), AGORA), 0);
    igual("... continua com 2", daSerie(db, r.serieId).length, 2);
  }

  {
    // Local arquivado nao ganha plantoes novos.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    igual("o local tem uma escala ativa", await contaSeriesAtivasDoLocal(ex, localId, AGORA), 1);
    await arquivaLocal(ex, localId, 9);
    igual("local arquivado: a agenda nao estende a escala", await garanteHorizonte(ex, somaDias(HOJE, 365), AGORA), 0);
    igual("... continua com 26", daSerie(db, serieId).length, 26);
  }

  {
    // A extensao respeita o que foi excluido, mesmo com o horizonte recuado.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    await excluiPlantao(ex, doDia(db, serieId, dia(11, 5, 2027)).id);
    db.prepare("UPDATE series SET gerado_ate = ? WHERE id = ?").run(dia(1, 12), serieId);
    db.prepare("DELETE FROM plantoes WHERE serie_id = ? AND ocorrencia_dia > ?").run(serieId, dia(1, 12));
    const c = await garanteHorizonte(ex, HORIZONTE, AGORA);
    igual("estender refaz o que faltava, menos o excluido", c, 22);
    igual("o dia excluido continua sem plantao", doDia(db, serieId, dia(11, 5, 2027)), null);
  }

  {
    // Escala que termina hoje ainda esta ativa; ontem, nao.
    const { ex, localId } = await cenario();
    const termina = tercas(localId);
    termina.regra.inicioDia = HOJE;
    termina.regra.fimDia = HOJE;
    await criaSerie(ex, termina, AGORA);
    igual("escala que termina hoje conta como ativa", await contaSeriesAtivasDoLocal(ex, localId, AGORA), 1);
    igual("e no dia seguinte deixa de contar", await contaSeriesAtivasDoLocal(ex, localId, somaDias(AGORA, 1)), 0);
  }

  {
    // Escala que comeca no futuro distante: so aparece quando a agenda chega la.
    const { db, ex, localId } = await cenario();
    const longe = tercas(localId);
    longe.regra.inicioDia = dia(5, 1, 2028); // 5/1/2028 e quarta; a regra e terca -> 11/01
    const r = await criaSerie(ex, longe, AGORA);
    igual("escala que so comeca em 2028 nao cria nada agora", r.criados, 0);
    igual("... mas fica registrada", contagem(db, "SELECT COUNT(*) FROM series"), 1);
    const c = await garanteHorizonte(ex, dia(31, 1, 2028), AGORA);
    check("ao navegar ate la, os plantoes aparecem (11, 18 e 25/01)", c === 3, `criados ${c}`);
    igual("a primeira terca e 11/01/2028", daSerie(db, r.serieId)[0].ocorrencia_dia, dia(11, 1, 2028));
  }

  /* -------------------------- excecoes e editar so um plantao -------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const alvo = doDia(db, serieId, dia(24, 11));
    const base = await buscaPlantao(ex, alvo.id);
    const entrada = (extra) => ({
      localId,
      inicio: base.inicio,
      fim: base.fim,
      valorBruto: base.valorBruto,
      descontoPercentual: base.descontoPercentual,
      status: base.status,
      observacao: base.observacao,
      ...extra,
    });

    await atualizaPlantao(ex, alvo.id, entrada({ valorBruto: 99000 }), AGORA);
    igual("mudar o valor so nele o torna excecao", (await buscaPlantao(ex, alvo.id)).excecao, true);
    await atualizaPlantao(ex, alvo.id, entrada({ valorBruto: 120000 }), AGORA);
    igual("voltar ao valor da escala desfaz a excecao", (await buscaPlantao(ex, alvo.id)).excecao, false);

    await atualizaPlantao(ex, alvo.id, entrada({ status: "realizado" }), AGORA);
    igual("mudar so a situacao nao e excecao", (await buscaPlantao(ex, alvo.id)).excecao, false);

    await atualizaPlantao(ex, alvo.id, entrada({ status: "agendado", inicio: base.inicio + 3600e3, fim: base.fim + 3600e3 }), AGORA);
    const movido = await buscaPlantao(ex, alvo.id);
    check("mover de horario e excecao", movido.excecao === true);
    igual("... e a identidade na escala nao muda", movido.ocorrenciaDia, dia(24, 11));

    await atualizaPlantao(ex, alvo.id, entrada({ observacao: "  trazer crachá  " }), AGORA);
    const obs = await buscaPlantao(ex, alvo.id);
    check("observacao diferente tambem e excecao, e vem aparada", obs.excecao === true && obs.observacao === "trazer crachá");

    // Excluir um plantao da escala deixa a marca, para a escala nao recria-lo.
    const outro = doDia(db, serieId, dia(1, 12));
    check("excluir um plantao da escala funciona", await excluiPlantao(ex, outro.id));
    igual("e registra a ocorrencia como pulada", contagem(db, "SELECT COUNT(*) FROM series_puladas WHERE serie_id = ? AND ocorrencia_dia = ?", serieId, dia(1, 12)), 1);
    igual("excluir de novo devolve falso", await excluiPlantao(ex, outro.id), false);
  }

  /* ------------------------------ editar: todos ------------------------------ */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const idsAntes = daSerie(db, serieId).map((l) => l.id);

    const r = await editaSerie(ex, doDia(db, serieId, dia(24, 11)).id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 5000);
    igual("editar todos devolve a mesma escala", r, serieId);
    const linhas = daSerie(db, serieId);
    igual("a quantidade nao muda", linhas.length, 26);
    check("os ids dos plantoes se mantem (edicao no lugar)", JSON.stringify(linhas.map((l) => l.id)) === JSON.stringify(idsAntes));
    check("todos ganharam o valor novo", linhas.every((l) => l.valor_bruto === 150000));
    igual("a escala guarda o valor novo", (await buscaSerie(ex, serieId)).valorBruto, 150000);

    const mudou = linhas.filter((l) => l.atualizado_em === AGORA + 5000).length;
    igual("so quem mudou teve a data de edicao atualizada", mudou, 26);
    await editaSerie(ex, doDia(db, serieId, dia(24, 11)).id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 9000);
    igual("editar sem mudar nada nao reescreve nenhum plantao", daSerie(db, serieId).filter((l) => l.atualizado_em === AGORA + 9000).length, 0);
  }

  {
    // O que ja aconteceu e o que foi ajustado a mao sobrevive a uma edicao em serie.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);

    const realizado = doDia(db, serieId, dia(17, 11));
    await mudaStatusPlantao(ex, realizado.id, "realizado", AGORA);
    const cancelado = doDia(db, serieId, dia(1, 12));
    await mudaStatusPlantao(ex, cancelado.id, "cancelado", AGORA);

    const ajustado = doDia(db, serieId, dia(24, 11));
    const base = await buscaPlantao(ex, ajustado.id);
    await atualizaPlantao(ex, ajustado.id, { ...base, valorBruto: 99000, observacao: "valor combinado" }, AGORA);

    await editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);

    igual("realizado mantem o valor antigo", doDia(db, serieId, dia(17, 11)).valor_bruto, 120000);
    igual("... e a situacao", doDia(db, serieId, dia(17, 11)).status, "realizado");
    igual("cancelado mantem o valor antigo", doDia(db, serieId, dia(1, 12)).valor_bruto, 120000);
    igual("... e a situacao", doDia(db, serieId, dia(1, 12)).status, "cancelado");
    igual("o ajustado a mao mantem o valor dele", doDia(db, serieId, dia(24, 11)).valor_bruto, 99000);
    igual("... e a observacao", doDia(db, serieId, dia(24, 11)).observacao, "valor combinado");
    igual("o plantao comum recebe o valor novo", doDia(db, serieId, dia(8, 12)).valor_bruto, 150000);

    // Trocar o dia da semana: as tercas comuns somem, as protegidas ficam, as quartas nascem.
    const quartas = tercas(localId);
    quartas.regra.diasSemana = 1 << 3;
    await editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", quartas, AGORA + 2);
    const depois = daSerie(db, serieId);
    const protegidas = depois.filter((l) => l.ocorrencia_dia === dia(17, 11) || l.ocorrencia_dia === dia(1, 12) || l.ocorrencia_dia === dia(24, 11));
    igual("as tres tercas protegidas continuam", protegidas.length, 3);
    const tercasRestantes = depois.filter((l) => new Date(l.ocorrencia_dia).getDay() === 2).length;
    igual("so elas sobraram como tercas", tercasRestantes, 3);
    const quartasNovas = depois.filter((l) => new Date(l.ocorrencia_dia).getDay() === 3).length;
    igual("e as quartas foram criadas ate o horizonte", quartasNovas, 26);
    igual("total = 26 quartas + 3 protegidas", depois.length, 29);
  }

  {
    // Cada campo do modelo, sozinho, chega aos plantoes da escala.
    const outroLocal = async (ex) => criaLocal(ex, novoLocal({ nome: "Clinica Norte" }), 2);
    const casos = [
      ["so a entrada", {}, { inicioMin: 8 * 60 }, (l) => l.inicio === hora(l.ocorrencia_dia, 8) && l.fim === hora(l.ocorrencia_dia, 19)],
      ["so a saida", {}, { fimMin: 20 * 60 }, (l) => l.inicio === hora(l.ocorrencia_dia, 7) && l.fim === hora(l.ocorrencia_dia, 20)],
      ["so o desconto", {}, { descontoPercentual: 11 }, (l) => l.desconto_percentual === 11],
      ["so a observacao", {}, { observacao: "levar notebook" }, (l) => l.observacao === "levar notebook"],
      ["so o valor", {}, { valorBruto: 130000 }, (l) => l.valor_bruto === 130000],
      ["so o local", { local: true }, {}, (l, n) => l.local_id === n.outro],
    ];
    for (const [nome, opcoes, mudanca, confere] of casos) {
      const { db, ex, localId } = await cenario();
      const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
      const outro = opcoes.local ? await outroLocal(ex) : null;
      const novo = tercas(opcoes.local ? outro : localId, mudanca);
      await editaSerie(ex, doDia(db, serieId, dia(24, 11)).id, "todos", novo, AGORA + 1);
      const linhas = daSerie(db, serieId);
      check(`editar ${nome} chega aos 26 plantoes`, linhas.length === 26 && linhas.every((l) => confere(l, { outro })));
    }
  }

  {
    // Dividir uma escala que a agenda ja estendeu: a nova herda o horizonte e nao perde plantoes.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    await garanteHorizonte(ex, somaDias(HOJE, 365), AGORA);
    igual("antes de dividir: 52 tercas", daSerie(db, serieId).length, 52);

    const nova = await editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "proximos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);
    igual("a nova herda o horizonte de um ano", (await buscaSerie(ex, nova)).geradoAte, somaDias(HOJE, 365));
    igual("nenhum plantao se perde: 3 antigas + 49 novas", daSerie(db, serieId).length + daSerie(db, nova).length, 52);
    igual("as novas chegam a 09/11/2027", daSerie(db, nova)[daSerie(db, nova).length - 1].ocorrencia_dia, dia(9, 11, 2027));
  }

  {
    // Dividir com regra invalida e recusado e nao muda nada.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const antes = foto(db);
    const invalida = tercas(localId, { regra: { ...tercas(localId).regra, diasSemana: 0 } });
    check("dividir com regra invalida e recusado", await rejeita(() => editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "proximos", invalida, AGORA + 1)));
    check("editar todos com regra invalida e recusado", await rejeita(() => editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", invalida, AGORA + 1)));
    igual("e o banco fica exatamente como estava", foto(db), antes);
  }

  {
    // Excecao que ficou igual ao novo modelo volta a ser plantao comum.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const alvo = doDia(db, serieId, dia(24, 11));
    const base = await buscaPlantao(ex, alvo.id);
    await atualizaPlantao(ex, alvo.id, { ...base, valorBruto: 150000 }, AGORA);
    igual("ajustado para 1.500,00: e excecao", (await buscaPlantao(ex, alvo.id)).excecao, true);
    await editaSerie(ex, alvo.id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);
    igual("a escala passa a valer 1.500,00: deixa de ser excecao", (await buscaPlantao(ex, alvo.id)).excecao, false);
  }

  {
    // Pulada continua pulada depois de editar.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    await excluiPlantao(ex, doDia(db, serieId, dia(24, 11)).id);
    await editaSerie(ex, doDia(db, serieId, dia(1, 12)).id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);
    igual("o dia excluido nao volta ao editar a escala", doDia(db, serieId, dia(24, 11)), null);
    igual("... e a escala segue com 25", daSerie(db, serieId).length, 25);
  }

  {
    // Encurtar a data final apaga o que passou dela; alongar traz de volta.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const ate = tercas(localId);
    ate.regra.fimDia = dia(1, 12);
    await editaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "todos", ate, AGORA + 1);
    igual("data final em 01/12 deixa 3 tercas", daSerie(db, serieId).length, 3);
    igual("e o horizonte encolhe junto", (await buscaSerie(ex, serieId)).geradoAte, dia(1, 12));

    const ate2 = tercas(localId);
    ate2.regra.fimDia = dia(15, 12);
    await editaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "todos", ate2, AGORA + 2);
    igual("alongar ate 15/12 traz as tercas de volta", daSerie(db, serieId).length, 5);

    const semFim = tercas(localId);
    await editaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "todos", semFim, AGORA + 3);
    await garanteHorizonte(ex, HORIZONTE, AGORA);
    igual("tirar a data final retoma a geracao", daSerie(db, serieId).length, 26);
  }

  {
    // Mover o inicio da escala para tras gera o que faltava; para a frente apaga.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const antes = tercas(localId);
    antes.regra.inicioDia = dia(3, 11);
    await editaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "todos", antes, AGORA + 1);
    igual("comecar em 03/11 acrescenta duas tercas (3 e 10/11)", daSerie(db, serieId).length, 28);
    igual("a primeira passa a ser 03/11", daSerie(db, serieId)[0].ocorrencia_dia, dia(3, 11));

    const depois = tercas(localId);
    depois.regra.inicioDia = dia(1, 12);
    await editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", depois, AGORA + 2);
    igual("comecar em 01/12 tira as tercas anteriores", daSerie(db, serieId)[0].ocorrencia_dia, dia(1, 12));
    igual("sobram 24 (26 menos 17/11 e 24/11)", daSerie(db, serieId).length, 24);
  }

  /* ----------------------------- editar: este e os proximos ----------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);

    const idDe8 = doDia(db, serieId, dia(8, 12)).id;
    const realizado = doDia(db, serieId, dia(15, 12));
    await mudaStatusPlantao(ex, realizado.id, "realizado", AGORA);
    await excluiPlantao(ex, doDia(db, serieId, dia(22, 12)).id);
    const idsAntes = new Map(daSerie(db, serieId).map((l) => [l.ocorrencia_dia, l.id]));

    const noturno = tercas(localId, { valorBruto: 150000, inicioMin: 19 * 60, fimMin: 7 * 60 });
    const nova = await editaSerie(ex, idDe8, "proximos", noturno, AGORA + 1);

    check("dividir cria outra escala", nova !== null && nova !== serieId);
    igual("agora existem duas escalas", contagem(db, "SELECT COUNT(*) FROM series"), 2);

    const velha = await buscaSerie(ex, serieId);
    igual("a antiga termina na vespera (07/12)", velha.regra.fimDia, dia(7, 12));
    igual("e o horizonte dela tambem", velha.geradoAte, dia(7, 12));
    const antigas = daSerie(db, serieId);
    igual("ficam as 3 tercas anteriores na antiga", antigas.length, 3);
    check("com o valor e o horario de antes", antigas.every((l) => l.valor_bruto === 120000 && l.fim === hora(l.ocorrencia_dia, 19)));

    const novaSerie = await buscaSerie(ex, nova);
    igual("a nova comeca em 08/12", novaSerie.regra.inicioDia, dia(8, 12));
    igual("e continua de onde a antiga tinha gerado", novaSerie.geradoAte, HORIZONTE);
    const novas = daSerie(db, nova);
    igual("23 tercas, menos a excluida (22/12) = 22", novas.length, 22);
    check(
      "valor e horario novos (19h -> 07h do dia seguinte)",
      novas.filter((l) => l.status === "agendado").every((l) => l.valor_bruto === 150000 && l.inicio === hora(l.ocorrencia_dia, 19) && l.fim === hora(l.ocorrencia_dia, 7, 1)),
    );

    igual("o plantao editado manteve o id", doDia(db, nova, dia(8, 12)).id, idDe8);
    check("todos os ids que ja existiam se mantem", [...idsAntes.values()].every((id) => todos(db, "SELECT 1 FROM plantoes WHERE id = ?", id).length === 1));
    const fato = doDia(db, nova, dia(15, 12));
    check("o realizado foi junto para a nova, intacto", fato.status === "realizado" && fato.valor_bruto === 120000 && fato.id === realizado.id);
    igual("a excluida continua excluida (marca mudou de escala)", contagem(db, "SELECT COUNT(*) FROM series_puladas WHERE serie_id = ? AND ocorrencia_dia = ?", nova, dia(22, 12)), 1);
    igual("... e nao sobrou marca na antiga", contagem(db, "SELECT COUNT(*) FROM series_puladas WHERE serie_id = ?", serieId), 0);
    igual("a agenda nao recria a excluida", await garanteHorizonte(ex, somaDias(HOJE, 365), AGORA), 26);
    igual("... e o dia 22/12 continua sem plantao", doDia(db, nova, dia(22, 12)), null);
  }

  {
    // "Este e os proximos" no primeiro dia da escala e a escala toda: nao cria outra.
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const r = await editaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "proximos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);
    igual("proximos a partir do primeiro dia nao divide", r, serieId);
    igual("continua uma escala so", contagem(db, "SELECT COUNT(*) FROM series"), 1);
    check("e todos receberam o valor novo", daSerie(db, serieId).every((l) => l.valor_bruto === 150000));
  }

  {
    // Plantao avulso nao tem escala para editar.
    const { db, ex, localId } = await cenario();
    const id = (
      await ex.runAsync(
        `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, status, criado_em, atualizado_em) VALUES (?, 1, 2, 0, 'agendado', 1, 1)`,
        [localId],
      )
    ).lastInsertRowId;
    igual("editar escala de plantao avulso devolve nulo", await editaSerie(ex, id, "todos", tercas(localId), AGORA), null);
    igual("excluir da escala um avulso devolve nulo", await excluiDaSerie(ex, id, "todos", AGORA), null);
    igual("contar impacto de um avulso devolve nulo", await contaImpacto(ex, id, "todos", "editar"), null);
    igual("o avulso continua la", contagem(db, "SELECT COUNT(*) FROM plantoes"), 1);
  }

  /* ---------------------------------- excluir ---------------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const r = await excluiDaSerie(ex, doDia(db, serieId, dia(24, 11)).id, "este", AGORA);
    check("excluir so este: um removido", r.removidos === 1 && r.mantidos === 0);
    igual("... e restam 25", daSerie(db, serieId).length, 25);
    igual("... com a ocorrencia marcada como pulada", contagem(db, "SELECT COUNT(*) FROM series_puladas"), 1);
  }

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const realizado = doDia(db, serieId, dia(15, 12));
    await mudaStatusPlantao(ex, realizado.id, "realizado", AGORA);
    await marcaPagamento(ex, doDia(db, serieId, dia(29, 12)).id, AGORA, AGORA);
    await excluiPlantao(ex, doDia(db, serieId, dia(5, 1, 2027)).id);
    const ajustado = doDia(db, serieId, dia(12, 1, 2027));
    await atualizaPlantao(ex, ajustado.id, { ...(await buscaPlantao(ex, ajustado.id)), valorBruto: 1 }, AGORA);

    const r = await excluiDaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "proximos", AGORA + 1);
    check("excluir proximos: devolve quantos removeu e quantos manteve", r.removidos === 20 && r.mantidos === 2, JSON.stringify(r));

    const velha = await buscaSerie(ex, serieId);
    igual("a escala termina na vespera", velha.regra.fimDia, dia(7, 12));
    igual("ficam as 3 tercas anteriores", daSerie(db, serieId).length, 3);
    const solto = todos(db, "SELECT * FROM plantoes WHERE id = ?", realizado.id)[0];
    check("o realizado ficou, agora avulso", solto.serie_id === null && solto.ocorrencia_dia === null && solto.status === "realizado");
    const pago = todos(db, "SELECT * FROM plantoes WHERE ocorrencia_dia IS NULL AND pago_em IS NOT NULL");
    check("o pago ficou, avulso, ainda pago", pago.length === 1 && pago[0].status === "realizado");
    igual("o ajustado agendado foi apagado junto", contagem(db, "SELECT COUNT(*) FROM plantoes WHERE valor_bruto = 1"), 0);
    igual("as marcas de puladas do futuro sumiram", contagem(db, "SELECT COUNT(*) FROM series_puladas"), 0);
    igual("a agenda nao recria nada depois do corte", await garanteHorizonte(ex, somaDias(HOJE, 365), AGORA), 0);
  }

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const realizado = doDia(db, serieId, dia(17, 11));
    await mudaStatusPlantao(ex, realizado.id, "realizado", AGORA);
    await excluiPlantao(ex, doDia(db, serieId, dia(24, 11)).id);

    const r = await excluiDaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", AGORA + 1);
    check("excluir todos: 24 removidos, 1 mantido", r.removidos === 24 && r.mantidos === 1, JSON.stringify(r));
    igual("a escala some", contagem(db, "SELECT COUNT(*) FROM series"), 0);
    igual("as marcas de puladas somem", contagem(db, "SELECT COUNT(*) FROM series_puladas"), 0);
    const restante = todos(db, "SELECT * FROM plantoes");
    check("sobra so o realizado, avulso", restante.length === 1 && restante[0].id === realizado.id && restante[0].serie_id === null);
  }

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    await excluiDaSerie(ex, doDia(db, serieId, dia(17, 11)).id, "proximos", AGORA + 1);
    igual("excluir proximos no primeiro dia apaga a escala inteira", contagem(db, "SELECT COUNT(*) FROM series"), 0);
    igual("... e os plantoes", contagem(db, "SELECT COUNT(*) FROM plantoes"), 0);
  }

  /* ---------------------------------- impacto ---------------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    await mudaStatusPlantao(ex, doDia(db, serieId, dia(17, 11)).id, "realizado", AGORA);
    await mudaStatusPlantao(ex, doDia(db, serieId, dia(1, 12)).id, "cancelado", AGORA);
    const aj = doDia(db, serieId, dia(24, 11));
    await atualizaPlantao(ex, aj.id, { ...(await buscaPlantao(ex, aj.id)), valorBruto: 5 }, AGORA);
    const d8 = doDia(db, serieId, dia(8, 12)).id;

    const j = (o) => JSON.stringify(o);
    igual("editar so este: 1", j(await contaImpacto(ex, d8, "este", "editar")), j({ alteraveis: 1, realizados: 0, ajustados: 0 }));
    igual("editar todos: 23 comuns, 2 fatos, 1 ajustado", j(await contaImpacto(ex, d8, "todos", "editar")), j({ alteraveis: 23, realizados: 2, ajustados: 1 }));
    igual("excluir todos: o ajustado cai junto", j(await contaImpacto(ex, d8, "todos", "excluir")), j({ alteraveis: 24, realizados: 2, ajustados: 0 }));
    igual("editar proximos a partir de 08/12", j(await contaImpacto(ex, d8, "proximos", "editar")), j({ alteraveis: 23, realizados: 0, ajustados: 0 }));
  }

  /* --------------------------------- pagamento --------------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const id = doDia(db, serieId, dia(17, 11)).id;

    check("marcar como pago funciona", await marcaPagamento(ex, id, dia(5, 12), AGORA));
    const p = await buscaPlantao(ex, id);
    check("e confirma o plantao (agendado vira realizado)", p.status === "realizado" && p.pagoEm === dia(5, 12));

    check("desfazer o pagamento funciona", await marcaPagamento(ex, id, null, AGORA));
    const d = await buscaPlantao(ex, id);
    check("o plantao segue realizado, sem data de pagamento", d.status === "realizado" && d.pagoEm === null);

    await mudaStatusPlantao(ex, id, "cancelado", AGORA);
    igual("cancelado nao pode ser marcado como pago", await marcaPagamento(ex, id, dia(5, 12), AGORA), false);
    igual("... e nada foi gravado", (await buscaPlantao(ex, id)).pagoEm, null);
    igual("pagamento de plantao que nao existe devolve falso", await marcaPagamento(ex, 99999, dia(5, 12), AGORA), false);

    await mudaStatusPlantao(ex, id, "realizado", AGORA);
    await marcaPagamento(ex, id, dia(5, 12), AGORA);
    await mudaStatusPlantao(ex, id, "trocado", AGORA);
    igual("sair de realizado apaga a data do pagamento", (await buscaPlantao(ex, id)).pagoEm, null);

    await mudaStatusPlantao(ex, id, "realizado", AGORA);
    await marcaPagamento(ex, id, dia(5, 12), AGORA);
    const base = await buscaPlantao(ex, id);
    await atualizaPlantao(ex, id, { ...base, status: "agendado" }, AGORA);
    igual("voltar a agendado pelo formulario apaga o pagamento", (await buscaPlantao(ex, id)).pagoEm, null);

    await marcaPagamento(ex, id, dia(5, 12), AGORA);
    await atualizaPlantao(ex, id, { ...(await buscaPlantao(ex, id)), valorBruto: 130000 }, AGORA);
    igual("editar outro campo nao mexe no pagamento", (await buscaPlantao(ex, id)).pagoEm, dia(5, 12));

    check(
      "o banco recusa pago em plantao que nao e realizado",
      await rejeita(() => ex.runAsync("UPDATE plantoes SET status = 'cancelado' WHERE id = ?", [id])),
    );

    // Um pago e fato consumado: edicao em serie nao o toca.
    await editaSerie(ex, doDia(db, serieId, dia(24, 11)).id, "todos", tercas(localId, { valorBruto: 150000 }), AGORA + 1);
    const pago = await buscaPlantao(ex, id);
    check("edicao em serie nao altera o plantao pago", pago.valorBruto === 130000 && pago.pagoEm === dia(5, 12));
  }

  /* --------------------------- integridade e transacoes --------------------------- */

  {
    const { db, ex, localId } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(localId), AGORA);
    const p = doDia(db, serieId, dia(17, 11));
    check(
      "o banco recusa duas ocorrencias iguais na mesma escala",
      await rejeita(() =>
        ex.runAsync(
          `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, status, criado_em, atualizado_em, serie_id, ocorrencia_dia)
           VALUES (?, 1, 2, 0, 'agendado', 1, 1, ?, ?)`,
          [localId, serieId, p.ocorrencia_dia],
        ),
      ),
    );
    await ex.runAsync(
      `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, status, criado_em, atualizado_em) VALUES (?, 1, 2, 0, 'agendado', 1, 1)`,
      [localId],
    );
    await ex.runAsync(
      `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, status, criado_em, atualizado_em) VALUES (?, 1, 2, 0, 'agendado', 1, 1)`,
      [localId],
    );
    igual("mas plantoes avulsos nao se atrapalham entre si", contagem(db, "SELECT COUNT(*) FROM plantoes WHERE serie_id IS NULL"), 2);

    const dentro = await ex.transacao(async (a) => a.transacao(async (b) => (a === b ? "mesma" : "outra")));
    igual("transacao dentro de transacao so reaproveita a de fora", dentro, "mesma");
  }

  // Falha no meio de qualquer passo: o banco volta exatamente ao que era.
  const operacoes = {
    "criar escala": async (ex, { localId }) => criaSerie(ex, tercas(localId), AGORA),
    "editar proximos": async (ex, { db, serieId, localId }) =>
      editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "proximos", tercas(localId, { valorBruto: 150000, inicioMin: 19 * 60, fimMin: 7 * 60 }), AGORA + 1),
    "editar todos trocando o dia": async (ex, { db, serieId, localId }) => {
      const quartas = tercas(localId, { valorBruto: 150000 });
      quartas.regra.diasSemana = 1 << 3;
      return editaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", quartas, AGORA + 1);
    },
    "excluir proximos": async (ex, { db, serieId }) => excluiDaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "proximos", AGORA + 1),
    "excluir todos": async (ex, { db, serieId }) => excluiDaSerie(ex, doDia(db, serieId, dia(8, 12)).id, "todos", AGORA + 1),
    "estender o horizonte": async (ex) => garanteHorizonte(ex, somaDias(HOJE, 365), AGORA),
    "excluir um plantao da escala": async (ex, { db, serieId }) => excluiPlantao(ex, doDia(db, serieId, dia(8, 12)).id),
    "salvar um plantao da escala": async (ex, { db, serieId }) => {
      const id = doDia(db, serieId, dia(8, 12)).id;
      return atualizaPlantao(ex, id, { ...(await buscaPlantao(ex, id)), valorBruto: 7 }, AGORA + 1);
    },
  };

  for (const [nome, operacao] of Object.entries(operacoes)) {
    // Primeiro uma rodada sem falha, so para contar quantas escritas a operacao faz.
    const prepara = async () => {
      const c = await cenario();
      const { serieId } = await criaSerie(c.ex, tercas(c.localId), AGORA);
      await mudaStatusPlantao(c.ex, doDia(c.db, serieId, dia(15, 12)).id, "realizado", AGORA);
      await excluiPlantao(c.ex, doDia(c.db, serieId, dia(22, 12)).id);
      const aj = doDia(c.db, serieId, dia(29, 12));
      await atualizaPlantao(c.ex, aj.id, { ...(await buscaPlantao(c.ex, aj.id)), valorBruto: 5 }, AGORA);
      return { ...c, serieId };
    };

    const contador = { n: 0 };
    const seco = await prepara();
    await operacao(comFalha(seco.ex, contador, Infinity), seco);
    const total = contador.n;

    let preservou = 0;
    let estourou = 0;
    for (let n = 1; n <= total; n++) {
      const c = await prepara();
      const antes = foto(c.db);
      let erro = null;
      try {
        await operacao(comFalha(c.ex, { n: 0 }, n), c);
      } catch (e) {
        erro = e;
      }
      if (erro) estourou += 1;
      if (erro && foto(c.db) === antes) preservou += 1;
    }
    check(
      `${nome}: falha em qualquer um dos ${total} passos nao deixa nada pela metade`,
      total > 0 && estourou === total && preservou === total,
      `${preservou}/${total} revertidos`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
