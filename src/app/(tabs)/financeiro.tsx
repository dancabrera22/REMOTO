import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { AlturaSuave } from "@/components/altura-suave";
import { FolhaRecebimento, TOM_ESTADO } from "@/components/baixa-recebimento";
import { SO_ROLA_NA_VERTICAL, useDeslizeHorizontal } from "@/components/gestos";
import { Screen } from "@/components/screen";
import { Segmentado } from "@/components/form";
import { Button, Card, EmptyState, Icone, Pill, Secao, Txt } from "@/components/ui";
import { listaPlantoesFinanceiro } from "@/db/financeiro";
import { useConsulta, useInvalidar } from "@/db/provider";
import {
  formatData,
  formatDiaSemana,
  formatDuracao,
  formatMesAno,
  formatMesAnoCurto,
  inicioDoDia,
  inicioDoMes,
  somaMeses,
} from "@/lib/datetime";
import {
  ROTULO_ESTADO,
  agrupaRecebimentos,
  itensAtrasados,
  itensDoMes,
  itensFinanceiros,
  previsaoDosMeses,
  resumoDoMesFinanceiro,
  resumoDosAtrasos,
  type GrupoRecebimento,
} from "@/lib/financeiro";
import { formatBRL } from "@/lib/money";
import { useTheme } from "@/theme";

type Visao = "mes" | "atrasados";

