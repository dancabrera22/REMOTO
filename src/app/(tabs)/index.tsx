import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { CalendarioMes } from "@/components/calendario-mes";
import { Screen } from "@/components/screen";
import { Button, Card, EmptyState, Pill, Secao, Txt } from "@/components/ui";
import { listaLocais } from "@/db/locais";
import { listaPlantoesPeriodo, mudaStatusPlantao } from "@/db/plantoes";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import {
  chaveDia,
  diasRelativos,
  fimDoDia,
  formatData,
  formatDiaSemanaLongo,
  formatDuracao,
  gradeDoMes,
  inicioDoDia,
} from "@/lib/datetime";
import { formatBRL } from "@/lib/money";
import {
  ROTULO_STATUS,
  contaNoValor,
  descreveHorario,
  liquidoDoPlantao,
  marcadoresDoMes,
  precisaConfirmar,
  resumoDoMes,
  type PlantaoComLocal,
  type StatusPlantao,
} from "@/lib/plantoes";
import { useTheme } from "@/theme";

export default function Agenda() {
  const t = useTheme();
  const router = useRouter();
  const hoje = inicioDoDia(Date.now());
  const [referencia, setReferencia] = useState(hoje);
  const [selecionado, setSelecionado] = useState(hoje);

  // A grade mostra dias dos meses vizinhos; buscamos o intervalo todo para os
  // pontinhos desses dias tambem aparecerem.
  const [de, ate] = useMemo(() => {
    const grade = gradeDoMes(referencia).flat();
    return [grade[0].ms, fimDoDia(grade[grade.length - 1].ms)] as const;
  }, [referencia]);

  const plantoes = useConsulta((db) => listaPlantoesPeriodo(db, de, ate), [de, ate]);
  const locais = useConsulta((db) => listaLocais(db, { arquivados: false }));

  const lista = plantoes.status === "pronto" ? plantoes.dados : [];
  const marcadores = useMemo(() => marcadoresDoMes(lista), [lista]);
  const resumo = useMemo(() => resumoDoMes(lista, referencia), [lista, referencia]);

  const chaveSel = chaveDia(selecionado);
  const doDia = lista.filter((p) => chaveDia(p.inicio) === chaveSel);

  const semLocais = locais.status === "pronto" && locais.dados.length === 0;

  const novo = () =>
    semLocais
      ? router.push("/local/novo")
      : router.push({ pathname: "/plantao/[id]", params: { id: "novo", dia: chaveSel } });

  return (
    <Screen
      titulo="Agenda"
      subtitulo={resumo.plantoes > 0 ? `${resumo.plantoes} ${resumo.plantoes === 1 ? "plantão" : "plantões"} no mês` : "Seus plantões do mês"}
      direita={
        <Button icone="plus" compacto onPress={novo}>
          Novo
        </Button>
      }
    >
      <Card>
        <CalendarioMes
          referenciaMs={referencia}
          selecionadoMs={selecionado}
          onSelecionar={(ms) => {
            setSelecionado(ms);
            setReferencia(ms);
          }}
          onTrocarMes={setReferencia}
          marcadores={marcadores}
        />
      </Card>

      <View>
        <Secao acao={<Pill tom="normal">{diasRelativos(selecionado)}</Pill>}>
          {`${formatDiaSemanaLongo(selecionado)}, ${formatData(selecionado)}`}
        </Secao>

        {plantoes.status === "erro" && (
          <Card style={{ borderColor: t.colors.danger }}>
            <Txt variant="bodyStrong" tom="danger">
              Não consegui ler o banco
            </Txt>
            <Txt variant="caption" tom="muted" style={{ marginTop: 4 }}>
              {plantoes.erro}
            </Txt>
          </Card>
        )}

        {doDia.length === 0 && plantoes.status !== "erro" && (
          <Card>
            <EmptyState
              icone="calendar-plus"
              titulo={semLocais ? "Cadastre um local primeiro" : "Nenhum plantão neste dia"}
              descricao={
                semLocais
                  ? "O valor, os descontos e a data em que você recebe vêm do local."
                  : "Toque em Novo para lançar um plantão nesta data."
              }
            >
              <Button icone={semLocais ? "map-marker-plus-outline" : "plus"} onPress={novo}>
                {semLocais ? "Cadastrar local" : "Novo plantão"}
              </Button>
            </EmptyState>
          </Card>
        )}

        <View style={{ gap: t.spacing.md }}>
          {doDia.map((p) => (
            <CartaoPlantao
              key={p.id}
              plantao={p}
              onPress={() => router.push({ pathname: "/plantao/[id]", params: { id: String(p.id) } })}
            />
          ))}
        </View>
      </View>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Secao>Resumo do mês</Secao>
          {resumo.aConfirmar > 0 && (
            <Pill tom="warning" icone="clock-alert-outline">
              {resumo.aConfirmar} a confirmar
            </Pill>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: t.spacing.lg }}>
          <Metrica rotulo="Plantões" valor={String(resumo.plantoes)} />
          <Metrica rotulo="Horas" valor={resumo.minutos ? formatDuracao(resumo.minutos) : "0h"} />
          <Metrica rotulo="Líquido" valor={formatBRL(resumo.liquido)} grande />
        </View>
      </Card>
    </Screen>
  );
}

