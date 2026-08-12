"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel } from "@/components/ChatPanel";
import { FilePanel } from "@/components/FilePanel";
import { StatsBar } from "@/components/StatsBar";
import { Badge, Button, Panel, TextInput, Toggle, formatCode } from "@/components/ui";
import { QUALITY_PRESETS } from "@/lib/protocol";
import { startRecording } from "@/lib/media/capture";
import { HostSession } from "@/lib/session/host";

const AGENT_COMMAND = "npx remoto-agent";

export default function SharePage() {
  const sessionRef = useRef<HostSession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = new HostSession(readName());
  }
  const session = sessionRef.current;

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tab, setTab] = useState<"chat" | "arquivos">("chat");
  const [pairCode, setPairCode] = useState("");
  const [recorder, setRecorder] = useState<{ stop: () => Promise<Blob> } | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    void session.start();
    const onUnload = () => session.stop();
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      session.stop();
    };
  }, [session]);

  // A pre-visualizacao local so existe para o anfitriao conferir o que esta
  // saindo; fica sem audio para nao criar realimentacao com o microfone.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stream = session.previewStream();
    if (video.srcObject !== stream) video.srcObject = stream;
  }, [session, snap.sharing, snap.surface]);

  const pending = snap.viewers.filter((v) => v.status === "pendente");
  const connected = snap.viewers.filter((v) => v.status === "conectado" || v.status === "conectando");
  const controller = connected.find((v) => v.control);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  };

  return (
    <main className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm font-semibold tracking-tight text-ink-200">
              REMOTO
            </Link>
            <Badge tone={snap.signal === "aberto" ? "good" : snap.signal === "erro" ? "bad" : "warn"}>
              sinalizacao {snap.signal}
            </Badge>
            {snap.storeKind === "memory" && (
              <Badge tone="warn">sinalizacao em memoria — ver README antes de publicar</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={snap.quality}
              onChange={(event) => session.setQuality(event.target.value)}
              className="rounded-lg border border-ink-600 bg-ink-850 px-2 py-2 text-sm text-ink-200"
              aria-label="Perfil de qualidade"
            >
              {Object.keys(QUALITY_PRESETS).map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
            <Button onClick={() => void session.toggleMic()}>
              {snap.micOn ? "Desligar microfone" : "Ligar microfone"}
            </Button>
            {snap.sharing ? (
              <Button variant="danger" onClick={() => session.stopShare()}>
                Parar de compartilhar
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void session.share()}>
                Compartilhar tela
              </Button>
            )}
          </div>
        </header>

        {snap.notice && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">{snap.notice}</div>
        )}
        {snap.phase === "erro" && (
          <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-2 text-sm text-bad">{snap.error}</div>
        )}

        <div className="relative overflow-hidden rounded-xl border border-ink-700 bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full bg-black object-contain"
          />
          {!snap.sharing && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-ink-300">Sua tela ainda nao esta sendo compartilhada.</p>
              <Button variant="primary" onClick={() => void session.share()}>
                Escolher o que compartilhar
              </Button>
            </div>
          )}

          {/* Ponteiros dos visualizantes que estao apenas assistindo. */}
          {connected.map((viewer) =>
            viewer.pointer && !viewer.control ? (
              <div
                key={viewer.peerId}
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${viewer.pointer.x * 100}%`, top: `${viewer.pointer.y * 100}%` }}
              >
                <div className="h-3 w-3 rounded-full border-2 border-white bg-accent" />
                <span className="mt-1 block rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-ink-200">
                  {viewer.name}
                </span>
              </div>
            ) : null,
          )}
        </div>

        <Panel title="Sessao">
          <div className="flex flex-wrap items-end gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">Codigo</div>
              <button
                className="font-mono text-3xl tracking-[0.15em] text-ink-200"
                onClick={() => void copy(snap.code, "codigo")}
                title="Copiar"
              >
                {snap.code ? formatCode(snap.code) : "— — —"}
              </button>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-400">PIN</div>
              <button
                className="font-mono text-3xl tracking-[0.15em] text-ink-200"
                onClick={() => void copy(snap.pin, "pin")}
                title="Copiar"
              >
                {snap.pin || "— — —"}
              </button>
            </div>
            <div className="flex-1">
              <div className="text-[10px] uppercase tracking-wider text-ink-400">Link direto (ja inclui o PIN)</div>
              <div className="flex gap-2">
                <TextInput readOnly value={snap.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button onClick={() => void copy(snap.link, "link")}>{copied === "link" ? "copiado" : "copiar"}</Button>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs leading-relaxed text-ink-400">
            Palavras de seguranca: <span className="font-mono text-ink-300">{snap.words || "—"}</span>. Leia em voz
            alta com a outra pessoa — se as duas telas mostram as mesmas palavras, ninguem se colocou no meio da
            negociacao.
          </p>
          {snap.surface && (
            <p className="mt-2 text-xs text-ink-400">
              Compartilhando {snap.surface.kind} · {snap.surface.width}×{snap.surface.height} · {snap.surface.fps} fps
            </p>
          )}
        </Panel>

        {connected.length > 0 && (
          <Panel title="Qualidade do enlace">
            <StatsBar stats={connected[0]!.stats} rttMs={connected[0]!.rttMs} />
          </Panel>
        )}

        <Panel title="Gravacao">
          <div className="flex items-center gap-3">
            {recorder ? (
              <Button
                variant="danger"
                onClick={async () => {
                  const blob = await recorder.stop();
                  setRecorder(null);
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `remoto-${Date.now()}.webm`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                }}
              >
                Parar e baixar
              </Button>
            ) : (
              <Button
                disabled={!snap.sharing}
                onClick={() => {
                  const stream = session.previewStream();
                  if (stream) setRecorder(startRecording(stream));
                }}
              >
                Gravar sessao
              </Button>
            )}
            <span className="text-xs text-ink-400">
              A gravacao acontece nesta aba e o arquivo fica no seu computador.
            </span>
          </div>
        </Panel>
      </div>

      <aside className="space-y-4">
        {pending.length > 0 && (
          <Panel title="Pedidos de acesso" className="border-accent/50">
            <ul className="space-y-3">
              {pending.map((viewer) => (
                <li key={viewer.peerId} className="rounded-lg bg-ink-850 p-3">
                  <div className="text-sm text-ink-200">{viewer.name}</div>
                  <div className="text-[11px] text-ink-400">
                    {viewer.wantsControl ? "pediu controle de mouse e teclado" : "quer apenas assistir"}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button variant="primary" onClick={() => void session.approve(viewer.peerId)}>
                      Permitir
                    </Button>
                    <Button variant="danger" onClick={() => void session.deny(viewer.peerId)}>
                      Recusar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title={`Participantes (${connected.length})`}>
          {connected.length === 0 && <p className="text-xs text-ink-400">Ninguem conectado ainda.</p>}
          <ul className="space-y-3">
            {connected.map((viewer) => (
              <li key={viewer.peerId} className="rounded-lg bg-ink-850 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-200">{viewer.name}</span>
                  <Badge tone={viewer.status === "conectado" ? "good" : "warn"}>{viewer.status}</Badge>
                </div>
                <div className="mt-1 font-mono text-[11px] text-ink-400">
                  {viewer.rttMs ? `${viewer.rttMs} ms` : "—"} · {(viewer.stats.kbps / 1000).toFixed(1)} Mb/s
                </div>
                <div className="mt-2 space-y-2">
                  <Toggle
                    checked={viewer.control}
                    disabled={!snap.agentPaired}
                    onChange={(value) => void session.setControl(viewer.peerId, value)}
                    label="Controle de mouse e teclado"
                    hint={
                      snap.agentPaired
                        ? controller && !viewer.control
                          ? `no momento com ${controller.name}`
                          : undefined
                        : "requer o agente local pareado"
                    }
                  />
                  <Button variant="subtle" onClick={() => session.disconnect(viewer.peerId)}>
                    Desconectar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          title="Agente local"
          aside={<Badge tone={snap.agentPaired ? "good" : "neutral"}>{snap.agentPaired ? "pareado" : "inativo"}</Badge>}
        >
          {snap.agentPaired ? (
            <div className="space-y-3">
              <p className="text-xs text-ink-300">
                Controle de mouse e teclado disponivel via {snap.agent?.backend} em {snap.agent?.os}.
              </p>
              {(snap.agent?.displays.length ?? 0) > 1 && (
                <label className="block text-xs text-ink-400">
                  Monitor compartilhado
                  <select
                    value={snap.displayId}
                    onChange={(event) => void session.setDisplay(Number(event.target.value))}
                    className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-850 px-2 py-2 text-sm text-ink-200"
                  >
                    {snap.agent?.displays.map((display) => (
                      <option key={display.id} value={display.id}>
                        {display.label} · {display.width}×{display.height}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block leading-relaxed">
                    O navegador nao informa qual monitor voce escolheu no dialogo de compartilhamento. Selecione o
                    mesmo aqui para o cursor cair no lugar certo.
                  </span>
                </label>
              )}
              <Button variant="subtle" onClick={() => session.forgetAgent()}>
                Desconectar agente
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-ink-300">
                Para liberar mouse e teclado, rode este comando no computador que esta sendo compartilhado. Ele nao
                instala nada e some quando voce fechar o terminal.
              </p>
              <div className="flex gap-2">
                <code className="flex-1 truncate rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 font-mono text-xs text-ink-200">
                  {AGENT_COMMAND}
                </code>
                <Button onClick={() => void copy(AGENT_COMMAND, "cmd")}>{copied === "cmd" ? "ok" : "copiar"}</Button>
              </div>
              <form
                className="flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await session.refreshAgent();
                  await session.pairAgent(pairCode);
                  setPairCode("");
                }}
              >
                <TextInput
                  value={pairCode}
                  onChange={(event) => setPairCode(event.target.value.toUpperCase().slice(0, 6))}
                  placeholder="CODIGO DO TERMINAL"
                  className="font-mono tracking-[0.2em]"
                  aria-label="Codigo de pareamento do agente"
                />
                <Button type="submit" variant="primary" disabled={pairCode.length !== 6}>
                  Ativar
                </Button>
              </form>
              <Button variant="subtle" onClick={() => void session.refreshAgent()}>
                Procurar agente novamente
              </Button>
            </div>
          )}
        </Panel>

        <Panel title="Area de transferencia">
          <Button onClick={() => void session.sendClipboard()}>Enviar minha area de transferencia</Button>
          {snap.clipboardIn && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-ink-400">Recebido</div>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-850 p-2 text-xs text-ink-300">
                {snap.clipboardIn}
              </pre>
            </div>
          )}
        </Panel>

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
                  disabled={connected.length === 0}
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

function readName(): string {
  if (typeof localStorage === "undefined") return "Anfitriao";
  return localStorage.getItem("remoto.nome") || "Anfitriao";
}
