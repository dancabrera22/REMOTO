import { useState } from "react";
import { View } from "react-native";
import { CalendarioMes } from "@/components/calendario-mes";
import { Screen } from "@/components/screen";
import { Button, Card, EmptyState, Pill, Secao, Txt } from "@/components/ui";
import {
  diasRelativos,
  formatData,
  formatDiaSemanaLongo,
  inicioDoDia,
} from "@/lib/datetime";
import { useTheme } from "@/theme";

export default function Agenda() {
  const t = useTheme();
  const hoje = inicioDoDia(Date.now());
  const [referencia, setReferencia] = useState(hoje);
  const [selecionado, setSelecionado] = useState(hoje);

  return (
    <Screen titulo="Agenda" subtitulo="Seus plantões do mês">
      <Card>
        <CalendarioMes
          referenciaMs={referencia}
          selecionadoMs={selecionado}
          onSelecionar={(ms) => {
            setSelecionado(ms);
            setReferencia(ms);
          }}
          onTrocarMes={setReferencia}
        />
      </Card>

      <View>
        <Secao acao={<Pill tom="normal">{diasRelativos(selecionado)}</Pill>}>
          {`${formatDiaSemanaLongo(selecionado)}, ${formatData(selecionado)}`}
        </Secao>

        <Card>
          <EmptyState
            icone="calendar-plus"
            titulo="Nenhum plantão neste dia"
            descricao="Cadastre seus locais primeiro — o valor do plantão já vem preenchido a partir deles."
          >
            <View style={{ alignItems: "center", gap: t.spacing.sm }}>
              <Button icone="plus" disabled>
                Novo plantão
              </Button>
              <Pill tom="primary" icone="progress-wrench">
                chega na Etapa 3
              </Pill>
            </View>
          </EmptyState>
        </Card>
      </View>

      <Card>
        <Secao>Resumo do mês</Secao>
        <View style={{ flexDirection: "row", gap: t.spacing.lg }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tom="muted">
              Plantões
            </Txt>
            <Txt variant="title">0</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tom="muted">
              Horas
            </Txt>
            <Txt variant="title">0h</Txt>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt variant="caption" tom="muted">
              Previsto
            </Txt>
            <Txt variant="title">—</Txt>
          </View>
        </View>
      </Card>
    </Screen>
  );
}
