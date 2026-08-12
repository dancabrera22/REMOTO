# Testes

Sem framework: cada arquivo é um script Node que imprime verificações e sai
com código diferente de zero se alguma falhar. Todos exercitam o sistema de
verdade — servidor real, WebRTC real, navegadores reais, cursor real.

```bash
npm run build
npm start -- -p 3210      # em outro terminal
npm test
```

| Arquivo | O que prova | Precisa de |
| --- | --- | --- |
| `signaling.mjs` | Criação de sessão, PIN errado indistinguível de código inexistente, token forjado recusado, SSE em ordem, cursor retomando sem perder mensagem, payload que o servidor não consegue ler | servidor |
| `sessao.mjs` | Dois navegadores negociam, autorização do anfitrião, DataChannel aberto nos dois sentidos, chat, caminho ICE, saída limpa | servidor + Chromium |
| `arquivos.mjs` | 12 MiB pelo DataChannel com contrapressão, aceite explícito, integridade SHA-256 no destino, recusa informada ao remetente | servidor + Chromium |
| `agente.mjs` | Pareamento por código, recusa sem token, cabeçalho de Private Network Access, mapeamento de coordenada normalizada para pixel real, revogação | X11 + `xdotool` |
| `controle.mjs` | O laço inteiro: tela compartilhada → vídeo no visualizante → controle concedido → **o cursor do sistema se move** → revogar interrompe | tudo acima |

## Ambiente gráfico

`agente.mjs` e `controle.mjs` injetam entrada no sistema. Em contêiner, suba
**duas** telas virtuais:

```bash
Xvfb :98 -screen 0 1920x1080x24 &   # a máquina controlada (agente)
Xvfb :99 -screen 0 1920x1080x24 &   # a máquina de quem controla (navegadores)
export DISPLAY=:99
```

Duas e não uma por um motivo concreto. Com tudo na mesma tela, o teste entra
em realimentação: o agente move o cursor físico, o cursor passa por baixo da
janela do visualizante, o navegador emite um `pointermove` legítimo, que volta
ao agente, que move o cursor de novo — e o cursor converge para um ponto fixo
que não é o pedido. Não é defeito do produto; é o cenário de controlar a
própria máquina. Duas telas modelam as duas máquinas reais e o laço some.

Numa máquina com sessão gráfica de verdade, o mesmo vale: rode o agente numa
máquina e os navegadores em outra, ou aceite que o cursor vai brigar consigo
mesmo.

`controle.mjs` tenta a captura de tela real e, se o ambiente não permitir
(comum em contêiner: o Chromium devolve `NotReadableError`), segue com um
canvas 1920×1080 que produz um `MediaStream` de verdade. Todo o restante do
caminho continua sendo código de produção.

## Chromium

Os testes procuram o executável em `REMOTO_CHROMIUM`, depois na pasta do
Playwright (`PLAYWRIGHT_BROWSERS_PATH`) e por fim nos caminhos usuais do
sistema.

```bash
REMOTO_CHROMIUM=/usr/bin/chromium npm run test:sessao
```
