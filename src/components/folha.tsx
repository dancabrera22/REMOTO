import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { Txt } from "./ui";

/**
 * Folha que sobe de baixo da tela, com o fundo escurecido: o jeito de pedir uma
 * decisao rapida sem tirar a pessoa de onde ela esta. Tocar fora fecha.
 *
 * `acoes` fica fixo embaixo (os botoes); `children` rola se for comprido.
 */
export function Folha({
  titulo,
  subtitulo,
  onFechar,
  children,
  acoes,
}: {
  titulo: string;
  subtitulo?: string;
  onFechar: () => void;
  children?: ReactNode;
  acoes?: ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent animationType="fade" onRequestClose={onFechar} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={onFechar} aria-label="Fechar" />
        <View
          style={{
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.lg,
            borderTopRightRadius: t.radius.lg,
            paddingHorizontal: t.spacing.lg,
            paddingTop: t.spacing.lg,
            paddingBottom: insets.bottom + t.spacing.lg,
            gap: t.spacing.md,
            maxHeight: "85%",
          }}
        >
          <View style={{ gap: 2 }}>
            <Txt variant="title">{titulo}</Txt>
            {subtitulo && (
              <Txt variant="label" tom="muted">
                {subtitulo}
              </Txt>
            )}
          </View>
          {children && (
            <ScrollView contentContainerStyle={{ gap: t.spacing.sm }} showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          )}
          {acoes}
        </View>
      </View>
    </Modal>
  );
}
