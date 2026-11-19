# Meu Plantão

Agenda de plantões com controle de valores e previsão de quando o dinheiro
entra. App Android, construído com Expo (React Native).

Tudo fica no próprio aparelho, num banco SQLite. Sem servidor, sem conta para
criar, sem mensalidade — nem valores, nem locais, nem a sua escala saem do
celular.

> **Versão 1.0 — as 7 etapas estão prontas.** Agenda mensal, locais, plantões avulsos
> e escalas que se repetem, **Financeiro** (previsão, atrasados, baixa em lote, feriados),
> plantões como eventos no **calendário** do celular (com lembrete) e, na última etapa,
> **seus dados**: *Ajustes → Seus dados* gera um **backup** em arquivo (e restaura,
> conferindo tudo antes de tocar no que você tem), exporta uma **planilha** que abre
> direto no Excel em português, e você escolhe o tema **claro, escuro ou do celular**.
> O app só pede acesso ao **calendário** — nada de internet. Para publicar na Play
> Store, veja o [PUBLICAR.md](PUBLICAR.md).
>
> **Unidades (1.1).** O *local* é a rede ou o hospital — nome e cor, e como você recebe
> (prazo e desconto). A *unidade* é o nome que você dá ao plantão dentro dele («Itaim»,
> «Central») e cada unidade tem o **próprio valor**: ao lançar, o app sugere as unidades
> que você já usou naquele local e preenche o último valor delas.

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

> Esses APKs usam uma **chave de teste**. Ao passar para a **sua** chave (para publicar),
> o Android exige desinstalar antes — **faça o backup** em *Ajustes → Seus dados* e
> restaure depois. Está tudo explicado no [PUBLICAR.md](PUBLICAR.md).

Para gerar o APK a partir do código (precisa de Node, JDK e ~6 GB livres):

```bash
scripts/build-apk.sh        # sai em dist/meu-plantao-<versao>.apk
```

O script compila a partir do **último commit**, baixa o Android SDK sozinho na
primeira vez e repete automaticamente quando o Maven Central responde 429. Só
gera arm64 (celulares atuais); para emulador x86: `ARQS=arm64-v8a,x86_64`.

Para assinar com a **sua** chave e gerar o pacote da Play Store (`.aab`):

```bash
scripts/cria-chave.sh                    # uma vez; a chave fica fora do projeto
MEU_PLANTAO_KEYSTORE=~/meu-plantao-chave/meu-plantao.jks MEU_PLANTAO_KEY_ALIAS=meu-plantao \
MEU_PLANTAO_KEYSTORE_PASSWORD='...' FORMATO=ambos scripts/build-apk.sh
```

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
| ✅ | **5. Financeiro** | previsão por mês e por local, atrasados, baixa em lote, feriados nacionais |
| ✅ | **6. Google Calendar** | o plantão vira evento no calendário do celular (e no Google, pela conta do aparelho), com lembrete; acompanha as mudanças |
| ✅ | **7. Dados e publicação** | backup e restauração em arquivo, planilha (CSV), tema claro/escuro/do celular, ícone e abertura definitivos, só as permissões do calendário, assinatura própria e pacote `.aab` |

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

**O valor é do plantão, não do local.** O plantão guarda o próprio valor bruto e o
desconto *daquele momento*, em vez de ler o local depois. Reajustar o valor de uma
unidade em janeiro não pode mudar sozinho o que você já lançou em dezembro — há
teste provando. Por isso cada unidade da mesma rede pode valer o que valer (e um
plantão extra, uma troca com adicional, também) sem tocar no cadastro do local; o
valor padrão do local é só uma sugestão, e opcional. Ao lançar, a ordem da
sugestão é: o último valor *daquela unidade na mesma duração* (12 h e 24 h valem
diferente), o último dela de outra duração (a tela avisa), o padrão do local.

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
  theme/                 cores, espaçamento, tipografia, escolha do tema
scripts/
  build-apk.sh           APK/AAB a partir do último commit (chave de teste ou a sua)
  cria-chave.sh          cria a sua chave de assinatura, fora do projeto
  gera-icones.mjs        desenha e exporta o ícone, a abertura e as imagens da loja
