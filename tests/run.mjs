#!/usr/bin/env node
/**
 * Roda a suite inteira num processo so.
 *
 *   npm test
 *
 * Nao precisa de aparelho, emulador nem servidor: tudo aqui e logica pura ou
 * SQLite em memoria. Os testes de interface sao visuais e ficam em
 * `tests/telas.mjs`, que exige o servidor web do Expo no ar.
 */
import { report } from "./helpers.mjs";
import { testes as cores } from "./cores.mjs";
import { testes as esquema } from "./esquema.mjs";
import { testes as locais } from "./locais.mjs";
import { testes as logica } from "./logica.mjs";
import { testes as pagamento } from "./pagamento.mjs";
import { testes as plantoes } from "./plantoes.mjs";
import { testes as plantoesDb } from "./plantoes-db.mjs";
import { testes as recorrencia } from "./recorrencia.mjs";
import { testes as seriesDb } from "./series-db.mjs";

console.log("\n── lógica (dinheiro e datas)");
logica();

console.log("\n── paleta de cores");
cores();

console.log("\n── regra de pagamento");
pagamento();

console.log("\n── esquema do banco");
esquema();

console.log("\n── locais (validação e persistência)");
await locais();

console.log("\n── plantões (horários, conflitos, contas da agenda)");
plantoes();

console.log("\n── plantões no banco (migração, integridade, consultas)");
await plantoesDb();

console.log("\n── recorrência (datas de cada escala)");
recorrencia();

console.log("\n── escalas no banco (criar, editar, excluir, falhas no meio)");
await seriesDb();

process.exit(report() ? 0 : 1);
