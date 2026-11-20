/**
 * Quais notificacoes o app usa neste aparelho.
 *
 *  - Android: as do aparelho (`expo-notifications`).
 *  - Web: nenhuma — o navegador nao agenda aviso com o app fechado. Exceto em desenvolvimento, com
 *    EXPO_PUBLIC_CALENDARIO_FALSO=1: ai usa um sistema falso (guardado no localStorage) e da para
 *    testar a tela inteira; o teste de interface o espia por `globalThis.__lembretesFalso`.
 */
import { Platform } from "react-native";
import type { ProvedorLembretes } from "@/db/lembretes";
import { criaLembretesFalso, type LembretesFalso } from "./lembretes-falso";
import { criaProvedorDeLembretesExpo } from "./lembretes-expo";
import type { LembretePlanejado } from "./lembretes";

let unico: ProvedorLembretes | null | undefined;

const CHAVE_FALSO = "meu-plantao:lembretes-falso";

function criaFalsoDaWeb(): LembretesFalso {
  const f = criaLembretesFalso();
  try {
    const guardado = JSON.parse(localStorage.getItem(CHAVE_FALSO) ?? "{}") as { permissao?: LembretesFalso["permissaoAtual"]; agendados?: LembretePlanejado[] };
    if (guardado.permissao) f.permissaoAtual = guardado.permissao;
    for (const l of guardado.agendados ?? []) f.agendados.set(l.id, l);
  } catch {
    /* sem armazenamento: comeca vazio */
  }
  const salva = () => {
    try {
      localStorage.setItem(CHAVE_FALSO, JSON.stringify({ permissao: f.permissaoAtual, agendados: [...f.agendados.values()] }));
    } catch {
      /* ignorado */
    }
  };
  for (const nome of ["pedePermissao", "agenda", "cancela"] as const) {
    const original = f[nome].bind(f) as (...a: unknown[]) => Promise<unknown>;
    (f as unknown as Record<string, unknown>)[nome] = async (...a: unknown[]) => {
      const r = await original(...a);
      salva();
      return r;
    };
  }
  (globalThis as Record<string, unknown>).__lembretesFalso = f;
  return f;
}

/** `null` quando este aparelho nao tem notificacoes para usar. */
export function obtemProvedorDeLembretes(): ProvedorLembretes | null {
  if (unico !== undefined) return unico;
  if (process.env.EXPO_PUBLIC_CALENDARIO_FALSO === "1" && Platform.OS === "web") unico = criaFalsoDaWeb();
  else if (Platform.OS === "web") unico = null;
  else unico = criaProvedorDeLembretesExpo();
  return unico;
}
