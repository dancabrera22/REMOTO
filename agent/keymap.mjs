/**
 * Traducao de `KeyboardEvent.code` para os identificadores de cada sistema.
 *
 * Usamos `code` (a posicao fisica da tecla) e nao `key` (o caractere gerado):
 * assim o layout de teclado que vale e o da maquina controlada, como acontece
 * em qualquer acesso remoto nativo. Quem digita num teclado ABNT2 controlando
 * um US obtem o que o US produz — e e exatamente isso que se espera.
 *
 *   win  = Virtual-Key Code (user32)
 *   x11  = keysym aceito pelo xdotool
 *   mac  = virtual keycode (kVK_*, Carbon HIToolbox)
 */
export const KEYMAP = {
  /* letras */
  KeyA: { win: 0x41, x11: "a", mac: 0 },
  KeyB: { win: 0x42, x11: "b", mac: 11 },
  KeyC: { win: 0x43, x11: "c", mac: 8 },
  KeyD: { win: 0x44, x11: "d", mac: 2 },
  KeyE: { win: 0x45, x11: "e", mac: 14 },
  KeyF: { win: 0x46, x11: "f", mac: 3 },
  KeyG: { win: 0x47, x11: "g", mac: 5 },
  KeyH: { win: 0x48, x11: "h", mac: 4 },
  KeyI: { win: 0x49, x11: "i", mac: 34 },
  KeyJ: { win: 0x4a, x11: "j", mac: 38 },
  KeyK: { win: 0x4b, x11: "k", mac: 40 },
  KeyL: { win: 0x4c, x11: "l", mac: 37 },
  KeyM: { win: 0x4d, x11: "m", mac: 46 },
  KeyN: { win: 0x4e, x11: "n", mac: 45 },
  KeyO: { win: 0x4f, x11: "o", mac: 31 },
  KeyP: { win: 0x50, x11: "p", mac: 35 },
  KeyQ: { win: 0x51, x11: "q", mac: 12 },
  KeyR: { win: 0x52, x11: "r", mac: 15 },
  KeyS: { win: 0x53, x11: "s", mac: 1 },
  KeyT: { win: 0x54, x11: "t", mac: 17 },
  KeyU: { win: 0x55, x11: "u", mac: 32 },
  KeyV: { win: 0x56, x11: "v", mac: 9 },
  KeyW: { win: 0x57, x11: "w", mac: 13 },
  KeyX: { win: 0x58, x11: "x", mac: 7 },
  KeyY: { win: 0x59, x11: "y", mac: 16 },
  KeyZ: { win: 0x5a, x11: "z", mac: 6 },

  /* fileira numerica */
  Digit0: { win: 0x30, x11: "0", mac: 29 },
  Digit1: { win: 0x31, x11: "1", mac: 18 },
  Digit2: { win: 0x32, x11: "2", mac: 19 },
  Digit3: { win: 0x33, x11: "3", mac: 20 },
  Digit4: { win: 0x34, x11: "4", mac: 21 },
  Digit5: { win: 0x35, x11: "5", mac: 23 },
  Digit6: { win: 0x36, x11: "6", mac: 22 },
  Digit7: { win: 0x37, x11: "7", mac: 26 },
  Digit8: { win: 0x38, x11: "8", mac: 28 },
  Digit9: { win: 0x39, x11: "9", mac: 25 },

  /* controle */
  Escape: { win: 0x1b, x11: "Escape", mac: 53 },
  Tab: { win: 0x09, x11: "Tab", mac: 48 },
  CapsLock: { win: 0x14, x11: "Caps_Lock", mac: 57 },
  Space: { win: 0x20, x11: "space", mac: 49 },
  Enter: { win: 0x0d, x11: "Return", mac: 36 },
  Backspace: { win: 0x08, x11: "BackSpace", mac: 51 },
  Delete: { win: 0x2e, x11: "Delete", mac: 117 },
  Insert: { win: 0x2d, x11: "Insert", mac: 114 },
  Home: { win: 0x24, x11: "Home", mac: 115 },
  End: { win: 0x23, x11: "End", mac: 119 },
  PageUp: { win: 0x21, x11: "Prior", mac: 116 },
  PageDown: { win: 0x22, x11: "Next", mac: 121 },
  ArrowLeft: { win: 0x25, x11: "Left", mac: 123 },
  ArrowUp: { win: 0x26, x11: "Up", mac: 126 },
  ArrowRight: { win: 0x27, x11: "Right", mac: 124 },
  ArrowDown: { win: 0x28, x11: "Down", mac: 125 },
  PrintScreen: { win: 0x2c, x11: "Print", mac: 105 },
  ScrollLock: { win: 0x91, x11: "Scroll_Lock", mac: 107 },
  Pause: { win: 0x13, x11: "Pause", mac: 113 },
  ContextMenu: { win: 0x5d, x11: "Menu", mac: 110 },

  /* modificadores */
  ShiftLeft: { win: 0xa0, x11: "Shift_L", mac: 56 },
  ShiftRight: { win: 0xa1, x11: "Shift_R", mac: 60 },
  ControlLeft: { win: 0xa2, x11: "Control_L", mac: 59 },
  ControlRight: { win: 0xa3, x11: "Control_R", mac: 62 },
  AltLeft: { win: 0xa4, x11: "Alt_L", mac: 58 },
  AltRight: { win: 0xa5, x11: "ISO_Level3_Shift", mac: 61 },
  MetaLeft: { win: 0x5b, x11: "Super_L", mac: 55 },
  MetaRight: { win: 0x5c, x11: "Super_R", mac: 54 },

  /* pontuacao (posicoes do layout US) */
  Semicolon: { win: 0xba, x11: "semicolon", mac: 41 },
  Equal: { win: 0xbb, x11: "equal", mac: 24 },
  Comma: { win: 0xbc, x11: "comma", mac: 43 },
  Minus: { win: 0xbd, x11: "minus", mac: 27 },
  Period: { win: 0xbe, x11: "period", mac: 47 },
  Slash: { win: 0xbf, x11: "slash", mac: 44 },
  Backquote: { win: 0xc0, x11: "grave", mac: 50 },
  BracketLeft: { win: 0xdb, x11: "bracketleft", mac: 33 },
  Backslash: { win: 0xdc, x11: "backslash", mac: 42 },
  BracketRight: { win: 0xdd, x11: "bracketright", mac: 30 },
  Quote: { win: 0xde, x11: "apostrophe", mac: 39 },
  IntlBackslash: { win: 0xe2, x11: "less", mac: 10 },
  IntlRo: { win: 0xc1, x11: "slash", mac: 94 },

  /* teclado numerico */
  NumLock: { win: 0x90, x11: "Num_Lock", mac: 71 },
  Numpad0: { win: 0x60, x11: "KP_0", mac: 82 },
  Numpad1: { win: 0x61, x11: "KP_1", mac: 83 },
  Numpad2: { win: 0x62, x11: "KP_2", mac: 84 },
  Numpad3: { win: 0x63, x11: "KP_3", mac: 85 },
  Numpad4: { win: 0x64, x11: "KP_4", mac: 86 },
  Numpad5: { win: 0x65, x11: "KP_5", mac: 87 },
  Numpad6: { win: 0x66, x11: "KP_6", mac: 88 },
  Numpad7: { win: 0x67, x11: "KP_7", mac: 89 },
  Numpad8: { win: 0x68, x11: "KP_8", mac: 91 },
  Numpad9: { win: 0x69, x11: "KP_9", mac: 92 },
  NumpadMultiply: { win: 0x6a, x11: "KP_Multiply", mac: 67 },
  NumpadAdd: { win: 0x6b, x11: "KP_Add", mac: 69 },
  NumpadSubtract: { win: 0x6d, x11: "KP_Subtract", mac: 78 },
  NumpadDecimal: { win: 0x6e, x11: "KP_Decimal", mac: 65 },
  NumpadDivide: { win: 0x6f, x11: "KP_Divide", mac: 75 },
  NumpadEnter: { win: 0x0d, x11: "KP_Enter", mac: 76 },

  /* funcao */
  F1: { win: 0x70, x11: "F1", mac: 122 },
  F2: { win: 0x71, x11: "F2", mac: 120 },
  F3: { win: 0x72, x11: "F3", mac: 99 },
  F4: { win: 0x73, x11: "F4", mac: 118 },
  F5: { win: 0x74, x11: "F5", mac: 96 },
  F6: { win: 0x75, x11: "F6", mac: 97 },
  F7: { win: 0x76, x11: "F7", mac: 98 },
  F8: { win: 0x77, x11: "F8", mac: 100 },
  F9: { win: 0x78, x11: "F9", mac: 101 },
  F10: { win: 0x79, x11: "F10", mac: 109 },
  F11: { win: 0x7a, x11: "F11", mac: 103 },
  F12: { win: 0x7b, x11: "F12", mac: 111 },
};

/**
 * Atalhos que o navegador nunca entrega ao JavaScript (o sistema local
 * intercepta antes). Chegam ate aqui como um comando nomeado.
 */
export const COMBOS = {
  "ctrl-alt-del": {
    x11: ["ctrl+alt+Delete"],
    win: ["SAS"], // caso especial: exige SendSAS, tratado a parte
    mac: [],
  },
  "alt-tab": {
    x11: ["alt+Tab"],
    win: [[0xa4, 0x09]],
    mac: [[55, 48]],
  },
  win: {
    x11: ["Super_L"],
    win: [[0x5b]],
    mac: [],
  },
  "cmd-space": {
    x11: [],
    win: [],
    mac: [[55, 49]],
  },
  "print-screen": {
    x11: ["Print"],
    win: [[0x2c]],
    mac: [[56, 55, 20]], // shift+cmd+3
  },
  "lock-screen": {
    x11: [],
    win: [[0x5b, 0x4c]], // Win+L
    mac: [[59, 55, 12]], // ctrl+cmd+q
  },
};
