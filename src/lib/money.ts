/**
 * Dinheiro em centavos, sempre.
 *
 * Valor de plantao entra em conta, soma e desconto percentual. Guardar isso em
 * ponto flutuante produz, mais cedo ou mais tarde, um total de R$ 4.799,99 onde
 * deveria estar R$ 4.800,00 — e num app de dinheiro isso destroi a confianca.
 * Inteiro de centavos nao tem esse problema.
 *
 * Nao usamos `Intl.NumberFormat`: o suporte a Intl no Hermes varia conforme a
 * plataforma e a versao, e pt-BR e previsivel o suficiente para formatarmos a
 * mao com resultado identico em todo aparelho.
 */

export type Centavos = number;

function agrupaMilhar(digitos: string): string {
  let saida = "";
  for (let i = 0; i < digitos.length; i++) {
    if (i > 0 && (digitos.length - i) % 3 === 0) saida += ".";
    saida += digitos[i];
  }
  return saida;
}

/** `123456` → "R$ 1.234,56" */
export function formatBRL(centavos: Centavos): string {
  const negativo = centavos < 0;
  const total = Math.round(Math.abs(centavos));
  const inteiros = Math.floor(total / 100);
  const resto = total % 100;
  const corpo = `${agrupaMilhar(String(inteiros))},${String(resto).padStart(2, "0")}`;
  return `${negativo ? "-" : ""}R$ ${corpo}`;
}

/** Igual a `formatBRL`, mas omite os centavos quando sao zero: "R$ 1.200". */
export function formatBRLCompacto(centavos: Centavos): string {
  return centavos % 100 === 0 ? formatBRL(centavos).replace(",00", "") : formatBRL(centavos);
}

/** Sem o prefixo, para usar ao lado de um "R$" já desenhado na tela. */
export function formatValor(centavos: Centavos): string {
  return formatBRL(centavos).replace("R$ ", "");
}

/**
 * Para campos de valor: o usuario digita somente numeros e eles entram pela
 * direita, como numa maquininha. "1", "12", "123" → R$ 0,01 · R$ 0,12 · R$ 1,23.
 *
 * Isso elimina toda a ambiguidade de ponto e virgula — ninguem precisa decidir
 * se "1.200" e mil e duzentos ou um e vinte.
 */
export function centavosDeDigitos(texto: string): Centavos {
  const digitos = texto.replace(/\D/g, "").slice(0, 11);
  return digitos ? Number(digitos) : 0;
}

/**
 * Le um valor escrito a mao, para importacao de planilha e colagem.
 * Aceita "1.234,56", "1234,56", "1234.56", "1234" e "R$ 1.234,56".
 * Devolve `null` quando nao da para ter certeza do que foi escrito.
 */
export function leValorEscrito(texto: string): Centavos | null {
  const limpo = texto.trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!limpo || !/^[\d.,]+$/.test(limpo)) return null;

  const temVirgula = limpo.includes(",");
  const temPonto = limpo.includes(".");

  let normalizado: string;
  if (temVirgula && temPonto) {
    // Convencao pt-BR: ponto agrupa milhar, virgula separa centavos.
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    normalizado = limpo.replace(",", ".");
  } else if (temPonto) {
    const partes = limpo.split(".");
    // "1234.56" e decimal; "1.234" e milhar. Dois digitos finais decidem.
    normalizado = partes.length === 2 && partes[1].length === 2 ? limpo : limpo.replace(/\./g, "");
  } else {
    normalizado = limpo;
  }

  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

/** Aplica um desconto percentual (ex.: 11 para 11%) devolvendo o liquido. */
export function aplicaDesconto(centavos: Centavos, percentual: number): Centavos {
  if (!percentual) return centavos;
  const fator = 1 - Math.min(Math.max(percentual, 0), 100) / 100;
  return Math.round(centavos * fator);
}

/** Valor de um plantao cobrado por hora, com minutos proporcionais. */
export function valorPorHora(valorHoraCentavos: Centavos, minutos: number): Centavos {
  return Math.round((valorHoraCentavos * minutos) / 60);
}
