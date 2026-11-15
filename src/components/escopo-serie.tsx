import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { excluiPlantao } from "@/db/plantoes";
import { useBanco } from "@/db/provider";
import { contaImpacto, excluiDaSerie, ROTULO_ESCOPO, type EscopoSerie, type Impacto } from "@/db/series";
import { formatDiaSemana, formatData } from "@/lib/datetime";
import { useTheme } from "@/theme";
import { Folha } from "./folha";
import { Button, Icone, Txt } from "./ui";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Folha que pergunta "so este, este e os proximos, ou todos?" antes de editar
 * ou excluir um plantao de escala, ja mostrando quantos plantoes cada resposta
 * atinge e quantos (realizados, pagos) ficam como estao.
 */
export function EscopoModal({
  plantaoId,
  inicio,
  titulo,
  acao,
  escopos,
  rotuloConfirmar,
  tomConfirmar,
  onConfirmar,
  onFechar,
  rodape,
}: {
  plantaoId: number;
  /** Instante de inicio do plantao tocado, para dizer "a partir de ter 17/11". */
  inicio: number;
  titulo: string;
  acao: "editar" | "excluir";
  escopos: readonly EscopoSerie[];
  rotuloConfirmar: string;
  tomConfirmar: "danger" | "primary";
  onConfirmar: (escopo: EscopoSerie) => Promise<void>;
  onFechar: () => void;
  rodape?: ReactNode;
}) {
  const t = useTheme();
  const db = useBanco();

  const [escopo, setEscopo] = useState<EscopoSerie>(escopos[0] ?? "este");
  const [impactos, setImpactos] = useState<Partial<Record<EscopoSerie, Impacto | null>>>({});
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // O array chega novo a cada render; a chave de texto evita refazer a consulta sem parar.
  const chaveEscopos = escopos.join(",");
  useEffect(() => {
    let vivo = true;
    (async () => {
      const r: Partial<Record<EscopoSerie, Impacto | null>> = {};
      for (const e of chaveEscopos.split(",").filter(Boolean) as EscopoSerie[]) {
        r[e] = await contaImpacto(db, plantaoId, e, acao);
      }
      if (vivo) setImpactos(r);
    })().catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [db, plantaoId, acao, chaveEscopos]);

  const dia = `${formatDiaSemana(inicio)}, ${formatData(inicio).slice(0, 5)}`;

  const detalhe = (e: EscopoSerie): string => {
    if (e === "este") return `Só o plantão de ${dia}.`;
    const i = impactos[e];
    if (!i) return "Calculando…";

    const de = e === "proximos" ? ` a partir de ${dia}` : "";
    const partes = [
      acao === "excluir"
        ? `${plural(i.alteraveis, "plantão agendado sai", "plantões agendados saem")}${de}`
        : `${plural(i.alteraveis, "plantão muda", "plantões mudam")}${de}`,
    ];
    if (i.realizados > 0) {
      partes.push(
        `${plural(i.realizados, "já realizado ou pago fica", "já realizados ou pagos ficam")} como ${i.realizados === 1 ? "está" : "estão"}`,
      );
    }
    if (i.ajustados > 0) {
      partes.push(
        `${plural(i.ajustados, "ajustado à mão fica", "ajustados à mão ficam")} como ${i.ajustados === 1 ? "está" : "estão"}`,
      );
    }
    if (acao === "editar") partes.push("Vale também para os que ainda vão aparecer no calendário");
    return `${partes.join(". ")}.`;
  };

  async function confirma() {
    setTrabalhando(true);
    setErro(null);
    try {
      await onConfirmar(escopo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui concluir.");
      setTrabalhando(false);
    }
  }

  return (
    <Folha
      titulo={titulo}
      onFechar={onFechar}
      acoes={
        <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
          <Button variant={tomConfirmar === "danger" ? "danger" : "primary"} onPress={confirma} disabled={trabalhando}>
            {trabalhando ? "Aguarde…" : rotuloConfirmar}
          </Button>
          <Button variant="secondary" onPress={onFechar} disabled={trabalhando}>
            Cancelar
          </Button>
        </View>
      }
    >
      {escopos.length > 0 && (
        <View role="radiogroup" style={{ gap: t.spacing.sm }}>
          {escopos.map((e) => {
            const ativo = e === escopo;
            return (
              <Pressable
                key={e}
                onPress={() => setEscopo(e)}
                role="radio"
                aria-checked={ativo}
                style={{
                  flexDirection: "row",
                  gap: t.spacing.md,
                  padding: t.spacing.md,
                  borderRadius: t.radius.md,
                  borderWidth: ativo ? 2 : 1,
                  borderColor: ativo ? t.colors.primary : t.colors.borderStrong,
                  backgroundColor: ativo ? t.colors.primarySoft : t.colors.surface,
                }}
              >
                <Icone
                  name={ativo ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={ativo ? t.colors.primary : t.colors.textFaint}
                  aria-hidden
                  importantForAccessibility="no"
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt variant="bodyStrong" tom={ativo ? "primary" : "normal"}>
                    {ROTULO_ESCOPO[e]}
                  </Txt>
                  <Txt variant="caption" tom="muted">
                    {detalhe(e)}
                  </Txt>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {rodape}
      {erro && (
        <Txt variant="label" tom="danger">
          {erro}
        </Txt>
      )}
    </Folha>
  );
}

/**
 * Exclusao de um plantao a partir de qualquer tela. Avulso: confirmacao simples.
 * De escala: pergunta o alcance. Quem chama so precisa saber quando terminou.
 */
export function ExcluirPlantao({
  plantao,
  onFechar,
  onExcluido,
}: {
  plantao: { id: number; serieId: number | null; inicio: number; local: { nome: string } };
  onFechar: () => void;
  onExcluido: () => void;
}) {
  const db = useBanco();
  const emSerie = plantao.serieId !== null;

  return (
    <EscopoModal
      plantaoId={plantao.id}
      inicio={plantao.inicio}
      titulo={emSerie ? "Excluir plantão da escala" : "Excluir este plantão?"}
      acao="excluir"
      escopos={emSerie ? ["este", "proximos", "todos"] : []}
      rotuloConfirmar="Excluir"
      tomConfirmar="danger"
      onFechar={onFechar}
      onConfirmar={async (escopo) => {
        if (emSerie) await excluiDaSerie(db, plantao.id, escopo);
        else await excluiPlantao(db, plantao.id);
        onExcluido();
      }}
      rodape={
        emSerie ? undefined : (
          <Txt variant="label" tom="muted">
            O plantão de {plantao.local.nome} sai da agenda e das contas. Se ele só não aconteceu, prefira marcar como
            cancelado ou trocado: o histórico fica.
          </Txt>
        )
      }
    />
  );
}
