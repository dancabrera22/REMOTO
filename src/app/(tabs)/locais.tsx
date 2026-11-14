import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Button, Card, EmptyState, Pill, Txt } from "@/components/ui";
import { useConsulta } from "@/db/provider";
import { useTheme } from "@/theme";

export default function Locais() {
  const t = useTheme();

  // Consulta real desde a Etapa 1: e o que prova que o banco abriu, migrou e
  // responde. Se algo estiver errado, aparece aqui e em Ajustes.
  const locais = useConsulta(async (db) => {
    const linha = await db.getFirstAsync<{ total: number }>(
      "SELECT COUNT(*) AS total FROM locais WHERE arquivado_em IS NULL",
    );
    return linha?.total ?? 0;
  });

  return (
    <Screen
      titulo="Locais"
      subtitulo="Hospitais, UPAs e clínicas onde você faz plantão"
    >
      {locais.status === "erro" && (
        <Card style={{ borderColor: t.colors.danger }}>
          <Txt variant="bodyStrong" tom="danger">
            Não consegui ler o banco
          </Txt>
          <Txt variant="caption" tom="muted" style={{ marginTop: 4 }}>
            {locais.erro}
          </Txt>
        </Card>
      )}

      <Card>
        <EmptyState
          icone="map-marker-plus-outline"
          titulo={
            locais.status === "pronto" && locais.dados > 0
              ? `${locais.dados} ${locais.dados === 1 ? "local" : "locais"} cadastrados`
              : "Nenhum local cadastrado"
          }
          descricao="Cada local guarda o valor padrão do plantão, quanto tempo leva para pagar e os descontos — é daí que sai a previsão de quando o dinheiro entra."
        >
          <View style={{ alignItems: "center", gap: t.spacing.sm }}>
            <Button icone="plus" disabled>
              Novo local
            </Button>
            <Pill tom="primary" icone="progress-wrench">
              chega na Etapa 2
            </Pill>
          </View>
        </EmptyState>
      </Card>

      <Card>
        <Txt variant="bodyStrong">O que vai caber num local</Txt>
        <View style={{ gap: t.spacing.sm, marginTop: t.spacing.md }}>
          {[
            ["tag-outline", "Nome, apelido e uma cor para reconhecer na agenda"],
            ["cash", "Valor por plantão ou por hora, já sugerido no lançamento"],
            ["calendar-clock", "Regra de pagamento: dia fixo, N dias depois ou fechamento"],
            ["percent-outline", "Descontos de IR, ISS ou cooperativa, para ver o líquido"],
          ].map(([, texto]) => (
            <View key={texto} style={{ flexDirection: "row", gap: t.spacing.sm }}>
              <Txt variant="label" tom="faint">
                •
              </Txt>
              <Txt variant="label" tom="muted" style={{ flex: 1 }}>
                {texto}
              </Txt>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
