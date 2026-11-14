import { useState } from "react";
import { Pressable, View } from "react-native";
import { Screen } from "@/components/screen";
import { Card, Icone, Pill, Secao, Txt } from "@/components/ui";
import { formatMesAno, inicioDoMes, somaMeses } from "@/lib/datetime";
import { formatBRL } from "@/lib/money";
import { useTheme } from "@/theme";

export default function Financeiro() {
  const t = useTheme();
  const [mes, setMes] = useState(inicioDoMes(Date.now()));

  const cartoes = [
    {
      rotulo: "A receber",
      valor: 0,
      tom: "warning" as const,
      icone: "clock-outline" as const,
      nota: "plantões já feitos, dinheiro ainda não caiu",
    },
    {
      rotulo: "Recebido",
      valor: 0,
      tom: "success" as const,
      icone: "check-circle-outline" as const,
      nota: "confirmado na conta",
    },
    {
      rotulo: "Previsto no mês",
      valor: 0,
      tom: "primary" as const,
      icone: "chart-line" as const,
      nota: "tudo que a escala deve gerar",
    },
  ];

  return (
    <Screen titulo="Financeiro" subtitulo="Quanto entra, e quando">
      <Card>
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          <Pressable onPress={() => setMes(somaMeses(mes, -1))} hitSlop={12}>
            <Icone name="chevron-left" size={24} color={t.colors.textMuted} />
          </Pressable>
          <Txt variant="title">{formatMesAno(mes)}</Txt>
          <Pressable onPress={() => setMes(somaMeses(mes, 1))} hitSlop={12}>
            <Icone name="chevron-right" size={24} color={t.colors.textMuted} />
          </Pressable>
        </View>
      </Card>

      <View style={{ gap: t.spacing.md }}>
        {cartoes.map((cartao) => (
          <Card key={cartao.rotulo}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: t.radius.md,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    cartao.tom === "success"
                      ? t.colors.successSoft
                      : cartao.tom === "warning"
                        ? t.colors.warningSoft
                        : t.colors.primarySoft,
                }}
              >
                <Icone
                  name={cartao.icone}
                  size={21}
                  color={
                    cartao.tom === "success"
                      ? t.colors.success
                      : cartao.tom === "warning"
                        ? t.colors.warning
                        : t.colors.primary
                  }
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="caption" tom="muted">
                  {cartao.rotulo}
                </Txt>
                <Txt variant="money">{formatBRL(cartao.valor)}</Txt>
                <Txt variant="caption" tom="faint">
                  {cartao.nota}
                </Txt>
              </View>
            </View>
          </Card>
        ))}
      </View>

      <Card>
        <Secao acao={<Pill tom="primary" icone="progress-wrench">Etapa 5</Pill>}>
          Como a previsão vai funcionar
        </Secao>
        <Txt variant="label" tom="muted">
          Cada local guarda a própria regra de pagamento. Lançado o plantão, o app calcula a data
          prevista de recebimento, soma por mês e por local, e avisa quando um pagamento passa do
          prazo. Um pagamento só pode cobrir vários plantões de uma vez — é assim que costuma
          chegar na conta, e é assim que vai ser registrado.
        </Txt>
      </Card>
    </Screen>
  );
}
