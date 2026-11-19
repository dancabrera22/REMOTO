import { useEffect, useState } from "react";
import { View } from "react-native";
import { unidadesDoLocal } from "@/db/plantoes";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import { contaUnidade, renomeiaUnidade, type ContagemDaUnidade } from "@/db/unidades";
import { formatDuracao } from "@/lib/datetime";
import { formatBRL } from "@/lib/money";
import { LIMITE_UNIDADE, chaveUnidade, normalizaUnidade, situacaoDoRenomear, type SugestaoDeUnidade } from "@/lib/plantoes";
import { useTheme } from "@/theme";
import { CampoTexto } from "./form";
import { Button, Card, Secao, Txt } from "./ui";

const plantoes = (n: number) => `${n} ${n === 1 ? "plantão" : "plantões"}`;
const escalas = (n: number) => `${n} ${n === 1 ? "escala" : "escalas"}`;

/**
 * As unidades usadas num local ("Itaim", "Central"), cada uma com quantos plantoes tem e o ultimo
 * valor. Daqui se RENOMEIA uma unidade — para consertar um erro de digitacao ou uma grafia ("itaim"
 * e "ITAIM") em todos os plantoes de uma vez — e se JUNTAM duas, dando a uma o nome da outra.
 *
 * Renomear vale na hora: nao depende do botao Salvar do local, porque mexe nos plantoes, nao no cadastro.
 */
export function UnidadesDoLocal({ localId }: { localId: number }) {
  const t = useTheme();
  const db = useBanco();
  const invalidar = useInvalidar();

  const lista = useConsulta((ex) => unidadesDoLocal(ex, localId), [localId]);
  const unidades: SugestaoDeUnidade[] = lista.status === "pronto" ? lista.dados : [];

  const [editando, setEditando] = useState<string | null>(null); // a unidade (como esta gravada) em renomeacao
  const [texto, setTexto] = useState("");
  const [alcance, setAlcance] = useState<ContagemDaUnidade | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Quanto sera atingido: conta tudo (inclusive cancelado), nao so o que a lista mostra.
  useEffect(() => {
    if (editando === null) {
      setAlcance(null);
      return;
    }
    let vivo = true;
    contaUnidade(db, localId, editando)
      .then((c) => vivo && setAlcance(c))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [editando, localId, db]);

  function comeca(u: SugestaoDeUnidade) {
    setEditando(u.unidade);
    setTexto(u.unidade);
    setAviso(null);
    setErro(null);
  }

  /** O nome que vai valer: ao juntar com uma unidade que ja existe, a grafia DELA ("itaim" digitado vira "Itaim"). */
  function nomeAlvo(): string {
    if (editando === null) return texto;
    if (situacaoDoRenomear(unidades, editando, texto) !== "mesclar") return texto;
    return unidades.find((x) => x.chave === chaveUnidade(texto))?.unidade ?? texto;
  }

  async function confirma() {
    if (editando === null) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await renomeiaUnidade(db, localId, editando, nomeAlvo());
      invalidar();
      setEditando(null);
      setAviso(
        r.plantoes + r.escalas === 0
          ? "Nada precisou mudar."
          : `Pronto: ${plantoes(r.plantoes)}${r.escalas > 0 ? ` e ${escalas(r.escalas)}` : ""} ${r.plantoes + r.escalas === 1 ? "atualizado" : "atualizados"}.`,
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui renomear.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <View style={{ gap: t.spacing.md }}>
      <Secao>Unidades deste local</Secao>

      {lista.status === "pronto" && unidades.length === 0 && (
        <Txt variant="caption" tom="muted">
          Ainda não há unidades. Ao lançar um plantão e digitar a unidade (ex.: Itaim), ela aparece aqui, com o último
          valor.
        </Txt>
      )}
      {unidades.length > 0 && (
        <Txt variant="caption" tom="muted">
          Renomear vale na hora, para todos os plantões e escalas da unidade — não depende do botão Salvar. Dar a uma
          unidade o nome de outra junta as duas.
        </Txt>
      )}

      {aviso && (
        <Txt variant="label" tom="success">
          {aviso}
        </Txt>
      )}

      {unidades.map((u) => {
        const emEdicao = editando === u.unidade;
        const situacao = emEdicao ? situacaoDoRenomear(unidades, u.unidade, texto) : "igual";
        const novo = situacao === "mesclar" ? normalizaUnidade(nomeAlvo()) : normalizaUnidade(texto);
        const verbo = alcance && alcance.plantoes + alcance.escalas === 1 ? "passa" : "passam";

        return (
          <Card key={u.chave}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="bodyStrong" numberOfLines={1}>
                  {u.unidade}
                </Txt>
                <Txt variant="caption" tom="muted">
                  {plantoes(u.usos)} · último valor {formatBRL(u.ultimoValor)} ({formatDuracao(u.ultimosMinutos)})
                </Txt>
              </View>
              {!emEdicao && (
                <Button variant="secondary" compacto icone="pencil-outline" rotuloAcessivel={`Renomear ${u.unidade}`} onPress={() => comeca(u)}>
                  Renomear
                </Button>
              )}
            </View>

            {emEdicao && (
              <View style={{ gap: t.spacing.md, marginTop: t.spacing.md }}>
                <CampoTexto
                  value={texto}
                  onChangeText={setTexto}
                  maxLength={LIMITE_UNIDADE + 20}
                  autoCapitalize="words"
                  autoFocus
                  accessibilityLabel={`Novo nome da unidade ${u.unidade}`}
                  placeholder="Novo nome"
                />

                {situacao === "vazio" && (
                  <Txt variant="caption" tom="muted">
                    Digite o novo nome.
                  </Txt>
                )}
                {situacao === "renomear" && (
                  <Txt variant="caption" tom="muted">
                    {alcance
                      ? `${plantoes(alcance.plantoes)}${alcance.escalas > 0 ? ` e ${escalas(alcance.escalas)}` : ""} de “${u.unidade}” ${verbo} a se chamar “${novo}”.`
                      : `“${u.unidade}” passa a se chamar “${novo}”.`}
                  </Txt>
                )}
                {situacao === "mesclar" && (
                  <Txt variant="caption" tom="warning">
                    {`Já existe “${novo}” neste local. ${alcance ? `${plantoes(alcance.plantoes)}${alcance.escalas > 0 ? ` e ${escalas(alcance.escalas)}` : ""} de “${u.unidade}”` : `Os plantões de “${u.unidade}”`} ${verbo} a ser de “${novo}”: as duas unidades viram uma só.`}
                  </Txt>
                )}
                {erro && (
                  <Txt variant="caption" tom="danger">
                    {erro}
                  </Txt>
                )}

                <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
                  <Button
                    compacto
                    onPress={confirma}
                    disabled={ocupado || situacao === "vazio" || situacao === "igual"}
                    rotuloAcessivel={situacao === "mesclar" ? "Juntar as unidades" : "Salvar o novo nome"}
                  >
                    {situacao === "mesclar" ? "Juntar" : "Salvar nome"}
                  </Button>
                  <Button variant="secondary" compacto onPress={() => setEditando(null)} disabled={ocupado}>
                    Cancelar
                  </Button>
                </View>
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );
}
