import Constants from "expo-constants";
import { Platform, View } from "react-native";
import { Screen } from "@/components/screen";
import { Card, Icone, Pill, Row, Secao, Txt } from "@/components/ui";
import { versaoEsquema } from "@/db/migrations";
import { useConsulta, useEstadoBanco } from "@/db/provider";
import { useTheme } from "@/theme";

const ETAPAS = [
  { n: 1, nome: "Fundação", detalhe: "abas, banco, tema, agenda navegável", feita: true },
  { n: 2, nome: "Locais", detalhe: "cadastro, cor, valor padrão, regra de pagamento", feita: true },
  { n: 3, nome: "Plantões", detalhe: "lançar, editar, ver na agenda, pontinho por local", feita: true },
  { n: 4, nome: "Recorrência", detalhe: "escala fixa que se repete", feita: false },
  { n: 5, nome: "Financeiro", detalhe: "previsão de recebimento e baixa", feita: false },
  { n: 6, nome: "Google Calendar", detalhe: "plantão aparece no calendário", feita: false },
  { n: 7, nome: "APK e backup", detalhe: "instalável, com exportação", feita: false },
];

export default function Ajustes() {
  const t = useTheme();
  const banco = useEstadoBanco();

  const diagnostico = useConsulta(async (db) => {
    const locais = await db.getFirstAsync<{ total: number }>("SELECT COUNT(*) AS total FROM locais");
    const tabelas = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return { locais: locais?.total ?? 0, tabelas: tabelas.map((x) => x.name) };
  });

  const estadoBanco =
    banco.status === "pronto"
      ? { texto: `ok · versão ${banco.versao} de ${versaoEsquema}`, tom: "success" as const }
      : banco.status === "carregando"
        ? { texto: "abrindo…", tom: "normal" as const }
        : { texto: "falhou", tom: "danger" as const };

  return (
    <Screen titulo="Ajustes" subtitulo="Estado do app e o que vem por aí">
      <View>
        <Secao>Diagnóstico</Secao>
        <Card padding="none" style={{ paddingHorizontal: t.spacing.lg }}>
          <Row
            titulo="Banco de dados"
            subtitulo={banco.status === "erro" ? banco.mensagem : "SQLite local, no próprio aparelho"}
            direita={<Pill tom={estadoBanco.tom}>{estadoBanco.texto}</Pill>}
          />
          <Row
            titulo="Tabelas"
            subtitulo={
              diagnostico.status === "pronto" ? diagnostico.dados.tabelas.join(", ") : "—"
            }
            direita={
              <Txt variant="label" tom="muted">
                {diagnostico.status === "pronto" ? diagnostico.dados.tabelas.length : "—"}
              </Txt>
            }
          />
          <Row
            titulo="Locais cadastrados"
            direita={
              <Txt variant="label" tom="muted">
                {diagnostico.status === "pronto" ? diagnostico.dados.locais : "—"}
              </Txt>
            }
          />
          <Row
            titulo="Tema"
            subtitulo="segue o sistema; a opção de fixar chega na Etapa 7"
            direita={<Pill>{t.name === "dark" ? "escuro" : "claro"}</Pill>}
          />
          <Row
            titulo="Versão"
            subtitulo={`${Platform.OS} · Expo SDK ${Constants.expoConfig?.sdkVersion ?? "58"}`}
            direita={
              <Txt variant="label" tom="muted">
                {Constants.expoConfig?.version ?? "0.1.0"}
              </Txt>
            }
            ultima
          />
        </Card>
      </View>

      <View>
        <Secao>Construção em etapas</Secao>
        <Card padding="none" style={{ paddingHorizontal: t.spacing.lg }}>
          {ETAPAS.map((etapa, i) => (
            <Row
              key={etapa.n}
              titulo={`${etapa.n}. ${etapa.nome}`}
              subtitulo={etapa.detalhe}
              direita={
                etapa.feita ? (
                  <Icone name="check-circle" size={20} color={t.colors.success} />
                ) : (
                  <Icone name="circle-outline" size={20} color={t.colors.textFaint} />
                )
              }
              ultima={i === ETAPAS.length - 1}
            />
          ))}
        </Card>
      </View>

      <Card>
        <Txt variant="bodyStrong">Seus dados ficam com você</Txt>
        <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.sm }}>
          Tudo é gravado só neste aparelho, num banco SQLite. Não há servidor, não há conta para
          criar e nada sai do celular — nem valores, nem locais, nem a sua escala. O backup em
          arquivo e a exportação chegam na Etapa 7.
        </Txt>
      </Card>
    </Screen>
  );
}
