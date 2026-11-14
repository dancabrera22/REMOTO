const resultados = [];

export function check(nome, ok, detalhe = "") {
  resultados.push({ nome, ok });
  console.log(`${ok ? "  ok  " : " FALHA"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  return ok;
}

export function igual(nome, obtido, esperado) {
  const ok = Object.is(obtido, esperado);
  return check(nome, ok, ok ? String(obtido) : `esperado ${esperado}, obtido ${obtido}`);
}

export function report() {
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  return falhas.length === 0;
}
