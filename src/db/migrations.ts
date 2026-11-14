/**
 * Migracoes do banco.
 *
 * Arquivo sem nenhum import de React Native de proposito: assim o Node consegue
 * importa-lo e rodar as mesmas migracoes contra o `node:sqlite`, o que permite
 * testar o esquema sem aparelho nem emulador (ver `tests/db.mjs`).
 *
 * Regra da casa: migracao publicada nunca e editada. Mudanca de esquema entra
 * como uma nova entrada no fim da lista.
 */

export interface Migracao {
  versao: number;
  descricao: string;
  sql: string;
}

export const migracoes: Migracao[] = [
  {
    versao: 1,
    descricao: "locais de plantao, com valor padrao e regra de pagamento",
    sql: `
      CREATE TABLE locais (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        nome                 TEXT    NOT NULL,
        apelido              TEXT,
        cor                  TEXT    NOT NULL DEFAULT '#2D7D6F',
        endereco             TEXT,
        contato              TEXT,
        observacao           TEXT,

        -- Valor padrao sugerido ao lancar um plantao neste local.
        -- 'plantao' = valor fechado; 'hora' = valor por hora, proporcional.
        modo_valor           TEXT    NOT NULL DEFAULT 'plantao'
                                     CHECK (modo_valor IN ('plantao', 'hora')),
        valor_padrao         INTEGER NOT NULL DEFAULT 0,

        -- Regra de pagamento: o que responde "quando eu vou receber".
        --   dia_mes_seguinte  paga no dia <regra_dia_pagamento> de
        --                     <regra_meses_adiante> mes(es) adiante
        --   dias_apos         paga <regra_dias_apos> dias apos o plantao
        --   fechamento        fecha no dia <regra_dia_fechamento>; o ciclo
        --                     fechado e pago no dia <regra_dia_pagamento> de
        --                     <regra_meses_adiante> mes(es) adiante
        regra_tipo           TEXT    NOT NULL DEFAULT 'dia_mes_seguinte'
                                     CHECK (regra_tipo IN ('dia_mes_seguinte', 'dias_apos', 'fechamento')),
        regra_dia_pagamento  INTEGER,
        regra_dias_apos      INTEGER,
        regra_dia_fechamento INTEGER,
        regra_meses_adiante  INTEGER NOT NULL DEFAULT 1,

        -- Quando a data cai em sabado, domingo ou feriado.
        ajuste_dia_util      TEXT    NOT NULL DEFAULT 'proximo'
                                     CHECK (ajuste_dia_util IN ('nenhum', 'proximo', 'anterior')),

        -- Retencoes do local (IR, ISS, taxa de cooperativa ou PJ) em %.
        desconto_percentual  REAL    NOT NULL DEFAULT 0
                                     CHECK (desconto_percentual >= 0 AND desconto_percentual <= 100),

        criado_em            INTEGER NOT NULL,
        atualizado_em        INTEGER NOT NULL,
        -- Local desativado some das listas sem apagar o historico de plantoes.
        arquivado_em         INTEGER
      );

      CREATE INDEX idx_locais_ativos ON locais (arquivado_em, nome);
    `,
  },
];

export const versaoEsquema = migracoes[migracoes.length - 1]!.versao;
