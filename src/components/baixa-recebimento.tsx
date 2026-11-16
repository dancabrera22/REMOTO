import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { CalendarioMes } from "@/components/calendario-mes";
import { Folha } from "@/components/folha";
import { Segmentado } from "@/components/form";
import { Button, Card, Icone, Pill, Txt } from "@/components/ui";
import { baixaPlantoes, desfazBaixa } from "@/db/financeiro";
import { useBanco } from "@/db/provider";
import { formatData, formatDiaSemana, formatDiaSemanaLongo, formatHora, inicioDoDia } from "@/lib/datetime";
import { erroDataRecebimento, ROTULO_ESTADO, type EstadoRecebimento, type GrupoRecebimento } from "@/lib/financeiro";
import { formatBRL } from "@/lib/money";
import { useTheme } from "@/theme";

export const TOM_ESTADO: Record<EstadoRecebimento, "success" | "danger" | "warning" | "primary"> = {
  recebido: "success",
  atrasado: "danger",
  a_receber: "warning",
  previsto: "primary",
};

type Quando = "hoje" | "prevista" | "outra";

/**
 * Um pagamento do hospital, aberto: quais plantoes ele cobre e quando caiu.
 * Da baixa em todos de uma vez (o normal: um deposito, varios plantoes) ou
 * so em alguns (o hospital pagou parte). Num grupo ja recebido, desfaz.
 */
