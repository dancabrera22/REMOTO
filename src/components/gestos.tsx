import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useTheme } from "@/theme";
import { Icone, Txt } from "./ui";

/** O movimento e claramente horizontal (e nao um rolar de tela torto)? */
export function horizontal(dx: number, dy: number, minimo: number): boolean {
  return Math.abs(dx) > minimo && Math.abs(dx) > Math.abs(dy) * 1.6;
}

/**
 * No navegador, `pan-y` diz que o dedo na vertical e da pagina (rolar) e na
 * horizontal e nosso. No aparelho esse estilo nao existe e e ignorado.
 */
export const SO_ROLA_NA_VERTICAL =
  Platform.OS === "web" ? ({ touchAction: "pan-y" } as object) : undefined;

/**
 * Deslizar o dedo na horizontal (ex.: mudar de mes). Devolve os `panHandlers`
 * para espalhar numa View. Toques curtos nao viram gesto: os botoes de dentro
 * continuam funcionando.
 *
 * `esquerda` = o dedo foi para a esquerda (a pagina "avanca"); `direita` = voltou.
 */
export function useDeslizeHorizontal(
  aoDeslizar: (direcao: "esquerda" | "direita") => void,
  distancia = 56,
) {
  const ultima = useRef(aoDeslizar);
  ultima.current = aoDeslizar;

  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => horizontal(g.dx, g.dy, 12),
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, g) => {
          const longe = Math.abs(g.dx) >= distancia;
          const arremesso = Math.abs(g.vx) > 0.5 && Math.abs(g.dx) > 28;
          if (longe || arremesso)
            ultima.current(g.dx < 0 ? "esquerda" : "direita");
        },
      }).panHandlers,
    [distancia],
  );
}

const LARGURA_ACAO = 92;

/**
 * Linha que se desliza para a esquerda e revela um botao de excluir no lado
 * direito. Aberta, tocar no conteudo fecha (e nao abre o plantao por engano).
 *
 * Gesto nao e o unico caminho: toda tela de edicao tem o botao de excluir, que
 * funciona com leitor de tela e sem arrastar.
 */
export function Deslizavel({
  children,
  onExcluir,
  rotulo = "Excluir",
  rotuloAcessivel,
}: {
  children: ReactNode;
  onExcluir: () => void;
  rotulo?: string;
  rotuloAcessivel?: string;
}) {
  const t = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const aberto = useRef(false);
  const base = useRef(0);
  const [visivel, setVisivel] = useState(false);
  // O botao so existe enquanto ha o que mostrar (arrastando, aberto ou fechando):
  // fechado, nao fica um "Excluir" escondido em cada cartao para o leitor de tela.
  const [montado, setMontado] = useState(false);

  const vai = (para: number) => {
    aberto.current = para !== 0;
    setVisivel(para !== 0);
    if (para !== 0) setMontado(true);
    Animated.spring(x, {
      toValue: para,
      useNativeDriver: Platform.OS !== "web",
      bounciness: 0,
      speed: 24,
    }).start(({ finished }) => {
      if (finished && para === 0) setMontado(false);
    });
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => horizontal(g.dx, g.dy, 8),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          base.current = aberto.current ? -LARGURA_ACAO : 0;
          setMontado(true);
        },
        onPanResponderMove: (_, g) => {
          x.setValue(
            Math.min(0, Math.max(-LARGURA_ACAO - 28, base.current + g.dx)),
          );
        },
        onPanResponderRelease: (_, g) => {
          const fim = base.current + g.dx;
          vai(fim < -LARGURA_ACAO / 2 || g.vx < -0.6 ? -LARGURA_ACAO : 0);
        },
        onPanResponderTerminate: () => vai(aberto.current ? -LARGURA_ACAO : 0),
      }),
    // `vai` so usa refs e `x`, estaveis; recriar o gesto a cada render o perderia no meio do arrasto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <View
      style={[
        { borderRadius: t.radius.lg, overflow: "hidden" },
        SO_ROLA_NA_VERTICAL,
      ]}
    >
      {montado && (
        <Animated.View
          pointerEvents={visivel ? "auto" : "none"}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: LARGURA_ACAO + 16,
            opacity: x.interpolate({
              inputRange: [-LARGURA_ACAO, -8, 0],
              outputRange: [1, 0.6, 0],
              extrapolate: "clamp",
            }),
          }}
        >
          <Pressable
            onPress={() => {
              vai(0);
              onExcluir();
            }}
            role="button"
            aria-label={rotuloAcessivel ?? rotulo}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              paddingLeft: 16,
              backgroundColor: t.colors.danger,
            }}
          >
            <Icone
              name="trash-can-outline"
              size={24}
              color={t.colors.primaryOn}
            />
            <Txt variant="caption" tom="inverso" style={{ fontWeight: "700" }}>
              {rotulo}
            </Txt>
          </Pressable>
        </Animated.View>
      )}

      <Animated.View
        style={{ transform: [{ translateX: x }] }}
        {...pan.panHandlers}
      >
        {children}
        {visivel && (
          <Pressable
            onPress={() => vai(0)}
            aria-label="Fechar"
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: "transparent" },
            ]}
          />
        )}
      </Animated.View>
    </View>
  );
}
