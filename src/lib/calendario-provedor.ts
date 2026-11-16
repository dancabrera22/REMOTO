/**
 * Qual calendario o app usa neste aparelho.
 *
 *  - Android: o do aparelho (`expo-calendar`).
 *  - Web: nenhum — o navegador nao tem calendario para escrever. A tela mostra
 *    isso. Exceto em desenvolvimento, com EXPO_PUBLIC_CALENDARIO_FALSO=1: ai usa
 *    um calendario falso (guardado no localStorage) e da para testar a tela inteira.
 */
import { Platform } from "react-native";
import type { ProvedorCalendario } from "@/db/calendario";
import { criaCalendarioFalso, type CalendarioFalso, type EventoGuardado } from "./calendario-falso";
import { criaProvedorExpo } from "./calendario-expo";

let unico: ProvedorCalendario | null | undefined;

const CHAVE_FALSO = "meu-plantao:calendario-falso";

function criaFalsoDaWeb(): CalendarioFalso {
  const f = criaCalendarioFalso();
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_FALSO) ?? "[]") as EventoGuardado[];
    for (const e of guardado) f.eventos.set(e.id, e);
  } catch {
    /* sem armazenamento: comeca vazio */
  }

  // Persiste depois de cada escrita, para sobreviver a recarregar a pagina.
  const salva = () => {
    try {
      localStorage.setItem(CHAVE_FALSO, JSON.stringify([...f.eventos.values()]));
    } catch {
      /* ignorado */
    }
  };
  for (const nome of ["criaEvento", "atualizaEvento", "apagaEvento"] as const) {
    const original = f[nome].bind(f) as (...a: unknown[]) => Promise<unknown>;
    (f as unknown as Record<string, unknown>)[nome] = async (...a: unknown[]) => {
      const r = await original(...a);
      salva();
      return r;
    };
  }
  // O teste de interface espia o calendario por aqui.
  (globalThis as Record<string, unknown>).__calendarioFalso = f;
  return f;
}

/** `null` quando este aparelho nao tem calendario para usar. */
export function obtemProvedorDeCalendario(): ProvedorCalendario | null {
  if (unico !== undefined) return unico;
  if (process.env.EXPO_PUBLIC_CALENDARIO_FALSO === "1" && Platform.OS === "web") unico = criaFalsoDaWeb();
  else if (Platform.OS === "web") unico = null;
  else unico = criaProvedorExpo();
  return unico;
}
