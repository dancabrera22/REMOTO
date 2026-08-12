"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { FilePanel } from "@/components/FilePanel";
import { RemoteScreen } from "@/components/RemoteScreen";
import { StatsBar } from "@/components/StatsBar";
import { Badge, Button, Panel, TextInput, Toggle, formatCode } from "@/components/ui";
import type { InputEvent } from "@/lib/protocol";
import { ViewerSession } from "@/lib/session/viewer";

export default function ConnectPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-ink-400">Carregando…</div>}>
      <Connect />
    </Suspense>
  );
}

function Connect() {
  const params = useSearchParams();
  const sessionRef = useRef<ViewerSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ViewerSession();
  const session = sessionRef.current;

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);

  const [code, setCode] = useState(params.get("c") ?? "");
  const [pin, setPin] = useState("");
  const [name, setName] = useState("");
  const [wantsControl, setWantsControl] = useState(true);
  const [tab, setTab] = useState<"chat" | "arquivos">("chat");

  // O PIN viaja no fragmento da URL, que o navegador nunca envia ao servidor.
  useEffect(() => {
    const fragment = location.hash.replace(/^#/, "").replace(/\D/g, "");
    if (fragment.length === 6) setPin(fragment);
    setName(localStorage.getItem("remoto.nome") || "");
  }, []);

  useEffect(() => () => session.stop(), [session]);

  const onInput = useCallback((events: InputEvent[]) => session.sendInput(events), [session]);
  const onPointer = useCallback((x: number, y: number) => session.sendPointer(x, y), [session]);
  const onNotice = useCallback((text: string) => session.notify(text), [session]);

  if (snap.phase === "inicial" || snap.phase === "entrando" || snap.phase === "erro") {
    const digits = code.replace(/\D/g, "");
    const pinDigits = pin.replace(/\D/g, "");
    const ready = digits.length === 9 && pinDigits.length === 6;

    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
        <Link href="/" className="text-sm font-semibold text-ink-200">
          REMOTO
        </Link>
        <Panel title="Entrar em uma sessao">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              localStorage.setItem("remoto.nome", name || "Visitante");
              void session.join(digits, pinDigits, name || "Visitante", wantsControl);
            }}
          >
            <TextInput
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
              placeholder="123 456 789"
              inputMode="numeric"
              aria-label="Codigo da sessao"
              className="font-mono text-lg tracking-[0.2em]"
            />
            <TextInput
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="PIN"
              inputMode="numeric"
              aria-label="PIN"
              className="font-mono tracking-[0.2em]"
            />
            <TextInput
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 40))}
              placeholder="Seu nome (aparece para o anfitriao)"
              aria-label="Seu nome"
            />
            <Toggle
              checked={wantsControl}
              onChange={setWantsControl}
              label="Pedir controle de mouse e teclado"
              hint="O anfitriao decide se concede; sem isso voce apenas assiste."
            />
            <Button type="submit" variant="primary" className="w-full" disabled={!ready || snap.phase === "entrando"}>
              {snap.phase === "entrando" ? "Entrando…" : "Conectar"}
            </Button>
            {snap.error && <p className="text-sm text-bad">{snap.error}</p>}
          </form>
        </Panel>
      </main>
    );
  }

  if (snap.phase === "aguardando" || snap.phase === "conectando") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="pulse h-3 w-3 rounded-full bg-accent" />
        <h1 className="text-lg text-ink-200">
          {snap.phase === "aguardando" ? "Aguardando o anfitriao autorizar" : "Estabelecendo conexao"}
        </h1>
        <p className="text-sm text-ink-400">
          Sessao {formatCode(code.replace(/\D/g, ""))}. A outra ponta precisa clicar em &ldquo;Permitir&rdquo;.
        </p>
        <p className="text-xs text-ink-400">
          Palavras de seguranca: <span className="font-mono text-ink-300">{snap.words}</span>
        </p>
        <Button variant="subtle" onClick={() => session.leave()}>
          Cancelar
        </Button>
      </main>
    );
  }

  if (snap.phase === "recusado" || snap.phase === "encerrado") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-lg text-ink-200">
          {snap.phase === "recusado" ? "Conexao recusada" : "Sessao encerrada"}
        </h1>
        <p className="text-sm text-ink-400">{snap.error}</p>
        <Link href="/">
          <Button variant="primary">Voltar ao inicio</Button>
        </Link>
      </main>
    );
  }

  const stopped = snap.surface?.label === "parado";

  return (
    <main className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold text-ink-200">
              REMOTO
            </Link>
            <Badge tone="good">{snap.hostName || "anfitriao"}</Badge>
            <Badge tone={snap.control ? "accent" : "neutral"}>
              {snap.control ? "controlando" : "assistindo"}
            </Badge>
            {!snap.caps?.agent && (
              <Badge tone="warn">anfitriao sem agente local — controle indisponivel</Badge>
            )}
          </div>
          <Button variant="danger" onClick={() => session.leave()}>
            Sair
          </Button>
        </header>

        {snap.controlNote && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
            {snap.controlNote}
          </div>
        )}
        {stopped && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-850 px-4 py-2 text-sm text-ink-300">
            <span>O anfitriao parou de compartilhar a tela.</span>
            <Button variant="subtle" onClick={() => session.requestReshare()}>
              Pedir para retomar
            </Button>
          </div>
        )}

        <RemoteScreen
          stream={snap.stream}
          control={snap.control}
          caps={snap.caps}
          onInput={onInput}
          onPointer={onPointer}
          onNotice={onNotice}
        />
      </div>

      <aside className="space-y-4">
        <Panel title="Enlace">
          <StatsBar stats={snap.stats} rttMs={snap.rttMs} />
          <p className="mt-3 text-xs text-ink-400">
            Palavras de seguranca: <span className="font-mono text-ink-300">{snap.words}</span>
          </p>
        </Panel>

        {snap.displays.length > 1 && (
          <Panel title="Monitores do anfitriao">
            <div className="space-y-2">
              {snap.displays.map((display) => (
                <Button key={display.id} className="w-full" onClick={() => session.pickDisplay(display.id)}>
                  {display.label} · {display.width}×{display.height}
                </Button>
              ))}
              <p className="text-[11px] leading-relaxed text-ink-400">
                Isso ajusta para qual monitor o cursor e enviado. Para ver outro monitor, peca ao anfitriao para
                trocar a tela compartilhada.
              </p>
            </div>
          </Panel>
        )}

        <Panel title="Area de transferencia">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void session.sendClipboard()}>Enviar a minha</Button>
            <Button onClick={() => session.requestClipboard()}>Pedir a do anfitriao</Button>
          </div>
          {snap.clipboardIn && (
            <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-850 p-2 text-xs text-ink-300">
              {snap.clipboardIn}
            </pre>
          )}
        </Panel>

        {snap.notice && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <span>{snap.notice}</span>
            <button onClick={() => session.notify(null)} aria-label="Dispensar aviso">
              ✕
            </button>
          </div>
        )}

        <Panel
          title={tab === "chat" ? "Bate-papo" : "Arquivos"}
          aside={
            <div className="flex gap-1">
              <button
                onClick={() => setTab("chat")}
                className={`rounded px-2 py-0.5 text-[11px] ${tab === "chat" ? "bg-ink-700 text-ink-200" : "text-ink-400"}`}
              >
                chat
              </button>
              <button
                onClick={() => setTab("arquivos")}
                className={`rounded px-2 py-0.5 text-[11px] ${tab === "arquivos" ? "bg-ink-700 text-ink-200" : "text-ink-400"}`}
              >
                arquivos
              </button>
            </div>
          }
        >
          <div className="h-80">
            {tab === "chat" ? (
              <ChatPanel chat={snap.chat} onSend={(text) => session.sendChat(text)} />
            ) : (
              <div className="h-full overflow-y-auto">
                <FilePanel
                  transfers={snap.transfers}
                  actions={{
                    onSend: (file) => void session.sendFile(file),
                    onAccept: (id) => session.acceptFile(id),
                    onReject: (id) => session.rejectFile(id),
                    onCancel: (id) => session.cancelFile(id),
                  }}
                />
              </div>
            )}
          </div>
        </Panel>
      </aside>
    </main>
  );
}
