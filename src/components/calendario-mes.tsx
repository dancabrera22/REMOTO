import { Pressable, View } from "react-native";
import {
  diasSemanaMinimo,
  formatMesAno,
  gradeDoMes,
  inicioDoMes,
  mesmoDia,
  somaMeses,
} from "@/lib/datetime";
import { useTheme } from "@/theme";
import { Icone, Txt } from "./ui";

export interface MarcadorDia {
  /** Cores dos locais com plantao no dia; viram pontinhos sob o numero. */
  cores: string[];
}

/**
 * Calendario mensal.
 *
 * Nucleo da aba Agenda e peca de base das etapas seguintes: a partir da Etapa 3
 * ele recebe `marcadores` com as cores dos locais de cada dia, e e por isso que
 * a escolha da cor do local, na Etapa 2, importa tanto — o mes inteiro passa a
 * ser lido de relance, antes de qualquer texto.
 */
export function CalendarioMes({
  referenciaMs,
  selecionadoMs,
  onSelecionar,
  onTrocarMes,
  marcadores,
}: {
  referenciaMs: number;
  selecionadoMs: number | null;
  onSelecionar: (ms: number) => void;
  onTrocarMes: (ms: number) => void;
  marcadores?: Record<string, MarcadorDia>;
}) {
  const t = useTheme();
  const semanas = gradeDoMes(referenciaMs);
  const mesAtual = inicioDoMes(Date.now()) === inicioDoMes(referenciaMs);

  const seta = (direcao: -1 | 1, nome: "chevron-left" | "chevron-right") => (
    <Pressable
      onPress={() => onTrocarMes(somaMeses(referenciaMs, direcao))}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: t.radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? t.colors.surfaceAlt : "transparent",
      })}
    >
      <Icone name={nome} size={22} color={t.colors.textMuted} />
    </Pressable>
  );

  return (
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {seta(-1, "chevron-left")}
        <Pressable
          onPress={() => !mesAtual && onTrocarMes(Date.now())}
          style={{ alignItems: "center", gap: 2 }}
        >
          <Txt variant="title">{formatMesAno(referenciaMs)}</Txt>
          {!mesAtual && (
            <Txt variant="caption" tom="primary">
              voltar para hoje
            </Txt>
          )}
        </Pressable>
        {seta(1, "chevron-right")}
      </View>

      <View style={{ flexDirection: "row" }}>
        {diasSemanaMinimo.map((dia, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <Txt variant="caption" tom="faint">
              {dia}
            </Txt>
          </View>
        ))}
      </View>

      <View style={{ gap: 2 }}>
        {semanas.map((semana, i) => (
          <View key={i} style={{ flexDirection: "row" }}>
            {semana.map((celula) => {
              const selecionado = selecionadoMs !== null && mesmoDia(celula.ms, selecionadoMs);
              const marcador = marcadores?.[celula.chave];

              return (
                <Pressable
                  key={celula.chave}
                  onPress={() => onSelecionar(celula.ms)}
                  style={{ flex: 1, alignItems: "center", paddingVertical: 3 }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: t.radius.md,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: selecionado
                        ? t.colors.primary
                        : celula.hoje
                          ? t.colors.primarySoft
                          : "transparent",
                    }}
                  >
                    <Txt
                      variant="label"
                      tom={
                        selecionado
                          ? "inverso"
                          : celula.foraDoMes
                            ? "faint"
                            : celula.hoje
                              ? "primary"
                              : celula.fimDeSemana
                                ? "muted"
                                : "normal"
                      }
                      style={celula.hoje && !selecionado ? { fontWeight: "700" } : undefined}
                    >
                      {celula.dia}
                    </Txt>
                  </View>

                  <View style={{ flexDirection: "row", gap: 2, height: 6, marginTop: 1 }}>
                    {marcador?.cores.slice(0, 3).map((cor, j) => (
                      <View
                        key={j}
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: 2,
                          backgroundColor: selecionado ? t.colors.primaryOn : cor,
                        }}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
