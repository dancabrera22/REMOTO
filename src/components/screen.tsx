import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { Txt } from "./ui";

/**
 * Moldura de toda tela: respeita a area segura, mantem o cabecalho com o mesmo
 * peso visual em todas as abas e reserva espaco embaixo para a barra de abas
 * nao cobrir o ultimo item da lista.
 */
export function Screen({
  titulo,
  subtitulo,
  direita,
  children,
  scroll = true,
}: {
  titulo: string;
  subtitulo?: string;
  direita?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  const cabecalho = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingTop: insets.top + t.spacing.lg,
        paddingBottom: t.spacing.lg,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="display">{titulo}</Txt>
        {subtitulo && (
          <Txt variant="label" tom="muted">
            {subtitulo}
          </Txt>
        )}
      </View>
      {direita}
    </View>
  );

  const corpo = (
    <View style={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.lg, flex: scroll ? undefined : 1 }}>
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {cabecalho}
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
          showsVerticalScrollIndicator={false}
        >
          {corpo}
        </ScrollView>
      ) : (
        corpo
      )}
    </View>
  );
}
