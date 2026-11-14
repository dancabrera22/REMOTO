/**
 * Configuracao do Metro, usada so no servidor de desenvolvimento web.
 *
 * O `expo-sqlite` roda na web sobre WebAssembly (wa-sqlite) dentro de um
 * Worker. Isso exige duas coisas que o Metro nao faz sozinho:
 *
 *  1. tratar `.wasm` como arquivo estatico, e
 *  2. responder com cabecalhos de isolamento de origem, que liberam o
 *     `SharedArrayBuffer` usado para falar com o Worker.
 *
 * Nada disso afeta o app no Android: la o SQLite e nativo. Serve para olhar e
 * testar a interface no navegador com um banco de verdade, em vez de uma
 * simulacao.
 */
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push("wasm");

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  return middleware(req, res, next);
};

module.exports = config;