export default function Financeiro() {
  const t = useTheme();
  const invalidar = useInvalidar();
  const hoje = inicioDoDia(Date.now());
  const mesAtual = inicioDoMes(hoje);

  const [mes, setMes] = useState(mesAtual);
  const [visao, setVisao] = useState<Visao>("mes");
  const [aberto, setAberto] = useState<GrupoRecebimento | null>(null);

  const dados = useConsulta((db) => listaPlantoesFinanceiro(db), []);
  const itens = useMemo(() => (dados.status === "pronto" ? itensFinanceiros(dados.dados, Date.now()) : []), [dados]);

  const resumo = useMemo(() => resumoDoMesFinanceiro(itens, mes), [itens, mes]);
  const atrasos = useMemo(() => resumoDosAtrasos(itens), [itens]);
  const grupos = useMemo(
    () => agrupaRecebimentos(visao === "mes" ? itensDoMes(itens, mes) : itensAtrasados(itens)),
    [itens, mes, visao],
  );
  const proximos = useMemo(() => previsaoDosMeses(itens, mesAtual, 6), [itens, mesAtual]);
  const maiorMes = Math.max(1, ...proximos.map((m) => m.resumo.total));

  // Sem atrasos nao ha o que ver na aba de atrasados.
  const visaoEfetiva: Visao = atrasos.plantoes === 0 ? "mes" : visao;

  // Trocar de mes muda tudo de uma vez (valores, barra, lista). Para isso nao parecer um "pisca",
  // o que depende do mes entra esmaecido e um pouco deslocado do lado de onde a pessoa veio, e
  // assenta em 240 ms; e a altura da lista e do resumo muda deslizando (AlturaSuave).
  const entra = useRef(new Animated.Value(0)).current; // 1 = recem trocado, 0 = em repouso
  const sentido = useRef<1 | -1>(1);
  const primeiraVez = useRef(true);
  useLayoutEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    // Animacao em JS (nao nativa): o valor inicial vale antes de a tela ser desenhada, entao o
    // conteudo novo nunca aparece em cheio por um quadro antes de esmaecer.
    entra.setValue(1);
    Animated.timing(entra, { toValue: 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [mes, entra]);
  const estiloEntrada = {
    opacity: entra.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
    transform: [{ translateX: entra.interpolate({ inputRange: [0, 1], outputRange: [0, sentido.current * 28] }) }],
  };

  const trocaMes = (ms: number) => {
    const novo = inicioDoMes(ms);
    sentido.current = novo >= mes ? 1 : -1;
    setMes(novo);
    setVisao("mes");
  };
  const deslize = useDeslizeHorizontal((dir) => trocaMes(somaMeses(mes, dir === "esquerda" ? 1 : -1)));

  const semNada = dados.status === "pronto" && itens.length === 0;

  return (
    <Screen titulo="Financeiro" subtitulo="Quanto entra, e quando">
      {dados.status === "erro" && (
        <Card style={{ borderColor: t.colors.danger }}>
          <Txt variant="bodyStrong" tom="danger">
            Não consegui ler o banco
          </Txt>
          <Txt variant="caption" tom="muted" style={{ marginTop: 4 }}>
            {dados.erro}
          </Txt>
        </Card>
      )}

      <View style={[{ gap: t.spacing.lg }, SO_ROLA_NA_VERTICAL]} {...deslize}>
        {/* ----------------------------------- mes ----------------------------------- */}
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Pressable
              onPress={() => trocaMes(somaMeses(mes, -1))}
              hitSlop={12}
              role="button"
              aria-label="Mês anterior"
              style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
            >
              <Icone name="chevron-left" size={24} color={t.colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => mes !== mesAtual && trocaMes(mesAtual)}
              style={{ alignItems: "center", gap: 2 }}
            >
              <Txt variant="title">{formatMesAno(mes)}</Txt>
              {/* A linha existe sempre (um espaco, no mes atual): se aparecesse e sumisse, tudo embaixo daria um tranco. */}
              <Txt variant="caption" tom="primary">
                {mes !== mesAtual ? "voltar para este mês" : "\u00A0"}
              </Txt>
            </Pressable>
            <Pressable
              onPress={() => trocaMes(somaMeses(mes, 1))}
              hitSlop={12}
              role="button"
              aria-label="Próximo mês"
              style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
            >
              <Icone name="chevron-right" size={24} color={t.colors.textMuted} />
            </Pressable>
          </View>
        </Card>

        {/* --------------------------------- resumo --------------------------------- */}
        <Animated.View style={estiloEntrada}>
          <AlturaSuave>
            <Card>
              <Txt variant="caption" tom="muted">
                {mes < mesAtual ? "Movimento do mês" : mes === mesAtual ? "Neste mês" : "Previsto para o mês"}
              </Txt>
              <Txt variant="money" style={{ marginTop: 2 }}>
                {formatBRL(resumo.total)}
              </Txt>
              {resumo.total > 0 && (
                <View
                  accessibilityLabel={`Recebido ${formatBRL(resumo.recebido)} de ${formatBRL(resumo.total)}`}
                  style={{
                    flexDirection: "row",
                    height: 8,
                    borderRadius: 4,
                    overflow: "hidden",
                    backgroundColor: t.colors.surfaceAlt,
                    marginVertical: t.spacing.md,
                  }}
                >
                  <View style={{ flex: resumo.recebido, backgroundColor: t.colors.success }} />
                  <View style={{ flex: resumo.total - resumo.recebido, backgroundColor: "transparent" }} />
                </View>
              )}
              <View style={{ flexDirection: "row", gap: t.spacing.lg, marginTop: resumo.total > 0 ? 0 : t.spacing.md }}>
                <Metrica rotulo="Recebido" valor={resumo.recebido} tom="success" />
                <Metrica rotulo="A receber" valor={resumo.aReceber} tom="warning" />
                <Metrica rotulo="Previsto" valor={resumo.previsto} tom="primary" />
              </View>
              {resumo.atrasado > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: t.spacing.sm,
                    marginTop: t.spacing.md,
                    paddingTop: t.spacing.md,
                    borderTopWidth: 1,
                    borderTopColor: t.colors.border,
                  }}
                >
                  <Icone name="alert-circle-outline" size={18} color={t.colors.danger} />
                  <Txt variant="label" tom="danger" style={{ flex: 1 }}>
                    {`Atrasado neste mês: ${formatBRL(resumo.atrasado)}`}
                  </Txt>
                </View>
              )}
              <Txt variant="caption" tom="faint" style={{ marginTop: t.spacing.md }}>
                Recebido: o que já caiu na conta. A receber: plantões feitos, dentro do prazo. Previsto: plantões ainda
                agendados.
              </Txt>
            </Card>
          </AlturaSuave>
        </Animated.View>
      </View>

      {/* -------------------------------- atrasados -------------------------------- */}
      {atrasos.plantoes > 0 && (
        <Card style={{ borderColor: t.colors.danger }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: t.radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.colors.dangerSoft,
              }}
            >
              <Icone name="clock-alert-outline" size={22} color={t.colors.danger} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt variant="bodyStrong" tom="danger">
                {`${formatBRL(atrasos.total)} em atraso`}
              </Txt>
              <Txt variant="caption" tom="muted">
                {`${atrasos.plantoes} ${atrasos.plantoes === 1 ? "plantão" : "plantões"} · o mais antigo era esperado em ${
                  atrasos.desde === null ? "—" : formatData(atrasos.desde)
                }`}
              </Txt>
            </View>
          </View>
          {visaoEfetiva !== "atrasados" && (
            <View style={{ marginTop: t.spacing.md }}>
              <Button variant="secondary" compacto icone="eye-outline" onPress={() => setVisao("atrasados")}>
                Ver atrasados
              </Button>
            </View>
          )}
        </Card>
      )}

      {/* --------------------------------- lista --------------------------------- */}
      <View style={{ gap: t.spacing.md }}>
        <Secao>Recebimentos</Secao>
        {atrasos.plantoes > 0 && (
          <Segmentado
            opcoes={[
              { valor: "mes" as Visao, rotulo: formatMesAnoCurto(mes) },
              { valor: "atrasados" as Visao, rotulo: `Atrasados (${atrasos.plantoes})` },
            ]}
            valor={visaoEfetiva}
            onChange={setVisao}
          />
        )}

        <Animated.View style={estiloEntrada}>
          <AlturaSuave estilo={{ gap: t.spacing.md }}>
            {grupos.length === 0 && dados.status !== "erro" && (
              <Card>
                <EmptyState
                  icone="cash-clock"
                  titulo={semNada ? "Nada para receber ainda" : `Nada previsto para ${formatMesAno(mes)}`}
                  descricao={
                    semNada
                      ? "Lance plantões na Agenda. A data em que cada um cai na conta vem da regra de pagamento do local."
                      : "Use as setas para ver outros meses, ou toque num mês em “Como vem por aí”."
                  }
                />
              </Card>
            )}

            {grupos.map((g) => (
              <CartaoGrupo key={g.chave} grupo={g} onPress={() => setAberto(g)} />
            ))}
          </AlturaSuave>
        </Animated.View>
      </View>

      {/* ------------------------------ proximos meses ------------------------------ */}
      {!semNada && (
        <Card>
          <Secao>Como vem por aí</Secao>
          <View style={{ gap: t.spacing.md }}>
            {proximos.map(({ mes: m, resumo: r }) => (
              <Pressable
                key={m}
                onPress={() => trocaMes(m)}
                role="button"
                aria-label={`${formatMesAno(m)}: ${formatBRL(r.total)}`}
                style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}
              >
                <Txt variant="label" tom={m === mes ? "primary" : "muted"} style={{ width: 52, fontWeight: m === mes ? "700" : "500" }}>
                  {formatMesAnoCurto(m)}
                </Txt>
                <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: t.colors.surfaceAlt, overflow: "hidden", flexDirection: "row" }}>
                  <View style={{ flex: r.recebido, backgroundColor: t.colors.success }} />
                  <View style={{ flex: r.atrasado, backgroundColor: t.colors.danger }} />
                  <View style={{ flex: r.aReceber + r.previsto, backgroundColor: t.colors.primary }} />
                  <View style={{ flex: Math.max(0, maiorMes - r.total) }} />
                </View>
                <Txt variant="label" style={{ width: 96, textAlign: "right", fontWeight: "600" }}>
                  {r.total > 0 ? formatBRL(r.total) : "—"}
                </Txt>
              </Pressable>
            ))}
          </View>
        </Card>
      )}

      {aberto && (
        <FolhaRecebimento
          grupo={aberto}
          onFechar={() => setAberto(null)}
          onConcluido={() => {
            setAberto(null);
            invalidar();
          }}
        />
      )}
    </Screen>
  );
}

