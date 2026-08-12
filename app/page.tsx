"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, TextInput } from "@/components/ui";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");

  const digits = code.replace(/\D/g, "");
  const pinDigits = pin.replace(/\D/g, "");
  const ready = digits.length === 9 && pinDigits.length === 6;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-10 px-6 py-16">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-ink-200">REMOTO</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-300">
          Acesso remoto pelo navegador. A tela e os arquivos vao direto de um computador ao outro,
          cifrados de ponta a ponta — o servidor so apresenta os dois lados e sai da frente.
          Nada para instalar de nenhum dos lados.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-6">
          <h2 className="text-lg font-medium text-ink-200">Compartilhar este computador</h2>
          <p className="mt-2 min-h-16 text-sm text-ink-300">
            Gera um codigo de 9 digitos e um PIN. Quem receber os dois consegue ver sua tela — e,
            se voce autorizar, controlar o mouse e o teclado.
          </p>
          <Link href="/compartilhar">
            <Button variant="primary" className="mt-4 w-full">
              Abrir sessao
            </Button>
          </Link>
        </section>

        <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-6">
          <h2 className="text-lg font-medium text-ink-200">Conectar a outro computador</h2>
          <p className="mt-2 text-sm text-ink-300">Digite o codigo e o PIN que a outra pessoa recebeu.</p>
          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (ready) router.push(`/conectar?c=${digits}#${pinDigits}`);
            }}
          >
            <TextInput
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^\d ]/g, "").slice(0, 11))}
              placeholder="123 456 789"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Codigo da sessao"
              className="font-mono text-lg tracking-[0.2em]"
            />
            <TextInput
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="PIN de 6 digitos"
              inputMode="numeric"
              autoComplete="off"
              aria-label="PIN"
              className="font-mono tracking-[0.2em]"
            />
            <Button type="submit" variant="primary" className="w-full" disabled={!ready}>
              Conectar
            </Button>
          </form>
        </section>
      </div>

      <section className="grid gap-6 border-t border-ink-800 pt-8 text-sm text-ink-300 md:grid-cols-3">
        <div>
          <h3 className="font-medium text-ink-200">O que funciona sem instalar nada</h3>
          <p className="mt-1 text-xs leading-relaxed">
            Ver a tela ao vivo, audio do sistema e microfone, bate-papo, area de transferencia
            compartilhada e transferencia de arquivos ponto-a-ponto.
          </p>
        </div>
        <div>
          <h3 className="font-medium text-ink-200">Controle de mouse e teclado</h3>
          <p className="mt-1 text-xs leading-relaxed">
            O navegador nao pode mover o mouse do sistema — e uma barreira do sandbox, nao uma
            limitacao contornavel. Quem quiser controle roda um comando de uma linha no computador
            compartilhado; a propria pagina da sessao mostra qual, pronto para copiar. Baixa um
            arquivo, executa e some ao fechar: sem instalacao, sem administrador.
          </p>
        </div>
        <div>
          <h3 className="font-medium text-ink-200">Privacidade</h3>
          <p className="mt-1 text-xs leading-relaxed">
            Video, audio e arquivos usam WebRTC (DTLS-SRTP) direto entre os dois. Ate a negociacao
            e cifrada com uma chave derivada do PIN, que nunca chega ao servidor.
          </p>
        </div>
      </section>
    </main>
  );
}