assets/design/           os desenhos em SVG e as imagens da Play Store
tests/                   suíte sem emulador — ver abaixo
```

---

## Testes

```bash
npm test            # 1340 verificações, sem emulador, sem servidor
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
| `feriados.mjs` | Páscoa de 1981 a 2076 (inclusive os anos em que o algoritmo precisa de correção), feriados fixos e móveis, Consciência Negra só a partir de 2024, e o efeito na data de recebimento (sábado de Carnaval, Natal de sexta…) |
| `financeiro.mjs` | a situação de cada plantão (recebido, atrasado, a receber, previsto), grupos por local e dia, somas por mês — com as bordas: prazo que vence hoje, virada de mês, regra incompleta |
| `financeiro-db.mjs` | a consulta com a regra do local, a baixa em lote (não paga cancelado, não sobrescreve quem já recebeu, mil de uma vez) e **falha injetada em cada lote** |
| `calendario.mjs` | o que um plantão vira como evento (título, local, notas, lembrete), quando o valor aparece (só se pedido), a assinatura que decide se há o que atualizar, a janela de datas e a leitura da configuração (inclusive texto estragado) |
| `calendario-db.mjs` | a sincronização contra um **calendário falso**: criar, atualizar só o que mudou, remover, refazer o que a pessoa apagou no calendário, trocar de calendário, desconectar com e sem remover, nunca duas rodadas ao mesmo tempo — e **falha injetada em cada escrita** (a rodada seguinte sempre termina o serviço, sem duplicar) |
| `backup.mjs` | o arquivo de backup: formato versionado, e a **validação** — o que for estranho (JSON quebrado, versão futura, referência a local que não existe, escala duplicada, valor negativo, fim antes do início…) é recusado com a explicação, antes de tocar em qualquer dado |
| `backup-db.mjs` | fazer e restaurar backup no SQLite: tudo ou nada (**falha injetada em cada escrita** — o que você tinha continua lá), restaurar em cima de dados e ida-e-volta idêntica, mais de mil plantões (o SQLite limita 999 variáveis por comando), coluna de versão futura que não vaza |
| `exportacao.mjs` | a planilha: `;` e vírgula decimal (Excel em português), BOM, acentos, aspas e quebra de linha nas observações, proteção contra fórmula (`=`, `+`, `-`, `@` no começo de uma célula), filtro por ano |
| `tema.mjs` | a escolha do tema e o que acontece com valor estragado no banco |
| `unidades.mjs` | o nome da unidade (espaços, limite de 60, grafias que contam como a mesma: «Itaim», «ITAIM», «São Luís»/«sao luis»), o título «Itaim · Rede D'Or», as sugestões por local e o valor que o formulário propõe (mesma duração, outra duração, padrão do local, nada) |
| `unidades-db.mjs` | a migração **de um banco já com dados** (nada some, tudo continua sem unidade), gravar e ler, as sugestões (cancelado não conta, vale o mais recente, mesmo com mais de 500 plantões) e as escalas: a unidade vai para cada plantão, uma edição em escala **não** sobrescreve o que você ajustou à mão nem o já realizado, e «este e os próximos» divide em duas |
| `series-db.mjs` | criar, estender, editar e excluir escalas no SQLite; o que **nunca** pode se perder (realizado, pago, ajustado à mão); e **falha injetada em cada passo** de cada operação para provar que nada fica pela metade |

A regra de pagamento e a lógica de plantões passaram por **teste de mutação**:
quebrei o código de propósito (trocar `<=` por `<`, tirar o ajuste de dia 31,
fazer o cancelado contar no valor…) — 8 mutações na regra de pagamento, 18 em
plantões, 19 em recorrência, 38 nas escalas do banco, 7 em pagamento/exclusão,
18 em feriados, 25 no motor financeiro, 16 na baixa em lote, 33 na sincronização do
calendário, 20 no conteúdo do evento, 50 no backup, 34 na planilha e 8 no deslizar suave (altura, destaque, legenda, esmaecer, lista, e o mesmo no Financeiro) e 45 na unidade (nome, sugestões, valor proposto, banco, escalas, backup, planilha, calendário, Financeiro), todas detectadas. As que sobreviveram mostraram lacunas: ou um caso sem teste
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
npm run test:financeiro              # noutro: atrasados, baixa parcial e em lote, desfazer, navegar entre meses
npm run test:deslizar                # noutro: o calendário acompanha o dedo (medido com o dedo ainda apoiado)
npm run test:dados                   # noutro: backup baixado de verdade, restaurar (e desfazer), planilha, tema
npm run test:suave                   # noutro: a troca de mês grava a tela quadro a quadro e procura pulos e "piscadas"
npm run test:unidades                # noutro: local sem valor, unidades diferentes na mesma rede, valor preenchido, Financeiro, escala
```

`test:calendario` precisa do servidor iniciado com um calendário falso (o navegador não
tem calendário de verdade):

```bash
EXPO_PUBLIC_CALENDARIO_FALSO=1 npx expo start --web --port 8081
npm run test:calendario              # conectar, trocar, parar, permissão negada, calendário que sumiu
```

```bash
npm run test:telas                   # retratos das quatro abas nos dois temas
```

`test:suave` não olha só o resultado: grava a tela **a cada quadro** enquanto o mês é arrastado e
assenta, e falha se o conteúdo de baixo der um salto (mês de 5 para 6 semanas = 56 px), se o dia
selecionado só aparecer depois de assentar, se a legenda «voltar para hoje» empurrar o título ou se a
lista do dia trocar sem esmaecer. No Financeiro, onde o mês não acompanha o dedo, ele confere que o conteúdo novo entra
esmaecido e que a lista muda de altura deslizando. Ele acha sozinho dois meses seguidos com número de semanas diferente,
então não depende da data de hoje.

`test:dados` baixa o arquivo de backup e a planilha de verdade, escolhe um arquivo pelo
seletor, recusa um arquivo estragado sem mexer em nada, restaura e desfaz.

`test:fluxo` percorre 45 verificações pela interface — validação do formulário,
a cor escolhida chegando ao pontinho, aviso de cor repetida, edição, arquivar com
confirmação, restaurar e os dados sobrevivendo a recarregar a página. As imagens
ficam em `tests/telas/`. A configuração do Metro que habilita o SQLite na web
(`metro.config.js`) vale só para o servidor de desenvolvimento; no Android o
SQLite é nativo.

### O que os testes não cobrem

Rodam em Linux, sobre `react-native-web`. O comportamento no Android de
verdade — teclado sobrepondo campos, área segura, gesto de voltar, o
`expo-sqlite` nativo, **o calendário do aparelho** (o pedido de permissão, os
eventos aparecendo no Google Calendar, o lembrete tocando) **e o compartilhamento e o
seletor de arquivos do Android** (onde o backup e a planilha vão parar, e de onde o
backup é escolhido na hora de restaurar) — só se confirma abrindo no aparelho. O que merece
atenção ao abrir o formulário no celular: se o teclado numérico cobre o campo
que você está digitando.
