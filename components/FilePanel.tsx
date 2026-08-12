"use client";

import { useRef, useState } from "react";
import type { TransferView } from "@/lib/rtc/files";
import { Button, bytes } from "./ui";

export interface FilePanelActions {
  onSend: (file: File) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
}

export function FilePanel({
  transfers,
  actions,
  disabled,
}: {
  transfers: TransferView[];
  actions: FilePanelActions;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) actions.onSend(file);
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) take(event.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed px-4 py-6 text-center text-xs transition ${
          dragging ? "border-accent bg-accent/10 text-ink-200" : "border-ink-600 text-ink-400"
        } ${disabled ? "opacity-50" : ""}`}
      >
        <p>Arraste arquivos aqui</p>
        <p className="mt-1 text-[11px]">Vao direto para o outro computador, sem passar por servidor.</p>
        <Button
          className="mt-3"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Escolher arquivo
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <ul className="space-y-2">
        {transfers.map((item) => {
          const percent = item.size ? Math.round((item.transferred / item.size) * 100) : 0;
          return (
            <li key={item.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium text-ink-200" title={item.name}>
                  {item.name}
                </span>
                <span className="shrink-0 text-[11px] text-ink-400">{bytes(item.size)}</span>
              </div>

              <div className="mt-2 h-1 overflow-hidden rounded bg-ink-700">
                <div
                  className={`h-full transition-[width] ${item.state === "erro" ? "bg-bad" : "bg-accent"}`}
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-400">
                <span>
                  {item.direction} · {item.state}
                  {item.detail ? ` · ${item.detail}` : ""} · {percent}%
                </span>
                <span className="flex gap-2">
                  {item.state === "aguardando" && item.direction === "recebendo" && (
                    <>
                      <button className="text-good" onClick={() => actions.onAccept(item.id)}>
                        aceitar
                      </button>
                      <button className="text-bad" onClick={() => actions.onReject(item.id)}>
                        recusar
                      </button>
                    </>
                  )}
                  {item.state === "ativo" && (
                    <button className="text-bad" onClick={() => actions.onCancel(item.id)}>
                      cancelar
                    </button>
                  )}
                  {item.state === "concluido" && item.url && (
                    <a className="text-accent" href={item.url} download={item.name}>
                      baixar
                    </a>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
