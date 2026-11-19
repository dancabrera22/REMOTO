/**
 * Sincronizacao com o calendario: criar, atualizar, remover, recuperar-se de
 * falha e nunca sobrepor duas rodadas. O calendario e um falso em memoria; os
 * comandos SQL sao os do app.
 */
import { criaLocal } from "../src/db/locais.ts";
import {
  conectaCalendario,
  contaEventosMapeados,
  desconectaCalendario,
  lerConfigCalendario,
  listaPlantoesParaCalendario,
  sincroniza,
  sincronizaSemSobrepor,
} from "../src/db/calendario.ts";
import { fimDoDia, inicioDoDia, instante, somaDias } from "../src/lib/datetime.ts";
import { criaCalendarioFalso } from "../src/lib/calendario-falso.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado, migraAte } from "./esquema.mjs";
import { check, igual } from "./helpers.mjs";

const AGORA = instante(2026, 10, 16, 10); // segunda, 16/11/2026
const HOJE = inicioDoDia(AGORA);
const dia = (n, h = 7) => {
  const d = new Date(somaDias(HOJE, n));
  return instante(d.getFullYear(), d.getMonth(), d.getDate(), h);
};

async function cenario() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const localId = await criaLocal(ex, { ...localVazio(), nome: "Hospital A", endereco: "Av. Brasil, 100", valorPadrao: 100000 }, 1);
  const outro = await criaLocal(ex, { ...localVazio(), nome: "UPA B", valorPadrao: 50000 }, 2);
  const cal = criaCalendarioFalso();
  return { db, ex, localId, outro, cal };
}

