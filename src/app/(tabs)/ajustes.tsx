import Constants from "expo-constants";
import { Platform, View } from "react-native";
import { CalendarioAjustes } from "@/components/calendario-ajustes";
import { AparenciaAjustes, DadosAjustes } from "@/components/dados-ajustes";
import { Screen } from "@/components/screen";
import { Card, Icone, Pill, Row, Secao, Txt } from "@/components/ui";
import { versaoEsquema } from "@/db/migrations";
import { useConsulta, useEstadoBanco } from "@/db/provider";
import { useTheme } from "@/theme";

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
    <Screen titulo="Ajustes" subtitulo="Calendário, seus dados e aparência">
      <CalendarioAjustes />

      {/* Precisa do banco aberto; se ele falhou, a tela continua mostrando o erro em "Sobre o app". */}
      {banco.status === "pronto" && <DadosAjustes />}

      <AparenciaAjustes />

      <View>
        <Secao>Sobre o app</Secao>
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

      <Card>
        <Txt variant="bodyStrong">Seus dados ficam com você</Txt>
        <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.sm }}>
          Tudo é gravado só neste aparelho, num banco SQLite. Não há servidor nem conta para criar, e o
          app não envia nada para lugar nenhum. A única exceção é o que você mesmo manda para o
          calendário: se o calendário escolhido for de uma conta Google, é o Google quem o
          sincroniza. O mesmo vale para o backup e a planilha: eles só saem do celular quando
          você os envia. E, se o backup do próprio Android estiver ligado no seu celular, o
          sistema pode guardar uma cópia dos dados do app na sua conta Google — isso é um
          recurso do Android, não do app, e dá para desligar nas configurações do celular.
        </Txt>
      </Card>
    </Screen>
  );
}
