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
import { testes as esquema } from "./esquema.mjs";
import { testes as logica } from "./logica.mjs";

console.log("\n── lógica (dinheiro e datas)");
logica();

console.log("\n── esquema do banco");
esquema();

process.exit(report() ? 0 : 1);
