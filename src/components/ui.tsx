import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { ComponentProps, ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/theme";

export type NomeIcone = ComponentProps<typeof MaterialCommunityIcons>["name"];
type Tom = "normal" | "muted" | "faint" | "primary" | "success" | "warning" | "danger" | "inverso";

/* --------------------------------- texto --------------------------------- */

export function Txt({
  children,
  variant = "body",
  tom = "normal",
  centro,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: keyof ReturnType<typeof useTheme>["type"];
  tom?: Tom;
  centro?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const t = useTheme();
  const cores: Record<Tom, string> = {
    normal: t.colors.text,
    muted: t.colors.textMuted,
    faint: t.colors.textFaint,
    primary: t.colors.primary,
    success: t.colors.success,
    warning: t.colors.warning,
    danger: t.colors.danger,
    inverso: t.colors.primaryOn,
  };
  const base = t.type[variant] as TextStyle;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        base,
        { color: cores[tom] },
        variant === "section" && { textTransform: "uppercase" },
        centro && { textAlign: "center" },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/* --------------------------------- cartao --------------------------------- */

export function Card({
  children,
  style,
  onPress,
  padding = "lg",
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padding?: keyof ReturnType<typeof useTheme>["spacing"] | "none";
}) {
  const t = useTheme();
  const conteudo = (
    <View
      style={[
        {
          backgroundColor: t.colors.surface,
          borderRadius: t.radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          padding: padding === "none" ? 0 : t.spacing[padding],
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  if (!onPress) return conteudo;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {conteudo}
    </Pressable>
  );
}

/* --------------------------------- botao --------------------------------- */

export function Button({
  children,
  onPress,
  variant = "primary",
  icone,
  disabled,
  largura,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icone?: NomeIcone;
  disabled?: boolean;
  largura?: "auto" | "cheia";
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();

  const estilos = {
    primary: { fundo: t.colors.primary, texto: t.colors.primaryOn, borda: "transparent" },
    secondary: { fundo: t.colors.surface, texto: t.colors.text, borda: t.colors.borderStrong },
    ghost: { fundo: "transparent", texto: t.colors.primary, borda: "transparent" },
    danger: { fundo: t.colors.dangerSoft, texto: t.colors.danger, borda: "transparent" },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: t.spacing.sm,
          paddingVertical: 13,
          paddingHorizontal: t.spacing.lg,
          borderRadius: t.radius.md,
          backgroundColor: estilos.fundo,
          borderWidth: variant === "secondary" ? StyleSheet.hairlineWidth : 0,
          borderColor: estilos.borda,
          alignSelf: largura === "cheia" ? "stretch" : "flex-start",
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {icone && <MaterialCommunityIcons name={icone} size={19} color={estilos.texto} />}
      <Text style={[t.type.label as TextStyle, { color: estilos.texto, fontWeight: "600" }]}>
        {children}
      </Text>
    </Pressable>
  );
}

/* -------------------------------- etiqueta -------------------------------- */

export function Pill({
  children,
  tom = "normal",
  icone,
}: {
  children: ReactNode;
  tom?: "normal" | "primary" | "success" | "warning" | "danger";
  icone?: NomeIcone;
}) {
  const t = useTheme();
  const mapa = {
    normal: { fundo: t.colors.surfaceAlt, texto: t.colors.textMuted },
    primary: { fundo: t.colors.primarySoft, texto: t.colors.primary },
    success: { fundo: t.colors.successSoft, texto: t.colors.success },
    warning: { fundo: t.colors.warningSoft, texto: t.colors.warning },
    danger: { fundo: t.colors.dangerSoft, texto: t.colors.danger },
  }[tom];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        backgroundColor: mapa.fundo,
        paddingHorizontal: t.spacing.sm,
        paddingVertical: 3,
        borderRadius: t.radius.pill,
      }}
    >
      {icone && <MaterialCommunityIcons name={icone} size={12} color={mapa.texto} />}
      <Text style={[t.type.caption as TextStyle, { color: mapa.texto, fontWeight: "600" }]}>
        {children}
      </Text>
    </View>
  );
}

/* ------------------------------ estado vazio ------------------------------ */

export function EmptyState({
  icone,
  titulo,
  descricao,
  children,
}: {
  icone: NomeIcone;
  titulo: string;
  descricao?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: t.spacing.xxl, gap: t.spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: t.radius.xl,
          backgroundColor: t.colors.surfaceAlt,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialCommunityIcons name={icone} size={30} color={t.colors.textFaint} />
      </View>
      <View style={{ gap: 4, alignItems: "center", paddingHorizontal: t.spacing.lg }}>
        <Txt variant="bodyStrong" centro>
          {titulo}
        </Txt>
        {descricao && (
          <Txt variant="label" tom="muted" centro>
            {descricao}
          </Txt>
        )}
      </View>
      {children}
    </View>
  );
}

/* --------------------------------- linhas --------------------------------- */

export function Row({
  titulo,
  subtitulo,
  cor,
  icone,
  direita,
  onPress,
  ultima,
}: {
  titulo: string;
  subtitulo?: string;
  /** Bolinha colorida a esquerda — e assim que um local e reconhecido. */
  cor?: string;
  icone?: NomeIcone;
  direita?: ReactNode;
  onPress?: () => void;
  ultima?: boolean;
}) {
  const t = useTheme();
  const conteudo = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: t.spacing.md,
        paddingVertical: t.spacing.md,
        borderBottomWidth: ultima ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: t.colors.border,
      }}
    >
      {cor && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor }} />}
      {icone && !cor && <MaterialCommunityIcons name={icone} size={20} color={t.colors.textMuted} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="bodyStrong" numberOfLines={1}>
          {titulo}
        </Txt>
        {subtitulo && (
          <Txt variant="caption" tom="muted" numberOfLines={1}>
            {subtitulo}
          </Txt>
        )}
      </View>
      {direita}
      {onPress && (
        <MaterialCommunityIcons name="chevron-right" size={20} color={t.colors.textFaint} />
      )}
    </View>
  );

  if (!onPress) return conteudo;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {conteudo}
    </Pressable>
  );
}

export function Secao({ children, acao }: { children: string; acao?: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: t.spacing.sm,
      }}
    >
      <Txt variant="section" tom="faint">
        {children}
      </Txt>
      {acao}
    </View>
  );
}

export { MaterialCommunityIcons as Icone };
