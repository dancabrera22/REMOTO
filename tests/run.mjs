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
import { testes as backup } from "./backup.mjs";
import { testes as backupDb } from "./backup-db.mjs";
import { testes as exportacao } from "./exportacao.mjs";
import { testes as tema } from "./tema.mjs";
import { testes as calendario } from "./calendario.mjs";
import { testes as calendarioDb } from "./calendario-db.mjs";
import { testes as cores } from "./cores.mjs";
import { testes as esquema } from "./esquema.mjs";
import { testes as feriados } from "./feriados.mjs";
import { testes as financeiro } from "./financeiro.mjs";
import { testes as financeiroDb } from "./financeiro-db.mjs";
import { testes as locais } from "./locais.mjs";
import { testes as logica } from "./logica.mjs";
import { testes as pagamento } from "./pagamento.mjs";
import { testes as plantoes } from "./plantoes.mjs";
import { testes as plantoesDb } from "./plantoes-db.mjs";
import { testes as recorrencia } from "./recorrencia.mjs";
import { testes as seriesDb } from "./series-db.mjs";
import { testes as unidades } from "./unidades.mjs";
import { testes as unidadesDb } from "./unidades-db.mjs";
import { testes as unidadesRenomear } from "./unidades-renomear.mjs";

console.log("\n── lógica (dinheiro e datas)");
logica();

console.log("\n── paleta de cores");
cores();

console.log("\n── regra de pagamento");
pagamento();

console.log("\n── feriados e dia útil");
feriados();

console.log("\n── financeiro (situação, grupos e somas)");
financeiro();

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

console.log("\n── unidade do plantão (nome, sugestões, valor proposto)");
unidades();

console.log("\n── unidade no banco (migração, gravar, escalas)");
await unidadesDb();

console.log("\n── renomear e juntar unidades (banco, escalas, falhas)");
await unidadesRenomear();

console.log("\n── financeiro no banco (consulta, baixa em lote, falhas)");
await financeiroDb();

console.log("\n── calendário do celular (evento e sincronização)");
calendario();
await calendarioDb();

console.log("\n── backup e restauração (formato, validação, ida e volta)");
backup();
await backupDb();

console.log("\n── exportação para planilha (CSV)");
await exportacao();

console.log("\n── tema (claro, escuro ou do celular)");
await tema();

process.exit(report() ? 0 : 1);
