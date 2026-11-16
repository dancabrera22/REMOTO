import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Platform, Pressable, View } from "react-native";
import {
  diasSemanaMinimo,
  formatMesAno,
  gradeDoMes,
  inicioDoMes,
  mesmoDia,
  somaMeses,
} from "@/lib/datetime";
import { useTheme } from "@/theme";
import { SO_ROLA_NA_VERTICAL, horizontal } from "./gestos";
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
  onSegurar,
}: {
  dia: number;
  selecionado?: boolean;
  hoje?: boolean;
  foraDoMes?: boolean;
  fimDeSemana?: boolean;
  cores?: readonly string[];
  onPress?: () => void;
  /** Segurar o dedo no dia. Tambem vira uma acao para leitores de tela. */
  onSegurar?: () => void;
}) {
  const t = useTheme();
  const excedente = cores.length - MAX_PONTOS;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onSegurar}
      delayLongPress={380}
      disabled={!onPress}
      role="button"
      aria-selected={selecionado}
      accessibilityActions={onSegurar ? [{ name: "incluir", label: "Incluir plantão neste dia" }] : undefined}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === "incluir" && onSegurar?.()}
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

/** Quanto do mes tem de ser arrastado (em fracao da largura) para a troca valer ao soltar. */
const FRACAO_PARA_TROCAR = 0.25;

/** Um arremesso (rapido, mesmo curto) tambem troca: px por ms e distancia minima. */
const VELOCIDADE_DE_ARREMESSO = 0.4;
const DISTANCIA_DE_ARREMESSO = 24;

