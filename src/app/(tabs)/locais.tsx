import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/screen";
import { Button, Card, EmptyState, Pill, Row, Secao, Txt } from "@/components/ui";
import { listaLocais, restauraLocal } from "@/db/locais";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import { descreveValor, type Local } from "@/lib/locais";
import { formatPercentual } from "@/lib/money";
import { descreveRegra } from "@/lib/pagamento";
import { useTheme } from "@/theme";

export default function Locais() {
  const t = useTheme();
  const router = useRouter();
  const [verArquivados, setVerArquivados] = useState(false);

  const ativos = useConsulta((db) => listaLocais(db, { arquivados: false }));
  const arquivados = useConsulta((db) => listaLocais(db, { arquivados: true }));

  const novoLocal = () => router.push("/local/novo");
  const abre = (l: Local) => router.push({ pathname: "/local/[id]", params: { id: String(l.id) } });

  const lista = ativos.status === "pronto" ? ativos.dados : [];
  const quantosArquivados = arquivados.status === "pronto" ? arquivados.dados.length : 0;

  return (
    <Screen
      titulo="Locais"
      subtitulo={
        ativos.status === "pronto" && lista.length > 0
          ? `${lista.length} ${lista.length === 1 ? "local" : "locais"} cadastrados`
          : "Onde você faz plantão"
      }
      direita={
        lista.length > 0 ? (
          <Button icone="plus" compacto onPress={novoLocal}>
            Novo
          </Button>
        ) : undefined
      }
    >
      {ativos.status === "erro" && (
        <Card style={{ borderColor: t.colors.danger }}>
          <Txt variant="bodyStrong" tom="danger">
            Não consegui ler o banco
          </Txt>
          <Txt variant="caption" tom="muted" style={{ marginTop: 4 }}>
            {ativos.erro}
          </Txt>
        </Card>
      )}

      {ativos.status === "pronto" && lista.length === 0 && (
        <Card>
          <EmptyState
            icone="map-marker-plus-outline"
            titulo="Nenhum local cadastrado"
            descricao="Cada local guarda o valor do plantão, quando ele paga e os descontos — é daí que sai a previsão do que você vai receber."
          >
            <Button icone="plus" onPress={novoLocal}>
              Cadastrar primeiro local
            </Button>
          </EmptyState>
        </Card>
      )}

      {lista.length > 0 && (
        <Card padding="none" style={{ paddingHorizontal: t.spacing.lg }}>
          {lista.map((local, i) => (
            <Row
              key={local.id}
              cor={local.cor}
              titulo={local.apelido ? `${local.nome} · ${local.apelido}` : local.nome}
              subtitulo={resumo(local)}
              linhasSubtitulo={2}
              onPress={() => abre(local)}
              ultima={i === lista.length - 1}
            />
          ))}
        </Card>
      )}

      {quantosArquivados > 0 && (
        <View>
          <Secao
            acao={
              <Button variant="ghost" compacto onPress={() => setVerArquivados((v) => !v)}>
                {verArquivados ? "Ocultar" : "Mostrar"}
              </Button>
            }
          >
            {`Arquivados (${quantosArquivados})`}
          </Secao>
          {verArquivados && arquivados.status === "pronto" && (
            <Card padding="none" style={{ paddingHorizontal: t.spacing.lg }}>
              {arquivados.dados.map((local, i) => (
                <LinhaArquivada
                  key={local.id}
                  local={local}
                  ultima={i === arquivados.dados.length - 1}
                />
              ))}
            </Card>
          )}
        </View>
      )}
    </Screen>
  );
}

/** "R$ 1.200 por plantão · Paga dia 10 do mês seguinte · −11%". */
function resumo(local: Local): string {
  const partes = [descreveValor(local.modoValor, local.valorPadrao), descreveRegra(local.regra)];
  if (local.descontoPercentual > 0) partes.push(`−${formatPercentual(local.descontoPercentual)}`);
  return partes.join(" · ");
}

function LinhaArquivada({ local, ultima }: { local: Local; ultima: boolean }) {
  const db = useBanco();
  const invalidar = useInvalidar();

  return (
    <Row
      cor={local.cor}
      titulo={local.nome}
      subtitulo={resumo(local)}
      linhasSubtitulo={2}
      ultima={ultima}
      direita={
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Pill>arquivado</Pill>
          <Button
            variant="secondary"
            compacto
            onPress={async () => {
              await restauraLocal(db, local.id);
              invalidar();
            }}
          >
            Restaurar
          </Button>
        </View>
      }
    />
  );
}
