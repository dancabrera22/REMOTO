# Meu Plantão

Agenda de plantões com controle de valores e previsão de quando o dinheiro
entra. App Android, construído com Expo (React Native).

Tudo fica no próprio aparelho, num banco SQLite. Sem servidor, sem conta para
criar, sem mensalidade — nem valores, nem locais, nem a sua escala saem do
celular.

> **Etapa 4 de 7 — Recorrência.** Cadastre a escala fixa uma vez («toda
> quarta», «12×36», «dia 15 de cada mês») e ela se repete sozinha na agenda.
> Editar ou excluir pergunta se vale só para aquele plantão, para ele e os
> próximos, ou para todos — e mostra quantos serão atingidos. O que você já
> trabalhou ou recebeu nunca é apagado por uma edição em série. Cada plantão
> pode ser marcado como **pago**; o resumo do mês separa o já recebido do a
> receber. Na agenda, **deslize o calendário** para trocar de mês e **deslize o
> cartão para a esquerda** para excluir, ou **segure o dedo num dia** para incluir
> um plantão ali. Dá para cadastrar um local direto da agenda (botão **Local**)
> ou do formulário de plantão (o círculo com **+** ao lado dos locais): ao voltar,
> o local novo já vem escolhido e o resto do formulário continua como estava. O
> estado de cada etapa está dentro do app, em **Ajustes**.

---

## Instalar no celular

### Pelo APK (o jeito simples)

1. Baixe o arquivo `.apk` no próprio celular.
2. Abra-o. O Android vai pedir para permitir a instalação de **apps desconhecidos**
   para o aplicativo que você usou para abrir (Arquivos, Chrome…): permita.
3. Se o Google Play Protect avisar que o app não é conhecido, é esperado — ele é
   seu, não está na Play Store. Escolha *Instalar mesmo assim*.

As versões novas instalam **por cima** da anterior e **mantêm seus dados**,
porque todas são assinadas com a mesma chave. O banco se atualiza sozinho.

Para gerar o APK a partir do código (precisa de Node, JDK e ~6 GB livres):

```bash
scripts/build-apk.sh        # sai em dist/meu-plantao-<versao>.apk
```

O script compila a partir do **último commit**, baixa o Android SDK sozinho na
primeira vez e repete automaticamente quando o Maven Central responde 429. Só
gera arm64 (celulares atuais); para emulador x86: `ARQS=arm64-v8a,x86_64`.

### Pelo Expo Go (para desenvolver)

Instale o **Expo Go** ([Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)) e:

```bash
npm install
npx expo start
```

Aponte a câmera para o QR code. Celular e computador na mesma rede Wi-Fi; se não
estiverem, `npx expo start --tunnel`.

---

## As 7 etapas

| | Etapa | O que entrega |
| --- | --- | --- |
| ✅ | **1. Fundação** | abas, banco com migrações, tema claro/escuro, agenda mensal navegável |
| ✅ | **2. Locais** | cadastro com cor, valor padrão, regra de pagamento e descontos; arquivar e restaurar |
| ✅ | **3. Plantões** | lançar, editar e excluir; noturno e 24 h; pontinho por local; conflito de horário; resumo do mês |
| ✅ | **4. Recorrência** | escala fixa (semanal, ciclo 12×36 / 24×72, mensal) com exceções; só este / próximos / todos; marcar como pago; deslizar para navegar e excluir |
| | 5. Financeiro | previsão de recebimento, a receber, baixa de pagamento |
| | 6. Google Calendar | o plantão aparece no calendário do celular |
| | 7. APK e backup | instalável, com exportação e restauração |

---

## Três decisões que moldam o resto

**Dinheiro em centavos inteiros.** Valor de plantão entra em soma, rateio por
hora e desconto percentual. Em ponto flutuante, cem parcelas de R$ 0,07 fecham
em R$ 6,999999 — e num app de dinheiro isso destrói a confiança. Centavo
inteiro não tem esse problema, e há teste provando.

**A regra de pagamento mora no local, não no plantão.** É o que torna possível
responder "quando eu vou receber" sem digitar nada a mais: cada local guarda se
paga no dia fixo do mês seguinte, N dias após o plantão, ou por fechamento
(fecha dia X, paga dia Y), além dos descontos de IR, ISS ou cooperativa. O
plantão só diz onde e quando foi; a data do dinheiro sai do local.

O esquema dessa regra já está na primeira migração — a Etapa 5 só precisa ler.

**O valor é copiado para dentro de cada plantão.** No lançamento, o plantão
guarda o valor bruto e o desconto do local *naquele momento*, em vez de ler o
local depois. Reajustar o valor de um hospital em janeiro não pode mudar
sozinho o que você já lançou em dezembro — há teste provando. Também por isso o
plantão pode ter um valor diferente do padrão do local (um plantão extra, uma
troca com adicional) sem tocar no cadastro.