function Metrica({ rotulo, valor, grande }: { rotulo: string; valor: string; grande?: boolean }) {
  return (
    <View style={{ flex: grande ? 1.6 : 1, gap: 2 }}>
      <Txt variant="caption" tom="muted">
        {rotulo}
      </Txt>
      <Txt variant="title" numberOfLines={1}>
        {valor}
      </Txt>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const TOM_STATUS: Record<StatusPlantao, "primary" | "success" | "danger" | "warning"> = {
  agendado: "primary",
  realizado: "success",
  cancelado: "danger",
  trocado: "warning",
};

/**
 * Um plantao na lista do dia. A barra lateral na cor do local e o que faz o
 * olho reconhecer o lugar antes de ler; cancelado e trocado ficam esmaecidos
 * porque nao contam no que voce vai receber.
 */
function CartaoPlantao({ plantao: p, onPress }: { plantao: PlantaoComLocal; onPress: () => void }) {
  const t = useTheme();
  const db = useBanco();
  const invalidar = useInvalidar();

  const conta = contaNoValor(p.status);
  const confirmar = precisaConfirmar(p);

  return (
    <Card padding="none" onPress={onPress} style={{ overflow: "hidden", opacity: conta ? 1 : 0.6 }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 6, backgroundColor: p.local.cor }} />
        <View style={{ flex: 1, padding: t.spacing.lg, gap: t.spacing.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
            <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
              {p.local.apelido ? `${p.local.nome} · ${p.local.apelido}` : p.local.nome}
            </Txt>
            <Pill tom={TOM_STATUS[p.status]}>{ROTULO_STATUS[p.status]}</Pill>
          </View>

          <Txt variant="label" tom="muted">
            {descreveHorario(p.inicio, p.fim)}
          </Txt>

          <View style={{ flexDirection: "row", alignItems: "baseline", gap: t.spacing.sm }}>
            <Txt
              variant="title"
              style={conta ? undefined : { textDecorationLine: "line-through" }}
            >
              {formatBRL(liquidoDoPlantao(p))}
            </Txt>
            {p.descontoPercentual > 0 && conta && (
              <Txt variant="caption" tom="faint">
                líquido
              </Txt>
            )}
          </View>

          {p.observacao && (
            <Txt variant="caption" tom="muted" numberOfLines={2}>
              {p.observacao}
            </Txt>
          )}

          {confirmar && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, marginTop: t.spacing.xs }}>
              <Pill tom="warning" icone="clock-alert-outline">
                já terminou
              </Pill>
              <Button
                variant="secondary"
                compacto
                icone="check"
                onPress={async () => {
                  await mudaStatusPlantao(db, p.id, "realizado");
                  invalidar();
                }}
              >
                Foi realizado
              </Button>
            </View>
          )}
        </View>
      </View>
    </Card>
  );
}
