# Executor de entrada do REMOTO no Windows.
#
# Fica vivo lendo comandos do stdin, um por linha. Manter um unico processo e
# essencial: subir um powershell.exe por evento custaria ~200 ms e tornaria o
# controle remoto inutilizavel.
#
# Nao instala nada — usa apenas user32.dll, que faz parte do sistema.

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class RemotoNative {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT { public uint type; public InputUnion U; }

    const uint INPUT_KEYBOARD = 1;
    const uint KEYEVENTF_KEYUP = 0x0002;
    const uint KEYEVENTF_UNICODE = 0x0004;

    // KEYEVENTF_UNICODE injeta o caractere direto, sem depender do layout
    // ativo. E o unico jeito de digitar acentos e emoji de forma confiavel.
    public static void TypeUnicode(string text) {
        if (string.IsNullOrEmpty(text)) return;
        var list = new System.Collections.Generic.List<INPUT>();
        foreach (char ch in text) {
            for (int up = 0; up < 2; up++) {
                var input = new INPUT();
                input.type = INPUT_KEYBOARD;
                input.U.ki.wVk = 0;
                input.U.ki.wScan = ch;
                input.U.ki.dwFlags = KEYEVENTF_UNICODE | (up == 1 ? KEYEVENTF_KEYUP : 0);
                input.U.ki.time = 0;
                input.U.ki.dwExtraInfo = IntPtr.Zero;
                list.Add(input);
            }
        }
        var arr = list.ToArray();
        SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }
}
'@

$MOUSEEVENTF_LEFTDOWN   = 0x0002
$MOUSEEVENTF_LEFTUP     = 0x0004
$MOUSEEVENTF_RIGHTDOWN  = 0x0008
$MOUSEEVENTF_RIGHTUP    = 0x0010
$MOUSEEVENTF_MIDDLEDOWN = 0x0020
$MOUSEEVENTF_MIDDLEUP   = 0x0040
$MOUSEEVENTF_WHEEL      = 0x0800
$MOUSEEVENTF_HWHEEL     = 0x1000
$KEYEVENTF_KEYUP        = 0x0002
$KEYEVENTF_EXTENDEDKEY  = 0x0001

# Teclas do bloco estendido precisam do flag; sem ele as setas e o Delete
# viram equivalentes do teclado numerico.
$EXTENDED = @(0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2D,0x2E,0x5B,0x5C,0x5D,0x6F,0xA3,0xA5)

function Invoke-Mouse([int]$button, [bool]$down) {
    switch ($button) {
        0 { $flag = if ($down) { $MOUSEEVENTF_LEFTDOWN }   else { $MOUSEEVENTF_LEFTUP } }
        1 { $flag = if ($down) { $MOUSEEVENTF_MIDDLEDOWN } else { $MOUSEEVENTF_MIDDLEUP } }
        2 { $flag = if ($down) { $MOUSEEVENTF_RIGHTDOWN }  else { $MOUSEEVENTF_RIGHTUP } }
        default { return }
    }
    [RemotoNative]::mouse_event($flag, 0, 0, 0, [IntPtr]::Zero)
}

function Invoke-Key([int]$vk, [bool]$down) {
    $flags = 0
    if ($EXTENDED -contains $vk) { $flags = $flags -bor $KEYEVENTF_EXTENDEDKEY }
    if (-not $down) { $flags = $flags -bor $KEYEVENTF_KEYUP }
    $scan = [RemotoNative]::MapVirtualKey([uint32]$vk, 0)
    [RemotoNative]::keybd_event([byte]$vk, [byte]$scan, [uint32]$flags, [IntPtr]::Zero)
}

Write-Output 'pronto'

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Length -eq 0) { continue }
    try {
        $p = $line.Split(' ')
        switch ($p[0]) {
            'm'  { [void][RemotoNative]::SetCursorPos([int]$p[1], [int]$p[2]) }
            'd'  { Invoke-Mouse ([int]$p[1]) $true }
            'u'  { Invoke-Mouse ([int]$p[1]) $false }
            'w'  {
                $dx = [int]$p[1]; $dy = [int]$p[2]
                # O Windows conta em "cliques" de 120 unidades e com o sinal
                # invertido em relacao ao deltaY do DOM.
                if ($dy -ne 0) { [RemotoNative]::mouse_event($MOUSEEVENTF_WHEEL, 0, 0, (-$dy), [IntPtr]::Zero) }
                if ($dx -ne 0) { [RemotoNative]::mouse_event($MOUSEEVENTF_HWHEEL, 0, 0, $dx, [IntPtr]::Zero) }
            }
            'kd' { Invoke-Key ([int]$p[1]) $true }
            'ku' { Invoke-Key ([int]$p[1]) $false }
            't'  {
                $text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))
                [RemotoNative]::TypeUnicode($text)
            }
        }
    } catch {
        # Um comando malformado nunca pode derrubar o executor.
        [Console]::Error.WriteLine("erro: $_")
    }
}