let seq = 0;
function insere(db, localId, inicio, extra = {}) {
  seq += 1;
  const r = db
    .prepare(
      `INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, desconto_percentual, status, observacao, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(localId, inicio, inicio + 12 * 3600e3, extra.valor ?? 100000, extra.desconto ?? 0, extra.status ?? "agendado", extra.obs ?? null);
  return Number(r.lastInsertRowid);
}

const ESCOLHA = (cal, extra = {}) => ({ calendario: cal.calendarios[0], lembreteMin: 60, mostrarValor: false, ...extra });
const eventosDe = (cal) => [...cal.eventos.values()].sort((a, b) => a.inicio - b.inicio);
const mapa = (db) => db.prepare("SELECT * FROM eventos_calendario ORDER BY plantao_id").all().map((l) => ({ ...l }));
const zeros = (r) => `${r.criados}/${r.atualizados}/${r.recriados}/${r.removidos}/${r.falhas}`;

/** Cenario padrao: 4 plantoes que valem evento e 3 que nao. */
async function populado() {
  const c = await cenario();
  c.p1 = insere(c.db, c.localId, dia(4)); // 20/11
  c.p2 = insere(c.db, c.localId, dia(9)); // 25/11
  c.p3 = insere(c.db, c.localId, dia(15)); // 01/12
  c.p4 = insere(c.db, c.localId, dia(-10), { status: "realizado" }); // passado, dentro da janela
  c.p5 = insere(c.db, c.localId, dia(-40), { status: "realizado" }); // antes da janela
  c.p6 = insere(c.db, c.localId, dia(200)); // depois da janela
  c.p7 = insere(c.db, c.localId, dia(5), { status: "cancelado" }); // cancelado
  return c;
}

export async function testes() {
  /* ------------------------------ migracao 4 ------------------------------ */

  {
    const v3 = bancoMigrado(3);
    const ex = adaptador(v3.db);
    const localId = await criaLocal(ex, { ...localVazio(), nome: "Antigo" }, 1);
    v3.db.prepare("INSERT INTO plantoes (local_id, inicio, fim, valor_bruto, status, criado_em, atualizado_em) VALUES (?, 1, 2, 5, 'realizado', 1, 1)").run(localId);
    igual("antes: nao existe a tabela de configuracao", v3.db.prepare("SELECT name FROM sqlite_master WHERE name = 'config'").all().length, 0);
    migraAte(v3.db);
    igual("depois: existe", v3.db.prepare("SELECT name FROM sqlite_master WHERE name = 'config'").all().length, 1);
    igual("e a do mapa de eventos", v3.db.prepare("SELECT name FROM sqlite_master WHERE name = 'eventos_calendario'").all().length, 1);
    igual("os dados de quem ja usava o app seguem la", v3.db.prepare("SELECT COUNT(*) AS n FROM plantoes").get().n, 1);
    igual("sem calendario conectado, nao ha configuracao", await lerConfigCalendario(ex), null);
  }

  /* -------------------------------- desligado -------------------------------- */

  {
    const { ex, cal } = await populado();
    const r = await sincroniza(ex, cal, AGORA);
    igual("sem conectar, nada acontece", r.estado, "desligado");
    igual("e o calendario nem foi tocado", cal.escritas + cal.eventos.size, 0);
  }

  /* -------------------------------- criar tudo -------------------------------- */

  {
    const { db, ex, cal, p1, p4 } = await populado();
    const r = await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    igual("conectar ja sincroniza", r.estado, "ok");
    igual("cria 4 eventos (3 agendados e 1 realizado recente)", r.criados, 4);
    igual("sem falhas", r.falhas, 0);
    igual("o calendario tem 4 eventos", cal.eventos.size, 4);
    igual("e o mapa tambem", await contaEventosMapeados(ex), 4);

    const evs = eventosDe(cal);
    check("fora da janela (40 dias atras e daqui a 200) e cancelado nao viram evento", evs.every((e) => e.inicio >= dia(-10) && e.inicio <= dia(15)));
    igual("o evento mais antigo e o realizado de 10 dias atras", evs[0].inicio, dia(-10));
    const e1 = [...cal.eventos.values()].find((e) => e.inicio === dia(4));
    igual("titulo do evento", e1.titulo, "Plantão · Hospital A");
    igual("local do evento", e1.local, "Av. Brasil, 100");
    igual("fim do evento", e1.fim, dia(4) + 12 * 3600e3);
    igual("lembrete do evento", e1.lembreteMin, 60);
    igual("calendario do evento", e1.calendarioId, "cal-1");
    check("o mapa liga cada plantao ao seu evento", mapa(db).some((m) => m.plantao_id === p1 && cal.eventos.has(m.evento_id)) && mapa(db).some((m) => m.plantao_id === p4));

    const cfg = await lerConfigCalendario(ex);
    check("a configuracao fica guardada", cfg.calendarioId === "cal-1" && cfg.calendarioNome === "Pessoal" && cfg.conta === "pessoa@gmail.com" && cfg.lembreteMin === 60 && cfg.mostrarValor === false);
    igual("com a hora da ultima sincronizacao", cfg.ultimaSincronizacao, AGORA);
    igual("e sem erro", cfg.ultimoErro, null);

    // Idempotente: de novo, nada muda e o calendario nem e tocado.
    const escritas = cal.escritas;
    const r2 = await sincroniza(ex, cal, AGORA);
    igual("sincronizar de novo nao muda nada", zeros(r2), "0/0/0/0/0");
    igual("e nao escreve no calendario", cal.escritas, escritas);

    // O que a pessoa mexe no evento, dentro do calendario, o app respeita enquanto o plantao nao mudar.
    const ev = [...cal.eventos.values()][0];
    cal.eventos.set(ev.id, { ...ev, notas: "editado la" });
    await sincroniza(ex, cal, AGORA);
    igual("edicao feita no calendario nao e sobrescrita se o plantao nao mudou", cal.eventos.get(ev.id).notas, "editado la");
  }

  /* ------------------------------ borda da janela ------------------------------ */

  {
    const { ex, db, localId, cal } = await cenario();
    const antes = insere(db, localId, dia(-31, 23)); // 30 dias e 1 hora antes... fora
    const dentro = insere(db, localId, dia(-30, 0)); // exatamente o inicio da janela
    const ultimo = insere(db, localId, dia(180, 23)); // ultimo dia da janela
    const depois = insere(db, localId, dia(181, 0)); // um minuto depois
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const ids = new Set((await listaPlantoesParaCalendario(ex, ...Object.values({ de: dia(-30, 0), ate: fimDoDia(dia(180)) }))).map((p) => p.id));
    check("a janela vai de 30 dias atras (meia-noite) a 180 adiante (fim do dia)", ids.has(dentro) && ids.has(ultimo) && !ids.has(antes) && !ids.has(depois));
    igual("so entram os dois de dentro", cal.eventos.size, 2);
  }

  /* ----------------------------- atualizar o que mudou ----------------------------- */

  {
    const { db, ex, cal, p1 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);

    // O valor nao aparece no evento: mudar o valor do plantao nao mexe no calendario.
    db.prepare("UPDATE plantoes SET valor_bruto = 1 WHERE id = ?").run(p1);
    const esc = cal.escritas;
    igual("mudar so o valor nao toca no calendario (ele nao aparece la)", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/0/0");
    igual("... nenhuma escrita", cal.escritas, esc);

    db.prepare("UPDATE plantoes SET observacao = 'Levar crachá' WHERE id = ?").run(p1);
    igual("mudar a observacao atualiza so aquele evento", zeros(await sincroniza(ex, cal, AGORA)), "0/1/0/0/0");
    check("e ela aparece nas notas", [...cal.eventos.values()].some((e) => e.notas.startsWith("Levar crachá")));

    db.prepare("UPDATE plantoes SET inicio = ?, fim = ? WHERE id = ?").run(dia(4, 8), dia(4, 20), p1);
    igual("mudar o horario atualiza", zeros(await sincroniza(ex, cal, AGORA)), "0/1/0/0/0");
    check("o evento ganha o horario novo", [...cal.eventos.values()].some((e) => e.inicio === dia(4, 8) && e.fim === dia(4, 20)));
    igual("e continua um evento so por plantao", cal.eventos.size, 4);

    db.prepare("UPDATE locais SET nome = 'Hospital Renomeado' WHERE id = 1").run();
    igual("renomear o local atualiza todos os eventos dele", zeros(await sincroniza(ex, cal, AGORA)), "0/4/0/0/0");
    check("com o titulo novo", eventosDe(cal).every((e) => e.titulo === "Plantão · Hospital Renomeado"));

    db.prepare("UPDATE plantoes SET unidade = 'Itaim' WHERE id = ?").run(p1);
    igual("dar uma unidade a UM plantao atualiza so o evento dele", zeros(await sincroniza(ex, cal, AGORA)), "0/1/0/0/0");
    check("o titulo ganha a unidade", eventosDe(cal).some((e) => e.titulo === "Plantão · Itaim · Hospital Renomeado"));
    igual("os outros eventos nao mudam", eventosDe(cal).filter((e) => e.titulo === "Plantão · Hospital Renomeado").length, 3);
    igual("sem mexer em nada, nada e atualizado", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/0/0");

    db.prepare("UPDATE locais SET endereco = NULL WHERE id = 1").run();
    await sincroniza(ex, cal, AGORA);
    check("tirar o endereco tira o local do evento", eventosDe(cal).every((e) => e.local === null));
  }

  /* ------------------------------- opcoes: lembrete e valor ------------------------------- */

  {
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);

    const r1 = await conectaCalendario(ex, cal, ESCOLHA(cal, { lembreteMin: 1440 }), AGORA + 5000); // mais tarde: a data de ativacao nao pode andar junto
    igual("mudar o lembrete atualiza todos", zeros(r1), "0/4/0/0/0");
    check("todos com o lembrete novo", eventosDe(cal).every((e) => e.lembreteMin === 1440));
    igual("mexer nas opcoes mais tarde nao muda a data de ativacao", (await lerConfigCalendario(ex)).ativadoEm, AGORA);
    const r2 = await conectaCalendario(ex, cal, ESCOLHA(cal, { lembreteMin: null }), AGORA);
    igual("tirar o lembrete tambem", zeros(r2), "0/4/0/0/0");
    check("e ninguem fica com lembrete", eventosDe(cal).every((e) => e.lembreteMin === null));

    const r3 = await conectaCalendario(ex, cal, ESCOLHA(cal, { lembreteMin: null, mostrarValor: true }), AGORA);
    igual("pedir o valor nas notas atualiza todos", zeros(r3), "0/4/0/0/0");
    check("com o liquido e a data de recebimento", eventosDe(cal).every((e) => e.notas.includes("Líquido: R$ 1.000,00") && e.notas.includes("Cai na conta:")));
    igual("a configuracao guarda a escolha", (await lerConfigCalendario(ex)).mostrarValor, true);

    // Escolher as mesmas opcoes de novo: nada a fazer.
    igual("a data de ativacao nao muda ao mexer nas opcoes", (await lerConfigCalendario(ex)).ativadoEm, AGORA);
    igual("repetir a mesma escolha nao muda nada", zeros(await conectaCalendario(ex, cal, ESCOLHA(cal, { lembreteMin: null, mostrarValor: true }), AGORA)), "0/0/0/0/0");
  }

  /* ----------------------------- remover o que sobrou ----------------------------- */

  {
    const { db, ex, cal, p2, p3 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);

    db.prepare("UPDATE plantoes SET status = 'cancelado' WHERE id = ?").run(p2);
    igual("cancelar o plantao remove o evento", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/1/0");
    igual("restam 3", cal.eventos.size, 3);
    igual("e o mapa acompanha", await contaEventosMapeados(ex), 3);

    db.prepare("UPDATE plantoes SET status = 'trocado' WHERE id = ?").run(p3);
    igual("trocar tambem", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/1/0");

    db.prepare("DELETE FROM plantoes WHERE id = ?").run(db.prepare("SELECT id FROM plantoes WHERE inicio = ?").get(dia(4)).id);
    igual("excluir o plantao remove o evento", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/1/0");
    igual("sobra so o realizado", cal.eventos.size, 1);

    db.prepare("UPDATE plantoes SET status = 'agendado' WHERE id = ?").run(p2);
    igual("descancelar traz o evento de volta", zeros(await sincroniza(ex, cal, AGORA)), "1/0/0/0/0");
  }

  {
    // Plantao que saiu da janela com o tempo: o evento antigo fica (e historico), nao e apagado.
    const { db, ex, cal, p4 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const depois = AGORA + 40 * 86400e3; // 40 dias depois: p4 (10 dias antes de AGORA) ficou fora da janela
    // Nesse dia a janela e [AGORA+10d, AGORA+220d]: so o plantao de +200 dias entra. Os tres antigos saem dela.
    igual("com o tempo, entra so o que passou a caber na janela", zeros(await sincroniza(ex, cal, depois)), "1/0/0/0/0");
    igual("e os eventos que sairam da janela seguem no calendario (5 no total)", cal.eventos.size, 5);
    check("o evento antigo continua la", [...cal.eventos.values()].some((e) => e.inicio === dia(-10)));
    check("e o mapa dele tambem", db.prepare("SELECT 1 FROM eventos_calendario WHERE plantao_id = ?").get(p4) !== undefined);
  }

  /* ------------------------- a pessoa apagou o evento no calendario ------------------------- */

  {
    const { db, ex, cal, p1 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const velho = db.prepare("SELECT evento_id FROM eventos_calendario WHERE plantao_id = ?").get(p1).evento_id;
    cal.eventos.delete(velho);

    const r = await sincroniza(ex, cal, AGORA);
    igual("evento apagado la e refeito", zeros(r), "0/0/1/0/0");
    igual("o plantao tem evento de novo", cal.eventos.size, 4);
    const novo = db.prepare("SELECT evento_id FROM eventos_calendario WHERE plantao_id = ?").get(p1).evento_id;
    check("com id novo no mapa", novo !== velho && cal.eventos.has(novo));

    // Apagado la E mudado aqui: tenta atualizar, o calendario diz que nao existe, e refaz.
    const id2 = db.prepare("SELECT evento_id FROM eventos_calendario WHERE plantao_id = ?").get(p1).evento_id;
    cal.eventos.delete(id2);
    db.prepare("UPDATE plantoes SET observacao = 'nova' WHERE id = ?").run(p1);
    igual("apagado la e alterado aqui tambem se resolve", zeros(await sincroniza(ex, cal, AGORA)), "0/0/1/0/0");
    check("com o conteudo novo", [...cal.eventos.values()].some((e) => e.notas.startsWith("nova")));
  }

  {
    // O evento "some" apos a checagem de existencia (corrida): atualizar devolve falso e o app refaz.
    const { db, ex, cal, p1 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const id = db.prepare("SELECT evento_id FROM eventos_calendario WHERE plantao_id = ?").get(p1).evento_id;
    const original = cal.idsDeEventos;
    cal.idsDeEventos = async (...a) => new Set([...(await original(...a)), id]); // finge que ainda existe
    cal.eventos.delete(id);
    db.prepare("UPDATE plantoes SET observacao = 'x' WHERE id = ?").run(p1);
    igual("atualizar um evento que sumiu cria outro", zeros(await sincroniza(ex, cal, AGORA)), "0/0/1/0/0");
  }

  /* ---------------------------- calendario ou permissao sumiram ---------------------------- */

  {
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);

    cal.calendarios = cal.calendarios.filter((c) => c.id !== "cal-1");
    const r = await sincroniza(ex, cal, AGORA + 1000);
    igual("calendario que sumiu do aparelho", r.estado, "sem_calendario");
    check("a mensagem diz qual", r.mensagem.includes("Pessoal"));
    igual("os eventos nao sao tocados", cal.eventos.size, 4);
    igual("o erro fica guardado para a tela", (await lerConfigCalendario(ex)).ultimoErro, r.mensagem);
    igual("e a hora da ultima sincronizacao boa nao muda", (await lerConfigCalendario(ex)).ultimaSincronizacao, AGORA);
  }

  {
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    cal.permissaoAtual = "negada";
    const r = await sincroniza(ex, cal, AGORA);
    igual("permissao retirada", r.estado, "sem_permissao");
    check("com mensagem", r.mensagem.includes("permissão"));
    igual("nada e apagado", cal.eventos.size, 4);
    cal.permissaoAtual = "concedida";
    igual("devolvida a permissao, volta ao normal", (await sincroniza(ex, cal, AGORA)).estado, "ok");
    igual("e o erro some da configuracao", (await lerConfigCalendario(ex)).ultimoErro, null);
  }

  {
    // Calendario que explode: a sincronizacao nunca lanca.
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    cal.permissao = async () => {
      throw new Error("o calendario nao respondeu");
    };
    const r = await sincroniza(ex, cal, AGORA);
    igual("erro geral nao lanca", r.estado, "erro");
    check("e conta como falha, com a mensagem", r.falhas === 1 && r.mensagem === "o calendario nao respondeu");
  }

  /* ------------------------------ falha em cada escrita ------------------------------ */

  {
    // Para CADA passo de escrita: falha ali, e a rodada seguinte termina o servico sem duplicar nada.
    const total = await (async () => {
      const c = await populado();
      await conectaCalendario(c.ex, c.cal, ESCOLHA(c.cal), AGORA);
      return c.cal.escritas;
    })();
    igual("criar quatro eventos sao quatro escritas", total, 4);

    let recuperou = 0;
    let consistente = 0;
    for (let n = 1; n <= total; n++) {
      const c = await populado();
      c.cal.falhaNaEscrita = n;
      const r = await conectaCalendario(c.ex, c.cal, ESCOLHA(c.cal), AGORA);
      const falhou = r.estado === "erro" && r.falhas === 1 && r.criados === total - 1 && r.mensagem.includes(`falha injetada na escrita ${n}`);
      if (n === 1) {
        igual("o erro traz o motivo para a tela", (await lerConfigCalendario(c.ex)).ultimoErro.includes("falha injetada na escrita 1"), true);
        check("e a mensagem do resultado diz quantas falharam", r.mensagem.startsWith("1 operação falhou: "));
      }

      // Todo mapa aponta para um evento que existe, e nenhum evento esta sem mapa.
      const ids = new Set(mapa(c.db).map((m) => m.evento_id));
      const ok = mapa(c.db).every((m) => c.cal.eventos.has(m.evento_id)) && [...c.cal.eventos.keys()].every((id) => ids.has(id));
      if (falhou && ok) consistente += 1;

      c.cal.falhaNaEscrita = Infinity;
      const r2 = await sincroniza(c.ex, c.cal, AGORA);
      if (r2.estado === "ok" && c.cal.eventos.size === 4 && mapa(c.db).length === 4 && r2.criados === 1) recuperou += 1;
    }
    check(`falha em qualquer das ${total} escritas: o mapa fica coerente`, consistente === total, `${consistente}/${total}`);
    check(`... e a proxima rodada termina o servico, sem duplicar`, recuperou === total, `${recuperou}/${total}`);
  }

  {
    // Falha ao REMOVER: o mapa mantem a linha e a proxima rodada remove.
    const { db, ex, cal, p2 } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    db.prepare("UPDATE plantoes SET status = 'cancelado' WHERE id = ?").run(p2);
    cal.falhaNaEscrita = cal.escritas + 1;
    const r = await sincroniza(ex, cal, AGORA);
    check("falha ao remover e registrada", r.estado === "erro" && r.removidos === 0);
    igual("o evento e o mapa continuam (nada pela metade)", `${cal.eventos.size}/${mapa(db).length}`, "4/4");
    cal.falhaNaEscrita = Infinity;
    igual("a proxima rodada remove", zeros(await sincroniza(ex, cal, AGORA)), "0/0/0/1/0");
  }

  /* ---------------------------------- trocar de calendario ---------------------------------- */

  {
    const { db, ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const r = await conectaCalendario(ex, cal, { calendario: cal.calendarios[1], lembreteMin: 60, mostrarValor: false }, AGORA);
    igual("trocar de calendario leva os eventos", zeros(r), "4/0/0/0/0");
    igual("nenhum evento fica no calendario antigo", [...cal.eventos.values()].filter((e) => e.calendarioId === "cal-1").length, 0);
    igual("todos estao no novo", [...cal.eventos.values()].filter((e) => e.calendarioId === "cal-2").length, 4);
    check("o mapa aponta para o calendario novo", mapa(db).every((m) => m.calendario_id === "cal-2"));
    igual("a configuracao tambem", (await lerConfigCalendario(ex)).calendarioNome, "Trabalho");
  }

  {
    // Trocar de calendario leva TODOS os eventos do app, tambem os de plantoes que ja saíram da janela.
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const depois = AGORA + 40 * 86400e3; // p1, p2 e p4 ficaram fora da janela
    await conectaCalendario(ex, cal, { calendario: cal.calendarios[1], lembreteMin: 60, mostrarValor: false }, depois);
    igual("nenhum evento do app fica no calendario antigo, nem os de plantoes antigos", [...cal.eventos.values()].filter((e) => e.calendarioId === "cal-1").length, 0);
    igual("no novo entram so os que cabem na janela de agora (2)", cal.eventos.size, 2);
  }

  {
    // Troca interrompida: parte dos eventos antigos nao foi apagada. A rodada seguinte acerta.
    const { db, ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const antes = cal.escritas;
    cal.falhaNaEscrita = antes + 2; // a segunda remocao do calendario antigo falha
    await conectaCalendario(ex, cal, { calendario: cal.calendarios[1], lembreteMin: 60, mostrarValor: false }, AGORA);
    cal.falhaNaEscrita = Infinity;
    const r = await sincroniza(ex, cal, AGORA);
    igual("depois da rodada seguinte, nada fica no calendario antigo", [...cal.eventos.values()].filter((e) => e.calendarioId === "cal-1").length, 0);
    igual("e ha um evento por plantao no novo", [...cal.eventos.values()].filter((e) => e.calendarioId === "cal-2").length, 4);
    check("sem duplicatas e com o mapa certo", cal.eventos.size === 4 && mapa(db).length === 4 && mapa(db).every((m) => m.calendario_id === "cal-2" && cal.eventos.has(m.evento_id)), JSON.stringify(zeros(r)));
  }

  /* ---------------------------------- desconectar ---------------------------------- */

  {
    const { db, ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const r = await desconectaCalendario(ex, cal, { removerEventos: true });
    igual("desconectar removendo apaga os 4 eventos", r.removidos, 4);
    igual("o calendario fica limpo", cal.eventos.size, 0);
    igual("o mapa tambem", mapa(db).length, 0);
    igual("e a configuracao some", await lerConfigCalendario(ex), null);
    igual("depois disso a sincronizacao nao faz nada", (await sincroniza(ex, cal, AGORA)).estado, "desligado");
  }

  {
    const { db, ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    const r = await desconectaCalendario(ex, cal, { removerEventos: false });
    igual("desconectar sem remover: nao apaga nada", `${r.removidos}/${cal.eventos.size}`, "0/4");
    igual("mas o app esquece a ligacao", mapa(db).length, 0);
    igual("e a configuracao", await lerConfigCalendario(ex), null);
  }

  {
    // Remocao com falha: o app nao finge que removeu.
    const { ex, cal } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    cal.falhaNaEscrita = cal.escritas + 2;
    const r = await desconectaCalendario(ex, cal, { removerEventos: true });
    check("conta o que removeu e o que nao conseguiu", r.removidos === 3 && r.falhas === 1, JSON.stringify(r));
    igual("o evento que falhou segue no calendario", cal.eventos.size, 1);
  }

  /* ----------------------------------- sem sobrepor ----------------------------------- */

  {
    const { db, ex, cal, localId } = await populado();
    await conectaCalendario(ex, cal, ESCOLHA(cal), AGORA);
    cal.latencia = 4;
    cal.maximoSimultaneas = 0;

    // Muda algo no meio da rodada e pede de novo, varias vezes.
    const novo = insere(db, localId, dia(20));
    const a = sincronizaSemSobrepor(ex, cal, () => AGORA);
    const b = sincronizaSemSobrepor(ex, cal, () => AGORA);
    const c = sincronizaSemSobrepor(ex, cal, () => AGORA);
    check("varios pedidos juntos viram a mesma rodada", a === b && b === c);
    await a;
    igual("nunca houve duas operacoes ao mesmo tempo no calendario", cal.maximoSimultaneas <= 1, true);
    check("o plantao novo ganhou evento", cal.eventos.size === 5 && [...cal.eventos.values()].some((e) => e.inicio === dia(20)));

    // Pedido feito no MEIO da rodada (depois de ela ler os plantoes): ela repete e pega a mudanca.
    cal.latencia = 0;
    let pedidoDuranteARodada = null;
    cal.aoListarEventos = () => {
      cal.aoListarEventos = null; // so na primeira vez
      insere(db, localId, dia(25)); // o plantao aparece depois que a rodada ja leu a lista
      pedidoDuranteARodada = sincronizaSemSobrepor(ex, cal, () => AGORA);
    };
    const durante = sincronizaSemSobrepor(ex, cal, () => AGORA);
    // O plantao novo so e inserido quando a rodada ja esta em andamento, entao ela nao o leu.
    const r = await durante;
    check("o pedido feito durante a rodada devolve a mesma rodada", pedidoDuranteARodada === durante);
    igual("e a repeticao pega o que mudou no meio", cal.eventos.size, 6);
    igual("(a rodada que repete criou o evento novo)", r.criados, 1);
    check("a proxima chamada comeca uma rodada nova", sincronizaSemSobrepor(ex, cal, () => AGORA) !== durante);
    await espera();
  }
}

const espera = () => new Promise((r) => setTimeout(r, 30));

if (import.meta.url === `file://${process.argv[1]}`) {
  const { report } = await import("./helpers.mjs");
  await testes();
  process.exit(report() ? 0 : 1);
}
