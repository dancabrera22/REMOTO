#!/usr/bin/env node
/**
 * Empacota o agente em um arquivo unico: `public/agente.mjs`.
 *
 * O agente e escrito em varios modulos porque assim se le melhor, mas quem
 * vai executa-lo esta do outro lado de uma ligacao de suporte e nao vai
 * clonar repositorio. Um arquivo so, baixado da propria implantacao, e a
 * diferenca entre "roda isso" e "instala isso".
 *
 * Os auxiliares de plataforma (mac-helper.js, win-helper.ps1) viajam em
 * base64 dentro do bundle e sao gravados em pasta temporaria no arranque.
 *
 * Roda sozinho no `prebuild`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AGENT = path.join(ROOT, "agent");
const OUT = path.join(ROOT, "public", "agente.mjs");

/** Ordem importa: cada modulo so pode usar o que ja foi concatenado. */
const MODULES = ["keymap.mjs", "backends.mjs", "remoto-agent.mjs"];
const EMBEDDED = ["mac-helper.js", "win-helper.ps1"];

const IMPORT_LINE = /^import\s+(.+?)\s+from\s+"([^"]+)";?\s*$/;

/** Junta os `import` de modulos nativos de todos os arquivos, sem repetir. */
const builtins = new Map(); // especificador -> { default: string|null, named: Set }

function collect(spec, clause) {
  if (!builtins.has(spec)) builtins.set(spec, { default: null, named: new Set() });
  const entry = builtins.get(spec);
  const named = /\{([^}]*)\}/.exec(clause);
  if (named) {
    for (const name of named[1].split(",").map((s) => s.trim()).filter(Boolean)) entry.named.add(name);
  }
  const bare = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
  if (bare) {
    if (entry.default && entry.default !== bare) {
      throw new Error(`Dois nomes padrao para ${spec}: ${entry.default} e ${bare}`);
    }
    entry.default = bare;
  }
}

const bodies = [];

for (const file of MODULES) {
  const source = fs.readFileSync(path.join(AGENT, file), "utf8");
  const kept = [];

  for (const line of source.split("\n")) {
    const match = IMPORT_LINE.exec(line);
    if (match) {
      const [, clause, spec] = match;
      if (spec.startsWith("node:")) {
        collect(spec, clause);
      } else if (!spec.startsWith("./")) {
        throw new Error(`Import externo inesperado em ${file}: ${spec}. O agente precisa ficar sem dependencias.`);
      }
      // imports locais somem: o modulo vizinho ja esta no mesmo arquivo
      continue;
    }
    kept.push(line);
  }

  bodies.push(
    `/* ${"=".repeat(66)}\n   ${file}\n   ${"=".repeat(66)} */\n\n` +
      kept
        .join("\n")
        .replace(/^export (const|let|function|async function|class) /gm, "$1 ")
        .replace(/^#!.*\n/, "")
        .trim(),
  );
}

const imports = [...builtins.entries()]
  .map(([spec, { default: def, named }]) => {
    const clause = [def, named.size ? `{ ${[...named].sort().join(", ")} }` : null].filter(Boolean).join(", ");
    return `import ${clause} from "${spec}";`;
  })
  .sort()
  .join("\n");

const payload = Object.fromEntries(
  EMBEDDED.map((name) => [name, fs.readFileSync(path.join(AGENT, name)).toString("base64")]),
);

const banner = `#!/usr/bin/env node
/**
 * REMOTO — agente local (arquivo unico, gerado por scripts/build-agent.mjs).
 *
 * Nao edite aqui: mexa em agent/ e rode \`npm run build:agent\`.
 *
 *   node agente.mjs
 *
 * Nao instala nada, nao pede administrador, nao abre porta na rede — escuta
 * apenas em 127.0.0.1 e encerra quando voce fechar esta janela.
 */
`;

const embedded = `\n// Auxiliares de plataforma embutidos; gravados em pasta temporaria no arranque.\nglobalThis.__REMOTO_EMBEDDED__ = ${JSON.stringify(payload)};\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, [banner, imports, embedded, ...bodies].join("\n") + "\n");

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`agente empacotado: public/agente.mjs (${kb} KB)`);
