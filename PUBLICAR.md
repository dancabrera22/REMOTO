# Publicar o Meu Plantão

Este guia cobre dois caminhos, e você pode usar só o primeiro para sempre:

1. **Continuar instalando o APK por conta própria** (o que você faz hoje).
2. **Publicar na Play Store.**

Nenhum dos dois é obrigatório. O app já funciona como está.

---

## Antes de tudo: a chave de assinatura

Todo app Android é assinado com uma **chave**. O Android só deixa uma versão nova
instalar por cima de outra se as duas tiverem a **mesma** chave — é isso que
mantém seus dados nas atualizações.

Os APKs que você recebeu até agora foram assinados com uma **chave de teste**
(a "debug" do modelo do Expo), que é pública: qualquer pessoa tem uma cópia. Serve
para testar, mas **não serve para publicar** — a Play Store recusa, e quem tem a
mesma chave pública poderia, em tese, assinar um app "atualizando" o seu.

Por isso, na hora de publicar, o app passa a ser assinado com a **sua** chave. E
aqui está o ponto que dói:

> **Trocar a chave exige desinstalar o app.** O Android recusa instalar por cima
> um app assinado com outra chave ("app não instalado" / "conflito de pacote"), e
> desinstalar apaga os dados.
>
> **Faça o backup antes:** *Ajustes → Seus dados → Fazer backup*. Guarde o arquivo
> fora do celular (Drive, e-mail para você mesmo). Instale a versão nova e use
> *Restaurar*. Seus locais, plantões, escalas e valores voltam como estavam.
>
> (O que **não** vai no backup, de propósito: a conexão com o calendário — é só
> conectar de novo em *Ajustes → Calendário*. Se, ao desinstalar, os eventos
> antigos ficarem no calendário, remova-os por lá antes de reconectar, senão
> aparecem duplicados.)

Se você nunca for publicar nem trocar de chave, nada disso se aplica: continue
usando o APK de teste, e as atualizações seguem por cima como sempre.

---

## 1. Criar a sua chave

```bash
scripts/cria-chave.sh
```

Cria `~/meu-plantao-chave/meu-plantao.jks` (fora do projeto, de propósito) e pede
uma senha. Para outro lugar: `scripts/cria-chave.sh /caminho/minha.jks`.

**Guarde bem:**

- Faça **duas cópias** do arquivo e guarde a senha junto (gerenciador de senhas).
- **Nunca** coloque o arquivo nem a senha no GitHub. O `.gitignore` já barra
  `*.jks`/`*.keystore`, mas o cuidado é seu.
- Perdeu o arquivo ou a senha? Você não consegue mais *atualizar* o app instalado —
  só publicar outro, do zero. (Exceção: com a **assinatura pela Play Store**,
  abaixo, a Google guarda a chave definitiva e a sua é só uma "chave de envio",
  que dá para substituir pedindo ao suporte. É a opção mais segura.)

## 2. Gerar o app assinado

```bash
MEU_PLANTAO_KEYSTORE=~/meu-plantao-chave/meu-plantao.jks \
MEU_PLANTAO_KEY_ALIAS=meu-plantao \
MEU_PLANTAO_KEYSTORE_PASSWORD='sua-senha' \
FORMATO=ambos scripts/build-apk.sh
```

Sai em `dist/`:

- `meu-plantao-1.0.0.apk` — para instalar direto no celular;
- `meu-plantao-1.0.0.aab` — o pacote que a Play Store pede (ela gera os APKs de
  cada aparelho a partir dele).

O script confere a chave **antes** de compilar (arquivo, senha e apelido) e, no
fim, mostra com que chave assinou. Compare com a impressão digital que o
`cria-chave.sh` mostrou.

`FORMATO=apk` (o padrão) ou `FORMATO=aab` também existem. O `aab` **exige** a sua
chave.

## 3. Cada atualização

- Mude o `version` em `package.json` **e** em `app.json` (ex.: `1.0.1`) — é o
  número que a pessoa vê.
- O número interno que o Android compara (`versionCode`) o script calcula sozinho
  pela contagem de commits: sempre sobe, ninguém precisa lembrar.
- Compile **do último commit** (é assim que o script funciona): commite antes.

---

## Play Store

> Os passos e regras da Play Console mudam com frequência e eu não consigo abri-la
> daqui: trate esta parte como um roteiro do que costuma ser pedido, e confirme
> cada item na própria Play Console.

1. **Conta de desenvolvedor** (taxa única, em dólar, e verificação de identidade).
   Em https://play.google.com/console.
2. **Criar o app**: nome *Meu Plantão*, idioma português (Brasil), app gratuito.
   O código do pacote (`com.meuplantao.app`) **não pode ser trocado depois**.
3. **Assinatura pela Play Store** (recomendado): ao enviar o primeiro `.aab`, deixe
   a Google guardar a chave definitiva. Sua chave vira "chave de envio".
4. **Ficha da loja**: descrição curta e completa, capturas de tela do celular,
   ícone de 512×512 e imagem de destaque de 1024×500 (as duas estão prontas em
   `assets/design/`).
5. **Política de privacidade**: a Play exige um endereço público, porque o app pede
   acesso ao calendário. Há um texto pronto em [`PRIVACIDADE.md`](PRIVACIDADE.md) —
   publique-o numa página pública (Google Sites, Notion público, GitHub Pages de um
   repositório público) e cole o link. Leia o texto e ajuste o que não for verdade
   para você; ele descreve o app como está hoje.
6. **Segurança dos dados**: o app **não tem permissão de internet** (isso está
   verificado no APK) e não envia nada a ninguém — o formulário é "não coleta e não
   compartilha dados". O acesso ao calendário é para criar os eventos que a própria
   pessoa pediu. Responda por você, com o que for verdade.
7. **Classificação de conteúdo** e **público-alvo**: questionários rápidos; o app
   não tem conteúdo sensível e não é voltado a crianças.
8. **Teste antes de publicar**: contas pessoais novas costumam precisar de um teste
   fechado com um número mínimo de pessoas durante alguns dias antes de liberar a
   publicação. Confira a regra atual na Play Console.
9. Envie o `.aab` na faixa de teste, depois promova para produção.

**Quem já instalou o APK de teste** e depois instala pela Play Store também precisa
desinstalar antes (a chave é outra) — faça o backup, como acima.

---

## Permissões do app (conferidas no APK)

| Permissão | Para quê |
| --- | --- |
| Ler calendário | achar o calendário que você escolheu e conferir quais eventos já existem |
| Escrever no calendário | criar, atualizar e remover os eventos dos seus plantões |

Nada mais. Em particular, **sem internet**, sem armazenamento externo (o backup e
a planilha passam pelo seletor e pelo compartilhamento do Android, que não pedem
permissão), sem sobreposição de tela e sem vibração.
