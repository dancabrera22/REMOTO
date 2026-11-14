import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { abreBanco, type Banco } from "./client";

export type EstadoBanco =
  | { status: "carregando" }
  | { status: "pronto"; db: Banco; versao: number }
  | { status: "erro"; mensagem: string };

const BancoContext = createContext<EstadoBanco>({ status: "carregando" });
/** Sobe a cada escrita, para as consultas se reexecutarem. */
const RevisaoContext = createContext<{ revisao: number; invalidar: () => void }>({
  revisao: 0,
  invalidar: () => {},
});

/**
 * Teto para a abertura do banco.
 *
 * Abrir um SQLite local leva milissegundos; se passar disso, alguma coisa
 * travou. Sem este limite o app ficaria na tela de abertura para sempre — uma
 * falha muda e sem saida. Com ele, vira um erro visivel em Ajustes.
 */
const LIMITE_ABERTURA_MS = 8000;

export function BancoProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoBanco>({ status: "carregando" });
  const [revisao, setRevisao] = useState(0);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const db = await Promise.race([
          abreBanco(),
          new Promise<never>((_, rejeita) =>
            setTimeout(
              () => rejeita(new Error(`O banco não respondeu em ${LIMITE_ABERTURA_MS / 1000}s.`)),
              LIMITE_ABERTURA_MS,
            ),
          ),
        ]);
        const linha = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
        if (!cancelado) setEstado({ status: "pronto", db, versao: linha?.user_version ?? 0 });
      } catch (erro) {
        // Falhar aqui nao pode deixar o app numa tela branca: o estado de erro
        // e exibido em Ajustes com a mensagem real.
        if (!cancelado) {
          setEstado({ status: "erro", mensagem: erro instanceof Error ? erro.message : String(erro) });
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const invalidar = useCallback(() => setRevisao((n) => n + 1), []);
  const revisaoValor = useMemo(() => ({ revisao, invalidar }), [revisao, invalidar]);

  return (
    <BancoContext.Provider value={estado}>
      <RevisaoContext.Provider value={revisaoValor}>{children}</RevisaoContext.Provider>
    </BancoContext.Provider>
  );
}

export function useEstadoBanco(): EstadoBanco {
  return useContext(BancoContext);
}

/** Use quando a tela so faz sentido com o banco aberto. */
export function useBanco(): Banco {
  const estado = useContext(BancoContext);
  if (estado.status !== "pronto") {
    throw new Error("useBanco chamado antes do banco estar pronto");
  }
  return estado.db;
}

export function useInvalidar(): () => void {
  return useContext(RevisaoContext).invalidar;
}

export type Consulta<T> =
  | { status: "carregando"; dados: null; erro: null }
  | { status: "pronto"; dados: T; erro: null }
  | { status: "erro"; dados: null; erro: string };

/**
 * Consulta declarativa: reexecuta quando as dependencias mudam ou quando
 * alguem chama `invalidar()` depois de uma escrita.
 */
export function useConsulta<T>(
  consulta: (db: Banco) => Promise<T>,
  deps: readonly unknown[] = [],
): Consulta<T> {
  const estado = useEstadoBanco();
  const { revisao } = useContext(RevisaoContext);
  const [resultado, setResultado] = useState<Consulta<T>>({
    status: "carregando",
    dados: null,
    erro: null,
  });

  useEffect(() => {
    if (estado.status === "erro") {
      setResultado({ status: "erro", dados: null, erro: estado.mensagem });
      return;
    }
    if (estado.status !== "pronto") return;

    let cancelado = false;
    (async () => {
      try {
        const dados = await consulta(estado.db);
        if (!cancelado) setResultado({ status: "pronto", dados, erro: null });
      } catch (erro) {
        if (!cancelado) {
          setResultado({
            status: "erro",
            dados: null,
            erro: erro instanceof Error ? erro.message : String(erro),
          });
        }
      }
    })();

    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado.status, estado.status === "pronto" ? estado.db : null, revisao, ...deps]);

  return resultado;
}
