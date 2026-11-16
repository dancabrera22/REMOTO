import { useRef, useState, type ReactNode } from "react";
import { Animated, Easing, View, type ViewStyle } from "react-native";

/**
 * Faz um bloco que muda de altura (uma lista que ganha ou perde cartoes) crescer ou
 * encolher DESLIZANDO, em vez de empurrar tudo que esta abaixo de uma vez so.
 *
 * Como funciona: o conteudo fica solto dentro de uma moldura de altura animada e
 * cortada (`overflow: hidden`). Cada vez que o conteudo muda de tamanho, a moldura vai
 * da altura de antes para a nova — o conteudo novo e revelado (ou recolhido) em vez de
 * aparecer de repente.
 *
 * Antes da primeira medida, o bloco se comporta como uma View comum (sem moldura): so
 * depois de saber a altura e que ele passa a animar, entao a primeira tela nunca pisca.
 */
export function AlturaSuave({
  children,
  duracao = 240,
  estilo,
}: {
  children: ReactNode;
  duracao?: number;
  /** Estilo do conteudo (por exemplo, o `gap` entre os cartoes de uma lista). */
  estilo?: ViewStyle;
}) {
  const altura = useRef(new Animated.Value(0)).current;
  const [medido, setMedido] = useState(false);

  return (
    <Animated.View style={medido ? { height: altura, overflow: "hidden" } : undefined}>
      <View
        // Depois de medido, o conteudo sai do fluxo: a moldura nao o estica, e ele mede o tamanho que realmente tem.
        style={medido ? [estilo, { position: "absolute", top: 0, left: 0, right: 0 }] : estilo}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (!medido) {
            altura.setValue(h);
            setMedido(true);
            return;
          }
          Animated.timing(altura, {
            toValue: h,
            duration: duracao,
            easing: Easing.out(Easing.cubic),
            // Altura e propriedade de layout: o driver nativo nao a anima.
            useNativeDriver: false,
          }).start();
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
}
