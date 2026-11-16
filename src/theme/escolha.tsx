import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { executorDe } from "@/db/client";
import { useEstadoBanco } from "@/db/provider";
import { gravaEscolhaTema, lerEscolhaTema } from "@/db/tema";
import { ESCOLHA_PADRAO, type EscolhaTema } from "@/lib/tema";
import { AppThemeProvider } from "./index";

interface Contexto {
  escolha: EscolhaTema;
  /** `false` ate a escolha guardada ser lida: a tela de abertura espera por isso para nao piscar o tema errado. */
  carregada: boolean;
  define: (nova: EscolhaTema) => Promise<void>;
}

const EscolhaContext = createContext<Contexto>({ escolha: ESCOLHA_PADRAO, carregada: false, define: async () => {} });

/**
 * Aplica a escolha de tema (claro, escuro ou do celular) guardada no banco.
 * Fica DENTRO do provedor do banco, que e de onde a escolha vem.
 */
export function TemaDoApp({ children }: { children: ReactNode }) {
  const banco = useEstadoBanco();
  const [escolha, setEscolha] = useState<EscolhaTema>(ESCOLHA_PADRAO);
  const [lida, setLida] = useState(false);

  useEffect(() => {
    if (banco.status === "erro") {
      setLida(true); // sem banco nao ha o que ler; segue o sistema
      return;
    }
    if (banco.status !== "pronto") return;
    let vivo = true;
    lerEscolhaTema(executorDe(banco.db))
      .then((e) => vivo && setEscolha(e))
      .catch(() => undefined)
      .finally(() => vivo && setLida(true));
    return () => {
      vivo = false;
    };
  }, [banco]);

  const define = useCallback(
    async (nova: EscolhaTema) => {
      setEscolha(nova); // a tela muda na hora; gravar vem depois
      if (banco.status === "pronto") await gravaEscolhaTema(executorDe(banco.db), nova);
    },
    [banco],
  );

  const valor = useMemo(() => ({ escolha, carregada: lida, define }), [escolha, lida, define]);

  return (
    <EscolhaContext.Provider value={valor}>
      <AppThemeProvider force={escolha === "sistema" ? undefined : escolha === "claro" ? "light" : "dark"}>{children}</AppThemeProvider>
    </EscolhaContext.Provider>
  );
}

export function useEscolhaDeTema(): Contexto {
  return useContext(EscolhaContext);
}
