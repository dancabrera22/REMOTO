import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { COMBOS, KEYMAP } from "./keymap.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Executa um comando pontual. Com `input`, o texto vai pelo stdin. */
function run(command, args, options = {}) {
  const { input, ...rest } = options;
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 8000, ...rest }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}

/**
 * Base comum aos tres executores.
 *
 * O padrao e sempre o mesmo: um processo auxiliar de vida longa recebendo
 * comandos de uma linha pelo stdin. Subir um processo por evento seria fatal
 * — 100 a 300 ms de latencia por clique.
 */
class Backend {
  constructor(name) {
    this.name = name;
    this.displays = [];
    this.child = null;
    this.pressed = new Set();
  }

  write(line) {
    if (!this.child?.stdin?.writable) return false;
    return this.child.stdin.write(`${line}\n`);
  }

  /** Solta tudo que ficou pressionado — usado ao perder o controle ou sair. */
  releaseAll() {
    for (const code of [...this.pressed]) this.keyUp(code);
    for (const button of [0, 1, 2]) this.up(button);
    this.pressed.clear();
  }

  close() {
    try {
      this.releaseAll();
      this.child?.stdin?.end();
      this.child?.kill();
    } catch {
      /* processo ja encerrado */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Linux — xdotool                                                     */
/* ------------------------------------------------------------------ */

class LinuxBackend extends Backend {
  static async create() {
    const wayland = (process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland";
    const probe = await run("xdotool", ["--version"]);
    if (probe.error) {
      throw new Error(
        wayland
          ? "Sessao Wayland sem xdotool. Instale `xdotool` e use uma sessao X11 (ou configure o ydotool) para ter controle de entrada."
          : "xdotool nao encontrado. Instale com: sudo apt install xdotool (ou o equivalente da sua distro).",
      );
    }

    const backend = new LinuxBackend("xdotool");
    if (wayland) {
      backend.warning =
        "Sessao Wayland detectada: o xdotool so consegue enviar eventos para aplicativos XWayland.";
    }
    backend.displays = await probeLinuxDisplays();
    backend.child = spawn("xdotool", ["-"], { stdio: ["pipe", "ignore", "pipe"] });
    backend.child.on("error", (error) => console.error("[agente] xdotool:", error.message));
    return backend;
  }

  move(x, y) {
    this.write(`mousemove ${Math.round(x)} ${Math.round(y)}`);
  }
  down(button) {
    this.write(`mousedown ${[1, 2, 3][button] ?? 1}`);
  }
  up(button) {
    this.write(`mouseup ${[1, 2, 3][button] ?? 1}`);
  }
  wheel(dx, dy) {
    // O X11 nao tem roda continua: cada "clique" e um botao 4/5 (vertical) ou
    // 6/7 (horizontal). Convertemos pixels em cliques com teto de 10.
    const steps = (delta) => Math.min(10, Math.max(1, Math.round(Math.abs(delta) / 100)));
    if (dy) this.write(`click --repeat ${steps(dy)} ${dy > 0 ? 5 : 4}`);
    if (dx) this.write(`click --repeat ${steps(dx)} ${dx > 0 ? 7 : 6}`);
  }
  keyDown(code) {
    const key = KEYMAP[code]?.x11;
    if (!key) return;
    this.pressed.add(code);
    this.write(`keydown ${key}`);
  }
  keyUp(code) {
    const key = KEYMAP[code]?.x11;
    if (!key) return;
    this.pressed.delete(code);
    this.write(`keyup ${key}`);
  }
  type(text) {
    // O modo `-` do xdotool separa argumentos por espaco, entao texto com
    // espacos precisa de uma invocacao propria.
    void run("xdotool", ["type", "--clearmodifiers", "--delay", "8", "--", text]);
  }
  combo(name) {
    const [sequence] = COMBOS[name]?.x11 ?? [];
    if (!sequence) return false;
    this.write(`key --clearmodifiers ${sequence}`);
    return true;
  }
}

async function probeLinuxDisplays() {
  const { error, stdout } = await run("xrandr", ["--query"]);
  if (!error) {
    const displays = [];
    // Ex.: "HDMI-1 connected primary 1920x1080+0+0 (normal left...) 527mm x 296mm"
    const pattern = /^(\S+) connected( primary)? (\d+)x(\d+)\+(\d+)\+(\d+)/gm;
    let match;
    while ((match = pattern.exec(stdout))) {
      displays.push({
        id: displays.length,
        label: match[1],
        width: Number(match[3]),
        height: Number(match[4]),
        x: Number(match[5]),
        y: Number(match[6]),
        primary: Boolean(match[2]),
      });
    }
    if (displays.length) return displays;
  }

  const geometry = await run("xdotool", ["getdisplaygeometry"]);
  const [width, height] = geometry.stdout.trim().split(/\s+/).map(Number);
  return [
    {
      id: 0,
      label: "Tela",
      width: width || 1920,
      height: height || 1080,
      x: 0,
      y: 0,
      primary: true,
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Windows — PowerShell + user32                                       */
/* ------------------------------------------------------------------ */

class WindowsBackend extends Backend {
  static async create() {
    const backend = new WindowsBackend("user32");
    backend.displays = await probeWindowsDisplays();
    backend.child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "win-helper.ps1")],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    backend.child.stderr?.on("data", (data) => {
      const text = String(data).trim();
      if (text) console.error("[agente] powershell:", text);
    });
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 6000);
      backend.child.stdout?.once("data", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    return backend;
  }

  move(x, y) {
    this.write(`m ${Math.round(x)} ${Math.round(y)}`);
  }
  down(button) {
    this.write(`d ${button}`);
  }
  up(button) {
    this.write(`u ${button}`);
  }
  wheel(dx, dy) {
    this.write(`w ${Math.round(dx)} ${Math.round(dy)}`);
  }
  keyDown(code) {
    const vk = KEYMAP[code]?.win;
    if (vk === undefined) return;
    this.pressed.add(code);
    this.write(`kd ${vk}`);
  }
  keyUp(code) {
    const vk = KEYMAP[code]?.win;
    if (vk === undefined) return;
    this.pressed.delete(code);
    this.write(`ku ${vk}`);
  }
  type(text) {
    this.write(`t ${Buffer.from(text, "utf8").toString("base64")}`);
  }
  combo(name) {
    if (name === "ctrl-alt-del") {
      // Ctrl+Alt+Del e a Secure Attention Sequence: por design do Windows,
      // nenhum processo em modo usuario consegue simula-la.
      return false;
    }
    const [sequence] = COMBOS[name]?.win ?? [];
    if (!Array.isArray(sequence)) return false;
    for (const vk of sequence) this.write(`kd ${vk}`);
    for (const vk of [...sequence].reverse()) this.write(`ku ${vk}`);
    return true;
  }
}

async function probeWindowsDisplays() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms;",
    'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public static class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }\';',
    "[void][Dpi]::SetProcessDPIAware();",
    "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object {",
    "  '{0}|{1}|{2}|{3}|{4}|{5}' -f $_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height,$_.Primary,$_.DeviceName }",
  ].join(" ");

  const { error, stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  if (error) return [{ id: 0, label: "Tela", width: 1920, height: 1080, x: 0, y: 0, primary: true }];

  const displays = stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const [x, y, width, height, primary, name] = line.split("|");
      return {
        id: index,
        label: (name ?? `Tela ${index + 1}`).replace(/^\\\\\.\\/, ""),
        width: Number(width),
        height: Number(height),
        x: Number(x),
        y: Number(y),
        primary: String(primary).toLowerCase() === "true",
      };
    })
    .filter((d) => d.width > 0 && d.height > 0);

  return displays.length ? displays : [{ id: 0, label: "Tela", width: 1920, height: 1080, x: 0, y: 0, primary: true }];
}

/* ------------------------------------------------------------------ */
/* macOS — osascript (JXA) + CoreGraphics                              */
/* ------------------------------------------------------------------ */

const MAC_DISPLAY_SCRIPT = `
ObjC.import('Cocoa');
var screens = $.NSScreen.screens;
var main = $.NSScreen.screens.objectAtIndex(0).frame;
var out = [];
for (var i = 0; i < screens.count; i++) {
  var f = screens.objectAtIndex(i).frame;
  out.push({
    id: i,
    label: 'Tela ' + (i + 1),
    width: Math.round(f.size.width),
    height: Math.round(f.size.height),
    x: Math.round(f.origin.x),
    // NSScreen tem origem embaixo a esquerda; CGEvent usa em cima a esquerda.
    y: Math.round(main.size.height - (f.origin.y + f.size.height)),
    primary: i === 0
  });
}
JSON.stringify(out);
`;

class MacBackend extends Backend {
  static async create() {
    const backend = new MacBackend("coregraphics");
    backend.displays = await probeMacDisplays();
    backend.child = spawn("osascript", ["-l", "JavaScript", path.join(HERE, "mac-helper.js")], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    backend.child.stderr?.on("data", (data) => {
      const text = String(data).trim();
      if (text) console.error("[agente] osascript:", text);
    });
    backend.warning =
      "Conceda Acessibilidade ao aplicativo que iniciou o agente em Ajustes do Sistema > Privacidade e Seguranca > Acessibilidade. Sem isso o macOS ignora os eventos silenciosamente.";
    return backend;
  }

  move(x, y) {
    this.write(`m ${Math.round(x)} ${Math.round(y)}`);
  }
  down(button) {
    this.write(`d ${button}`);
  }
  up(button) {
    this.write(`u ${button}`);
  }
  wheel(dx, dy) {
    this.write(`w ${Math.round(dx)} ${Math.round(dy)}`);
  }
  keyDown(code) {
    const key = KEYMAP[code]?.mac;
    if (key === undefined) return;
    this.pressed.add(code);
    this.write(`kd ${key}`);
  }
  keyUp(code) {
    const key = KEYMAP[code]?.mac;
    if (key === undefined) return;
    this.pressed.delete(code);
    this.write(`ku ${key}`);
  }
  type(text) {
    this.write(`t ${Buffer.from(text, "utf8").toString("base64")}`);
  }
  combo(name) {
    const [sequence] = COMBOS[name]?.mac ?? [];
    if (!Array.isArray(sequence)) return false;
    for (const key of sequence) this.write(`kd ${key}`);
    for (const key of [...sequence].reverse()) this.write(`ku ${key}`);
    return true;
  }
}

async function probeMacDisplays() {
  const { error, stdout } = await run("osascript", ["-l", "JavaScript"], { input: MAC_DISPLAY_SCRIPT });
  if (!error) {
    try {
      const parsed = JSON.parse(stdout.trim());
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* saida inesperada: cai no padrao abaixo */
    }
  }
  return [{ id: 0, label: "Tela", width: 1920, height: 1080, x: 0, y: 0, primary: true }];
}

/* ------------------------------------------------------------------ */

export async function createBackend() {
  switch (os.platform()) {
    case "win32":
      return WindowsBackend.create();
    case "darwin":
      return MacBackend.create();
    case "linux":
      return LinuxBackend.create();
    default:
      throw new Error(`Sistema nao suportado: ${os.platform()}`);
  }
}
