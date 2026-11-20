/**
 * Sincronizacao dos lembretes contra um sistema de notificacoes FALSO: criar, trocar, cancelar,
 * desligar, permissao negada, falha em cada escrita (a rodada seguinte termina o servico, sem
 * duplicar), nunca duas rodadas ao mesmo tempo e nunca mexer no que nao e do app. Os comandos SQL
 * sao os do app (via o adaptador do `node:sqlite`).
 */
import { criaLocal } from "../src/db/locais.ts";
import {
  configuraLembretes,
  lerConfigLembretes,
  listaPlantoesParaLembretes,
  sincronizaLembretes,
  sincronizaLembretesSemSobrepor,
} from "../src/db/lembretes.ts";
import { atualizaPlantao, criaPlantao, mudaStatusPlantao } from "../src/db/plantoes.ts";
import { instante, somaDias } from "../src/lib/datetime.ts";
import { MAXIMO_LEMBRETES, PREFIXO_LEMBRETE } from "../src/lib/lembretes.ts";
import { criaLembretesFalso } from "../src/lib/lembretes-falso.ts";
import { localVazio } from "../src/lib/locais.ts";
import { adaptador, bancoMigrado } from "./esquema.mjs";
import { check, igual, report } from "./helpers.mjs";

// "Agora" dos testes: domingo, 15/11/2026, 10h.
const AGORA = instante(2026, 10, 15, 10);
const dia = (n, h = 7) => instante(2026, 10, n, h);

async function cenario() {
  const { db } = bancoMigrado();
  const ex = adaptador(db);
  const rede = await criaLocal(ex, { ...localVazio(), nome: "Rede D'Or", endereco: "Av. Brasil, 100" }, 1);
  const outro = await criaLocal(ex, { ...localVazio(), nome: "UPA B" }, 2);
  const f = criaLembretesFalso();
  return { db, ex, rede, outro, f };
}

const plantao = (localId, inicioMs, extra = {}) => ({
  localId,
  unidade: null,
  inicio: inicioMs,
  fim: inicioMs + 12 * 3600e3,
  valorBruto: 100000,
  descontoPercentual: 0,
  status: "agendado",
  observacao: null,
  ...extra,
});

const ids = (f) => [...f.agendados.keys()].sort();
const todos = (db, sql, ...p) => db.prepare(sql).all(...p).map((l) => ({ ...l }));
/** criados/cancelados/falhas — o resumo de uma rodada. */
const resumo = (r) => `${r.criados}/${r.cancelados}/${r.falhas}`;

