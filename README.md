# Meu Plantão

Agenda de plantões com controle de valores e previsão de quando o dinheiro
entra. App Android, construído com Expo (React Native).

Tudo fica no próprio aparelho, num banco SQLite. Sem servidor, sem conta para
criar, sem mensalidade — nem valores, nem locais, nem a sua escala saem do
celular.

> **Etapa 1 de 7 — Fundação.** O app abre, navega entre as quatro abas, o banco
> migra sozinho e a agenda mensal já funciona. Lançar plantões, cadastrar
> locais e calcular recebimentos vêm nas etapas seguintes; o estado de cada uma
> aparece dentro do app, em **Ajustes**.

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
| | 2. Locais | cadastro com valor padrão, regra de pagamento e descontos |
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
    calendario-mes.tsx   grade mensal, com marcadores por local
  db/
    migrations.ts        SQL puro, sem import de React Native
    client.ts            abertura + migração por PRAGMA user_version
    provider.tsx         contexto, consultas e invalidação
  lib/
    money.ts             centavos, formatação e leitura de pt-BR
    datetime.ts          datas pt-BR, grade do mês, virada de madrugada
  theme/                 cores, espaçamento, tipografia
tests/                   suíte sem emulador — ver abaixo
```

---

## Testes

```bash
npm test          # lógica + esquema do banco  (62 verificações)
npm run typecheck
```

Sem emulador e sem aparelho. `src/db/migrations.ts` não importa nada do React
Native justamente para que o `node:sqlite` embutido no Node 22 possa aplicar as
**mesmas** migrações que rodam no celular e conferir colunas, padrões e
restrições.

Para olhar a interface:

```bash
npx expo start --web --port 8081     # num terminal
npm run test:telas                   # noutro
```

Abre as quatro abas nos dois temas num viewport de celular, salva as imagens em
`tests/telas/` e falha se houver erro de JavaScript.

### O que os testes não cobrem

Rodam em Linux, sobre `node:sqlite` e `react-native-web`. O comportamento no
Android — expo-sqlite nativo, área segura real, barra de abas do sistema —
só é confirmado abrindo no aparelho. Na web o `expo-sqlite` não resolve, e o
app mostra isso em **Ajustes** como `O banco não respondeu em 8s.` em vez de
travar na tela de abertura: o limite de tempo existe para que uma falha de
banco nunca vire um app congelado.
