import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Pressable, View } from "react-native";
import {
  alturaDaLinha,
  alturaDoMes,
  chaveDia,
  diasSemanaMinimo,
  formatMesAno,
  gradeDoMes,
  inicioDoMes,
  linhasDoMes,
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
function DiaCelulaBase({
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

const mesmasCores = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((c, i) => c === b[i]));

/**
 * Memoizada comparando as cores pelo CONTEUDO: quando a consulta devolve de novo os
 * mesmos plantoes (uma lista nova, igual), nenhuma das 42 celulas precisa ser
 * redesenhada — e redesenhar tudo no instante em que o mes assenta era um dos
 * motivos de a tela dar um tranco.
 */
export const DiaCelula = memo(DiaCelulaBase, (a, b) =>
  a.dia === b.dia &&
  a.selecionado === b.selecionado &&
  a.hoje === b.hoje &&
  a.foraDoMes === b.foraDoMes &&
  a.fimDeSemana === b.fimDeSemana &&
  a.onPress === b.onPress &&
  a.onSegurar === b.onSegurar &&
  mesmasCores(a.cores, b.cores),
);

/** Quanto do mes tem de ser arrastado (em fracao da largura) para a troca valer ao soltar. */
const FRACAO_PARA_TROCAR = 0.25;

/** Um arremesso (rapido, mesmo curto) tambem troca: px por ms e distancia minima. */
const VELOCIDADE_DE_ARREMESSO = 0.4;
const DISTANCIA_DE_ARREMESSO = 24;

/** Vao entre uma semana e a seguinte (o `gap` da grade) — a altura de um mes sai disso e da altura medida de uma semana. */
const ESPACO_ENTRE_SEMANAS = 2;

/** Espera parado, assim, antes de montar os meses vizinhos fora da vista (ver `prontos`). */
const ESPERA_PARA_PREPARAR_MS = 280;

const mesmasCoresCelula = mesmasCores;

/**
 * Uma celula do mes. Existe para que `onPress`/`onSegurar` de cada dia tenham identidade
 * estavel (a mesma enquanto o dia e o tratador forem os mesmos) e a memoizacao funcione.
 */
const CelulaDoMes = memo(
  function CelulaDoMes({
    ms,
    dia,
    selecionado,
    hoje,
    foraDoMes,
    fimDeSemana,
    cores,
    onSelecionar,
    onSegurar,
  }: {
    ms: number;
    dia: number;
    selecionado: boolean;
    hoje: boolean;
    foraDoMes: boolean;
    fimDeSemana: boolean;
    cores?: readonly string[];
    onSelecionar: (ms: number) => void;
    onSegurar?: (ms: number) => void;
  }) {
    const tocar = useCallback(() => onSelecionar(ms), [onSelecionar, ms]);
    const segurar = useCallback(() => onSegurar?.(ms), [onSegurar, ms]);
    return (
      <DiaCelula
        dia={dia}
        selecionado={selecionado}
        hoje={hoje}
        foraDoMes={foraDoMes}
        fimDeSemana={fimDeSemana}
        cores={cores}
        onPress={tocar}
        onSegurar={onSegurar ? segurar : undefined}
      />
    );
  },
  (a, b) =>
    a.ms === b.ms &&
    a.dia === b.dia &&
    a.selecionado === b.selecionado &&
    a.hoje === b.hoje &&
    a.foraDoMes === b.foraDoMes &&
    a.fimDeSemana === b.fimDeSemana &&
    a.onSelecionar === b.onSelecionar &&
    a.onSegurar === b.onSegurar &&
    mesmasCoresCelula(a.cores, b.cores),
);

/** Um mes: as semanas, uma sobre a outra. Existe como parte propria para o calendario poder mostrar tres lado a lado. */
const GradeDoMes = memo(function GradeDoMes({
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
  // A grade so muda com o mes — ou com a virada do dia, que muda qual celula e "hoje".
  const hojeChave = chaveDia(Date.now());
  const semanas = useMemo(() => gradeDoMes(mesMs), [mesMs, hojeChave]);
  return (
    <View style={{ gap: ESPACO_ENTRE_SEMANAS }}>
      {semanas.map((semana, i) => (
        <View key={i} style={{ flexDirection: "row" }}>
          {semana.map((celula) => (
            <CelulaDoMes
              key={celula.chave}
              ms={celula.ms}
              dia={celula.dia}
              selecionado={selecionadoMs !== null && mesmoDia(celula.ms, selecionadoMs)}
              hoje={celula.hoje}
              foraDoMes={celula.foraDoMes}
              fimDeSemana={celula.fimDeSemana}
              cores={marcadores?.[celula.chave]?.cores}
              onSelecionar={onSelecionar}
              onSegurar={onSegurar}
            />
          ))}
        </View>
      ))}
    </View>
  );
});

/**
 * Calendario mensal.
 *
 * Nucleo da aba Agenda: a partir da Etapa 3 ele recebe `marcadores` com as
 * cores dos locais de cada dia. E por isso que a cor escolhida no cadastro do
 * local importa tanto — o mes inteiro passa a ser lido de relance.
 *
 * Trocar de mes e um gesto fisico, como passar fotos: o mes ACOMPANHA o dedo, o
 * vizinho entra de lado, e ao soltar ele termina de deslizar (ou volta, se o
 * arrasto foi curto). As setas deslizam do mesmo jeito.
 *
 * O que faz a troca parecer suave (e nao um "pisca"):
 *  - a ALTURA acompanha o dedo: um mes de 6 semanas e mais alto que um de 5, e antes
 *    tudo que fica embaixo dava um salto de 56 px de uma vez;
 *  - o mes que entra ja traz o dia que sera selecionado nele (`selecionadoAoTrocar`),
 *    entao o destaque chega junto, em vez de aparecer so depois de assentar;
 *  - os meses vizinhos sao montados DEPOIS de a tela ficar parada um instante, fora da
 *    vista e escondidos da acessibilidade, e nao no instante em que o dedo comeca a
 *    andar (montar 84 celulas de uma vez travava justo ali).
 */
export function CalendarioMes({
  referenciaMs,
  selecionadoMs,
  onSelecionar,
  onTrocarMes,
  onSegurar,
  marcadores,
  selecionadoAoTrocar,
  emTroca,
}: {
  referenciaMs: number;
  selecionadoMs: number | null;
  onSelecionar: (ms: number) => void;
  onTrocarMes: (ms: number) => void;
  /** Segurar o dedo num dia (a agenda oferece incluir um plantao ali). */
  onSegurar?: (ms: number) => void;
  marcadores?: Record<string, MarcadorDia>;
  /** Que dia fica selecionado quando esse mes abrir; o mes que entra deslizando o mostra de antemao. */
  selecionadoAoTrocar?: (mesMs: number) => number | null;
  /**
   * Avisa que uma troca de mes vai terminar de deslizar (`true`) ou foi desfeita
   * (`false`) — para quem mostra outras coisas por baixo suavizar a mudanca delas.
   */
  emTroca?: (ativa: boolean) => void;
}) {
  const t = useTheme();

  const [largura, setLargura] = useState(0);
  const [movendo, setMovendo] = useState(false);
  /**
   * Os meses vizinhos que ja estao montados, parados fora da vista: o arrasto nao precisa montar
   * nada. Ao trocar de mes, o vizinho de antes vira o atual ou o vizinho do lado (continua
   * montado, sem custo); so o novo vizinho do outro lado e montado depois, com a tela parada.
   */
  const [prontos, setProntos] = useState<readonly number[]>([]);
  /** O mes que o titulo mostra: acompanha o arrasto e vira o novo assim que passa da metade. */
  const [tituloMs, setTituloMs] = useState(referenciaMs);
  /** Altura de UMA semana, medida na tela (a altura de qualquer mes sai dela). */
  const [linha, setLinha] = useState<number | null>(null);

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
  const vivo = useRef({ referenciaMs, onTrocarMes, largura, onSelecionar, onSegurar, emTroca });
  vivo.current = { referenciaMs, onTrocarMes, largura, onSelecionar, onSegurar, emTroca };

  const mesDe = (delta: number) => somaMeses(inicioDoMes(vivo.current.referenciaMs), delta);

  // Identidade estavel: as celulas memoizadas nao se redesenham a cada render da tela.
  const selecionar = useCallback((ms: number) => vivo.current.onSelecionar(ms), []);
  const temSegurar = Boolean(onSegurar);
  const segurar = useMemo(
    () => (temSegurar ? (ms: number) => vivo.current.onSegurar?.(ms) : undefined),
    [temSegurar],
  );

  /**
   * Termina a troca: desliza ate o vizinho e entao avisa quem controla o mes.
   *
   * Nada aqui usa o driver nativo: o deslocamento E a altura saem do mesmo valor
   * (`x`), e a altura e propriedade de layout, que o driver nativo nao anima.
   */
  const termina = (direcao: 1 | -1) => {
    const W = vivo.current.largura;
    const alvo = mesDe(direcao);
    setTituloMs(alvo);
    vivo.current.emTroca?.(true);
    const restante = Math.abs(-direcao * W - posicao.current);
    Animated.timing(x, {
      toValue: -direcao * W,
      duration: Math.round(110 + 150 * (restante / Math.max(W, 1))),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      vivo.current.onTrocarMes(alvo);
      // Se quem controla nao trocou o mes, nao deixamos o calendario preso no vizinho.
      setTimeout(() => {
        if (inicioDoMes(vivo.current.referenciaMs) !== alvo) volta();
      }, 400);
    });
  };

  const volta = () => {
    vivo.current.emTroca?.(false);
    Animated.timing(x, {
      toValue: 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      posicao.current = 0;
      ocupado.current = false;
      setMovendo(false);
      setTituloMs(vivo.current.referenciaMs);
    });
  };

  // Quando o mes de fato troca, a pagina vizinha ja esta na tela: so falta tornar
  // o vizinho o "atual" e zerar o deslocamento — tudo no mesmo quadro, sem piscar.
  // Fica montado so quem continua vizinho; o novo vizinho do outro lado vem depois.
  useLayoutEffect(() => {
    x.setValue(0);
    posicao.current = 0;
    ocupado.current = false;
    pendente.current = null;
    setMovendo(false);
    const antes = somaMeses(inicioDoMes(referenciaMs), -1);
    const depois = somaMeses(inicioDoMes(referenciaMs), 1);
    setProntos((p) => {
      const ficam = p.filter((m) => m === antes || m === depois);
      return ficam.length === p.length ? p : ficam;
    });
    setTituloMs(referenciaMs);
  }, [referenciaMs, x]);

  // Parado um instante: monta o vizinho que falta, fora da vista. E uma transicao (React pode
  // pausar no meio se um dedo tocar), e o primeiro arrasto ja encontra tudo pronto.
  useEffect(() => {
    if (movendo || largura === 0 || linha === null) return;
    const base = inicioDoMes(referenciaMs);
    const faltam = [somaMeses(base, -1), somaMeses(base, 1)].filter((m) => !prontos.includes(m));
    if (faltam.length === 0) return;
    const id = setTimeout(
      () => startTransition(() => setProntos((p) => [...p, ...faltam.filter((m) => !p.includes(m))])),
      ESPERA_PARA_PREPARAR_MS,
    );
    return () => clearTimeout(id);
  }, [movendo, prontos, largura, linha, referenciaMs]);

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
  const tres = movendo || prontos.length > 0;
  // Durante o arrasto os tres meses existem; parado, so os que ja foram preparados.
  const paginas = [-1, 0, 1].filter((d) => d === 0 || movendo || prontos.includes(somaMeses(base, d)));

  // A altura do calendario vai de um mes ao outro junto com o dedo (x = -largura: o seguinte
  // ocupa a tela; x = +largura: o anterior). Sem isso o conteudo de baixo pula ate 56 px.
  const altura = useMemo(() => {
    if (!tres || linha === null || largura === 0) return null;
    const h = (d: number) => alturaDoMes(linhasDoMes(somaMeses(base, d)), linha, ESPACO_ENTRE_SEMANAS);
    return x.interpolate({
      inputRange: [-largura, 0, largura],
      outputRange: [h(1), h(0), h(-1)],
      extrapolate: "clamp",
    });
  }, [tres, linha, largura, base, x]);

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
          {/* A linha existe sempre (um espaco, no mes de hoje): se ela aparecesse e sumisse, tudo
              que esta embaixo daria um tranco de 6 px a cada vez que o titulo passa pelo mes de hoje. */}
          <Txt variant="caption" tom="primary">
            {mesAtual ? "\u00A0" : "voltar para hoje"}
          </Txt>
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

      <Animated.View
        onLayout={(e) => setLargura(e.nativeEvent.layout.width)}
        aria-busy={movendo}
        style={[{ overflow: "hidden" }, altura ? { height: altura } : null, SO_ROLA_NA_VERTICAL]}
        {...pan.panHandlers}
      >
        <Animated.View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            // Com os tres meses lado a lado, o do meio fica no lugar e os outros esperam fora da vista.
            width: tres ? largura * 3 : undefined,
            marginLeft: tres ? -largura : 0,
            transform: [{ translateX: x }],
          }}
        >
          {/* O lugar do mes anterior fica reservado mesmo sem ele montado: e ele que empurra o atual para o meio. */}
          {tres && !paginas.includes(-1) && <View key="espaco" style={{ width: largura }} />}
          {paginas.map((d) => {
            const mesMs = somaMeses(base, d);
            return (
              <View
                key={mesMs}
                role="group"
                aria-label={formatMesAno(mesMs)}
                aria-hidden={d !== 0}
                onLayout={
                  d === 0
                    ? (e) => setLinha(alturaDaLinha(e.nativeEvent.layout.height, linhasDoMes(mesMs), ESPACO_ENTRE_SEMANAS))
                    : undefined
                }
                style={{ width: tres ? largura : "100%" }}
              >
                <GradeDoMes
                  mesMs={mesMs}
                  selecionadoMs={d === 0 || !selecionadoAoTrocar ? selecionadoMs : selecionadoAoTrocar(mesMs)}
                  marcadores={marcadores}
                  onSelecionar={selecionar}
                  onSegurar={segurar}
                />
              </View>
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
