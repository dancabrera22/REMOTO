"use client";

import { MOD, type ComboName, type InputEvent, type PointerButton } from "@/lib/protocol";

export interface CaptureOptions {
  /** Envia a batelada acumulada. Chamado no maximo uma vez por quadro. */
  send: (events: InputEvent[]) => void;
  /** Enquanto false, apenas observamos (modo somente-visualizacao). */
  enabled: () => boolean;
  onNotice?: (text: string) => void;
}

/**
 * Traduz eventos do navegador em eventos de entrada normalizados.
 *
 * Tres decisoes que definem a qualidade percebida:
 *
 * 1. Movimentos do ponteiro sao coalescidos por quadro. Um mousemove dispara
 *    ate 1000x/s em mouses gamer; enviar tudo entope o DataChannel e adiciona
 *    latencia sem ganho nenhum — a tela remota nao atualiza mais que 60x/s.
 *
 * 2. Coordenadas viajam normalizadas (0..1) contra a area util do video, nao
 *    contra o elemento. Com `object-fit: contain` sobram barras pretas, e
 *    ignora-las deslocaria o cursor remoto proporcionalmente ao letterbox.
 *
 * 3. Teclas usam `KeyboardEvent.code` (posicao fisica), nunca `key`. O
 *    anfitriao pode ter outro layout; quem decide o que "KeyY" significa e o
 *    teclado de la, exatamente como num acesso remoto nativo.
 */
export class InputCapture {
  private queue: InputEvent[] = [];
  private frame = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: { x: number; y: number } | null = null;
  private pressedKeys = new Set<string>();
  private attached = false;
  private composing = false;

  constructor(
    private surface: HTMLElement,
    private video: HTMLVideoElement,
    private opts: CaptureOptions,
  ) {}

  attach() {
    if (this.attached) return;
    this.attached = true;

    this.surface.addEventListener("pointermove", this.onPointerMove);
    this.surface.addEventListener("pointerdown", this.onPointerDown);
    this.surface.addEventListener("pointerup", this.onPointerUp);
    this.surface.addEventListener("pointercancel", this.onPointerUp);
    this.surface.addEventListener("contextmenu", this.onContextMenu);
    this.surface.addEventListener("wheel", this.onWheel, { passive: false });
    this.surface.addEventListener("dblclick", this.onDoubleClick);

    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    window.addEventListener("keyup", this.onKeyUp, { capture: true });
    window.addEventListener("blur", this.releaseAll);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.releaseAll();
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.timer) clearTimeout(this.timer);
    this.frame = 0;
    this.timer = null;
    this.queue = [];
    this.pendingMove = null;

    this.surface.removeEventListener("pointermove", this.onPointerMove);
    this.surface.removeEventListener("pointerdown", this.onPointerDown);
    this.surface.removeEventListener("pointerup", this.onPointerUp);
    this.surface.removeEventListener("pointercancel", this.onPointerUp);
    this.surface.removeEventListener("contextmenu", this.onContextMenu);
    this.surface.removeEventListener("wheel", this.onWheel);
    this.surface.removeEventListener("dblclick", this.onDoubleClick);

    window.removeEventListener("keydown", this.onKeyDown, { capture: true });
    window.removeEventListener("keyup", this.onKeyUp, { capture: true });
    window.removeEventListener("blur", this.releaseAll);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /* --------------------------- fila --------------------------- */

  private push(event: InputEvent) {
    if (!this.opts.enabled()) return;
    this.queue.push(event);
    this.schedule();
  }

  private schedule() {
    if (this.frame || this.timer) return;
    this.frame = requestAnimationFrame(() => this.flush());
    // O rAF e o relogio ideal (um envio por quadro renderizado), mas ele
    // congela quando a janela esta encoberta ou em segundo plano. Sem esta
    // rede de seguranca, um clique feito logo apos trazer a janela para a
    // frente ficaria preso na fila ate o proximo quadro — que pode demorar.
    this.timer = setTimeout(() => this.flush(), 50);
  }

