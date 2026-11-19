/**
 * Exportacao para planilha (CSV).
 *
 * Feito para abrir direto no Excel e no Google Planilhas do Brasil: separador
 * ponto e virgula, decimal com virgula, datas dd/mm/aaaa, acentos (UTF-8 com BOM)
 * e linhas terminadas em CRLF. Dinheiro sai como numero puro (1234,56), sem "R$"
 * nem ponto de milhar, para a planilha somar.
 *
 * Funcoes puras, sem banco. A leitura dos dados esta em `db/exportacao.ts`.
 */
import { diasSemanaCurto, formatData, formatHora, minutosEntre } from "./datetime.ts";
import { calculaDataRecebimento, type RegraPagamento } from "./pagamento.ts";
import { contaNoValor, liquidoDoPlantao, ROTULO_STATUS, type StatusPlantao } from "./plantoes.ts";

export interface LinhaExportacao {
  inicio: number;
  fim: number;
  localNome: string;
  /** Ver `PlantaoInput.unidade`. */
  unidade?: string | null;
  status: StatusPlantao;
  valorBruto: number;
  descontoPercentual: number;
  pagoEm: number | null;
  observacao: string | null;
  emEscala: boolean;
  regra: RegraPagamento;
}

export const CABECALHO = [
  "Data",
  "Dia",
  "Início",
  "Fim",
  "Horas",
  "Local",
  "Unidade",
  "Situação",
  "Conta no valor",
  "Valor bruto",
  "Desconto (%)",
  "Valor líquido",
  "Recebimento previsto",
  "Pago em",
  "Observação",
  "Escala",
] as const;

const BOM = String.fromCharCode(0xfeff); // marca de UTF-8: sem ela o Excel nao reconhece os acentos
const SEPARADOR = ";";
const FIM_DE_LINHA = "\r\n";

/**
 * Uma celula pronta. Texto que a planilha interpretaria como FORMULA (comeca com
 * = + - @) ganha um apostrofo na frente: um nome de local ou uma observacao
 * nunca pode virar comando ao abrir o arquivo. Entre aspas se tiver separador,
 * aspas ou quebra de linha.
 */
export function celulaCsv(valor: string): string {
  let v = valor;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[;"\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** 12 -> "12", 7.5 -> "7,5", 7.25 -> "7,25": ate duas casas, sem zeros sobrando. */
function decimal(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

/** Centavos -> "1234,56". */
function dinheiro(centavos: number): string {
  return (centavos / 100).toFixed(2).replace(".", ",");
}

const dataHora = (ms: number) => `${formatData(ms)} ${formatHora(ms)}`;

export function linhaCsv(l: LinhaExportacao): string {
  const conta = contaNoValor(l.status);
  const previsto = conta ? calculaDataRecebimento(l.regra, l.inicio) : null;

  const campos = [
    formatData(l.inicio),
    diasSemanaCurto[new Date(l.inicio).getDay()]!,
    dataHora(l.inicio),
    dataHora(l.fim),
    decimal(minutosEntre(l.inicio, l.fim) / 60),
    l.localNome,
    l.unidade ?? "",
    ROTULO_STATUS[l.status],
    conta ? "Sim" : "Não",
    dinheiro(l.valorBruto),
    decimal(l.descontoPercentual),
    dinheiro(liquidoDoPlantao(l)),
    previsto === null ? "" : formatData(previsto),
    l.pagoEm === null ? "" : formatData(l.pagoEm),
    l.observacao ?? "",
    l.emEscala ? "Sim" : "Não",
  ];
  return campos.map(celulaCsv).join(SEPARADOR);
}

/** O arquivo inteiro: BOM, cabecalho e uma linha por plantao, na ordem recebida. */
export function montaCsv(linhas: readonly LinhaExportacao[]): string {
  const todas = [CABECALHO.map(celulaCsv).join(SEPARADOR), ...linhas.map(linhaCsv)];
  return BOM + todas.join(FIM_DE_LINHA) + FIM_DE_LINHA;
}

/** "meu-plantao-plantoes-2026.csv" ou "...-todos.csv". */
export function nomeDoArquivoCsv(ano: number | null): string {
  return `meu-plantao-plantoes-${ano === null ? "todos" : ano}.csv`;
}