/** Um mes: as semanas, uma sobre a outra. Existe como parte propria para o calendario poder mostrar tres lado a lado. */
function GradeDoMes({
  mesMs,
  selecionadoMs,
  marcadores,
  onSelecionar,
  onSegurar,
}: {
  mesMs: number;
  selecionadoMs: number | null;
  marcadores?: Record<string, MarcadorDia>;
  onSelecionar: (ms: number) => void;
  onSegurar?: (ms: number) => void;
}) {
  return (
    <View style={{ gap: 2 }}>
      {gradeDoMes(mesMs).map((semana, i) => (
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
              onSegurar={onSegurar ? () => onSegurar(celula.ms) : undefined}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Calendario mensal.
 *
 * Nucleo da aba Agenda: a partir da Etapa 3 ele recebe `marcadores` com as
 * cores dos locais de cada dia. E por isso que a cor escolhida no cadastro do
 * local importa tanto — o mes inteiro passa a ser lido de relance.
 *
 * Trocar de mes e um gesto fisico, como passar fotos: o mes ACOMPANHA o dedo, o
 * vizinho entra de lado, e ao soltar ele termina de deslizar (ou volta, se o
 * arrasto foi curto). As setas deslizam do mesmo jeito. Os meses vizinhos so
 * existem enquanto ha movimento: parado, a tela tem uma grade so.
 */
export function CalendarioMes({
  referenciaMs,
  selecionadoMs,
  onSelecionar,
  onTrocarMes,
  onSegurar,
  marcadores,
}: {
  referenciaMs: number;
  selecionadoMs: number | null;
  onSelecionar: (ms: number) => void;
  onTrocarMes: (ms: number) => void;
  /** Segurar o dedo num dia (a agenda oferece incluir um plantao ali). */
  onSegurar?: (ms: number) => void;
  marcadores?: Record<string, MarcadorDia>;
}) {
  const t = useTheme();
  const usaNativo = Platform.OS !== "web";

  const [largura, setLargura] = useState(0);
  const [movendo, setMovendo] = useState(false);
  /** O mes que o titulo mostra: acompanha o arrasto e vira o novo assim que passa da metade. */
  const [tituloMs, setTituloMs] = useState(referenciaMs);
  const [alturas, setAlturas] = useState<Record<number, number>>({});

  const x = useRef(new Animated.Value(0)).current;
  const ocupado = useRef(false);
  const posicao = useRef(0);
  /**
   * O gesto so e reconhecido depois de o dedo andar uns pixels, e dali em diante
   * `dx` conta do ponto do reconhecimento. Sem somar o que ja andou, o mes ficaria
   * sempre esses pixels atras da ponta do dedo.
   */
  const jaAndou = useRef(0);
  const pendente = useRef<1 | -1 | null>(null);
  // O que os tratadores de gesto (criados uma vez so) precisam ler sempre atualizado.
  const vivo = useRef({ referenciaMs, onTrocarMes, largura });
  vivo.current = { referenciaMs, onTrocarMes, largura };

  const mesDe = (delta: number) => somaMeses(inicioDoMes(vivo.current.referenciaMs), delta);

  /** Termina a troca: desliza ate o vizinho e entao avisa quem controla o mes. */
  const termina = (direcao: 1 | -1) => {
    const W = vivo.current.largura;
    const alvo = mesDe(direcao);
    setTituloMs(alvo);
    const restante = Math.abs(-direcao * W - posicao.current);
    Animated.timing(x, {
      toValue: -direcao * W,
      duration: Math.round(110 + 150 * (restante / Math.max(W, 1))),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: usaNativo,
    }).start(() => {
      vivo.current.onTrocarMes(alvo);
      // Se quem controla nao trocou o mes, nao deixamos o calendario preso no vizinho.
      setTimeout(() => {
        if (inicioDoMes(vivo.current.referenciaMs) !== alvo) volta();
      }, 400);
    });
  };

  const volta = () => {
    Animated.timing(x, {
      toValue: 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: usaNativo,
    }).start(() => {
      posicao.current = 0;
      ocupado.current = false;
      setMovendo(false);
      setTituloMs(vivo.current.referenciaMs);
    });
  };

  // Quando o mes de fato troca, a pagina vizinha ja esta na tela: so falta tornar
  // o vizinho o "atual" e zerar o deslocamento — tudo no mesmo quadro, sem piscar.
  useLayoutEffect(() => {
    x.setValue(0);
    posicao.current = 0;
    ocupado.current = false;
    pendente.current = null;
    setMovendo(false);
    setTituloMs(referenciaMs);
  }, [referenciaMs, x]);

  // As setas: primeiro montam o vizinho, depois deslizam (senao nao haveria o que mostrar).
  useLayoutEffect(() => {
    if (movendo && pendente.current !== null) {
      const d = pendente.current;
      pendente.current = null;
      termina(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movendo]);

  const paginar = (direcao: 1 | -1) => {
    if (ocupado.current || vivo.current.largura === 0) {
      if (vivo.current.largura === 0) onTrocarMes(somaMeses(referenciaMs, direcao));
      return;
    }
    ocupado.current = true;
    pendente.current = direcao;
    setMovendo(true);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (ocupado.current || vivo.current.largura === 0 || !horizontal(g.dx, g.dy, 10)) return false;
          jaAndou.current = g.dx;
          return true;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          ocupado.current = true;
          setMovendo(true);
        },
        onPanResponderMove: (_, g) => {
          const W = vivo.current.largura;
          const dx = Math.max(-W, Math.min(W, g.dx + jaAndou.current));
          posicao.current = dx;
          x.setValue(dx);
          // O titulo troca quando o mes novo passa a ocupar mais da metade da tela.
          setTituloMs(mesDe(dx < -W / 2 ? 1 : dx > W / 2 ? -1 : 0));
        },
        onPanResponderRelease: (_, g) => {
          const W = vivo.current.largura;
          const dx = g.dx + jaAndou.current;
          const longe = Math.abs(dx) > W * FRACAO_PARA_TROCAR;
          const arremesso = Math.abs(g.vx) > VELOCIDADE_DE_ARREMESSO && Math.abs(dx) > DISTANCIA_DE_ARREMESSO;
          if (longe || arremesso) termina(dx < 0 ? 1 : -1);
          else volta();
        },
        onPanResponderTerminate: () => volta(),
      }),
    // Os tratadores leem tudo por `vivo`; recria-los no meio do arrasto o perderia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [x],
  );

  const mesAtual = inicioDoMes(Date.now()) === inicioDoMes(tituloMs);
  const base = inicioDoMes(referenciaMs);
  const paginas = movendo ? [-1, 0, 1] : [0];
  const alturaMax = Math.max(0, ...paginas.map((d) => alturas[somaMeses(base, d)] ?? 0));

  const seta = (direcao: -1 | 1, nome: "chevron-left" | "chevron-right", rotulo: string) => (
    <Pressable
      onPress={() => paginar(direcao)}
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
    <View style={{ gap: t.spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {seta(-1, "chevron-left", "Mês anterior")}
        <Pressable
          onPress={() => !mesAtual && !ocupado.current && onTrocarMes(Date.now())}
          style={{ alignItems: "center", gap: 2 }}
        >
          <Txt variant="title">{formatMesAno(tituloMs)}</Txt>
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

      <View
        onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
        style={[{ overflow: "hidden" }, movendo && alturaMax > 0 ? { height: alturaMax } : null, SO_ROLA_NA_VERTICAL]}
        {...pan.panHandlers}
      >
        <Animated.View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            // Com os tres meses lado a lado, o do meio fica no lugar e os outros esperam fora da vista.
            width: movendo ? largura * 3 : undefined,
            marginLeft: movendo ? -largura : 0,
            transform: [{ translateX: x }],
          }}
        >
          {paginas.map((d) => {
            const mesMs = somaMeses(base, d);
            return (
              <View
                key={mesMs}
                role="group"
                aria-label={formatMesAno(mesMs)}
                aria-hidden={d !== 0}
                onLayout={(e) => {
                  const h = e.nativeEvent.layout.height;
                  setAlturas((a) => (a[mesMs] === h ? a : { ...a, [mesMs]: h }));
                }}
                style={{ width: movendo ? largura : "100%" }}
              >
                <GradeDoMes
                  mesMs={mesMs}
                  selecionadoMs={selecionadoMs}
                  marcadores={marcadores}
                  onSelecionar={onSelecionar}
                  onSegurar={onSegurar}
                />
              </View>
            );
          })}
        </Animated.View>
      </View>
    </View>
  );
}
