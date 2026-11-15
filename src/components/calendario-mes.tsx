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
import { SO_ROLA_NA_VERTICAL, useDeslizeHorizontal } from "./gestos";
import { Icone, Txt } from "./ui";

export interface MarcadorDia {
  /** Cores dos locais com plantao no dia; viram pontinhos sob o numero. */
  cores: string[];
}

/** Quantos pontinhos cabem sob um dia antes de virar "+". */
export const MAX_PONTOS = 3;

/**
 * Uma celula de dia. Existe como componente proprio para que o calendario e a
 * previa de cor do formulario de local desenhem exatamente a mesma coisa: o que
 * voce ve ao escolher a cor e o que vai aparecer na agenda.
 *
 * Os pontinhos ficam FORA do quadrado do numero, sobre o fundo do cartao. Isso
 * importa: no dia selecionado o quadrado e verde-escuro, e um ponto dentro dele
 * perderia a cor do local — que e a unica pista de onde voce estara naquela data.
 */
export function DiaCelula({
  dia,
  selecionado = false,
  hoje = false,
  foraDoMes = false,
  fimDeSemana = false,
  cores = [],
  onPress,
}: {
  dia: number;
  selecionado?: boolean;
  hoje?: boolean;
  foraDoMes?: boolean;
  fimDeSemana?: boolean;
  cores?: readonly string[];
  onPress?: () => void;
}) {
  const t = useTheme();
  const excedente = cores.length - MAX_PONTOS;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      role="button"
      aria-selected={selecionado}
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
            : hoje
              ? t.colors.primarySoft
              : "transparent",
        }}
      >
        <Txt
          variant="label"
          tom={
            selecionado
              ? "inverso"
              : foraDoMes
                ? "faint"
                : hoje
                  ? "primary"
                  : fimDeSemana
                    ? "muted"
                    : "normal"
          }
          style={hoje && !selecionado ? { fontWeight: "700" } : undefined}
        >
          {dia}
        </Txt>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 3, height: 8, marginTop: 2 }}>
        {cores.slice(0, MAX_PONTOS).map((cor, i) => (
          <View
            key={`${cor}-${i}`}
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cor }}
          />
        ))}
        {excedente > 0 && (
          <Txt variant="caption" tom="faint" style={{ fontSize: 9, lineHeight: 10 }}>
            +
          </Txt>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Calendario mensal.
 *
 * Nucleo da aba Agenda: a partir da Etapa 3 ele recebe `marcadores` com as
 * cores dos locais de cada dia. E por isso que a cor escolhida no cadastro do
 * local importa tanto — o mes inteiro passa a ser lido de relance.
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

  // Deslizar para a esquerda avanca o mes; para a direita, volta. As setas continuam.
  const deslize = useDeslizeHorizontal((direcao) => onTrocarMes(somaMeses(referenciaMs, direcao === "esquerda" ? 1 : -1)));

  const seta = (direcao: -1 | 1, nome: "chevron-left" | "chevron-right", rotulo: string) => (
    <Pressable
      onPress={() => onTrocarMes(somaMeses(referenciaMs, direcao))}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
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
    <View style={[{ gap: t.spacing.md }, SO_ROLA_NA_VERTICAL]} {...deslize}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {seta(-1, "chevron-left", "Mês anterior")}
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
        {seta(1, "chevron-right", "Próximo mês")}
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
            {semana.map((celula) => (
              <DiaCelula
                key={celula.chave}
                dia={celula.dia}
                selecionado={selecionadoMs !== null && mesmoDia(celula.ms, selecionadoMs)}
                hoje={celula.hoje}
                foraDoMes={celula.foraDoMes}
                fimDeSemana={celula.fimDeSemana}
                cores={marcadores?.[celula.chave]?.cores}
                onPress={() => onSelecionar(celula.ms)}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
