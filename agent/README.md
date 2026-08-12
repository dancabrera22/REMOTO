# remoto-agent

Entrega mouse e teclado a uma sessão do [REMOTO](../README.md).

```bash
npx remoto-agent
```

Um código de 6 caracteres aparece no terminal. Digite-o na aba do REMOTO, em
**Agente local → Ativar**. Pronto: quem você autorizar na sessão passa a
controlar o computador.

## Por que isso existe

O navegador não pode mover o mouse nem digitar no sistema operacional. Não é
uma API faltando — é o sandbox funcionando: se uma página web pudesse fazer
isso, qualquer site aberto numa aba assumiria a máquina.

Então alguém precisa executar código fora do sandbox. Este agente é a menor
peça possível que resolve isso.

## O que ele faz e o que não faz

| Faz | Não faz |
| --- | --- |
| Escuta em `127.0.0.1` numa porta alta | Não abre porta na rede local nem na internet |
| Aceita eventos só depois do pareamento por código | Não aceita conexão de página não pareada |
| Aplica mouse/teclado com APIs nativas do SO | Não instala nada, não cria serviço, não escreve no registro |
| Encerra quando você fecha o terminal | Não inicia com o sistema, não roda em segundo plano |
| Solta todas as teclas ao sair | Não fala com servidor nenhum — nem com o do REMOTO |

O agente nunca vê a rede: quem conversa com ele é a aba do navegador que está
na sua própria máquina, pelo loopback.

## Como cada sistema é controlado

| Sistema | Mecanismo | Requisito |
| --- | --- | --- |
| Windows | `user32.dll` (`SetCursorPos`, `SendInput`) via PowerShell | nenhum |
| macOS | CoreGraphics via `osascript -l JavaScript` | permissão de **Acessibilidade** para o app do terminal |
| Linux (X11) | `xdotool` em modo stdin | `sudo apt install xdotool` |
| Linux (Wayland) | parcial — só aplicativos XWayland | sessão X11 é o caminho confiável |

Em todos os casos o processo auxiliar fica **vivo** lendo comandos do stdin.
Subir um processo por evento custaria 100–300 ms por clique e tornaria o
controle inutilizável.

## Opções

```
--port=45789          porta fixa no loopback (padrão: primeira livre de 45789–45793)
--origin=https://...  aceita apenas essa origem
--quiet               menos mensagens
```

## Limites conhecidos

- **Ctrl+Alt+Del no Windows** é a *Secure Attention Sequence*: por design, nenhum
  processo em modo usuário consegue simulá-la. Requer a política
  `SoftwareSASGeneration` habilitada e um processo com privilégio.
- **Safari** bloqueia requisições de página HTTPS para `http://127.0.0.1`. Use
  Chrome, Edge ou Firefox no computador que será controlado.
- **Wayland** isola a injeção de entrada por design. Uma sessão X11 (ou
  `ydotool` com o daemon configurado) é o caminho previsível.

## Revogar o acesso

Feche o terminal (`Ctrl+C`) — o agente solta todas as teclas pressionadas e
some. Para trocar o código sem encerrar, use o botão **Desconectar agente** na
aba do REMOTO.
