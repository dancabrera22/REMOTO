"use client";

import { CHUNK_SIZE, type ControlMessage, decodeChunk, encodeChunk } from "@/lib/protocol";

export interface TransferView {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: "enviando" | "recebendo";
  transferred: number;
  state: "aguardando" | "ativo" | "concluido" | "recusado" | "cancelado" | "erro";
  detail?: string;
  /** Disponivel no destino quando o estado vira "concluido". */
  url?: string;
}

type Emit = (message: ControlMessage) => void;
type Notify = (transfers: TransferView[]) => void;

interface Incoming {
  view: TransferView;
  parts: Uint8Array[];
  expected: number;
}

interface Outgoing {
  view: TransferView;
  file: File;
  cancelled: boolean;
}

/** Acima disso paramos de escrever e esperamos o SCTP drenar. */
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
/** Teto de seguranca: o arquivo recebido fica em memoria ate o fim. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Transferencia de arquivos sobre o DataChannel.
 *
 * Metadados e handshake vao pelo canal de controle (JSON); o conteudo vai
 * pelo canal "bulk" em blocos binarios de 64 KiB — o maior tamanho que toda
 * implementacao de SCTP aceita sem fragmentar.
 *
 * O controle de fluxo e o ponto delicado: escrever num DataChannel mais rapido
 * do que ele drena estoura a memoria da aba e derruba a conexao. Por isso
 * esperamos o evento `bufferedamountlow` sempre que a fila passa de 4 MiB.
 */
export class FileTransfers {
  private incoming = new Map<string, Incoming>();
  private outgoing = new Map<string, Outgoing>();

  constructor(
    private bulk: () => RTCDataChannel | null,
    private emit: Emit,
    private notify: Notify,
    /** Recebimento exige confirmacao explicita do usuario. */
    private autoAccept = false,
  ) {}

  list(): TransferView[] {
    return [...[...this.outgoing.values()].map((o) => o.view), ...[...this.incoming.values()].map((i) => i.view)].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
  }

  private changed() {
    this.notify(this.list());
  }

  /* ----------------------------- envio ----------------------------- */

  async offer(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("Arquivo acima do limite de 2 GB.");
    }
    const id = newId();
    this.outgoing.set(id, {
      file,
      cancelled: false,
      view: {
        id,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        direction: "enviando",
        transferred: 0,
        state: "aguardando",
      },
    });
    this.emit({ t: "file-offer", id, name: file.name, size: file.size, mime: file.type });
    this.changed();
  }

  private async pump(id: string) {
    const job = this.outgoing.get(id);
    const channel = this.bulk();
    if (!job || !channel) return;

    job.view.state = "ativo";
    this.changed();
    channel.bufferedAmountLowThreshold = LOW_WATER;

    try {
      let index = 0;
      for (let offset = 0; offset < job.file.size; offset += CHUNK_SIZE) {
        if (job.cancelled) return;
        if (channel.readyState !== "open") throw new Error("canal fechado");

        if (channel.bufferedAmount > HIGH_WATER) await drain(channel);

        const slice = job.file.slice(offset, offset + CHUNK_SIZE);
        channel.send(encodeChunk(id, index++, await slice.arrayBuffer()));

        job.view.transferred = Math.min(offset + CHUNK_SIZE, job.file.size);
        this.changed();
      }
      this.emit({ t: "file-done", id });
      job.view.state = "concluido";
    } catch (error) {
      job.view.state = "erro";
      job.view.detail = String(error);
      this.emit({ t: "file-cancel", id, reason: String(error) });
    } finally {
      this.changed();
    }
  }

  cancel(id: string, reason = "cancelado pelo usuario") {
    const out = this.outgoing.get(id);
    if (out) {
      out.cancelled = true;
      out.view.state = "cancelado";
    }
    const inc = this.incoming.get(id);
    if (inc) inc.view.state = "cancelado";
    this.emit({ t: "file-cancel", id, reason });
    this.changed();
  }

  accept(id: string) {
    const inc = this.incoming.get(id);
    if (!inc) return;
    inc.view.state = "ativo";
    this.emit({ t: "file-accept", id });
    this.changed();
  }

  reject(id: string, reason = "recusado") {
    const inc = this.incoming.get(id);
    if (inc) {
      inc.view.state = "recusado";
      this.incoming.delete(id);
    }
    this.emit({ t: "file-reject", id, reason });
    this.changed();
  }

  /* --------------------------- recepcao --------------------------- */

  handleControl(message: ControlMessage): boolean {
    switch (message.t) {
      case "file-offer": {
        const view: TransferView = {
          id: message.id,
          name: sanitize(message.name),
          size: message.size,
          mime: message.mime || "application/octet-stream",
          direction: "recebendo",
          transferred: 0,
          state: this.autoAccept ? "ativo" : "aguardando",
        };
        this.incoming.set(message.id, {
          view,
          parts: [],
          expected: Math.ceil(message.size / CHUNK_SIZE),
        });
        if (this.autoAccept) this.emit({ t: "file-accept", id: message.id });
        this.changed();
        return true;
      }
      case "file-accept":
        void this.pump(message.id);
        return true;
      case "file-reject": {
        const job = this.outgoing.get(message.id);
        if (job) {
          job.view.state = "recusado";
          job.view.detail = message.reason;
          this.changed();
        }
        return true;
      }
      case "file-cancel": {
        const job = this.outgoing.get(message.id);
        if (job) {
          job.cancelled = true;
          job.view.state = "cancelado";
          job.view.detail = message.reason;
        }
        const inc = this.incoming.get(message.id);
        if (inc) inc.view.state = "cancelado";
        this.changed();
        return true;
      }
      case "file-done": {
        this.finish(message.id);
        return true;
      }
      default:
        return false;
    }
  }

  handleChunk(buffer: ArrayBuffer) {
    const { id, index, body } = decodeChunk(buffer);
    const inc = this.incoming.get(id);
    if (!inc || inc.view.state === "cancelado") return;
    inc.parts[index] = new Uint8Array(body);
    inc.view.transferred = Math.min(inc.view.transferred + body.byteLength, inc.view.size);
    this.changed();
  }

  private finish(id: string) {
    const inc = this.incoming.get(id);
    if (!inc) return;
    const missing = inc.parts.length < inc.expected || [...inc.parts].some((p) => p === undefined);
    if (missing) {
      inc.view.state = "erro";
      inc.view.detail = "blocos faltando";
      this.changed();
      return;
    }
    const blob = new Blob(inc.parts as BlobPart[], { type: inc.view.mime });
    inc.view.url = URL.createObjectURL(blob);
    inc.view.transferred = inc.view.size;
    inc.view.state = "concluido";
    // O Blob ja detem os dados; soltar os pedacos libera o dobro de memoria.
    inc.parts = [];
    this.changed();
  }

  dispose() {
    for (const inc of this.incoming.values()) if (inc.view.url) URL.revokeObjectURL(inc.view.url);
    this.incoming.clear();
    this.outgoing.clear();
  }
}

function drain(channel: RTCDataChannel) {
  return new Promise<void>((resolve) => {
    const done = () => {
      channel.removeEventListener("bufferedamountlow", done);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", done);
  });
}

/** Ids tem exatamente 16 bytes ASCII porque vao no cabecalho binario. */
function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

/** O nome vem da outra ponta: nunca deixamos virar caminho de diretorio. */
function sanitize(name: string): string {
  return (name || "arquivo")
    .replace(/[\\/]/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180) || "arquivo";
}
