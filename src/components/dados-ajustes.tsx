import Constants from "expo-constants";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Folha } from "@/components/folha";
import { Chip, Segmentado } from "@/components/form";
import { Button, Card, Icone, Secao, Txt } from "@/components/ui";
import { contaDados, criaBackup, restauraBackup } from "@/db/backup";
import { anosComPlantoes, listaPlantoesParaExportar } from "@/db/exportacao";
import { versaoEsquema } from "@/db/migrations";
import { useBanco, useInvalidar } from "@/db/provider";
import {
  apagaCopiaInterna,
  entregaArquivo,
  escolheArquivoDeTexto,
  guardaCopiaInterna,
  leCopiaInterna,
} from "@/lib/arquivos";
import { interpretaBackup, nomeDoArquivoDeBackup, serializaBackup, type ArquivoBackup, type ResumoBackup } from "@/lib/backup";
import { formatData } from "@/lib/datetime";
import { montaCsv, nomeDoArquivoCsv } from "@/lib/exportacao";
import { ESCOLHAS_TEMA } from "@/lib/tema";
import { useEscolhaDeTema } from "@/theme/escolha";
import { useTheme } from "@/theme";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const resumoTexto = (r: { locais: number; plantoes: number; series: number }) =>
  `${plural(r.locais, "local", "locais")}, ${plural(r.plantoes, "plantão", "plantões")}${r.series ? `, ${plural(r.series, "escala", "escalas")}` : ""}`;

interface Pendente {
  modo: "restaurar" | "desfazer";
  nome: string;
  backup: ArquivoBackup;
  resumo: ResumoBackup;
  atuais: { locais: number; plantoes: number; series: number };
}

/** O app como esta (versao do app), para o arquivo de backup dizer quem o gerou. */
const versaoDoApp = () => Constants.expoConfig?.version ?? "0";

/**
 * "Seus dados": backup e restauracao em arquivo, e exportacao para planilha.
 * Restaurar e a unica acao daqui que apaga alguma coisa, entao ela confirma
 * mostrando o que vai ser trocado — e guarda uma copia do que havia antes.
 */
