// Executor de entrada do REMOTO no macOS (JXA + CoreGraphics).
//
// Roda com `osascript -l JavaScript mac-helper.js` — o osascript faz parte do
// sistema, entao nada precisa ser instalado. O processo fica vivo lendo
// comandos do stdin, um por linha.
//
// EXIGE permissao de Acessibilidade para o aplicativo que iniciou o agente
// (Terminal, iTerm, VS Code...): Ajustes do Sistema > Privacidade e Seguranca
// > Acessibilidade. Sem isso o macOS descarta os eventos em silencio.

ObjC.import('Foundation');
try { ObjC.import('CoreGraphics'); } catch (e) { ObjC.import('Quartz'); }

var HID_TAP = 0;

// Constantes de CGEventType.
var EV = {
  leftDown: 1, leftUp: 2, rightDown: 3, rightUp: 4, moved: 5,
  leftDragged: 6, rightDragged: 7, scroll: 22,
  otherDown: 25, otherUp: 26, otherDragged: 27,
};

// CGMouseButton
var BTN = { left: 0, right: 1, center: 2 };

var lastX = 0;
var lastY = 0;
var down = { 0: false, 1: false, 2: false };

function point(x, y) {
  return $.CGPointMake(x, y);
}

function postMouse(type, x, y, button) {
  var ev = $.CGEventCreateMouseEvent($(), type, point(x, y), button);
  if (ev) { $.CGEventPost(HID_TAP, ev); $.CFRelease(ev); }
}

function move(x, y) {
  lastX = x; lastY = y;
  // Arrastar exige o tipo "dragged": um "moved" com o botao pressionado nao
  // e interpretado como arrasto por boa parte dos aplicativos.
  if (down[0]) postMouse(EV.leftDragged, x, y, BTN.left);
  else if (down[2]) postMouse(EV.rightDragged, x, y, BTN.right);
  else if (down[1]) postMouse(EV.otherDragged, x, y, BTN.center);
  else postMouse(EV.moved, x, y, BTN.left);
}

function button(index, isDown) {
  down[index] = isDown;
  if (index === 0) postMouse(isDown ? EV.leftDown : EV.leftUp, lastX, lastY, BTN.left);
  else if (index === 2) postMouse(isDown ? EV.rightDown : EV.rightUp, lastX, lastY, BTN.right);
  else postMouse(isDown ? EV.otherDown : EV.otherUp, lastX, lastY, BTN.center);
}

function scroll(dx, dy) {
  try {
    // unidade 0 = pixels; a direcao do CG e oposta a do deltaY do DOM.
    var ev = $.CGEventCreateScrollWheelEvent($(), 0, 2, -dy, -dx);
    if (ev) { $.CGEventPost(HID_TAP, ev); $.CFRelease(ev); }
  } catch (e) { /* variadica indisponivel nesta versao do bridge */ }
}

function key(code, isDown) {
  var ev = $.CGEventCreateKeyboardEvent($(), code, isDown);
  if (ev) { $.CGEventPost(HID_TAP, ev); $.CFRelease(ev); }
}

var systemEvents = null;
function type(text) {
  if (!systemEvents) systemEvents = Application('System Events');
  // Quebras de linha viram Return; keystroke as ignoraria.
  var parts = text.split('\n');
  for (var i = 0; i < parts.length; i++) {
    if (parts[i]) systemEvents.keystroke(parts[i]);
    if (i < parts.length - 1) systemEvents.keyCode(36);
  }
}

function handle(line) {
  var p = line.split(' ');
  switch (p[0]) {
    case 'm': move(parseFloat(p[1]), parseFloat(p[2])); break;
    case 'd': button(parseInt(p[1], 10), true); break;
    case 'u': button(parseInt(p[1], 10), false); break;
    case 'w': scroll(parseInt(p[1], 10), parseInt(p[2], 10)); break;
    case 'kd': key(parseInt(p[1], 10), true); break;
    case 'ku': key(parseInt(p[1], 10), false); break;
    case 't': type($.NSString.alloc.initWithDataEncoding(
      $.NSData.alloc.initWithBase64EncodedStringOptions($(p[1]), 0),
      $.NSUTF8StringEncoding).js); break;
  }
}

function run() {
  var handle_ = $.NSFileHandle.fileHandleWithStandardInput;
  var buffer = '';
  while (true) {
    var data = handle_.availableData;
    if (!data || data.length === 0) break; // stdin fechado: o agente saiu
    buffer += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    var index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      var line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.length) {
        try { handle(line); } catch (e) { /* comando invalido nao derruba o loop */ }
      }
    }
  }
}

run();
