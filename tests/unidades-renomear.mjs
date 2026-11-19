/**
 * Renomear (ou juntar) unidades de um local, no banco. O nome da unidade e digitado livremente,
 * entao um erro de digitacao ("Itiam") ou grafias diferentes ("itaim", "ITAIM") se espalham por
 * muitos plantoes; renomear acerta todos de uma vez e e como se juntam duas unidades que eram a
 * mesma. O que nunca pode acontecer: mexer em outro local, perder um plantao, ou deixar a
 * marca de "ajustado a mao" das escalas mentindo — nem pela metade, se algo falhar no meio.
 */
import { criaLocal } from "../src/db/locais.ts";
import { atualizaPlantao, buscaPlantao, criaPlantao, unidadesDoLocal } from "../src/db/plantoes.ts";
import { criaSerie } from "../src/db/series.ts";
import { contaUnidade, renomeiaUnidade } from "../src/db/unidades.ts";
import { instante } from "../src/lib/datetime.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual, report } from "./helpers.mjs";

const AGORA = instante(2026, 10, 15, 10);
const dia = (d, m, a = 2026) => instante(a, m - 1, d);

const novoPlantao = (localId, extra = {}) => ({
  localId,
  unidade: null,
  inicio: instante(2026, 9, 5, 7),
  fim: instante(2026, 9, 5, 19),
  valorBruto: 150000,
  descontoPercentual: 0,
  status: "realizado",
  observacao: null,
  ...extra,
});

const todos = (db, sql, ...p) => db.prepare(sql).all(...p).map((l) => ({ ...l }));
const unidades = (db, localId) =>
  todos(db, "SELECT unidade, COUNT(*) AS n FROM plantoes WHERE local_id = ? GROUP BY unidade ORDER BY unidade", localId)
    .map((l) => `${l.unidade ?? "-"}:${l.n}`)
    .join(" ");
const foto = (db) =>
  JSON.stringify(["locais", "series", "series_puladas", "plantoes"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all().map((l) => ({ ...l }))));

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

const tercas = (localId, unidade) => ({
  localId,
  unidade,
  inicioMin: 7 * 60,
  fimMin: 19 * 60,
  valorBruto: 150000,
  descontoPercentual: 0,
  observacao: null,
  regra: { tipo: "semanal", diasSemana: 1 << 2, cada: 1, diaDoMes: null, inicioDia: dia(17, 11), fimDia: null },
});