export function FolhaRecebimento({
  grupo,
  onFechar,
  onConcluido,
}: {
  grupo: GrupoRecebimento;
  onFechar: () => void;
  onConcluido: () => void;
}) {
  const t = useTheme();
  const db = useBanco();
  const hoje = inicioDoDia(Date.now());
  const recebido = grupo.estado === "recebido";

  const [escolhidos, setEscolhidos] = useState<Set<number>>(() => new Set(grupo.itens.map((i) => i.id)));
  const [quando, setQuando] = useState<Quando>("hoje");
  const [outraData, setOutraData] = useState(hoje);
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [refCalendario, setRefCalendario] = useState(hoje);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const previstaVale = !recebido && grupo.data <= hoje;
  const pagoEm = quando === "hoje" ? Date.now() : quando === "prevista" ? grupo.data : outraData;
  const erroData = recebido ? null : erroDataRecebimento(pagoEm);

  const selecionados = useMemo(() => grupo.itens.filter((i) => escolhidos.has(i.id)), [grupo, escolhidos]);
  const totalSelecionado = selecionados.reduce((s, i) => s + i.liquido, 0);
  const n = selecionados.length;
  const todos = n === grupo.itens.length;

  const alterna = (id: number) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  async function confirma() {
    setTrabalhando(true);
    setErro(null);
    try {
      const ids = selecionados.map((i) => i.id);
      if (recebido) await desfazBaixa(db, ids);
      else await baixaPlantoes(db, ids, pagoEm);
      onConcluido();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui concluir.");
      setTrabalhando(false);
    }
  }

  const rotuloData = (ms: number) => `${formatDiaSemana(ms)}, ${formatData(ms)}`;
  const quandoTexto = recebido
    ? `Recebido em ${rotuloData(grupo.data)}`
    : grupo.estado === "atrasado"
      ? `Era esperado em ${rotuloData(grupo.data)}`
      : `Cai em ${rotuloData(grupo.data)}`;

  return (
    <Folha
      titulo={grupo.local.apelido ? `${grupo.local.nome} · ${grupo.local.apelido}` : grupo.local.nome}
      subtitulo={`${quandoTexto} · ${grupo.itens.length} ${grupo.itens.length === 1 ? "plantão" : "plantões"} · ${formatBRL(grupo.total).replace(" ", "\u00A0")}`}
      onFechar={onFechar}
      acoes={
        <View style={{ gap: t.spacing.sm }}>
          {erro && (
            <Txt variant="label" tom="danger">
              {erro}
            </Txt>
          )}
          <Button
            variant={recebido ? "danger" : "primary"}
            icone={recebido ? "undo" : "cash-check"}
            largura="cheia"
            disabled={n === 0 || trabalhando || Boolean(erroData)}
            onPress={confirma}
          >
            {trabalhando
              ? "Aguarde…"
              : recebido
                ? `Desfazer recebimento de ${n}`
                : `Marcar ${n} como recebido · ${formatBRL(totalSelecionado)}`}
          </Button>
          <Button variant="secondary" largura="cheia" onPress={onFechar} disabled={trabalhando}>
            Fechar
          </Button>
        </View>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
        <Pill tom={TOM_ESTADO[grupo.estado]}>{ROTULO_ESTADO[grupo.estado]}</Pill>
        {grupo.itens.length > 1 && (
          <Pressable
            role="button"
            onPress={() => setEscolhidos(todos ? new Set() : new Set(grupo.itens.map((i) => i.id)))}
            style={{ marginLeft: "auto" }}
          >
            <Txt variant="label" tom="primary" style={{ fontWeight: "600" }}>
              {todos ? "Desmarcar todos" : "Marcar todos"}
            </Txt>
          </Pressable>
        )}
      </View>

      <View style={{ gap: t.spacing.sm }}>
        {grupo.itens.map((item) => {
          const marcado = escolhidos.has(item.id);
          return (
            <Pressable
              key={item.id}
              role="checkbox"
              aria-checked={marcado}
              onPress={() => alterna(item.id)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: t.spacing.md,
                padding: t.spacing.md,
                borderRadius: t.radius.md,
                borderWidth: marcado ? 2 : 1,
                borderColor: marcado ? t.colors.primary : t.colors.borderStrong,
                backgroundColor: marcado ? t.colors.primarySoft : t.colors.surface,
              }}
            >
              <Icone
                name={marcado ? "checkbox-marked" : "checkbox-blank-outline"}
                size={22}
                color={marcado ? t.colors.primary : t.colors.textFaint}
                aria-hidden
                importantForAccessibility="no"
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">
                  {formatDiaSemana(item.inicio)}, {formatData(item.inicio).slice(0, 5)}
                </Txt>
                <Txt variant="caption" tom="muted">
                  {formatHora(item.inicio)} → {formatHora(item.fim)}
                  {item.status === "agendado" ? " · ainda agendado" : ""}
                </Txt>
              </View>
              <Txt variant="bodyStrong">{formatBRL(item.liquido)}</Txt>
            </Pressable>
          );
        })}
      </View>

      {!recebido && (
        <View style={{ gap: t.spacing.sm, marginTop: t.spacing.sm }}>
          <Txt variant="label" style={{ fontWeight: "600" }}>
            Quando o dinheiro caiu
          </Txt>
          <Segmentado
            opcoes={
              previstaVale
                ? [
                    { valor: "hoje" as Quando, rotulo: "Hoje" },
                    { valor: "prevista" as Quando, rotulo: `Dia previsto` },
                    { valor: "outra" as Quando, rotulo: "Outra data" },
                  ]
                : [
                    { valor: "hoje" as Quando, rotulo: "Hoje" },
                    { valor: "outra" as Quando, rotulo: "Outra data" },
                  ]
            }
            valor={quando}
            onChange={(q) => {
              setQuando(q);
              setCalendarioAberto(q === "outra");
            }}
          />
          <Txt variant="caption" tom={erroData ? "danger" : "muted"}>
            {erroData ?? `Vai constar como recebido em ${formatDiaSemanaLongo(pagoEm)}, ${formatData(pagoEm)}.`}
          </Txt>
          {quando === "outra" && calendarioAberto && (
            <Card>
              <CalendarioMes
                referenciaMs={refCalendario}
                selecionadoMs={outraData}
                onSelecionar={(ms) => {
                  setOutraData(inicioDoDia(ms));
                  setRefCalendario(ms);
                }}
                onTrocarMes={setRefCalendario}
              />
            </Card>
          )}
        </View>
      )}
    </Folha>
  );
}