function Metrica({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: "success" | "warning" | "primary" }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: tom === "success" ? t.colors.success : tom === "warning" ? t.colors.warning : t.colors.primary,
          }}
        />
        <Txt variant="caption" tom="muted">
          {rotulo}
        </Txt>
      </View>
      <Txt variant="bodyStrong" numberOfLines={1}>
        {formatBRL(valor)}
      </Txt>
    </View>
  );
}

/** Um pagamento: de que local, quando cai (ou caiu), quantos plantoes e quanto. */
function CartaoGrupo({ grupo: g, onPress }: { grupo: GrupoRecebimento; onPress: () => void }) {
  const t = useTheme();
  const quando =
    g.estado === "recebido"
      ? `Recebido em ${formatDiaSemana(g.data)}, ${formatData(g.data).slice(0, 5)}`
      : g.estado === "atrasado"
        ? `Era esperado em ${formatDiaSemana(g.data)}, ${formatData(g.data).slice(0, 5)}`
        : `Cai em ${formatDiaSemana(g.data)}, ${formatData(g.data).slice(0, 5)}`;

  return (
    <Card padding="none" onPress={onPress} style={{ overflow: "hidden" }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 6, backgroundColor: g.local.cor }} />
        <View style={{ flex: 1, padding: t.spacing.lg, gap: t.spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {g.local.apelido ? `${g.local.nome} · ${g.local.apelido}` : g.local.nome}
            </Txt>
            <Pill tom={TOM_ESTADO[g.estado]}>{ROTULO_ESTADO[g.estado]}</Pill>
          </View>
          <Txt variant="label" tom="muted">
            {quando}
          </Txt>
          <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" }}>
            <Txt variant="title">{formatBRL(g.total)}</Txt>
            <Txt variant="caption" tom="faint">
              {`${g.itens.length} ${g.itens.length === 1 ? "plantão" : "plantões"} · ${formatDuracao(g.minutos)}`}
            </Txt>
          </View>
        </View>
      </View>
    </Card>
  );
}
