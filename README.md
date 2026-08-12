# REMOTO

Acesso remoto pelo navegador. Sem instalar nada em nenhuma das duas pontas
para ver a tela, conversar, sincronizar a área de transferência e trocar
arquivos; com um comando `npx` — que também não instala nada — para liberar
mouse e teclado de verdade.

A tela, o áudio e os arquivos vão **direto de um computador ao outro** por
WebRTC. O servidor só apresenta os dois lados e sai da frente. Feito para
publicar na Vercel.

---

## O problema real, dito na cara

Uma página web **não pode** mover o mouse nem digitar no sistema operacional.
Isso não é uma API que falta nem algo que se contorne com código esperto: é o
sandbox do navegador funcionando. Se qualquer página pudesse fazer isso,
qualquer aba aberta assumiria a máquina.

Então "acesso remoto 100% no navegador" só existe em dois níveis, e vale
separá-los com honestidade:

| | Sem instalar nada | Precisa de um processo local |
| --- | --- | --- |
| Ver a tela ao vivo | ✅ | |
| Áudio do sistema e microfone | ✅ | |
| Transferência de arquivos | ✅ | |
| Área de transferência nos dois sentidos | ✅ | |
| Bate-papo, ponteiro remoto, gravação | ✅ | |
| **Mover o mouse, digitar, clicar** | ❌ impossível | ✅ `npx remoto-agent` |

O `remoto-agent` é a menor peça possível que resolve o segundo nível: um
script Node de execução única, sem dependências, sem instalação, sem
privilégio de administrador, sem serviço, sem porta na rede. Escuta só em
`127.0.0.1`, exige um código de pareamento mostrado no terminal e some quando
você fecha a janela. Detalhes em [`agent/README.md`](agent/README.md).

---

## Como funciona

```
   ANFITRIÃO                        VERCEL                      VISUALIZANTE
   (compartilha)                (só apresenta)                   (assiste)

  ┌───────────┐                                                ┌───────────┐
  │  aba web  │ ── POST /api/signal ──►┌──────────┐            │  aba web  │
  │           │ ◄── SSE  /api/signal/  │  Redis   │            │           │
  │           │       stream ──────────│ (Upstash)│◄──────────►│           │
  └─────┬─────┘                        └──────────┘            └─────┬─────┘
        │                                                            │
        │        SDP e ICE cifrados com chave derivada do PIN        │
        │                                                            │
        └────────────────► WebRTC · DTLS-SRTP ◄──────────────────────┘
             vídeo · áudio · entrada · arquivos · chat · clipboard
                       (nunca passa pelo servidor)
        │
        │ HTTP no loopback, com token de pareamento
        ▼
  ┌─────────────┐
  │ remoto-agent│ ── user32 / CoreGraphics / xdotool ──► mouse e teclado
  └─────────────┘
```

Três decisões carregam o projeto:

**1. Sinalização por SSE + Redis, não por WebSocket.** A Vercel não hospeda
servidor WebSocket de longa duração. O caminho que funciona sem depender de um
serviço de terceiros para tempo real: um `GET` que devolve `text/event-stream`
e faz polling com backoff no Redis (120 ms enquanto chegam mensagens, até 3 s
quando a sessão está parada). O fluxo se encerra sozinho a cada 45 s — dentro
do limite de qualquer plano — carregando o cursor de leitura; o cliente reabre
e não perde uma mensagem sequer.

**2. Coordenadas normalizadas, teclas por posição física.** O ponteiro viaja
como fração 0–1 da área útil do vídeo (descontando o letterbox do
`object-fit: contain`), e o agente mapeia para os pixels da tela dele. As
teclas usam `KeyboardEvent.code`, nunca `key`: quem decide o que a tecla
significa é o teclado da máquina controlada, como em qualquer acesso remoto
nativo.

**3. O PIN também é chave criptográfica.** O WebRTC já cifra mídia e dados,
mas as impressões digitais do DTLS viajam dentro do SDP — que passa pelo nosso
servidor. Derivando uma chave AES-GCM do PIN (PBKDF2, 210 mil iterações) e
cifrando os payloads de sinalização, o servidor volta a ser um encaminhador de
bytes opacos. As duas telas mostram três **palavras de segurança** derivadas
dessa chave: se batem quando lidas em voz alta, ninguém se colocou no meio.

