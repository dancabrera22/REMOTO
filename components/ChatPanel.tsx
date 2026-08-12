"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatEntry } from "@/lib/session/host";
import { Button, TextInput } from "./ui";

export function ChatPanel({ chat, onSend }: { chat: ChatEntry[]; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {chat.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-400">
            Nenhuma mensagem. O bate-papo trafega pela mesma conexao cifrada da tela.
          </p>
        )}
        {chat.map((entry) => (
          <div key={entry.id} className={entry.mine ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-1.5 text-left text-sm ${
                entry.mine ? "bg-accent/20 text-ink-200" : "bg-ink-800 text-ink-200"
              }`}
            >
              {!entry.mine && <span className="mb-0.5 block text-[11px] text-ink-400">{entry.from}</span>}
              <span className="whitespace-pre-wrap break-words">{entry.text}</span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSend(draft);
          setDraft("");
        }}
      >
        <TextInput
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Mensagem"
          maxLength={2000}
          aria-label="Mensagem do bate-papo"
        />
        <Button type="submit" variant="primary" disabled={!draft.trim()}>
          Enviar
        </Button>
      </form>
    </div>
  );
}