export function DadosAjustes() {
  const t = useTheme();
  const db = useBanco();
  const invalidar = useInvalidar();

  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [temCopia, setTemCopia] = useState(false);
  const [anos, setAnos] = useState<number[]>([]);
  const [anoExport, setAnoExport] = useState<number | null>(null);

  const carrega = useCallback(async () => {
    setAnos(await anosComPlantoes(db));
    setTemCopia((await leCopiaInterna()) !== null);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void carrega();
    }, [carrega]),
  );

  /** Roda uma acao com o botao travado e o erro (qualquer um) virando mensagem. */
  async function executa(acao: () => Promise<void>) {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao();
    } catch (e) {
      setMensagem({ tom: "erro", texto: e instanceof Error ? e.message : "Algo deu errado." });
    } finally {
      setOcupado(false);
    }
  }

  const fazBackup = () =>
    executa(async () => {
      const agora = Date.now();
      const texto = serializaBackup(await criaBackup(db, { esquema: versaoEsquema, app: versaoDoApp() }, agora));
      // Confere o arquivo ANTES de entrega-lo: um backup que nao se le de volta e pior que nenhum.
      const conferido = interpretaBackup(texto);
      if (!conferido.ok) throw new Error(`O backup gerado não passou na verificação: ${conferido.erro}`);
      await entregaArquivo(nomeDoArquivoDeBackup(agora), texto, "application/json");
      setMensagem({
        tom: "ok",
        texto: `Backup pronto: ${resumoTexto(conferido.resumo)}. Guarde o arquivo fora do celular (nuvem ou e-mail).`,
      });
    });

  const escolheBackup = () =>
    executa(async () => {
      const arquivo = await escolheArquivoDeTexto();
      if (!arquivo) return;
      const lido = interpretaBackup(arquivo.texto);
      if (!lido.ok) {
        setMensagem({ tom: "erro", texto: lido.erro });
        return;
      }
      setPendente({ modo: "restaurar", nome: arquivo.nome, backup: lido.backup, resumo: lido.resumo, atuais: await contaDados(db) });
    });

  const pedeDesfazer = () =>
    executa(async () => {
      const texto = await leCopiaInterna();
      const lido = texto ? interpretaBackup(texto) : null;
      if (!lido || !lido.ok) throw new Error("A cópia guardada antes da restauração não está mais disponível.");
      setPendente({ modo: "desfazer", nome: "cópia de antes da restauração", backup: lido.backup, resumo: lido.resumo, atuais: await contaDados(db) });
    });

  const confirma = () =>
    executa(async () => {
      if (!pendente) return;
      const { modo, backup, resumo } = pendente;

      if (modo === "restaurar") {
        // Antes de apagar qualquer coisa, guarda o que existe: erro de arquivo errado tem volta.
        const atual = serializaBackup(await criaBackup(db, { esquema: versaoEsquema, app: versaoDoApp() }, Date.now()));
        await guardaCopiaInterna(atual);
      }
      await restauraBackup(db, backup);
      if (modo === "desfazer") await apagaCopiaInterna();

      invalidar();
      setPendente(null);
      await carrega();
      setMensagem({
        tom: "ok",
        texto:
          modo === "restaurar"
            ? `Restaurado: ${resumoTexto(resumo)}. Os dados de antes ficaram guardados — se foi engano, use “Desfazer a restauração”.`
            : `Tudo como estava antes da restauração: ${resumoTexto(resumo)}.`,
      });
    });

  const exporta = () =>
    executa(async () => {
      const linhas = await listaPlantoesParaExportar(db, anoExport);
      if (linhas.length === 0) {
        setMensagem({ tom: "erro", texto: anoExport === null ? "Ainda não há plantões para exportar." : `Nenhum plantão em ${anoExport}.` });
        return;
      }
      await entregaArquivo(nomeDoArquivoCsv(anoExport), montaCsv(linhas), "text/csv");
      setMensagem({ tom: "ok", texto: `Planilha pronta: ${plural(linhas.length, "plantão", "plantões")}. Abre direto no Excel e no Planilhas.` });
    });

  return (
    <View>
      <Secao>Seus dados</Secao>
      <Card>
        <View style={{ gap: t.spacing.lg }}>
          {/* ---------------------------------- backup ---------------------------------- */}
          <View style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: "row", gap: t.spacing.md }}>
              <Icone name="content-save-outline" size={22} color={t.colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Backup</Txt>
                <Txt variant="label" tom="muted">
                  Guarda todos os seus locais, plantões e escalas num arquivo. Mande-o para o e-mail ou a nuvem: se trocar de
                  celular ou perder este, você recupera tudo.
                </Txt>
              </View>
            </View>
            <Button icone="export-variant" compacto onPress={fazBackup} disabled={ocupado}>
              Fazer backup
            </Button>
          </View>

          <Linha />

          {/* -------------------------------- restaurar -------------------------------- */}
          <View style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: "row", gap: t.spacing.md }}>
              <Icone name="backup-restore" size={22} color={t.colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Restaurar</Txt>
                <Txt variant="label" tom="muted">
                  Escolha um arquivo de backup. Antes de trocar qualquer coisa, o app mostra o que tem nele e guarda uma cópia
                  do que existe agora.
                </Txt>
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
              <Button variant="secondary" icone="file-upload-outline" compacto onPress={escolheBackup} disabled={ocupado}>
                Escolher arquivo
              </Button>
              {temCopia && (
                <Button variant="ghost" compacto icone="undo" onPress={pedeDesfazer} disabled={ocupado}>
                  Desfazer a restauração
                </Button>
              )}
            </View>
          </View>

          <Linha />

          {/* ---------------------------------- planilha ---------------------------------- */}
          <View style={{ gap: t.spacing.sm }}>
            <View style={{ flexDirection: "row", gap: t.spacing.md }}>
              <Icone name="table-arrow-right" size={22} color={t.colors.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong">Planilha</Txt>
                <Txt variant="label" tom="muted">
                  Exporta os plantões em CSV, com valores, desconto, data prevista e data do pagamento. Abre direto no Excel
                  e no Google Planilhas.
                </Txt>
              </View>
            </View>
            <View role="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
              <Chip rotulo="Todos os anos" ativo={anoExport === null} onPress={() => setAnoExport(null)} />
              {anos.map((a) => (
                <Chip key={a} rotulo={String(a)} ativo={anoExport === a} onPress={() => setAnoExport(a)} />
              ))}
            </View>
            <Button variant="secondary" icone="table-arrow-right" compacto onPress={exporta} disabled={ocupado}>
              Exportar planilha
            </Button>
          </View>

          {mensagem && (
            <View
              style={{
                padding: t.spacing.md,
                borderRadius: t.radius.md,
                backgroundColor: mensagem.tom === "ok" ? t.colors.successSoft : t.colors.dangerSoft,
              }}
            >
              <Txt variant="label" tom={mensagem.tom === "ok" ? "success" : "danger"}>
                {mensagem.texto}
              </Txt>
            </View>
          )}
        </View>
      </Card>

      {pendente && (
        <Folha
          titulo={pendente.modo === "restaurar" ? "Restaurar este backup?" : "Voltar ao que havia antes?"}
          subtitulo={
            pendente.resumo.criadoEm
              ? `${pendente.nome} · feito em ${formatData(pendente.resumo.criadoEm)}`
              : pendente.nome
          }
          onFechar={() => !ocupado && setPendente(null)}
          acoes={
            <View style={{ gap: t.spacing.sm }}>
              <Button variant="danger" icone="backup-restore" largura="cheia" onPress={confirma} disabled={ocupado}>
                {ocupado ? "Restaurando…" : "Substituir tudo"}
              </Button>
              <Button variant="secondary" largura="cheia" onPress={() => setPendente(null)} disabled={ocupado}>
                Cancelar
              </Button>
            </View>
          }
        >
          <Bloco rotulo="No arquivo" valor={resumoTexto(pendente.resumo)} tom="success" />
          <Bloco rotulo="No celular agora (será substituído)" valor={resumoTexto(pendente.atuais)} tom="danger" />
          <Txt variant="label" tom="muted">
            {pendente.modo === "restaurar"
              ? "Tudo o que está no celular agora é trocado pelo conteúdo do arquivo. Os dados atuais ficam guardados no app, e você pode desfazer."
              : "Os dados de agora são trocados pelos que havia antes da última restauração."}
          </Txt>
        </Folha>
      )}
    </View>
  );
}