  private flush() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingMove) {
      // O movimento entra na frente das demais acoes do lote para que um
      // clique sempre acerte a posicao mais recente.
      this.queue.unshift({ k: "m", ...this.pendingMove });
      this.pendingMove = null;
    }
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.opts.send(batch);
  }

  /* ------------------- mapeamento de coordenadas ------------------- */

  /**
   * Converte coordenadas de tela para 0..1 dentro do conteudo do video,
   * descontando o letterbox que o `object-fit: contain` cria.
   */
  private normalize(clientX: number, clientY: number) {
    const rect = this.video.getBoundingClientRect();
    const vw = this.video.videoWidth || rect.width;
    const vh = this.video.videoHeight || rect.height;
    if (!rect.width || !rect.height || !vw || !vh) return { x: 0, y: 0 };

    const scale = Math.min(rect.width / vw, rect.height / vh);
    const drawnW = vw * scale;
    const drawnH = vh * scale;
    const offsetX = (rect.width - drawnW) / 2;
    const offsetY = (rect.height - drawnH) / 2;

    const x = (clientX - rect.left - offsetX) / drawnW;
    const y = (clientY - rect.top - offsetY) / drawnH;
    return { x: clamp01(x), y: clamp01(y) };
  }

  /* --------------------------- ponteiro --------------------------- */

  private onPointerMove = (event: PointerEvent) => {
    if (!this.opts.enabled()) return;
    this.pendingMove = this.normalize(event.clientX, event.clientY);
    this.schedule();
  };

  private onPointerDown = (event: PointerEvent) => {
    if (!this.opts.enabled()) return;
    event.preventDefault();
    this.surface.focus();
    this.surface.setPointerCapture?.(event.pointerId);
    const at = this.normalize(event.clientX, event.clientY);
    this.pendingMove = at;
    this.push({ k: "d", b: button(event.button), ...at });
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.opts.enabled()) return;
    event.preventDefault();
    this.surface.releasePointerCapture?.(event.pointerId);
    this.push({ k: "u", b: button(event.button), ...this.normalize(event.clientX, event.clientY) });
  };

  private onDoubleClick = (event: MouseEvent) => {
    if (!this.opts.enabled()) return;
    event.preventDefault();
    // Alguns sistemas so reconhecem duplo clique pelo contador do evento, nao
    // pelo intervalo entre dois pares press/release retransmitidos.
    this.push({ k: "c", b: button(event.button), ...this.normalize(event.clientX, event.clientY), n: 2 });
  };

  private onContextMenu = (event: Event) => {
    // O menu do navegador local roubaria o clique direito destinado ao remoto.
    if (this.opts.enabled()) event.preventDefault();
  };

  private onWheel = (event: WheelEvent) => {
    if (!this.opts.enabled()) return;
    event.preventDefault();
    // deltaMode 1 = linhas, 2 = paginas. Normalizamos tudo para pixels.
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    this.push({
      k: "w",
      dx: Math.round(event.deltaX * factor),
      dy: Math.round(event.deltaY * factor),
      ...this.normalize(event.clientX, event.clientY),
    });
  };

  /* ---------------------------- teclado ---------------------------- */

  private modifiers(event: KeyboardEvent) {
    return (
      (event.shiftKey ? MOD.SHIFT : 0) |
      (event.ctrlKey ? MOD.CTRL : 0) |
      (event.altKey ? MOD.ALT : 0) |
      (event.metaKey ? MOD.META : 0)
    );
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.opts.enabled() || this.composing) return;
    if (isEditingLocally(event.target)) return; // chat, campos de formulario

    event.preventDefault();
    event.stopPropagation();
    this.pressedKeys.add(event.code);
    this.push({ k: "kd", c: event.code, m: this.modifiers(event) });
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (!this.opts.enabled() || this.composing) return;
    if (isEditingLocally(event.target)) return;

    event.preventDefault();
    event.stopPropagation();
    this.pressedKeys.delete(event.code);
    this.push({ k: "ku", c: event.code, m: this.modifiers(event) });
  };

  private onVisibility = () => {
    if (document.hidden) this.releaseAll();
  };

  /**
   * Solta tudo que ficou pressionado. Sem isso, trocar de aba com Alt
   * pressionado deixa o Alt "grudado" na maquina remota — o classico bug de
   * tecla presa em acesso remoto.
   */
  private releaseAll = () => {
    if (!this.pressedKeys.size) return;
    const events: InputEvent[] = [...this.pressedKeys].map((code) => ({ k: "ku", c: code, m: 0 }));
    this.pressedKeys.clear();
    this.opts.send(events);
  };

  /** Envia texto literal — colagem, emoji e teclados de IME (CJK). */
  sendText(text: string) {
    if (!text) return;
    this.push({ k: "txt", s: text });
  }

  sendCombo(combo: ComboName) {
    this.push({ k: "combo", s: combo });
  }

  setComposing(value: boolean) {
    this.composing = value;
  }

  /**
   * Tela cheia + `keyboard.lock()`: e o que permite entregar Escape, Tab,
   * Alt+Tab e a tecla Meta para o computador remoto em vez de o navegador
   * local consumi-las. So existe em navegadores Chromium.
   */
  async captureKeyboard(): Promise<boolean> {
    const keyboard = (navigator as Navigator & { keyboard?: { lock: (keys?: string[]) => Promise<void> } }).keyboard;
    if (!keyboard?.lock) {
      this.opts.onNotice?.(
        "Este navegador nao permite capturar Esc/Tab/Meta. Use Chrome ou Edge para o teclado completo.",
      );
      return false;
    }
    try {
      await keyboard.lock();
      return true;
    } catch {
      return false;
    }
  }

  releaseKeyboard() {
    const keyboard = (navigator as Navigator & { keyboard?: { unlock: () => void } }).keyboard;
    keyboard?.unlock?.();
  }
}

function clamp01(value: number) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function button(index: number): PointerButton {
  return index === 1 ? 1 : index === 2 ? 2 : 0;
}

/** Enquanto o foco esta num campo local (chat), o teclado e do campo. */
function isEditingLocally(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}