---

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`, clique em **Abrir sessão**, e em outra janela
anônima entre com o código e o PIN. Sem variáveis de ambiente, a sinalização
usa memória do processo — suficiente para desenvolvimento, inviável em
produção (veja abaixo).

Para liberar mouse e teclado, no computador compartilhado:

```bash
npm run agent      # ou, publicado: npx remoto-agent
```

---

## Publicar na Vercel

```bash
vercel
```

O build funciona sem configuração, mas **duas variáveis decidem se o produto
funciona de verdade**. Confira em `/api/health` depois de publicar: ele diz
exatamente o que está faltando.

### 1. Redis — obrigatório

Cada requisição na Vercel pode cair numa instância diferente, e duas
instâncias não compartilham memória. Sem armazenamento externo, anfitrião e
visualizante caem em processos distintos e nunca trocam SDP — o sintoma é uma
conexão que trava em "aguardando" de forma intermitente e difícil de depurar.

No painel da Vercel: **Storage → Marketplace → Upstash Redis**. A integração
injeta `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` sozinha. (Os
nomes antigos `KV_REST_API_URL`/`KV_REST_API_TOKEN` também são aceitos.)

REST e não TCP de propósito: não há pool de conexões vazando entre invocações
serverless.

### 2. TURN — fortemente recomendado

STUN resolve a maioria das redes domésticas. TURN é o que salva os 10–20%
restantes: NAT simétrico, wifi de hotel, rede corporativa com firewall. Sem
ele, essas conexões simplesmente não fecham.

Configure **um** destes blocos (veja [`.env.example`](.env.example)):

| Provedor | Variáveis |
| --- | --- |
| Cloudflare Realtime (1 TB/mês grátis) | `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` |
| Metered | `METERED_API_KEY`, `METERED_SUBDOMAIN` |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| coturn próprio (credencial temporária) | `TURN_URLS`, `TURN_SECRET` |
| coturn próprio (usuário fixo) | `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` |

As credenciais são geradas por requisição em `/api/ice` e nunca vão para o
bundle. A barra de estatísticas mostra se a conexão está **ponto-a-ponto** ou
**via TURN**.

---

## Segurança

- **Código de 9 dígitos + PIN de 6.** 10¹⁵ combinações, com limite de 12
  tentativas por minuto por código e 30 por minuto por IP.
- **Código inexistente e PIN errado dão a mesma resposta.** Um atacante não
  descobre nem quais códigos existem.
- **O anfitrião autoriza cada participante** por nome, vendo se o pedido inclui
  controle. Nada acontece antes do clique em "Permitir".
- **Controle é concedido por participante e revogável na hora** — o teste
  automatizado verifica que a entrada para de ser aplicada imediatamente.
- **Um controlador por vez.** Dois cursores disputando a mesma máquina não
  produzem nada utilizável.
- **Tokens de peer são HMAC** da chave aleatória da sessão. Não existe segredo
  global para vazar, e um token não vale para outra sessão.
- **Visualizante só fala com o anfitrião.** Quem tiver o código não consegue
  usar a sessão como canal lateral.
- **O PIN nunca chega ao servidor.** No link direto ele viaja no fragmento
  (`#123456`), que o navegador não envia. No servidor há apenas o hash.
- **O agente local** exige pareamento por código do terminal, escuta só no
  loopback, solta todas as teclas ao sair e pode ser revogado sem reiniciar.

---

## Limites conhecidos

Ditos aqui porque descobri-los na hora do suporte é pior.

- **Ctrl+Alt+Del no Windows** é a *Secure Attention Sequence*: por design,
  nenhum processo em modo usuário consegue simulá-la. O botão existe e avisa.
- **Esc, Tab e a tecla Windows/⌘** só chegam à máquina remota em tela cheia no
  Chrome ou Edge, via `keyboard.lock()`. Firefox e Safari não têm essa API.
- **Safari** bloqueia requisições de página HTTPS para `http://127.0.0.1`, o
  que impede o agente. Ver a tela funciona normalmente.
- **Wayland** isola a injeção de entrada por design; o `xdotool` só alcança
  aplicativos XWayland. Sessão X11 é o caminho previsível.
- **macOS** exige permissão de Acessibilidade para o aplicativo que iniciou o
  agente. Sem ela, o sistema descarta os eventos em silêncio.
- **Qual monitor está sendo compartilhado** o `getDisplayMedia` não informa ao
  JavaScript. Com mais de uma tela, o anfitrião escolhe num seletor para o
  cursor cair no lugar certo.
- **Controlar a própria máquina** cria realimentação: o cursor movido pelo
  agente passa por baixo da janela do visualizante e gera novos eventos. É
  inerente ao cenário, não um defeito.
- **Arquivos recebidos ficam em memória** até o fim da transferência. O teto é
  2 GB.

---

## Estrutura

```
app/
  page.tsx                início: abrir sessão ou entrar em uma
  compartilhar/           painel do anfitrião
  conectar/               visualizador
  api/
    session/              abrir, alterar, encerrar, entrar
    signal/               POST enviar · GET stream (SSE)
    ice/                  credenciais TURN por requisição
    health/               diagnóstico de implantação
lib/
  protocol.ts             todas as mensagens, dos dois canais
  crypto.ts               PBKDF2, AES-GCM, palavras de segurança
  store/                  memória (dev) e Upstash Redis (produção)
  server/auth.ts          tokens HMAC por peer, limites de tentativa
  rtc/                    negociação perfeita, canais, stats, arquivos
  input/capture.ts        eventos do navegador → protocolo
  media/capture.ts        getDisplayMedia, wake lock, gravação
  session/                máquinas de estado do anfitrião e do visualizante
  agent/client.ts         descoberta e pareamento do agente local
agent/                    o agente (zero dependências)
tests/                    suíte funcional — ver tests/README.md
```

---

## Testes

Sem framework e sem simulação do que importa: servidor real, WebRTC real, dois
Chromium reais, cursor real.

```bash
npm run build
npm start -- -p 3210     # em outro terminal
npm test
```

Cobre a sinalização (incluindo que o servidor não consegue ler o payload), a
negociação entre dois navegadores, 12 MiB pelo DataChannel com verificação
SHA-256, o agente local, e o laço completo: tela compartilhada → vídeo no
visualizante → controle concedido → **o cursor do sistema se move** → revogar
interrompe. Detalhes e requisitos em [`tests/README.md`](tests/README.md).
