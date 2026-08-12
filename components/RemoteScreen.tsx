"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { InputCapture } from "@/lib/input/capture";
import type { ComboName, InputEvent, PeerCapabilities } from "@/lib/protocol";
import { Badge, Button } from "./ui";

export interface RemoteScreenProps {
  stream: MediaStream | null;
  control: boolean;
  caps: PeerCapabilities | null;
  onInput: (events: InputEvent[]) => void;
  onPointer: (x: number, y: number) => void;
  onNotice: (text: string) => void;
}

const COMBOS: { id: ComboName; label: string; only?: string }[] = [
  { id: "ctrl-alt-del", label: "Ctrl+Alt+Del", only: "windows" },
  { id: "alt-tab", label: "Alt+Tab" },
  { id: "win", label: "Tecla Windows", only: "windows" },
  { id: "cmd-space", label: "⌘+Espaco", only: "darwin" },
  { id: "print-screen", label: "Print Screen" },
  { id: "lock-screen", label: "Bloquear tela" },
];

export function RemoteScreen({ stream, control, caps, onInput, onPointer, onNotice }: RemoteScreenProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<InputCapture | null>(null);
  const controlRef = useRef(control);
  const [fullscreen, setFullscreen] = useState(false);
  const [keyboardLocked, setKeyboardLocked] = useState(false);
  const [fit, setFit] = useState<"contain" | "actual">("contain");

  controlRef.current = control;

  useEffect(() => {
    const video = videoRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    const surface = surfaceRef.current;
    const video = videoRef.current;
    if (!surface || !video) return;

    const capture = new InputCapture(surface, video, {
      send: (events) => onInput(events),
      enabled: () => controlRef.current,
      onNotice,
    });
    capture.attach();
    captureRef.current = capture;
    return () => {
      capture.detach();
      captureRef.current = null;
    };
  }, [onInput, onNotice]);

  // Sem controle, o movimento do mouse ainda e util: o anfitriao ve o ponteiro
  // e consegue acompanhar o que voce esta apontando.
  const trackPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (controlRef.current) return;
      const video = videoRef.current;
      if (!video) return;
      const rect = video.getBoundingClientRect();
      const vw = video.videoWidth || rect.width;
      const vh = video.videoHeight || rect.height;
      const scale = Math.min(rect.width / vw, rect.height / vh);
      const offsetX = (rect.width - vw * scale) / 2;
      const offsetY = (rect.height - vh * scale) / 2;
      const x = (event.clientX - rect.left - offsetX) / (vw * scale);
      const y = (event.clientY - rect.top - offsetY) / (vh * scale);
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onPointer(x, y);
    },
    [onPointer],
  );

  useEffect(() => {
    const onChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      if (!active) {
        captureRef.current?.releaseKeyboard();
        setKeyboardLocked(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await surfaceRef.current?.requestFullscreen().catch(() => undefined);
    // O bloqueio de teclado so e permitido em tela cheia.
    if (control) {
      const locked = await captureRef.current?.captureKeyboard();
      setKeyboardLocked(Boolean(locked));
    }
  };

  const os = caps?.os ?? "";
  const combos = COMBOS.filter((combo) => !combo.only || combo.only === os);

  return (
    <div className="space-y-3">
      <div
        ref={surfaceRef}
        tabIndex={0}
        onPointerMove={trackPointer}
        onPaste={(event) => {
          if (!control) return;
          const text = event.clipboardData.getData("text");
          if (text) {
            event.preventDefault();
            captureRef.current?.sendText(text);
          }
        }}
        className={`surface relative overflow-hidden rounded-xl border bg-black ${
          control ? "border-accent/60 cursor-none" : "border-ink-700"
        } ${fit === "actual" ? "overflow-auto" : ""}`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className={`w-full bg-black ${fit === "contain" ? "aspect-video object-contain" : "max-w-none"}`}
        />

        {!stream && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-ink-400">Aguardando o video do anfitriao…</p>
          </div>
        )}

        {stream && !control && (
          <div className="pointer-events-none absolute left-3 top-3">
            <Badge tone="neutral">somente visualizacao</Badge>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void toggleFullscreen()}>{fullscreen ? "Sair da tela cheia" : "Tela cheia"}</Button>
        <Button onClick={() => setFit(fit === "contain" ? "actual" : "contain")}>
          {fit === "contain" ? "Tamanho real" : "Ajustar a janela"}
        </Button>
        {keyboardLocked && <Badge tone="good">teclado capturado</Badge>}

        <span className="mx-1 h-5 w-px bg-ink-700" />

        {combos.map((combo) => (
          <Button
            key={combo.id}
            variant="subtle"
            disabled={!control}
            onClick={() => captureRef.current?.sendCombo(combo.id)}
            title={
              combo.id === "ctrl-alt-del"
                ? "O Windows bloqueia esta combinacao para programas comuns; funciona apenas com a politica SoftwareSASGeneration habilitada."
                : undefined
            }
          >
            {combo.label}
          </Button>
        ))}

        <Button
          variant="subtle"
          disabled={!control}
          onClick={() => {
            const text = window.prompt("Texto para digitar no computador remoto:");
            if (text) captureRef.current?.sendText(text);
          }}
        >
          Digitar texto
        </Button>
      </div>

      {control && (
        <p className="text-xs leading-relaxed text-ink-400">
          Em tela cheia no Chrome ou Edge, Esc, Tab e a tecla Windows/⌘ vao para o computador remoto. Fora da tela
          cheia, o navegador local intercepta essas teclas.
        </p>
      )}
    </div>
  );
}
