# Meu Plantão

Agenda de plantões com controle de valores e previsão de quando o dinheiro
entra. App Android, construído com Expo (React Native).

Tudo fica no próprio aparelho, num banco SQLite. Sem servidor, sem conta para
criar, sem mensalidade — nem valores, nem locais, nem a sua escala saem do
celular.

> **Etapa 2 de 7 — Locais.** Dá para cadastrar, editar, arquivar e restaurar
> locais de plantão, cada um com cor, valor padrão, descontos e regra de
> pagamento — com prévia ao vivo de quanto sobra e de quando cada plantão cai
> na conta. Lançar plantões vem na Etapa 3; é só ali que o pontinho colorido
> aparece na agenda. O estado de cada etapa está dentro do app, em **Ajustes**.

---

## Ver no seu celular agora

Não precisa instalar nada no celular além do **Expo Go**
([Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent)).

```bash
npm install
npx expo start
```

Aponte a câmera para o QR code que aparece no terminal. O app abre no Expo Go.
O celular e o computador precisam estar na mesma rede Wi-Fi; se não estiverem,
use `npx expo start --tunnel`.

O APK instalável, que dispensa o Expo Go, é a Etapa 7.

---

## As 7 etapas

| | Etapa | O que entrega |
| --- | --- | --- |
| ✅ | **1. Fundação** | abas, banco com migrações, tema claro/escuro, agenda mensal navegável |
| ✅ | **2. Locais** | cadastro com cor, valor padrão, regra de pagamento e descontos; arquivar e restaurar |
| | 3. Plantões | lançar, editar e ver na agenda; plantão que vira a madrugada |
| | 4. Recorrência | escala fixa (12×36, 24×72, semanal) com exceções |
| | 5. Financeiro | previsão de recebimento, a receber, baixa de pagamento |
| | 6. Google Calendar | o plantão aparece no calendário do celular |
| | 7. APK e backup | instalável, com exportação e restauração |

---

## Duas decisões que moldam o resto

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
npm test            # 206 verificações, sem emulador, sem servidor
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

A regra de pagamento passou por **teste de mutação**: quebrei a lógica de
propósito de oito maneiras (trocar `<=` por `<`, tirar o ajuste de dia 31,
somar um dia a mais…) e a suíte detectou todas. Uma nona sobreviveu e se
mostrou código redundante, que foi removido.

### Testando a interface

O app roda no navegador (`react-native-web`) e o `expo-sqlite` roda sobre
WebAssembly — as **mesmas migrações e o mesmo SQL** do celular, com motor
diferente. Isso permite testar o fluxo inteiro, sem simulação:

```bash
npx expo start --web --port 8081     # num terminal
npm run test:fluxo                   # noutro: cadastra, edita, arquiva, restaura, recarrega
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