export async function testes() {
  /* --------------------------------- desligado --------------------------------- */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    const r = await sincronizaLembretes(ex, f, AGORA);
    igual("sem configuracao: desligado", r.estado, "desligado");
    igual("e nada e agendado", f.agendados.size, 0);
    igual("nem sequer escreve no sistema", f.escritas, 0);
    igual("a configuracao ainda nao existe", await lerConfigLembretes(ex), null);
  }

  /* ----------------------------------- ligar ----------------------------------- */

  {
    const { db, ex, rede, outro, f } = await cenario();
    const p1 = await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    await criaPlantao(ex, plantao(rede, dia(21)), AGORA);
    await criaPlantao(ex, plantao(outro, dia(22), { unidade: "Pronto-socorro" }), AGORA);
    await criaPlantao(ex, plantao(rede, dia(23), { status: "realizado" }), AGORA); // realizado: nao
    await criaPlantao(ex, plantao(rede, dia(24), { status: "cancelado" }), AGORA); // cancelado: nao
    await criaPlantao(ex, plantao(rede, dia(14)), AGORA); // ja passou: nao
    await criaPlantao(ex, plantao(rede, instante(2027, 0, 20, 7)), AGORA); // depois do prazo de 45 dias: nao

    const consulta = await listaPlantoesParaLembretes(ex, AGORA);
    igual("a consulta traz so os agendados que ainda vao comecar, no prazo", consulta.length, 3);
    check("com o endereco do local", consulta.some((p) => p.local.endereco === "Av. Brasil, 100"));

    const r = await configuraLembretes(ex, f, 60, AGORA);
    igual("ligar com 1 h antes: estado ok", r.estado, "ok");
    igual("cria um aviso por plantao agendado do prazo", resumo(r), "3/0/0");
    igual("a configuracao fica guardada", (await lerConfigLembretes(ex)).antecedenciaMin, 60);
    igual("e a hora da ultima sincronizacao", (await lerConfigLembretes(ex)).ultimaSincronizacao, AGORA);
    const avisos = [...f.agendados.values()].sort((a, b) => a.quando - b.quando);
    igual("o primeiro toca uma hora antes do plantao", avisos[0].quando, dia(20) - 3600e3);
    igual("com o titulo e o endereco", `${avisos[0].titulo} | ${avisos[0].corpo.split("\n")[1]}`, "Plantão em 1 h — Rede D'Or | Av. Brasil, 100");
    check("a unidade aparece no titulo do outro", avisos[2].titulo === "Plantão em 1 h — Pronto-socorro · UPA B");
    check("todos com identificador do app", avisos.every((a) => a.id.startsWith(PREFIXO_LEMBRETE)));

    // idempotente
    const escritasAntes = f.escritas;
    igual("rodar de novo nao muda nada", resumo(await sincronizaLembretes(ex, f, AGORA)), "0/0/0");
    igual("e nao escreve nada no sistema", f.escritas, escritasAntes);

    /* --------------------------- o plantao muda: troca o aviso --------------------------- */

    await atualizaPlantao(ex, p1, plantao(rede, dia(20, 8)), AGORA);
    igual("mudar o horario de UM plantao troca so o aviso dele", resumo(await sincronizaLembretes(ex, f, AGORA)), "1/1/0");
    igual("continua um aviso por plantao", f.agendados.size, 3);
    check("o novo toca na hora nova", [...f.agendados.values()].some((a) => a.quando === dia(20, 8) - 3600e3));
    check("e o antigo saiu", ![...f.agendados.values()].some((a) => a.quando === dia(20) - 3600e3));

    await atualizaPlantao(ex, p1, plantao(rede, dia(20, 8), { unidade: "Itaim" }), AGORA);
    igual("dar uma unidade ao plantao troca o aviso", resumo(await sincronizaLembretes(ex, f, AGORA)), "1/1/0");
    check("o titulo ganha a unidade", [...f.agendados.values()].some((a) => a.titulo === "Plantão em 1 h — Itaim · Rede D'Or"));

    db.prepare("UPDATE locais SET endereco = 'Rua Nova, 5' WHERE id = ?").run(rede);
    igual("mudar o endereco do local troca os avisos dele (2 plantoes)", resumo(await sincronizaLembretes(ex, f, AGORA)), "2/2/0");
    check("com o endereco novo", [...f.agendados.values()].filter((a) => a.corpo.includes("Rua Nova, 5")).length === 2);

    await mudaStatusPlantao(ex, p1, "cancelado", AGORA);
    igual("cancelar o plantao cancela o aviso", resumo(await sincronizaLembretes(ex, f, AGORA)), "0/1/0");
    igual("sobram 2", f.agendados.size, 2);

    db.prepare("DELETE FROM plantoes WHERE inicio = ?").run(dia(21));
    igual("excluir o plantao tambem", resumo(await sincronizaLembretes(ex, f, AGORA)), "0/1/0");
    igual("sobra 1", f.agendados.size, 1);

    await criaPlantao(ex, plantao(rede, dia(25)), AGORA);
    igual("um plantao novo ganha o aviso na proxima rodada", resumo(await sincronizaLembretes(ex, f, AGORA)), "1/0/0");

    /* ---------------------------------- trocar a antecedencia ---------------------------------- */

    const antes = ids(f);
    const r30 = await configuraLembretes(ex, f, 30, AGORA);
    igual("trocar para 30 min refaz todos", resumo(r30), "2/2/0");
    check("nenhum identificador antigo sobrou", ids(f).every((id) => !antes.includes(id)));
    check("os avisos tocam 30 min antes", [...f.agendados.values()].every((a) => a.titulo.startsWith("Plantão em 30 min")));
    const r1d = await configuraLembretes(ex, f, 1440, AGORA);
    igual("e para 1 dia antes", resumo(r1d), "2/2/0");
    check("o titulo diz 1 dia", [...f.agendados.values()].every((a) => a.titulo.startsWith("Plantão em 1 dia")));

    /* ----------------------------------- desligar ----------------------------------- */

    f.deOutros.add("teste");
    f.deOutros.add("outra-parte-do-app");
    const rOff = await configuraLembretes(ex, f, null, AGORA);
    igual("desligar cancela todos os avisos do app", `${rOff.estado}/${rOff.cancelados}/${f.agendados.size}`, "desligado/2/0");
    igual("a configuracao guarda 'desligado'", (await lerConfigLembretes(ex)).antecedenciaMin, null);
    check("NUNCA pediu para cancelar o que nao e do app", f.pedidosDeCancelar.every((id) => id.startsWith(PREFIXO_LEMBRETE)));
    check("o que nao e do app continua la", f.deOutros.has("teste") && f.deOutros.has("outra-parte-do-app"));
    const escritasOff = f.escritas;
    await sincronizaLembretes(ex, f, AGORA);
    igual("desligado e sem nada agendado: nao escreve", f.escritas, escritasOff);

    // ligar de novo depois de desligar
    igual("ligar de novo recria", (await configuraLembretes(ex, f, 60, AGORA)).criados, 2);
  }

  /* ---------------------------------- permissao ---------------------------------- */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    f.permissaoAtual = "negada";
    const r = await configuraLembretes(ex, f, 60, AGORA);
    igual("sem permissao: nada e agendado", `${r.estado}/${f.agendados.size}`, "sem_permissao/0");
    check("a mensagem diz o motivo", /permissão/.test(r.mensagem ?? ""));
    check("e fica guardada para a tela mostrar", /permissão/.test((await lerConfigLembretes(ex)).ultimoErro ?? ""));
    igual("a escolha de 1 h antes tambem fica guardada", (await lerConfigLembretes(ex)).antecedenciaMin, 60);
    igual("nao escreveu no sistema", f.escritas, 0);

    f.permissaoAtual = "pergunta";
    igual("ainda sem decidir: o mesmo", (await sincronizaLembretes(ex, f, AGORA)).estado, "sem_permissao");

    f.respostaDoPedido = "concedida";
    await f.pedePermissao();
    const r2 = await sincronizaLembretes(ex, f, AGORA);
    igual("liberada a permissao, a proxima rodada agenda", `${r2.estado}/${f.agendados.size}`, "ok/1");
    igual("e o erro some da configuracao", (await lerConfigLembretes(ex)).ultimoErro, null);

    // a permissao e tirada depois: o que ja estava agendado nao e apagado nem recriado
    f.permissaoAtual = "negada";
    igual("permissao tirada depois: nao mexe no que ja esta (nao tocaria mesmo)", `${(await sincronizaLembretes(ex, f, AGORA)).estado}/${f.agendados.size}`, "sem_permissao/1");
  }

  /* ----------------------------- o prazo anda com o tempo ----------------------------- */

  {
    const { ex, rede, f } = await cenario();
    const longe = instante(2027, 0, 5, 7); // 51 dias depois de AGORA
    await criaPlantao(ex, plantao(rede, longe), AGORA);
    await criaPlantao(ex, plantao(rede, dia(16)), AGORA);
    await configuraLembretes(ex, f, 60, AGORA);
    igual("o plantao fora do prazo de 45 dias nao tem aviso (ainda)", f.agendados.size, 1);
    const depois = somaDias(AGORA, 10);
    const r = await sincronizaLembretes(ex, f, depois);
    igual("dez dias depois o plantao distante entra no prazo e ganha o aviso (e o do plantao de 16/11, ja passado, sai)", resumo(r), "1/1/0");
    igual("sobra so o do plantao que ainda vem", f.agendados.size, 1);
    // o sistema entrega o aviso e o tira da lista sozinho: o app nao o recria
    f.agendados.clear();
    const r2 = await sincronizaLembretes(ex, f, depois);
    igual("o aviso do plantao ja passado (que o sistema ja entregou) NAO e recriado; so o que ainda vem", `${r2.criados}/${f.agendados.size}`, "1/1");
  }

  /* ------------------------------------ o teto ------------------------------------ */

  {
    const { ex, rede, f } = await cenario();
    for (let k = 0; k < MAXIMO_LEMBRETES + 30; k++) await criaPlantao(ex, plantao(rede, dia(16) + k * 3600e3 * 4, { fim: dia(16) + k * 3600e3 * 4 + 3600e3 }), AGORA);
    const r = await configuraLembretes(ex, f, 30, AGORA);
    igual(`no maximo ${MAXIMO_LEMBRETES} avisos agendados`, f.agendados.size, MAXIMO_LEMBRETES);
    igual("e a rodada criou exatamente esses", r.criados, MAXIMO_LEMBRETES);
    const quandos = [...f.agendados.values()].map((a) => a.quando).sort((a, b) => a - b);
    check("sao os mais proximos", quandos[0] === dia(16) - 30 * 60e3);
    igual("rodar de novo nao muda nada", resumo(await sincronizaLembretes(ex, f, AGORA)), "0/0/0");
  }

  /* ------------------------ falha em cada escrita: nada duplica ------------------------ */

  {
    // O servico: 4 plantoes ja agendados; um muda de horario, um e cancelado e entra um novo (2 cancelamentos
    // e 2 criacoes em 3 escritas) — falhar em qualquer uma deixa a rodada seguinte terminar o servico.
    const monta = async () => {
      const c = await cenario();
      const p = [];
      for (const n of [20, 21, 22, 23]) p.push(await criaPlantao(c.ex, plantao(c.rede, dia(n)), AGORA));
      await configuraLembretes(c.ex, c.f, 60, AGORA);
      await atualizaPlantao(c.ex, p[0], plantao(c.rede, dia(20, 9)), AGORA);
      await mudaStatusPlantao(c.ex, p[1], "cancelado", AGORA);
      await criaPlantao(c.ex, plantao(c.rede, dia(26)), AGORA);
      c.f.escritas = 0;
      return c;
    };

    // quantas escritas a rodada faz
    const base = await monta();
    const certo = await sincronizaLembretes(base.ex, base.f, AGORA);
    const total = base.f.escritas;
    const esperado = ids(base.f);
    check("a rodada tem varias escritas (a falha tem onde atuar)", total >= 3, `${total}`);
    igual("e termina com um aviso por plantao agendado", esperado.length, 4);

    let convergiu = 0;
    let semDuplicar = 0;
    let falhouMesmo = 0;
    for (let k = 1; k <= total; k++) {
      const { ex, f } = await monta();
      f.falhaNaEscrita = k;
      const r1 = await sincronizaLembretes(ex, f, AGORA);
      if (r1.estado === "erro" && r1.falhas >= 1) falhouMesmo += 1;
      f.falhaNaEscrita = Infinity;
      const r2 = await sincronizaLembretes(ex, f, AGORA);
      if (r2.estado === "ok" && JSON.stringify(ids(f)) === JSON.stringify(esperado)) convergiu += 1;
      const r3 = await sincronizaLembretes(ex, f, AGORA);
      if (resumo(r3) === "0/0/0" && f.agendados.size === 4) semDuplicar += 1;
    }
    igual(`com falha em cada uma das ${total} escritas, a rodada acusa o erro`, falhouMesmo, total);
    igual("a rodada seguinte termina o servico, com os avisos EXATOS", convergiu, total);
    igual("e a terceira nao tem mais nada a fazer, sem duplicar", semDuplicar, total);
    void certo;

    // o erro fica guardado, e some depois
    const { ex, f } = await monta();
    f.falhaNaEscrita = 1;
    await sincronizaLembretes(ex, f, AGORA);
    check("o erro fica guardado para a tela", /falha injetada/.test((await lerConfigLembretes(ex)).ultimoErro ?? ""));
    f.falhaNaEscrita = Infinity;
    await sincronizaLembretes(ex, f, AGORA);
    igual("e some quando a rodada seguinte da certo", (await lerConfigLembretes(ex)).ultimoErro, null);
  }

  /* ------------------------------ o sistema nao responde ------------------------------ */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    await configuraLembretes(ex, f, 60, AGORA);
    f.falhaAoListar = true;
    let lancou = false;
    let r;
    try {
      r = await sincronizaLembretes(ex, f, AGORA);
    } catch {
      lancou = true;
    }
    igual("falha ao listar NUNCA lanca", lancou, false);
    igual("vira erro no resultado, com a mensagem", `${r.estado}/${r.falhas}/${r.mensagem}`, "erro/1/O sistema não respondeu.");
    igual("o que estava agendado continua", f.agendados.size, 1);
    check("e o erro fica guardado", /não respondeu/.test((await lerConfigLembretes(ex)).ultimoErro ?? ""));
    f.falhaAoListar = false;
    igual("quando volta, tudo se acerta", (await sincronizaLembretes(ex, f, AGORA)).estado, "ok");
  }

  /* ---------------------------- nunca duas rodadas ao mesmo tempo ---------------------------- */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    await configuraLembretes(ex, f, 60, AGORA);
    f.agendados.clear();

    let simultaneas = 0;
    let maximo = 0;
    let rodadas = 0;
    const lenta = {
      ...f,
      permissao: () => f.permissao(),
      pedePermissao: () => f.pedePermissao(),
      agenda: (l) => f.agenda(l),
      cancela: (i) => f.cancela(i),
      testeAgora: (...a) => f.testeAgora(...a),
      async listaAgendados() {
        rodadas += 1;
        simultaneas += 1;
        maximo = Math.max(maximo, simultaneas);
        await new Promise((r) => setTimeout(r, 15));
        const l = await f.listaAgendados();
        simultaneas -= 1;
        return l;
      },
    };
    const pedidos = await Promise.all([1, 2, 3, 4, 5].map(() => sincronizaLembretesSemSobrepor(ex, lenta, () => AGORA)));
    igual("cinco pedidos em rajada nunca rodam juntos", maximo, 1);
    igual("viram duas rodadas (a que andava e uma repeticao so)", rodadas, 2);
    check("todos recebem um resultado", pedidos.every((r) => r.estado === "ok"));
    igual("e o aviso foi criado uma vez so", f.agendados.size, 1);
    igual("a rajada pediu para agendar uma vez so (alem da que ligou os lembretes, antes de limpar)", f.pedidosDeAgendar.length, 2);
  }

  /* ----------------- plantao criado no meio de uma rodada: a repeticao o pega ----------------- */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    await configuraLembretes(ex, f, 60, AGORA);

    let uma = true;
    const comMudanca = {
      permissao: () => f.permissao(),
      pedePermissao: () => f.pedePermissao(),
      agenda: (l) => f.agenda(l),
      cancela: (i) => f.cancela(i),
      testeAgora: (...a) => f.testeAgora(...a),
      async listaAgendados() {
        const l = await f.listaAgendados();
        if (uma) {
          uma = false;
          await criaPlantao(ex, plantao(rede, dia(22)), AGORA); // a pessoa lanca outro plantao enquanto a rodada anda
        }
        return l;
      },
    };
    const p = sincronizaLembretesSemSobrepor(ex, comMudanca, () => AGORA);
    sincronizaLembretesSemSobrepor(ex, comMudanca, () => AGORA); // o pedido que o novo plantao dispararia
    await p;
    igual("o plantao lancado no meio da rodada tambem ganha o aviso", f.agendados.size, 2);
  }

  /* ------------------------------- config estragada no banco ------------------------------- */

  {
    const { db, ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    db.prepare("INSERT INTO config (chave, valor) VALUES ('lembretes', '{estragado')").run();
    igual("config estragada = desligado, sem erro", (await sincronizaLembretes(ex, f, AGORA)).estado, "desligado");
    igual("e a escolha de uma antecedencia conserta", (await configuraLembretes(ex, f, 60, AGORA)).estado, "ok");
    igual("a configuracao nova substitui a estragada", todos(db, "SELECT COUNT(*) AS n FROM config WHERE chave = 'lembretes'")[0].n, 1);
  }

  /* ------------------------------- o que fica guardado ------------------------------- */

  {
    const { ex, rede, f } = await cenario();
    await criaPlantao(ex, plantao(rede, dia(20)), AGORA);
    await configuraLembretes(ex, f, 60, AGORA);
    igual("a sincronizacao certa guarda a hora", (await lerConfigLembretes(ex)).ultimaSincronizacao, AGORA);
    f.falhaNaEscrita = f.escritas + 1;
    await criaPlantao(ex, plantao(rede, dia(21)), AGORA);
    const r = await sincronizaLembretes(ex, f, AGORA + 5000);
    igual("a rodada com falha e erro", r.estado, "erro");
    const c = await lerConfigLembretes(ex);
    igual("a falha nao conta como sincronizada", c.ultimaSincronizacao, AGORA);
    check("e o erro fica guardado", typeof c.ultimoErro === "string");
    f.falhaNaEscrita = Infinity;
    await configuraLembretes(ex, f, null, AGORA + 9000);
    igual("desligar limpa o erro antigo", (await lerConfigLembretes(ex)).ultimoErro, null);
  }

}

if (import.meta.url === `file://${process.argv[1]}`) {
  await testes();
  process.exit(report() ? 0 : 1);
}