async function cenario() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const rede = await criaLocal(ex, { ...localVazio(), nome: "Rede D'Or" }, 1);
  const outra = await criaLocal(ex, { ...localVazio(), nome: "Hospital Vizinho" }, 2);
  const d = (n) => ({ inicio: instante(2026, 9, n, 7), fim: instante(2026, 9, n, 19) });
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Itiam", ...d(1) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Itiam", ...d(2) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Itiam", status: "cancelado", ...d(3) })); // cancelado tambem e renomeado
  await criaPlantao(ex, novoPlantao(rede, { unidade: "itaim", ...d(4) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "ITAIM", ...d(6) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Central", ...d(7) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: "Central", ...d(8) }));
  await criaPlantao(ex, novoPlantao(rede, { unidade: null, ...d(9) }));
  await criaPlantao(ex, novoPlantao(outra, { unidade: "Itiam", ...d(10) }));
  return { db, ex, rede, outra };
}

export async function testes() {
  /* ----------------------------------- contar ----------------------------------- */

  {
    const { ex, rede, outra } = await cenario();
    igual("conta os plantoes da unidade (inclusive cancelado)", (await contaUnidade(ex, rede, "Itiam")).plantoes, 3);
    igual("a grafia da busca nao importa", (await contaUnidade(ex, rede, "  ITIAM ")).plantoes, 3);
    igual("as tres grafias de Itaim contam como uma unidade", (await contaUnidade(ex, rede, "Itaim")).plantoes, 2);
    igual("so deste local", (await contaUnidade(ex, outra, "Itiam")).plantoes, 1);
    igual("unidade que nao existe", (await contaUnidade(ex, rede, "Nenhuma")).plantoes, 0);
    igual("nome vazio", (await contaUnidade(ex, rede, "  ")).plantoes, 0);
  }

  /* ---------------------------- renomear: erro de digitacao ---------------------------- */

  {
    const { db, ex, rede, outra } = await cenario();
    const ids = todos(db, "SELECT id FROM plantoes ORDER BY id").map((l) => l.id);
    const antes = await buscaPlantao(ex, ids[0]);
    const r = await renomeiaUnidade(ex, rede, "Itiam", "Itaim 2", AGORA);
    igual("devolve quantos plantoes mudaram (o cancelado entra)", r.plantoes, 3);
    igual("e nenhuma escala", r.escalas, 0);
    igual("todos viram o nome novo; as outras unidades ficam como estavam", unidades(db, rede), "-:1 Central:2 ITAIM:1 Itaim 2:3 itaim:1");
    igual("o OUTRO local nao e tocado", unidades(db, outra), "Itiam:1");
    igual("ninguem foi apagado nem criado", todos(db, "SELECT COUNT(*) AS n FROM plantoes")[0].n, 9);
    const depois = await buscaPlantao(ex, ids[0]);
    igual("o id e o valor do plantao continuam os mesmos", `${depois.id}/${depois.valorBruto}/${depois.inicio}`, `${antes.id}/${antes.valorBruto}/${antes.inicio}`);
    igual("so a unidade mudou", `${depois.unidade}`, "Itaim 2");
    igual("e o carimbo de atualizacao", depois.atualizadoEm, AGORA);
    igual("o plantao que nao era dessa unidade nao e tocado", (await buscaPlantao(ex, ids[7])).atualizadoEm !== AGORA, true);
    const sug = await unidadesDoLocal(ex, rede);
    igual("as sugestoes refletem o nome novo (o cancelado nao conta; itaim/ITAIM seguem uma unidade, na grafia mais recente)", sug.map((s) => `${s.unidade}:${s.usos}`).sort().join(","), "Central:2,ITAIM:2,Itaim 2:2");
  }

  /* ----------------------------- renomear: so a grafia ----------------------------- */

  {
    const { db, ex, rede } = await cenario();
    const r = await renomeiaUnidade(ex, rede, "itaim", "Itaim", AGORA);
    igual("acertar a grafia muda as variantes (itaim e ITAIM)", r.plantoes, 2);
    igual("e as tres viram uma", unidades(db, rede), "-:1 Central:2 Itaim:2 Itiam:3");
    const de = await renomeiaUnidade(ex, rede, "Itaim", "Itaim", AGORA);
    igual("renomear para o mesmo nome nao muda nada", `${de.plantoes}/${de.escalas}`, "0/0");
  }

  /* ----------------------------------- juntar ----------------------------------- */

  {
    const { db, ex, rede } = await cenario();
    const r = await renomeiaUnidade(ex, rede, "Itiam", "Itaim", AGORA);
    igual("juntar: os Itiam passam a Itaim E as outras grafias de Itaim tambem ficam 'Itaim'", unidades(db, rede), "-:1 Central:2 Itaim:5");
    igual("conta tudo que foi acertado", r.plantoes, 5);
    const sug = await unidadesDoLocal(ex, rede);
    igual("e as sugestoes mostram UMA unidade Itaim", sug.map((s) => s.unidade).sort().join(","), "Central,Itaim");
    igual("com todos os usos (o cancelado nao conta)", sug.find((s) => s.unidade === "Itaim").usos, 4);
  }

  {
    const { db, ex, rede } = await cenario();
    await renomeiaUnidade(ex, rede, "Itiam", "  central ", AGORA);
    igual("juntar com uma unidade existente adota a grafia digitada (normalizada) para as duas", unidades(db, rede), "-:1 ITAIM:1 central:5 itaim:1");
  }

  /* ----------------------------------- erros ----------------------------------- */

  {
    const { db, ex, rede } = await cenario();
    const antes = foto(db);
    check("nome novo vazio e recusado", await rejeita(() => renomeiaUnidade(ex, rede, "Itiam", "   ")));
    check("unidade de origem vazia e recusada", await rejeita(() => renomeiaUnidade(ex, rede, "  ", "Novo")));
    igual("e nada mudou", foto(db), antes);
    const nenhuma = await renomeiaUnidade(ex, rede, "Inexistente", "Novo", AGORA);
    igual("renomear o que nao existe nao e erro e nao muda nada", `${nenhuma.plantoes}/${nenhuma.escalas}/${foto(db) === antes}`, "0/0/true");
    const longo = await renomeiaUnidade(ex, rede, "Itiam", "x".repeat(100), AGORA);
    igual("nome novo comprido demais e cortado em 60, como no formulario", todos(db, "SELECT unidade FROM plantoes WHERE unidade LIKE 'xxx%'")[0].unidade.length, 60);
    igual("e conta os plantoes", longo.plantoes, 3);
  }

  /* ----------------------- escalas: modelo, plantoes e excecoes ----------------------- */

  {
    const { db, ex, rede } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(rede, "Itiam"), AGORA);
    const daSerie = () => todos(db, "SELECT * FROM plantoes WHERE serie_id = ? ORDER BY ocorrencia_dia", serieId);
    const inicio = daSerie();
    check("a escala criou plantoes", inicio.length > 10, String(inicio.length));
    igual("todos com a unidade com erro", inicio.every((p) => p.unidade === "Itiam"), true);

    // dois plantoes da escala ficam "ajustados a mao" so pela unidade
    const [p1, p2, p3] = inicio;
    await atualizaPlantao(ex, p2.id, novoPlantao(rede, { unidade: "Central", inicio: p2.inicio, fim: p2.fim, status: "agendado" }));
    await atualizaPlantao(ex, p3.id, novoPlantao(rede, { unidade: "Itaim 2", inicio: p3.inicio, fim: p3.fim, status: "agendado" }));
    igual("os dois sao excecoes", `${daSerie()[1].excecao}${daSerie()[2].excecao}`, "11");

    // Itiam -> Itaim 2: o modelo e os plantoes normais mudam; p3 (que ja era Itaim 2) deixa de ser excecao
    const r = await renomeiaUnidade(ex, rede, "Itiam", "Itaim 2", AGORA);
    igual("conta a escala", r.escalas, 1);
    igual("o modelo da escala tem o nome novo", todos(db, "SELECT unidade FROM series WHERE id = ?", serieId)[0].unidade, "Itaim 2");
    const depois = daSerie();
    igual("os plantoes normais da escala mudam", depois[0].unidade, "Itaim 2");
    igual("e o ultimo tambem", depois[depois.length - 1].unidade, "Itaim 2");
    igual("quem era 'Central' continua Central (outra unidade)", depois[1].unidade, "Central");
    igual("e continua excecao (ainda difere do modelo)", depois[1].excecao, 1);
    igual("quem JA era Itaim 2 deixa de ser excecao (agora bate com o modelo)", depois[2].excecao, 0);
    igual("ids e ocorrencias intactos", depois.map((p) => `${p.id}/${p.ocorrencia_dia}`).join(), inicio.map((p) => `${p.id}/${p.ocorrencia_dia}`).join());

    // juntar Central na Itaim 2: a excecao deixa de existir
    await renomeiaUnidade(ex, rede, "Central", "Itaim 2", AGORA);
    igual("ao juntar com a unidade da escala, a excecao some", todos(db, "SELECT excecao FROM plantoes WHERE id = ?", p2.id)[0].excecao, 0);
    void p1;
  }

  // So o MODELO da escala muda de nome (nenhum plantao dela tinha o nome antigo): as marcas de excecao
  // tambem precisam ser reavaliadas.
  {
    const { db, ex, rede } = await cenario();
    const { serieId } = await criaSerie(ex, tercas(rede, "Itiam"), AGORA);
    db.prepare("UPDATE plantoes SET unidade = 'Central', excecao = 1 WHERE serie_id = ?").run(serieId);
    igual("todos os plantoes da escala estao 'ajustados' para Central", todos(db, "SELECT COUNT(*) AS n FROM plantoes WHERE serie_id = ? AND excecao = 1", serieId)[0].n > 10, true);
    const r = await renomeiaUnidade(ex, rede, "Itiam", "Central", AGORA);
    igual("o modelo passa a Central", todos(db, "SELECT unidade FROM series WHERE id = ?", serieId)[0].unidade, "Central");
    igual("e nenhum plantao da escala continua marcado como excecao (agora todos batem com o modelo)", todos(db, "SELECT COUNT(*) AS n FROM plantoes WHERE serie_id = ? AND excecao = 1", serieId)[0].n, 0);
    igual("a escala conta mesmo sem plantao renomeado nela", r.escalas, 1);
  }

  /* ------------------ tudo ou nada: falha injetada em cada escrita ------------------ */

  {
    // O cenario: uma escala "Itiam" com um plantao ajustado a mao so pela unidade ("Itaim"). Renomear
    // Itiam -> Itaim mexe na escala, nos plantoes E na marca de excecao desse plantao.
    const comEscala = async () => {
      const c = await cenario();
      const { serieId } = await criaSerie(c.ex, tercas(c.rede, "Itiam"), AGORA);
      const p = todos(c.db, "SELECT * FROM plantoes WHERE serie_id = ? ORDER BY ocorrencia_dia", serieId)[1];
      await atualizaPlantao(c.ex, p.id, novoPlantao(c.rede, { unidade: "Itaim", inicio: p.inicio, fim: p.fim, status: "agendado" }));
      return { ...c, excecaoId: p.id };
    };
    const base = await comEscala();
    igual("o plantao ajustado so pela unidade e excecao", todos(base.db, "SELECT excecao FROM plantoes WHERE id = ?", base.excecaoId)[0].excecao, 1);
    const contador0 = { n: 0 };
    await renomeiaUnidade(comFalha(base.ex, contador0, 9999), base.rede, "Itiam", "Itaim", AGORA);
    const total = contador0.n;
    check("a renomeacao escreve em varios comandos (a falha injetada tem onde atuar)", total >= 3, String(total));

    let intactas = 0;
    for (let k = 1; k <= total; k++) {
      const { db, ex, rede } = await comEscala();
      const antes = foto(db);
      const contador = { n: 0 };
      const falhou = await rejeita(() => renomeiaUnidade(comFalha(ex, contador, k), rede, "Itiam", "Itaim", AGORA));
      if (falhou && foto(db) === antes) intactas += 1;
    }
    igual(`com falha em cada um dos ${total} comandos, o banco fica EXATAMENTE como estava`, intactas, total);

    const { db, ex, rede, excecaoId } = await comEscala();
    await renomeiaUnidade(ex, rede, "Itiam", "Itaim", AGORA);
    igual("e sem falha ele termina de verdade (neste local; o outro local nao e tocado)", todos(db, "SELECT COUNT(*) AS n FROM plantoes WHERE unidade = 'Itiam' AND local_id = ?", rede)[0].n, 0);
    igual("o outro local continua com o dele", todos(db, "SELECT COUNT(*) AS n FROM plantoes WHERE unidade = 'Itiam' AND local_id <> ?", rede)[0].n, 1);
    igual("inclusive a marca de excecao (agora o plantao bate com o modelo)", todos(db, "SELECT excecao FROM plantoes WHERE id = ?", excecaoId)[0].excecao, 0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await testes();
  process.exit(report() ? 0 : 1);
}
