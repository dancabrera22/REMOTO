#!/usr/bin/env node
/**
 * REMOTO — agente local (arquivo unico, gerado por scripts/build-agent.mjs).
 *
 * Nao edite aqui: mexa em agent/ e rode `npm run build:agent`.
 *
 *   node agente.mjs
 *
 * Nao instala nada, nao pede administrador, nao abre porta na rede — escuta
 * apenas em 127.0.0.1 e encerra quando voce fechar esta janela.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Auxiliares de plataforma embutidos; gravados em pasta temporaria no arranque.
globalThis.__REMOTO_EMBEDDED__ = {"mac-helper.js":"Ly8gRXhlY3V0b3IgZGUgZW50cmFkYSBkbyBSRU1PVE8gbm8gbWFjT1MgKEpYQSArIENvcmVHcmFwaGljcykuCi8vCi8vIFJvZGEgY29tIGBvc2FzY3JpcHQgLWwgSmF2YVNjcmlwdCBtYWMtaGVscGVyLmpzYCDigJQgbyBvc2FzY3JpcHQgZmF6IHBhcnRlIGRvCi8vIHNpc3RlbWEsIGVudGFvIG5hZGEgcHJlY2lzYSBzZXIgaW5zdGFsYWRvLiBPIHByb2Nlc3NvIGZpY2Egdml2byBsZW5kbwovLyBjb21hbmRvcyBkbyBzdGRpbiwgdW0gcG9yIGxpbmhhLgovLwovLyBFWElHRSBwZXJtaXNzYW8gZGUgQWNlc3NpYmlsaWRhZGUgcGFyYSBvIGFwbGljYXRpdm8gcXVlIGluaWNpb3UgbyBhZ2VudGUKLy8gKFRlcm1pbmFsLCBpVGVybSwgVlMgQ29kZS4uLik6IEFqdXN0ZXMgZG8gU2lzdGVtYSA+IFByaXZhY2lkYWRlIGUgU2VndXJhbmNhCi8vID4gQWNlc3NpYmlsaWRhZGUuIFNlbSBpc3NvIG8gbWFjT1MgZGVzY2FydGEgb3MgZXZlbnRvcyBlbSBzaWxlbmNpby4KCk9iakMuaW1wb3J0KCdGb3VuZGF0aW9uJyk7CnRyeSB7IE9iakMuaW1wb3J0KCdDb3JlR3JhcGhpY3MnKTsgfSBjYXRjaCAoZSkgeyBPYmpDLmltcG9ydCgnUXVhcnR6Jyk7IH0KCnZhciBISURfVEFQID0gMDsKCi8vIENvbnN0YW50ZXMgZGUgQ0dFdmVudFR5cGUuCnZhciBFViA9IHsKICBsZWZ0RG93bjogMSwgbGVmdFVwOiAyLCByaWdodERvd246IDMsIHJpZ2h0VXA6IDQsIG1vdmVkOiA1LAogIGxlZnREcmFnZ2VkOiA2LCByaWdodERyYWdnZWQ6IDcsIHNjcm9sbDogMjIsCiAgb3RoZXJEb3duOiAyNSwgb3RoZXJVcDogMjYsIG90aGVyRHJhZ2dlZDogMjcsCn07CgovLyBDR01vdXNlQnV0dG9uCnZhciBCVE4gPSB7IGxlZnQ6IDAsIHJpZ2h0OiAxLCBjZW50ZXI6IDIgfTsKCnZhciBsYXN0WCA9IDA7CnZhciBsYXN0WSA9IDA7CnZhciBkb3duID0geyAwOiBmYWxzZSwgMTogZmFsc2UsIDI6IGZhbHNlIH07CgpmdW5jdGlvbiBwb2ludCh4LCB5KSB7CiAgcmV0dXJuICQuQ0dQb2ludE1ha2UoeCwgeSk7Cn0KCmZ1bmN0aW9uIHBvc3RNb3VzZSh0eXBlLCB4LCB5LCBidXR0b24pIHsKICB2YXIgZXYgPSAkLkNHRXZlbnRDcmVhdGVNb3VzZUV2ZW50KCQoKSwgdHlwZSwgcG9pbnQoeCwgeSksIGJ1dHRvbik7CiAgaWYgKGV2KSB7ICQuQ0dFdmVudFBvc3QoSElEX1RBUCwgZXYpOyAkLkNGUmVsZWFzZShldik7IH0KfQoKZnVuY3Rpb24gbW92ZSh4LCB5KSB7CiAgbGFzdFggPSB4OyBsYXN0WSA9IHk7CiAgLy8gQXJyYXN0YXIgZXhpZ2UgbyB0aXBvICJkcmFnZ2VkIjogdW0gIm1vdmVkIiBjb20gbyBib3RhbyBwcmVzc2lvbmFkbyBuYW8KICAvLyBlIGludGVycHJldGFkbyBjb21vIGFycmFzdG8gcG9yIGJvYSBwYXJ0ZSBkb3MgYXBsaWNhdGl2b3MuCiAgaWYgKGRvd25bMF0pIHBvc3RNb3VzZShFVi5sZWZ0RHJhZ2dlZCwgeCwgeSwgQlROLmxlZnQpOwogIGVsc2UgaWYgKGRvd25bMl0pIHBvc3RNb3VzZShFVi5yaWdodERyYWdnZWQsIHgsIHksIEJUTi5yaWdodCk7CiAgZWxzZSBpZiAoZG93blsxXSkgcG9zdE1vdXNlKEVWLm90aGVyRHJhZ2dlZCwgeCwgeSwgQlROLmNlbnRlcik7CiAgZWxzZSBwb3N0TW91c2UoRVYubW92ZWQsIHgsIHksIEJUTi5sZWZ0KTsKfQoKZnVuY3Rpb24gYnV0dG9uKGluZGV4LCBpc0Rvd24pIHsKICBkb3duW2luZGV4XSA9IGlzRG93bjsKICBpZiAoaW5kZXggPT09IDApIHBvc3RNb3VzZShpc0Rvd24gPyBFVi5sZWZ0RG93biA6IEVWLmxlZnRVcCwgbGFzdFgsIGxhc3RZLCBCVE4ubGVmdCk7CiAgZWxzZSBpZiAoaW5kZXggPT09IDIpIHBvc3RNb3VzZShpc0Rvd24gPyBFVi5yaWdodERvd24gOiBFVi5yaWdodFVwLCBsYXN0WCwgbGFzdFksIEJUTi5yaWdodCk7CiAgZWxzZSBwb3N0TW91c2UoaXNEb3duID8gRVYub3RoZXJEb3duIDogRVYub3RoZXJVcCwgbGFzdFgsIGxhc3RZLCBCVE4uY2VudGVyKTsKfQoKZnVuY3Rpb24gc2Nyb2xsKGR4LCBkeSkgewogIHRyeSB7CiAgICAvLyB1bmlkYWRlIDAgPSBwaXhlbHM7IGEgZGlyZWNhbyBkbyBDRyBlIG9wb3N0YSBhIGRvIGRlbHRhWSBkbyBET00uCiAgICB2YXIgZXYgPSAkLkNHRXZlbnRDcmVhdGVTY3JvbGxXaGVlbEV2ZW50KCQoKSwgMCwgMiwgLWR5LCAtZHgpOwogICAgaWYgKGV2KSB7ICQuQ0dFdmVudFBvc3QoSElEX1RBUCwgZXYpOyAkLkNGUmVsZWFzZShldik7IH0KICB9IGNhdGNoIChlKSB7IC8qIHZhcmlhZGljYSBpbmRpc3Bvbml2ZWwgbmVzdGEgdmVyc2FvIGRvIGJyaWRnZSAqLyB9Cn0KCmZ1bmN0aW9uIGtleShjb2RlLCBpc0Rvd24pIHsKICB2YXIgZXYgPSAkLkNHRXZlbnRDcmVhdGVLZXlib2FyZEV2ZW50KCQoKSwgY29kZSwgaXNEb3duKTsKICBpZiAoZXYpIHsgJC5DR0V2ZW50UG9zdChISURfVEFQLCBldik7ICQuQ0ZSZWxlYXNlKGV2KTsgfQp9Cgp2YXIgc3lzdGVtRXZlbnRzID0gbnVsbDsKZnVuY3Rpb24gdHlwZSh0ZXh0KSB7CiAgaWYgKCFzeXN0ZW1FdmVudHMpIHN5c3RlbUV2ZW50cyA9IEFwcGxpY2F0aW9uKCdTeXN0ZW0gRXZlbnRzJyk7CiAgLy8gUXVlYnJhcyBkZSBsaW5oYSB2aXJhbSBSZXR1cm47IGtleXN0cm9rZSBhcyBpZ25vcmFyaWEuCiAgdmFyIHBhcnRzID0gdGV4dC5zcGxpdCgnXG4nKTsKICBmb3IgKHZhciBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7CiAgICBpZiAocGFydHNbaV0pIHN5c3RlbUV2ZW50cy5rZXlzdHJva2UocGFydHNbaV0pOwogICAgaWYgKGkgPCBwYXJ0cy5sZW5ndGggLSAxKSBzeXN0ZW1FdmVudHMua2V5Q29kZSgzNik7CiAgfQp9CgpmdW5jdGlvbiBoYW5kbGUobGluZSkgewogIHZhciBwID0gbGluZS5zcGxpdCgnICcpOwogIHN3aXRjaCAocFswXSkgewogICAgY2FzZSAnbSc6IG1vdmUocGFyc2VGbG9hdChwWzFdKSwgcGFyc2VGbG9hdChwWzJdKSk7IGJyZWFrOwogICAgY2FzZSAnZCc6IGJ1dHRvbihwYXJzZUludChwWzFdLCAxMCksIHRydWUpOyBicmVhazsKICAgIGNhc2UgJ3UnOiBidXR0b24ocGFyc2VJbnQocFsxXSwgMTApLCBmYWxzZSk7IGJyZWFrOwogICAgY2FzZSAndyc6IHNjcm9sbChwYXJzZUludChwWzFdLCAxMCksIHBhcnNlSW50KHBbMl0sIDEwKSk7IGJyZWFrOwogICAgY2FzZSAna2QnOiBrZXkocGFyc2VJbnQocFsxXSwgMTApLCB0cnVlKTsgYnJlYWs7CiAgICBjYXNlICdrdSc6IGtleShwYXJzZUludChwWzFdLCAxMCksIGZhbHNlKTsgYnJlYWs7CiAgICBjYXNlICd0JzogdHlwZSgkLk5TU3RyaW5nLmFsbG9jLmluaXRXaXRoRGF0YUVuY29kaW5nKAogICAgICAkLk5TRGF0YS5hbGxvYy5pbml0V2l0aEJhc2U2NEVuY29kZWRTdHJpbmdPcHRpb25zKCQocFsxXSksIDApLAogICAgICAkLk5TVVRGOFN0cmluZ0VuY29kaW5nKS5qcyk7IGJyZWFrOwogIH0KfQoKZnVuY3Rpb24gcnVuKCkgewogIHZhciBoYW5kbGVfID0gJC5OU0ZpbGVIYW5kbGUuZmlsZUhhbmRsZVdpdGhTdGFuZGFyZElucHV0OwogIHZhciBidWZmZXIgPSAnJzsKICB3aGlsZSAodHJ1ZSkgewogICAgdmFyIGRhdGEgPSBoYW5kbGVfLmF2YWlsYWJsZURhdGE7CiAgICBpZiAoIWRhdGEgfHwgZGF0YS5sZW5ndGggPT09IDApIGJyZWFrOyAvLyBzdGRpbiBmZWNoYWRvOiBvIGFnZW50ZSBzYWl1CiAgICBidWZmZXIgKz0gJC5OU1N0cmluZy5hbGxvYy5pbml0V2l0aERhdGFFbmNvZGluZyhkYXRhLCAkLk5TVVRGOFN0cmluZ0VuY29kaW5nKS5qczsKICAgIHZhciBpbmRleDsKICAgIHdoaWxlICgoaW5kZXggPSBidWZmZXIuaW5kZXhPZignXG4nKSkgPj0gMCkgewogICAgICB2YXIgbGluZSA9IGJ1ZmZlci5zbGljZSgwLCBpbmRleCk7CiAgICAgIGJ1ZmZlciA9IGJ1ZmZlci5zbGljZShpbmRleCArIDEpOwogICAgICBpZiAobGluZS5sZW5ndGgpIHsKICAgICAgICB0cnkgeyBoYW5kbGUobGluZSk7IH0gY2F0Y2ggKGUpIHsgLyogY29tYW5kbyBpbnZhbGlkbyBuYW8gZGVycnViYSBvIGxvb3AgKi8gfQogICAgICB9CiAgICB9CiAgfQp9CgpydW4oKTsK","win-helper.ps1":"IyBFeGVjdXRvciBkZSBlbnRyYWRhIGRvIFJFTU9UTyBubyBXaW5kb3dzLgojCiMgRmljYSB2aXZvIGxlbmRvIGNvbWFuZG9zIGRvIHN0ZGluLCB1bSBwb3IgbGluaGEuIE1hbnRlciB1bSB1bmljbyBwcm9jZXNzbyBlCiMgZXNzZW5jaWFsOiBzdWJpciB1bSBwb3dlcnNoZWxsLmV4ZSBwb3IgZXZlbnRvIGN1c3RhcmlhIH4yMDAgbXMgZSB0b3JuYXJpYSBvCiMgY29udHJvbGUgcmVtb3RvIGludXRpbGl6YXZlbC4KIwojIE5hbyBpbnN0YWxhIG5hZGEg4oCUIHVzYSBhcGVuYXMgdXNlcjMyLmRsbCwgcXVlIGZheiBwYXJ0ZSBkbyBzaXN0ZW1hLgoKJEVycm9yQWN0aW9uUHJlZmVyZW5jZSA9ICdTdG9wJwpbQ29uc29sZV06Ok91dHB1dEVuY29kaW5nID0gW1N5c3RlbS5UZXh0LkVuY29kaW5nXTo6VVRGOAoKQWRkLVR5cGUgLVR5cGVEZWZpbml0aW9uIEAnCnVzaW5nIFN5c3RlbTsKdXNpbmcgU3lzdGVtLlJ1bnRpbWUuSW50ZXJvcFNlcnZpY2VzOwoKcHVibGljIHN0YXRpYyBjbGFzcyBSZW1vdG9OYXRpdmUgewogICAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiBib29sIFNldEN1cnNvclBvcyhpbnQgWCwgaW50IFkpOwogICAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIpXSBwdWJsaWMgc3RhdGljIGV4dGVybiB2b2lkIG1vdXNlX2V2ZW50KHVpbnQgZHdGbGFncywgaW50IGR4LCBpbnQgZHksIGludCBkd0RhdGEsIEludFB0ciBkd0V4dHJhSW5mbyk7CiAgICBbRGxsSW1wb3J0KCJ1c2VyMzIuZGxsIildIHB1YmxpYyBzdGF0aWMgZXh0ZXJuIHZvaWQga2V5YmRfZXZlbnQoYnl0ZSBiVmssIGJ5dGUgYlNjYW4sIHVpbnQgZHdGbGFncywgSW50UHRyIGR3RXh0cmFJbmZvKTsKICAgIFtEbGxJbXBvcnQoInVzZXIzMi5kbGwiKV0gcHVibGljIHN0YXRpYyBleHRlcm4gdWludCBNYXBWaXJ0dWFsS2V5KHVpbnQgdUNvZGUsIHVpbnQgdU1hcFR5cGUpOwogICAgW0RsbEltcG9ydCgidXNlcjMyLmRsbCIsIFNldExhc3RFcnJvciA9IHRydWUpXSBzdGF0aWMgZXh0ZXJuIHVpbnQgU2VuZElucHV0KHVpbnQgbklucHV0cywgSU5QVVRbXSBwSW5wdXRzLCBpbnQgY2JTaXplKTsKCiAgICBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCldCiAgICBzdHJ1Y3QgS0VZQkRJTlBVVCB7IHB1YmxpYyB1c2hvcnQgd1ZrOyBwdWJsaWMgdXNob3J0IHdTY2FuOyBwdWJsaWMgdWludCBkd0ZsYWdzOyBwdWJsaWMgdWludCB0aW1lOyBwdWJsaWMgSW50UHRyIGR3RXh0cmFJbmZvOyB9CgogICAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLlNlcXVlbnRpYWwpXQogICAgc3RydWN0IE1PVVNFSU5QVVQgeyBwdWJsaWMgaW50IGR4OyBwdWJsaWMgaW50IGR5OyBwdWJsaWMgdWludCBtb3VzZURhdGE7IHB1YmxpYyB1aW50IGR3RmxhZ3M7IHB1YmxpYyB1aW50IHRpbWU7IHB1YmxpYyBJbnRQdHIgZHdFeHRyYUluZm87IH0KCiAgICBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCldCiAgICBzdHJ1Y3QgSEFSRFdBUkVJTlBVVCB7IHB1YmxpYyB1aW50IHVNc2c7IHB1YmxpYyB1c2hvcnQgd1BhcmFtTDsgcHVibGljIHVzaG9ydCB3UGFyYW1IOyB9CgogICAgW1N0cnVjdExheW91dChMYXlvdXRLaW5kLkV4cGxpY2l0KV0KICAgIHN0cnVjdCBJbnB1dFVuaW9uIHsKICAgICAgICBbRmllbGRPZmZzZXQoMCldIHB1YmxpYyBNT1VTRUlOUFVUIG1pOwogICAgICAgIFtGaWVsZE9mZnNldCgwKV0gcHVibGljIEtFWUJESU5QVVQga2k7CiAgICAgICAgW0ZpZWxkT2Zmc2V0KDApXSBwdWJsaWMgSEFSRFdBUkVJTlBVVCBoaTsKICAgIH0KCiAgICBbU3RydWN0TGF5b3V0KExheW91dEtpbmQuU2VxdWVudGlhbCldCiAgICBzdHJ1Y3QgSU5QVVQgeyBwdWJsaWMgdWludCB0eXBlOyBwdWJsaWMgSW5wdXRVbmlvbiBVOyB9CgogICAgY29uc3QgdWludCBJTlBVVF9LRVlCT0FSRCA9IDE7CiAgICBjb25zdCB1aW50IEtFWUVWRU5URl9LRVlVUCA9IDB4MDAwMjsKICAgIGNvbnN0IHVpbnQgS0VZRVZFTlRGX1VOSUNPREUgPSAweDAwMDQ7CgogICAgLy8gS0VZRVZFTlRGX1VOSUNPREUgaW5qZXRhIG8gY2FyYWN0ZXJlIGRpcmV0bywgc2VtIGRlcGVuZGVyIGRvIGxheW91dAogICAgLy8gYXRpdm8uIEUgbyB1bmljbyBqZWl0byBkZSBkaWdpdGFyIGFjZW50b3MgZSBlbW9qaSBkZSBmb3JtYSBjb25maWF2ZWwuCiAgICBwdWJsaWMgc3RhdGljIHZvaWQgVHlwZVVuaWNvZGUoc3RyaW5nIHRleHQpIHsKICAgICAgICBpZiAoc3RyaW5nLklzTnVsbE9yRW1wdHkodGV4dCkpIHJldHVybjsKICAgICAgICB2YXIgbGlzdCA9IG5ldyBTeXN0ZW0uQ29sbGVjdGlvbnMuR2VuZXJpYy5MaXN0PElOUFVUPigpOwogICAgICAgIGZvcmVhY2ggKGNoYXIgY2ggaW4gdGV4dCkgewogICAgICAgICAgICBmb3IgKGludCB1cCA9IDA7IHVwIDwgMjsgdXArKykgewogICAgICAgICAgICAgICAgdmFyIGlucHV0ID0gbmV3IElOUFVUKCk7CiAgICAgICAgICAgICAgICBpbnB1dC50eXBlID0gSU5QVVRfS0VZQk9BUkQ7CiAgICAgICAgICAgICAgICBpbnB1dC5VLmtpLndWayA9IDA7CiAgICAgICAgICAgICAgICBpbnB1dC5VLmtpLndTY2FuID0gY2g7CiAgICAgICAgICAgICAgICBpbnB1dC5VLmtpLmR3RmxhZ3MgPSBLRVlFVkVOVEZfVU5JQ09ERSB8ICh1cCA9PSAxID8gS0VZRVZFTlRGX0tFWVVQIDogMCk7CiAgICAgICAgICAgICAgICBpbnB1dC5VLmtpLnRpbWUgPSAwOwogICAgICAgICAgICAgICAgaW5wdXQuVS5raS5kd0V4dHJhSW5mbyA9IEludFB0ci5aZXJvOwogICAgICAgICAgICAgICAgbGlzdC5BZGQoaW5wdXQpOwogICAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIHZhciBhcnIgPSBsaXN0LlRvQXJyYXkoKTsKICAgICAgICBTZW5kSW5wdXQoKHVpbnQpYXJyLkxlbmd0aCwgYXJyLCBNYXJzaGFsLlNpemVPZih0eXBlb2YoSU5QVVQpKSk7CiAgICB9Cn0KJ0AKCiRNT1VTRUVWRU5URl9MRUZURE9XTiAgID0gMHgwMDAyCiRNT1VTRUVWRU5URl9MRUZUVVAgICAgID0gMHgwMDA0CiRNT1VTRUVWRU5URl9SSUdIVERPV04gID0gMHgwMDA4CiRNT1VTRUVWRU5URl9SSUdIVFVQICAgID0gMHgwMDEwCiRNT1VTRUVWRU5URl9NSURETEVET1dOID0gMHgwMDIwCiRNT1VTRUVWRU5URl9NSURETEVVUCAgID0gMHgwMDQwCiRNT1VTRUVWRU5URl9XSEVFTCAgICAgID0gMHgwODAwCiRNT1VTRUVWRU5URl9IV0hFRUwgICAgID0gMHgxMDAwCiRLRVlFVkVOVEZfS0VZVVAgICAgICAgID0gMHgwMDAyCiRLRVlFVkVOVEZfRVhURU5ERURLRVkgID0gMHgwMDAxCgojIFRlY2xhcyBkbyBibG9jbyBlc3RlbmRpZG8gcHJlY2lzYW0gZG8gZmxhZzsgc2VtIGVsZSBhcyBzZXRhcyBlIG8gRGVsZXRlCiMgdmlyYW0gZXF1aXZhbGVudGVzIGRvIHRlY2xhZG8gbnVtZXJpY28uCiRFWFRFTkRFRCA9IEAoMHgyMSwweDIyLDB4MjMsMHgyNCwweDI1LDB4MjYsMHgyNywweDI4LDB4MkQsMHgyRSwweDVCLDB4NUMsMHg1RCwweDZGLDB4QTMsMHhBNSkKCmZ1bmN0aW9uIEludm9rZS1Nb3VzZShbaW50XSRidXR0b24sIFtib29sXSRkb3duKSB7CiAgICBzd2l0Y2ggKCRidXR0b24pIHsKICAgICAgICAwIHsgJGZsYWcgPSBpZiAoJGRvd24pIHsgJE1PVVNFRVZFTlRGX0xFRlRET1dOIH0gICBlbHNlIHsgJE1PVVNFRVZFTlRGX0xFRlRVUCB9IH0KICAgICAgICAxIHsgJGZsYWcgPSBpZiAoJGRvd24pIHsgJE1PVVNFRVZFTlRGX01JRERMRURPV04gfSBlbHNlIHsgJE1PVVNFRVZFTlRGX01JRERMRVVQIH0gfQogICAgICAgIDIgeyAkZmxhZyA9IGlmICgkZG93bikgeyAkTU9VU0VFVkVOVEZfUklHSFRET1dOIH0gIGVsc2UgeyAkTU9VU0VFVkVOVEZfUklHSFRVUCB9IH0KICAgICAgICBkZWZhdWx0IHsgcmV0dXJuIH0KICAgIH0KICAgIFtSZW1vdG9OYXRpdmVdOjptb3VzZV9ldmVudCgkZmxhZywgMCwgMCwgMCwgW0ludFB0cl06Olplcm8pCn0KCmZ1bmN0aW9uIEludm9rZS1LZXkoW2ludF0kdmssIFtib29sXSRkb3duKSB7CiAgICAkZmxhZ3MgPSAwCiAgICBpZiAoJEVYVEVOREVEIC1jb250YWlucyAkdmspIHsgJGZsYWdzID0gJGZsYWdzIC1ib3IgJEtFWUVWRU5URl9FWFRFTkRFREtFWSB9CiAgICBpZiAoLW5vdCAkZG93bikgeyAkZmxhZ3MgPSAkZmxhZ3MgLWJvciAkS0VZRVZFTlRGX0tFWVVQIH0KICAgICRzY2FuID0gW1JlbW90b05hdGl2ZV06Ok1hcFZpcnR1YWxLZXkoW3VpbnQzMl0kdmssIDApCiAgICBbUmVtb3RvTmF0aXZlXTo6a2V5YmRfZXZlbnQoW2J5dGVdJHZrLCBbYnl0ZV0kc2NhbiwgW3VpbnQzMl0kZmxhZ3MsIFtJbnRQdHJdOjpaZXJvKQp9CgpXcml0ZS1PdXRwdXQgJ3Byb250bycKCndoaWxlICgkdHJ1ZSkgewogICAgJGxpbmUgPSBbQ29uc29sZV06OkluLlJlYWRMaW5lKCkKICAgIGlmICgkbnVsbCAtZXEgJGxpbmUpIHsgYnJlYWsgfQogICAgaWYgKCRsaW5lLkxlbmd0aCAtZXEgMCkgeyBjb250aW51ZSB9CiAgICB0cnkgewogICAgICAgICRwID0gJGxpbmUuU3BsaXQoJyAnKQogICAgICAgIHN3aXRjaCAoJHBbMF0pIHsKICAgICAgICAgICAgJ20nICB7IFt2b2lkXVtSZW1vdG9OYXRpdmVdOjpTZXRDdXJzb3JQb3MoW2ludF0kcFsxXSwgW2ludF0kcFsyXSkgfQogICAgICAgICAgICAnZCcgIHsgSW52b2tlLU1vdXNlIChbaW50XSRwWzFdKSAkdHJ1ZSB9CiAgICAgICAgICAgICd1JyAgeyBJbnZva2UtTW91c2UgKFtpbnRdJHBbMV0pICRmYWxzZSB9CiAgICAgICAgICAgICd3JyAgewogICAgICAgICAgICAgICAgJGR4ID0gW2ludF0kcFsxXTsgJGR5ID0gW2ludF0kcFsyXQogICAgICAgICAgICAgICAgIyBPIFdpbmRvd3MgY29udGEgZW0gImNsaXF1ZXMiIGRlIDEyMCB1bmlkYWRlcyBlIGNvbSBvIHNpbmFsCiAgICAgICAgICAgICAgICAjIGludmVydGlkbyBlbSByZWxhY2FvIGFvIGRlbHRhWSBkbyBET00uCiAgICAgICAgICAgICAgICBpZiAoJGR5IC1uZSAwKSB7IFtSZW1vdG9OYXRpdmVdOjptb3VzZV9ldmVudCgkTU9VU0VFVkVOVEZfV0hFRUwsIDAsIDAsICgtJGR5KSwgW0ludFB0cl06Olplcm8pIH0KICAgICAgICAgICAgICAgIGlmICgkZHggLW5lIDApIHsgW1JlbW90b05hdGl2ZV06Om1vdXNlX2V2ZW50KCRNT1VTRUVWRU5URl9IV0hFRUwsIDAsIDAsICRkeCwgW0ludFB0cl06Olplcm8pIH0KICAgICAgICAgICAgfQogICAgICAgICAgICAna2QnIHsgSW52b2tlLUtleSAoW2ludF0kcFsxXSkgJHRydWUgfQogICAgICAgICAgICAna3UnIHsgSW52b2tlLUtleSAoW2ludF0kcFsxXSkgJGZhbHNlIH0KICAgICAgICAgICAgJ3QnICB7CiAgICAgICAgICAgICAgICAkdGV4dCA9IFtUZXh0LkVuY29kaW5nXTo6VVRGOC5HZXRTdHJpbmcoW0NvbnZlcnRdOjpGcm9tQmFzZTY0U3RyaW5nKCRwWzFdKSkKICAgICAgICAgICAgICAgIFtSZW1vdG9OYXRpdmVdOjpUeXBlVW5pY29kZSgkdGV4dCkKICAgICAgICAgICAgfQogICAgICAgIH0KICAgIH0gY2F0Y2ggewogICAgICAgICMgVW0gY29tYW5kbyBtYWxmb3JtYWRvIG51bmNhIHBvZGUgZGVycnViYXIgbyBleGVjdXRvci4KICAgICAgICBbQ29uc29sZV06OkVycm9yLldyaXRlTGluZSgiZXJybzogJF8iKQogICAgfQp9Cg=="};

/* ==================================================================
   keymap.mjs
   ================================================================== */

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
const KEYMAP = {
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
const COMBOS = {
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
/* ==================================================================
   backends.mjs
   ================================================================== */

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Localiza um auxiliar de plataforma.
 *
 * Rodando a partir do repositorio, ele esta na pasta ao lado. Rodando a
 * partir do arquivo unico baixado da implantacao, ele vem embutido em base64
 * e precisa existir em disco para ser executado — gravamos em pasta
 * temporaria, com permissao restrita ao dono.
 */
function helperPath(name) {
  const embedded = globalThis.__REMOTO_EMBEDDED__?.[name];
  if (!embedded) return path.join(HERE, name);

  const dir = path.join(os.tmpdir(), `remoto-agente-${process.getuid?.() ?? "win"}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(embedded, "base64"), { mode: 0o600 });
  return file;
}

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
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperPath("win-helper.ps1")],
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
    backend.child = spawn("osascript", ["-l", "JavaScript", helperPath("mac-helper.js")], {
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

async function createBackend() {
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
/* ==================================================================
   remoto-agent.mjs
   ================================================================== */

/**
 * Agente local do REMOTO.
 *
 * Por que ele existe: uma pagina web nao pode — e nao deve poder — mover o
 * mouse ou digitar no sistema operacional. Esse limite e do sandbox do
 * navegador, nao uma limitacao que se contorne com codigo esperto. Entao para
 * ter controle real (e nao so ver a tela) alguem precisa executar codigo fora
 * do sandbox.
 *
 * O que este agente NAO faz: nao instala nada, nao pede privilegio de
 * administrador, nao escreve no registro nem cria servico, nao abre porta na
 * rede (so 127.0.0.1) e nao fala com servidor nenhum. Ele so recebe eventos
 * de entrada da propria aba do navegador, pelo loopback, e some quando voce
 * fecha o terminal.
 *
 *   node agent/remoto-agent.mjs
 *
 * Uma vez publicado no npm, o mesmo efeito com: npx remoto-agent
 */


const VERSION = 3;
const PORTS = [45789, 45790, 45791, 45792, 45793];
/** Sem I, O, 0 e 1: o codigo e lido em voz alta e digitado a mao. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PAIR_ATTEMPTS = 12;

const args = parseArgs(process.argv.slice(2));

const state = {
  /** Codigo mostrado no terminal; some depois do pareamento. */
  pairingCode: randomCode(6),
  token: null,
  pairAttempts: 0,
  displayId: 0,
  lastActivity: 0,
  backend: null,
};

/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = { port: null, origin: null, quiet: false };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "port") out.port = Number(value);
    else if (key === "origin") out.origin = value;
    else if (key === "quiet") out.quiet = true;
    else if (key === "help" || key === "h") {
      console.log(
        [
          "Agente local do REMOTO",
          "",
          "  --port=45789          porta fixa no loopback (padrao: primeira livre)",
          "  --origin=https://...  aceita apenas essa origem (padrao: qualquer, com pareamento)",
          "  --quiet               menos mensagens",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }
  }
  return out;
}

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (args.origin && origin && origin !== args.origin) return false;
  res.setHeader("access-control-allow-origin", origin ?? "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  res.setHeader("access-control-max-age", "600");
  // O Chrome exige este cabecalho para deixar uma pagina publica falar com
  // um endereco privado (Private Network Access).
  if (req.headers["access-control-request-private-network"]) {
    res.setHeader("access-control-allow-private-network", "true");
  }
  res.setHeader("vary", "origin");
  return true;
}

function authorized(req) {
  if (!state.token) return false;
  const header = req.headers.authorization ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== state.token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(state.token));
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("corpo grande demais"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------------------ */
/* Aplicacao dos eventos                                               */
/* ------------------------------------------------------------------ */

function currentDisplay() {
  const list = state.backend.displays;
  return list.find((d) => d.id === state.displayId) ?? list[0];
}

/**
 * Coordenadas chegam normalizadas (0..1) contra a superficie compartilhada.
 * Aqui viram pixels absolutos da tela escolhida — por isso a pagina do
 * anfitriao pergunta qual monitor esta sendo compartilhado quando ha mais de
 * um: o `getDisplayMedia` nao revela essa informacao ao JavaScript.
 */
function toPixels(nx, ny) {
  const display = currentDisplay();
  const x = display.x + Math.min(Math.max(nx, 0), 1) * (display.width - 1);
  const y = display.y + Math.min(Math.max(ny, 0), 1) * (display.height - 1);
  return [x, y];
}

function applyEvents(events) {
  const backend = state.backend;
  let applied = 0;

  for (const event of events) {
    switch (event.k) {
      case "m": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        break;
      }
      case "d": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.down(event.b ?? 0);
        break;
      }
      case "u": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.up(event.b ?? 0);
        break;
      }
      case "c": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        for (let i = 0; i < Math.min(event.n ?? 1, 3); i++) {
          backend.down(event.b ?? 0);
          backend.up(event.b ?? 0);
        }
        break;
      }
      case "w": {
        const [x, y] = toPixels(event.x, event.y);
        backend.move(x, y);
        backend.wheel(event.dx ?? 0, event.dy ?? 0);
        break;
      }
      case "kd":
        backend.keyDown(event.c);
        break;
      case "ku":
        backend.keyUp(event.c);
        break;
      case "txt":
        if (typeof event.s === "string" && event.s.length <= 8192) backend.type(event.s);
        break;
      case "combo":
        backend.combo(event.s);
        break;
      default:
        continue;
    }
    applied += 1;
  }

  state.lastActivity = Date.now();
  return applied;
}

/* ------------------------------------------------------------------ */
/* Servidor                                                            */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  try {
    if (req.method === "GET" && url.pathname === "/hello") {
      json(res, 200, {
        version: VERSION,
        os: os.platform(),
        backend: state.backend.name,
        displays: state.backend.displays,
        // So confirmamos o pareamento a quem apresenta o token correto.
        paired: authorized(req),
        warning: state.backend.warning ?? null,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/pair") {
      if (state.pairAttempts >= MAX_PAIR_ATTEMPTS) {
        json(res, 429, { error: "tentativas_esgotadas" });
        return;
      }
      const body = await readBody(req, 1024);
      state.pairAttempts += 1;
      if (String(body.code ?? "").toUpperCase() !== state.pairingCode) {
        json(res, 403, { error: "codigo_invalido" });
        return;
      }
      state.token = crypto.randomBytes(32).toString("hex");
      state.pairAttempts = 0;
      console.log("\n  ✓ Navegador pareado. O controle remoto esta ativo.\n");
      json(res, 200, { token: state.token });
      return;
    }

    if (req.method === "POST" && url.pathname === "/input") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      const body = await readBody(req);
      const events = Array.isArray(body.events) ? body.events.slice(0, 256) : [];
      json(res, 200, { applied: applyEvents(events) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/display") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      const body = await readBody(req, 1024);
      const id = Number(body.id);
      if (state.backend.displays.some((d) => d.id === id)) state.displayId = id;
      json(res, 200, { displayId: state.displayId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/release") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      state.backend.releaseAll();
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/unpair") {
      if (!authorized(req)) {
        json(res, 403, { error: "nao_pareado" });
        return;
      }
      state.backend.releaseAll();
      state.token = null;
      state.pairingCode = randomCode(6);
      console.log(`\n  Pareamento revogado. Novo codigo: ${state.pairingCode}\n`);
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "rota_desconhecida" });
  } catch (error) {
    json(res, 400, { error: String(error?.message ?? error) });
  }
});

async function listen() {
  const candidates = args.port ? [args.port] : PORTS;
  for (const port of candidates) {
    const ok = await new Promise((resolve) => {
      const onError = () => resolve(false);
      server.once("error", onError);
      // Loopback apenas: o agente nunca fica exposto na rede local.
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve(true);
      });
    });
    if (ok) return port;
  }
  throw new Error(`Nenhuma porta livre em ${candidates.join(", ")}.`);
}

function banner(port) {
  const display = currentDisplay();
  const lines = [
    "",
    "  ┌──────────────────────────────────────────────┐",
    "  │  REMOTO · agente local                       │",
    "  └──────────────────────────────────────────────┘",
    "",
    `  Porta      http://127.0.0.1:${port}`,
    `  Sistema    ${os.platform()} · ${state.backend.name}`,
    `  Telas      ${state.backend.displays.map((d) => `${d.label} ${d.width}x${d.height}`).join(", ")}`,
    `  Ativa      ${display.label}`,
    "",
    `  CODIGO DE PAREAMENTO:  ${state.pairingCode.split("").join(" ")}`,
    "",
    "  Digite esse codigo na aba do REMOTO, em 'Ativar controle'.",
    "  Enquanto este terminal estiver aberto, quem voce autorizar",
    "  na sessao controla este computador. Ctrl+C encerra tudo.",
    "",
  ];
  if (state.backend.warning) lines.push(`  ! ${state.backend.warning}`, "");
  console.log(lines.join("\n"));
}

async function main() {
  try {
    state.backend = await createBackend();
  } catch (error) {
    console.error(`\n  Nao foi possivel iniciar o executor de entrada:\n  ${error.message}\n`);
    process.exit(1);
  }

  const primary = state.backend.displays.find((d) => d.primary);
  if (primary) state.displayId = primary.id;

  const port = await listen();
  if (!args.quiet) banner(port);

  const shutdown = () => {
    console.log("\n  Encerrando agente. Teclas e botoes liberados.\n");
    try {
      state.backend.close();
    } catch {
      /* nada a fazer */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