function Linha() {
  const t = useTheme();
  return <View style={{ height: 1, backgroundColor: t.colors.border }} />;
}

function Bloco({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: "success" | "danger" }) {
  const t = useTheme();
  return (
    <View
      style={{
        padding: t.spacing.md,
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: tom === "success" ? t.colors.success : t.colors.danger,
        gap: 2,
      }}
    >
      <Txt variant="caption" tom="muted">
        {rotulo}
      </Txt>
      <Txt variant="bodyStrong">{valor}</Txt>
    </View>
  );
}

/** "Aparencia": claro, escuro ou o do celular. */
export function AparenciaAjustes() {
  const t = useTheme();
  const { escolha, define } = useEscolhaDeTema();
  return (
    <View>
      <Secao>Aparência</Secao>
      <Card>
        <View style={{ gap: t.spacing.md }}>
          <Segmentado opcoes={ESCOLHAS_TEMA} valor={escolha} onChange={(v) => void define(v)} />
          <Txt variant="caption" tom="muted">
            {escolha === "sistema" ? "Segue o que o celular estiver usando (claro de dia, escuro à noite, se você configurou assim)." : escolha === "claro" ? "Sempre claro, mesmo com o celular no modo escuro." : "Sempre escuro, mesmo com o celular no modo claro."}
          </Txt>
        </View>
      </Card>
    </View>
  );
}