---

## Estrutura

```
src/
  app/                   rotas (expo-router)
    _layout.tsx          tema + banco + splash
    (tabs)/              Agenda · Locais · Financeiro · Ajustes
  components/
    ui.tsx               Txt, Card, Button, Pill, Row, EmptyState
    screen.tsx           moldura com área segura e cabeçalho
    calendario-mes.tsx   grade mensal e DiaCelula (o pontinho colorido)
    form.tsx             campos, segmentado e seletor de cor
  db/
    migrations.ts        SQL puro, sem import de React Native
    locais.ts            CRUD de locais sobre a interface Executor
    client.ts            abertura + migração por PRAGMA user_version
    provider.tsx         contexto, consultas e invalidação
  lib/
    money.ts             centavos, formatação e leitura de pt-BR
    datetime.ts          datas pt-BR, grade do mês, virada de madrugada
    pagamento.ts         regra de pagamento: quando cada plantão cai na conta
    locais.ts            modelo, validação e cor sugerida
  theme/                 cores, espaçamento, tipografia
tests/                   suíte sem emulador — ver abaixo
```

---

## Testes

```bash
npm test            # 635 verificações, sem emulador, sem servidor
npm run typecheck
```

O que a suíte rápida cobre:

| Arquivo | Prova |
| --- | --- |
| `logica.mjs` | dinheiro em centavos, formatação pt-BR, datas, grade do mês |
| `cores.mjs` | a paleta: contraste ≥ 3:1 nos dois temas e distância mínima entre qualquer par |
| `pagamento.mjs` | a regra de pagamento, com bordas de calendário (dia 31 em fevereiro, virada de ano, bissexto, fim de semana, último dia do ciclo) |
| `esquema.mjs` | as migrações num SQLite real (`node:sqlite`): colunas, padrões, restrições |
| `locais.mjs` | validação, cor sugerida e persistência — os **mesmos comandos SQL** do app |
| `plantoes.mjs` | horários (noturno, 24 h, virada de mês e de ano), conflito, marcadores do calendário e soma do mês |
| `plantoes-db.mjs` | a migração **de quem já tem dados da Etapa 2**, integridade (chave estrangeira, CHECKs), consultas por período |
| `recorrencia.mjs` | as datas de cada tipo de escala (semanal, a cada N dias, mensal), com bordas: semana que cruza o mês, dia 31, ano bissexto, escala que começa no meio |
| `series-db.mjs` | criar, estender, editar e excluir escalas no SQLite; o que **nunca** pode se perder (realizado, pago, ajustado à mão); e **falha injetada em cada passo** de cada operação para provar que nada fica pela metade |

A regra de pagamento e a lógica de plantões passaram por **teste de mutação**:
quebrei o código de propósito (trocar `<=` por `<`, tirar o ajuste de dia 31,
fazer o cancelado contar no valor…) — 8 mutações na regra de pagamento, 18 em
plantões, 19 em recorrência, 38 nas escalas do banco e 7 em pagamento/exclusão,
todas detectadas. As que sobreviveram mostraram lacunas: ou um caso sem teste
(que ganhou teste) ou código redundante (que foi removido).

### Testando a interface

O app roda no navegador (`react-native-web`) e o `expo-sqlite` roda sobre
WebAssembly — as **mesmas migrações e o mesmo SQL** do celular, com motor
diferente. Isso permite testar o fluxo inteiro, sem simulação:

```bash
npx expo start --web --port 8081     # num terminal
npm run test:fluxo                   # noutro: locais — cadastra, edita, arquiva, restaura, recarrega
npm run test:plantoes                # noutro: plantões — a cor chegando ao pontinho, conflito, cancelar, excluir
npm run test:escalas                 # noutro: escalas, pagamento e gestos (com toques de dedo de verdade)
npm run test:atalhos                 # noutro: botão Local, o «+» do formulário, segurar o dia
npm run test:telas                   # retratos das quatro abas nos dois temas
```

`test:fluxo` percorre 45 verificações pela interface — validação do formulário,
a cor escolhida chegando ao pontinho, aviso de cor repetida, edição, arquivar com
confirmação, restaurar e os dados sobrevivendo a recarregar a página. As imagens
ficam em `tests/telas/`. A configuração do Metro que habilita o SQLite na web
(`metro.config.js`) vale só para o servidor de desenvolvimento; no Android o
SQLite é nativo.

### O que os testes não cobrem

Rodam em Linux, sobre `react-native-web`. O comportamento no Android de
verdade — teclado sobrepondo campos, área segura, gesto de voltar, o
`expo-sqlite` nativo — só se confirma abrindo no aparelho. O que merece
atenção ao abrir o formulário no celular: se o teclado numérico cobre o campo
que você está digitando.
