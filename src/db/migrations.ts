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
  {
    versao: 2,
    descricao: "plantoes: o que foi (ou sera) trabalhado, com valor e situacao",
    sql: `
      CREATE TABLE plantoes (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,

        -- Nunca apagamos locais (so arquivamos), entao a referencia nunca fica
        -- orfa; e o banco impede apontar para um local que nao existe.
        local_id            INTEGER NOT NULL REFERENCES locais (id),

        -- Instantes em milissegundos (epoch). O dia de calendario do plantao e o
        -- dia em que ele COMECA: um noturno 19h-07h pertence ao dia da entrada.
        inicio              INTEGER NOT NULL,
        fim                 INTEGER NOT NULL,

        -- Valor e desconto sao COPIADOS do local no momento do lancamento, nao
        -- lidos dele depois. Reajustar o valor de um hospital em janeiro nao
        -- pode mudar sozinho o que voce ja lancou em dezembro.
        valor_bruto         INTEGER NOT NULL DEFAULT 0
                            CHECK (valor_bruto >= 0),
        desconto_percentual REAL    NOT NULL DEFAULT 0
                            CHECK (desconto_percentual >= 0 AND desconto_percentual <= 100),

        status              TEXT    NOT NULL DEFAULT 'agendado'
                            CHECK (status IN ('agendado', 'realizado', 'cancelado', 'trocado')),
        observacao          TEXT,

        criado_em           INTEGER NOT NULL,
        atualizado_em       INTEGER NOT NULL,

        CHECK (fim > inicio)
      );

      -- A agenda busca por intervalo de tempo (o mes na tela).
      CREATE INDEX idx_plantoes_inicio ON plantoes (inicio);
      CREATE INDEX idx_plantoes_local  ON plantoes (local_id, inicio);
    `,
  },
  {
    versao: 3,
    descricao: "series: escalas que se repetem, materializadas em plantoes",
    sql: `
      -- Uma serie e a REGRA de repeticao mais o MODELO de cada plantao. Os plantoes
      -- em si continuam na tabela plantoes: a agenda, as somas e (adiante) os
      -- recebimentos leem uma tabela so, sem saber o que e escala e o que e avulso.
      CREATE TABLE series (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id            INTEGER NOT NULL REFERENCES locais (id),

        -- repeticao
        tipo                TEXT    NOT NULL CHECK (tipo IN ('semanal', 'intervalo', 'mensal')),
        dias_semana         INTEGER NOT NULL DEFAULT 0 CHECK (dias_semana >= 0 AND dias_semana <= 127),
        cada                INTEGER NOT NULL DEFAULT 1 CHECK (cada >= 1 AND cada <= 60),
        dia_do_mes          INTEGER CHECK (dia_do_mes IS NULL OR (dia_do_mes >= 1 AND dia_do_mes <= 31)),
        inicio_dia          INTEGER NOT NULL,
        fim_dia             INTEGER,

        -- modelo do plantao (entrada e saida em minutos desde a meia-noite;
        -- saida <= entrada quer dizer que termina no dia seguinte)
        inicio_min          INTEGER NOT NULL CHECK (inicio_min >= 0 AND inicio_min < 1440),
        fim_min             INTEGER NOT NULL CHECK (fim_min >= 0 AND fim_min < 1440),
        valor_bruto         INTEGER NOT NULL DEFAULT 0 CHECK (valor_bruto >= 0),
        desconto_percentual REAL    NOT NULL DEFAULT 0
                            CHECK (desconto_percentual >= 0 AND desconto_percentual <= 100),
        observacao          TEXT,

        -- Ate que dia as ocorrencias ja viraram plantoes. Uma escala sem data
        -- final nao pode criar plantoes ate o infinito: a agenda estende sob
        -- demanda, e este campo diz de onde continuar.
        gerado_ate          INTEGER NOT NULL DEFAULT 0,

        criado_em           INTEGER NOT NULL,
        atualizado_em       INTEGER NOT NULL
      );

      CREATE INDEX idx_series_local ON series (local_id);

      -- Ocorrencias que o usuario EXCLUIU de uma escala. Sem este registro a
      -- agenda recriaria o plantao na proxima vez que estendesse o calendario.
      CREATE TABLE series_puladas (
        serie_id        INTEGER NOT NULL REFERENCES series (id),
        ocorrencia_dia  INTEGER NOT NULL,
        PRIMARY KEY (serie_id, ocorrencia_dia)
      );

      -- serie_id: de que escala o plantao veio (NULL = avulso).
      -- ocorrencia_dia: o dia que a REGRA deu a ele. Nao muda se o plantao for
      --   movido para outra data: e a identidade dele dentro da escala.
      -- excecao: 1 se foi alterado so nele; edicoes em serie nao o sobrescrevem.
      ALTER TABLE plantoes ADD COLUMN serie_id INTEGER REFERENCES series (id);
      ALTER TABLE plantoes ADD COLUMN ocorrencia_dia INTEGER;
      ALTER TABLE plantoes ADD COLUMN excecao INTEGER NOT NULL DEFAULT 0 CHECK (excecao IN (0, 1));

      -- Quando o dinheiro deste plantao entrou (NULL = ainda nao recebeu). So um
      -- plantao realizado pode estar pago: marcar como pago ja o confirma, e
      -- voltar para cancelado/agendado limpa a data. O banco garante isso.
      ALTER TABLE plantoes ADD COLUMN pago_em INTEGER CHECK (pago_em IS NULL OR status = 'realizado');

      -- Uma ocorrencia, um plantao: e o que torna a geracao repetivel sem duplicar.
      CREATE UNIQUE INDEX idx_plantoes_ocorrencia ON plantoes (serie_id, ocorrencia_dia)
        WHERE serie_id IS NOT NULL;
    `,
  },
  {
    versao: 4,
    descricao: "configuracoes e a ligacao entre plantoes e eventos do calendario do celular",
    sql: `
      -- Chave/valor para o que e do app e nao de um plantao (calendario escolhido,
      -- lembrete...). Valor em texto; quem le sabe o formato (ver lib/calendario.ts).
      CREATE TABLE config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );

      -- Que evento do calendario do celular espelha cada plantao.
      --   assinatura: o que foi enviado ao calendario; se o plantao muda, a
      --               assinatura muda, e so entao o evento e atualizado.
      -- Sem REFERENCES de proposito: apagar um plantao nao pode ser bloqueado nem
      -- apagar esta linha sozinho — a sincronizacao precisa ver a linha sobrando
      -- para remover o evento do calendario.
      CREATE TABLE eventos_calendario (
        plantao_id      INTEGER PRIMARY KEY,
        calendario_id   TEXT    NOT NULL,
        evento_id       TEXT    NOT NULL,
        assinatura      TEXT    NOT NULL,
        sincronizado_em INTEGER NOT NULL
      );
    `,
  },
];

export const versaoEsquema = migracoes[migracoes.length - 1]!.versao;
