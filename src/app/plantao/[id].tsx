import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarioMes } from "@/components/calendario-mes";
import { Campo, CampoDinheiro, CampoHora, CampoTexto, Chip, Segmentado } from "@/components/form";
import { Button, Card, Icone, Pill, Secao, Txt } from "@/components/ui";
import { listaLocais } from "@/db/locais";
import {
  atualizaPlantao,
  buscaPlantao,
  criaPlantao,
  excluiPlantao,
  listaPlantoesPeriodo,
  ultimoLocalUsado,
} from "@/db/plantoes";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import {
  deChaveDia,
  fimDoDia,
  formatData,
  formatDiaSemana,
  formatDiaSemanaLongo,
  inicioDoDia,
  somaDias,
} from "@/lib/datetime";
import type { Local } from "@/lib/locais";
import { formatBRL, formatPercentual } from "@/lib/money";
import { calculaDataRecebimento } from "@/lib/pagamento";
import {
  DESCRICAO_STATUS,
  ROTULO_STATUS,
  STATUS_PLANTAO,
  TURNOS_COMUNS,
  contaNoValor,
  descreveHorario,
  formatHoraMin,
  liquidoDoPlantao,
  minutosDoDia,
  montaIntervalo,
  parseHora,
  temErrosPlantao,
  validaPlantao,
  valorSugeridoPara,
  type PlantaoComLocal,
  type PlantaoInput,
  type StatusPlantao,
} from "@/lib/plantoes";
import { useTheme } from "@/theme";

const ROTULOS_ERRO: Record<string, string> = {
  localId: "local",
  horario: "horário",
  valorBruto: "valor",
  descontoPercentual: "desconto",
  status: "situação",
  observacao: "observações",
};

/* -------------------------------------------------------------------------- */
/* Tela: carrega o necessario e entrega ao formulario                          */
/* -------------------------------------------------------------------------- */

export default function TelaPlantao() {
  const { id, dia, local } = useLocalSearchParams<{ id: string; dia?: string; local?: string }>();
  const router = useRouter();
  const editandoId = id === "novo" ? null : Number(id);
  const voltar = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const dados = useConsulta(async (db) => {
    const [ativos, arquivados, plantao, ultimo] = await Promise.all([
      listaLocais(db, { arquivados: false }),
      listaLocais(db, { arquivados: true }),
      editandoId !== null && Number.isInteger(editandoId) ? buscaPlantao(db, editandoId) : null,
      ultimoLocalUsado(db),
    ]);
    return { ativos, arquivados, plantao, ultimo };
  }, [editandoId]);

  const invalido = editandoId !== null && !Number.isInteger(editandoId);

  if (invalido || dados.status === "erro" || (dados.status === "pronto" && editandoId !== null && !dados.dados.plantao)) {
    return (
      <Moldura titulo="Plantão" onVoltar={voltar}>
        <Card>
          <Txt variant="bodyStrong" tom="danger">
            {dados.status === "erro" ? "Não consegui ler o banco" : "Plantão não encontrado"}
          </Txt>
          <Txt variant="label" tom="muted" style={{ marginTop: 4 }}>
            {dados.status === "erro" ? dados.erro : "Ele pode ter sido excluído."}
          </Txt>
        </Card>
      </Moldura>
    );
  }

  if (dados.status !== "pronto") {
    return (
      <Moldura titulo={editandoId === null ? "Novo plantão" : "Editar plantão"} onVoltar={voltar}>
        <Txt variant="label" tom="muted">
          Carregando…
        </Txt>
      </Moldura>
    );
  }

  const { ativos, arquivados, plantao, ultimo } = dados.dados;

  // Ao editar, o local do plantao continua escolhivel mesmo se foi arquivado depois.
  const selecionaveis = [...ativos];
  if (plantao && !selecionaveis.some((l) => l.id === plantao.localId)) {
    const arq = arquivados.find((l) => l.id === plantao.localId);
    if (arq) selecionaveis.push(arq);
  }

  const existe = (n: number | null) => n !== null && selecionaveis.some((l) => l.id === n);
  const doParametro = local ? Number(local) : null;
  const localInicial: number | null =
    plantao?.localId ??
    (existe(doParametro) ? doParametro : null) ??
    (existe(ultimo) ? ultimo : null) ??
    (selecionaveis.length === 1 ? selecionaveis[0].id : null);

  return (
    <Formulario
      key={editandoId ?? "novo"}
      editando={plantao}
      locais={selecionaveis}
      localInicial={localInicial}
      diaInicial={dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? deChaveDia(dia) : inicioDoDia(Date.now())}
      voltar={voltar}
    />
  );
}

/* -------------------------------------------------------------------------- */

function Moldura({
  titulo,
  onVoltar,
  direita,
  children,
}: {
  titulo: string;
  onVoltar: () => void;
  direita?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: t.spacing.sm,
          paddingTop: insets.top + t.spacing.sm,
          paddingBottom: t.spacing.md,
          paddingLeft: t.spacing.sm,
          paddingRight: t.spacing.md,
          backgroundColor: t.colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
        }}
      >
        <Pressable
          onPress={onVoltar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: t.radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? t.colors.surfaceAlt : "transparent",
          })}
        >
          <Icone name="arrow-left" size={24} color={t.colors.text} />
        </Pressable>
        <Txt variant="title" style={{ flex: 1 }} numberOfLines={1}>
          {titulo}
        </Txt>
        {direita}
      </View>
      <View style={{ flex: 1, padding: t.spacing.lg }}>{children}</View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Formulario                                                                  */
/* -------------------------------------------------------------------------- */

function Formulario({
  editando,
  locais,
  localInicial,
  diaInicial,
  voltar,
}: {
  editando: PlantaoComLocal | null;
  locais: Local[];
  localInicial: number | null;
  diaInicial: number;
  voltar: () => void;
}) {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const db = useBanco();
  const invalidar = useInvalidar();

  const agora = Date.now();

  const [localId, setLocalId] = useState<number | null>(localInicial);
  const [dia, setDia] = useState(editando ? inicioDoDia(editando.inicio) : diaInicial);
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [refCalendario, setRefCalendario] = useState(dia);

  const [entrada, setEntrada] = useState(editando ? formatHoraMin(minutosDoDia(editando.inicio)) : "07:00");
  const [saida, setSaida] = useState(editando ? formatHoraMin(minutosDoDia(editando.fim)) : "19:00");

  const [valor, setValor] = useState(editando?.valorBruto ?? 0);
  // Editando, o valor salvo e a verdade e nao pode ser trocado por uma sugestao.
  const [valorManual, setValorManual] = useState(Boolean(editando));
  const [descontoPct, setDescontoPct] = useState(
    editando?.descontoPercentual ?? locais.find((l) => l.id === localInicial)?.descontoPercentual ?? 0,
  );

  const [status, setStatus] = useState<StatusPlantao>(
    editando?.status ?? (dia < inicioDoDia(agora) ? "realizado" : "agendado"),
  );
  const [statusTocado, setStatusTocado] = useState(Boolean(editando));
  const [observacao, setObservacao] = useState(editando?.observacao ?? "");

  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);

  const local = locais.find((l) => l.id === localId) ?? null;

  /* ------------------------------- horario ------------------------------- */

  const horaEntrada = parseHora(entrada);
  const horaSaida = parseHora(saida);
  const intervalo = useMemo(
    () => (horaEntrada !== null && horaSaida !== null ? montaIntervalo(dia, horaEntrada, horaSaida) : null),
    [dia, horaEntrada, horaSaida],
  );

  /* --------------------------- sugestao de valor --------------------------- */

  const sugerido = local && intervalo ? valorSugeridoPara(local, intervalo.inicio, intervalo.fim) : null;

  useEffect(() => {
    if (!valorManual && sugerido !== null) setValor(sugerido);
  }, [valorManual, sugerido]);

  // Ao escolher o local, o desconto dele acompanha: faz parte da regra do local.
  function escolheLocal(l: Local) {
    setLocalId(l.id);
    setDescontoPct(l.descontoPercentual);
  }

  // Enquanto a situacao nao foi mexida, ela acompanha a data: passado = realizado.
  useEffect(() => {
    if (!statusTocado) setStatus(dia < inicioDoDia(Date.now()) ? "realizado" : "agendado");
  }, [dia, statusTocado]);

  /* ------------------------------- conflitos ------------------------------- */

  // Janela de um dia para cada lado: pega o noturno da vespera que invade este dia.
  const vizinhos = useConsulta(
    (ex) => listaPlantoesPeriodo(ex, inicioDoDia(somaDias(dia, -1)), fimDoDia(somaDias(dia, 1))),
    [dia],
  );

  /* ------------------------------- validacao ------------------------------- */

  const input: PlantaoInput | null = useMemo(
    () =>
      intervalo && local
        ? {
            localId: local.id,
            inicio: intervalo.inicio,
            fim: intervalo.fim,
            valorBruto: valor,
            descontoPercentual: descontoPct,
            status,
            observacao: observacao.trim() || null,
          }
        : null,
    [intervalo, local, valor, descontoPct, status, observacao],
  );

  const validacao = useMemo(() => {
    if (!input) {
      return {
        erros: {
          ...(local ? {} : { localId: "Escolha o local." }),
          ...(intervalo ? {} : { horario: "Informe os dois horários, como 07:00." }),
        },
        avisos: {},
      } as ReturnType<typeof validaPlantao>;
    }
    return validaPlantao(input, vizinhos.status === "pronto" ? vizinhos.dados : [], editando?.id);
  }, [input, local, intervalo, vizinhos, editando]);

  const { erros, avisos } = validacao;
  const mostra = (campo: keyof typeof erros) => (tentou ? erros[campo] : undefined);

  async function salvar() {
    setTentou(true);
    setMensagem(null);
    if (!input || temErrosPlantao(erros)) return;

    setSalvando(true);
    try {
      if (editando) {
        const ok = await atualizaPlantao(db, editando.id, input);
        if (!ok) throw new Error("Este plantão não existe mais.");
      } else {
        await criaPlantao(db, input);
      }
      invalidar();
      voltar();
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não consegui salvar.");
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!editando) return;
    setSalvando(true);
    try {
      await excluiPlantao(db, editando.id);
      invalidar();
      voltar();
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não consegui excluir.");
      setSalvando(false);
    }
  }

  const pendencias = Object.entries(erros)
    .filter(([, v]) => v)
    .map(([k]) => ROTULOS_ERRO[k] ?? k);

  const liquido = input ? liquidoDoPlantao(input) : 0;
  const recebe = local && intervalo && contaNoValor(status) ? calculaDataRecebimento(local.regra, intervalo.inicio) : null;

  /* ------------------------------ sem locais ------------------------------ */

  if (locais.length === 0) {
    return (
      <Moldura titulo="Novo plantão" onVoltar={voltar}>
        <Card>
          <View style={{ alignItems: "center", gap: t.spacing.md, paddingVertical: t.spacing.lg }}>
            <Icone name="map-marker-plus-outline" size={36} color={t.colors.textFaint} />
            <Txt variant="bodyStrong" centro>
              Cadastre um local primeiro
            </Txt>
            <Txt variant="label" tom="muted" centro>
              O plantão precisa de um local: é dele que vêm o valor, os descontos e a data em que você recebe.
            </Txt>
            <Button icone="plus" onPress={() => router.replace("/local/novo")}>
              Cadastrar local
            </Button>
          </View>
        </Card>
      </Moldura>
    );
  }

  return (
    <Moldura
      titulo={editando ? "Editar plantão" : "Novo plantão"}
      onVoltar={voltar}
      direita={
        <Button compacto onPress={salvar} disabled={salvando}>
          Salvar
        </Button>
      }
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: t.spacing.xl, paddingBottom: insets.bottom + t.spacing.xxxl }}
          style={{ marginHorizontal: -t.spacing.lg, paddingHorizontal: t.spacing.lg }}
        >
          {/* ---------------------------------- local ---------------------------------- */}
          <Campo rotulo="Local" erro={mostra("localId")}>
            <View role="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
              {locais.map((l) => (
                <Chip
                  key={l.id}
                  rotulo={l.apelido || l.nome}
                  rotuloAcessivel={l.nome}
                  cor={l.cor}
                  ativo={l.id === localId}
                  onPress={() => escolheLocal(l)}
                />
              ))}
            </View>
            {local && local.arquivadoEm !== null && (
              <Txt variant="caption" tom="warning">
                Este local está arquivado.
              </Txt>
            )}
          </Campo>

          {/* ---------------------------------- quando ---------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Quando</Secao>

            <Campo rotulo="Data">
              <Pressable
                onPress={() => setCalendarioAberto((a) => !a)}
                accessibilityRole="button"
                accessibilityLabel={`Data: ${formatDiaSemanaLongo(dia)}, ${formatData(dia)}. Tocar para mudar.`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: t.spacing.md,
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: calendarioAberto ? t.colors.primary : t.colors.borderStrong,
                  borderRadius: t.radius.md,
                  paddingHorizontal: t.spacing.lg,
                  paddingVertical: 12,
                }}
              >
                <Icone name="calendar-month-outline" size={20} color={t.colors.primary} />
                <Txt variant="bodyStrong" style={{ flex: 1 }}>
                  {formatDiaSemanaLongo(dia)}, {formatData(dia)}
                </Txt>
                <Icone name={calendarioAberto ? "chevron-up" : "chevron-down"} size={20} color={t.colors.textFaint} />
              </Pressable>
              {calendarioAberto && (
                <Card>
                  <CalendarioMes
                    referenciaMs={refCalendario}
                    selecionadoMs={dia}
                    onSelecionar={(ms) => {
                      setDia(inicioDoDia(ms));
                      setRefCalendario(ms);
                      setCalendarioAberto(false);
                    }}
                    onTrocarMes={setRefCalendario}
                  />
                </Card>
              )}
            </Campo>

            <Campo rotulo="Turno" dica="Toque num turno comum para preencher os dois horários.">
              <View role="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
                {TURNOS_COMUNS.map((turno) => (
                  <Chip
                    key={turno.rotulo}
                    rotulo={turno.rotulo}
                    ativo={horaEntrada === turno.inicio && horaSaida === turno.fim}
                    onPress={() => {
                      setEntrada(formatHoraMin(turno.inicio));
                      setSaida(formatHoraMin(turno.fim));
                    }}
                  />
                ))}
              </View>
            </Campo>

            <Campo rotulo="Horário" erro={mostra("horario")}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.md }}>
                <View style={{ gap: 4 }}>
                  <Txt variant="caption" tom="muted">
                    Entrada
                  </Txt>
                  <CampoHora
                    valor={entrada}
                    onChange={setEntrada}
                    erro={Boolean(mostra("horario"))}
                    rotuloAcessivel="Horário de entrada"
                  />
                </View>
                <Icone name="arrow-right" size={20} color={t.colors.textFaint} style={{ marginTop: 18 }} />
                <View style={{ gap: 4 }}>
                  <Txt variant="caption" tom="muted">
                    Saída
                  </Txt>
                  <CampoHora
                    valor={saida}
                    onChange={setSaida}
                    erro={Boolean(mostra("horario"))}
                    rotuloAcessivel="Horário de saída"
                  />
                </View>
              </View>
              {intervalo && (
                <Txt variant="label" tom="muted">
                  {intervalo.viraDia
                    ? `Termina no dia seguinte (${formatDiaSemana(intervalo.fim)}, ${formatData(intervalo.fim).slice(0, 5)}) · `
                    : "Termina no mesmo dia · "}
                  {descreveHorario(intervalo.inicio, intervalo.fim).split(" · ")[1]}
                </Txt>
              )}
            </Campo>

            {avisos.conflito && (
              <Card style={{ borderColor: t.colors.warning }}>
                <View style={{ flexDirection: "row", gap: t.spacing.sm, alignItems: "center" }}>
                  <Icone name="alert-outline" size={20} color={t.colors.warning} />
                  <Txt variant="label" tom="warning" style={{ flex: 1 }}>
                    {avisos.conflito}
                  </Txt>
                </View>
              </Card>
            )}
          </View>

          {/* ---------------------------------- valor ---------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Valor</Secao>

            <Campo
              rotulo="Valor bruto"
              erro={mostra("valorBruto")}
              dica={
                local && !valorManual
                  ? `Sugerido pelo local: ${local.modoValor === "hora" ? "valor da hora × duração" : "valor do plantão"}.`
                  : undefined
              }
            >
              <CampoDinheiro
                valor={valor}
                onChange={(v) => {
                  setValor(v);
                  setValorManual(true);
                }}
                erro={Boolean(mostra("valorBruto"))}
              />
              {valorManual && sugerido !== null && sugerido !== valor && (
                <Pressable
                  onPress={() => {
                    setValor(sugerido);
                    setValorManual(false);
                  }}
                  accessibilityRole="button"
                >
                  <Txt variant="label" tom="primary" style={{ fontWeight: "600" }}>
                    Usar o valor do local: {formatBRL(sugerido)}
                  </Txt>
                </Pressable>
              )}
            </Campo>

            {descontoPct > 0 && (
              <Txt variant="label" tom="muted">
                Desconto do local: {formatPercentual(descontoPct)} → líquido{" "}
                <Txt variant="bodyStrong">{formatBRL(liquido)}</Txt>
              </Txt>
            )}
          </View>

          {/* --------------------------------- situacao --------------------------------- */}
          <View style={{ gap: t.spacing.md }}>
            <Secao>Situação</Secao>
            <Segmentado
              opcoes={STATUS_PLANTAO.map((s) => ({ valor: s, rotulo: ROTULO_STATUS[s] }))}
              valor={status}
              onChange={(s) => {
                setStatus(s);
                setStatusTocado(true);
              }}
            />
            <Txt variant="caption" tom="muted">
              {DESCRICAO_STATUS[status]}
            </Txt>
          </View>

          <Campo rotulo="Observações" opcional erro={mostra("observacao")}>
            <CampoTexto
              value={observacao}
              onChangeText={setObservacao}
              placeholder="Troca, setor, quem cobriu…"
              maxLength={300}
              multiline
            />
          </Campo>

          {/* ---------------------------------- resumo ---------------------------------- */}
          {local && intervalo && (
            <Card style={{ borderColor: t.colors.primary }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, marginBottom: t.spacing.md }}>
                <Icone name="eye-outline" size={18} color={t.colors.primary} />
                <Txt variant="section" tom="primary">
                  Resumo
                </Txt>
              </View>
              <View style={{ gap: t.spacing.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: local.cor }} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                    {local.nome}
                  </Txt>
                  <Pill tom={status === "realizado" ? "success" : status === "agendado" ? "primary" : "warning"}>
                    {ROTULO_STATUS[status]}
                  </Pill>
                </View>
                <Txt variant="label" tom="muted">
                  {formatDiaSemana(intervalo.inicio)}, {formatData(intervalo.inicio)} ·{" "}
                  {descreveHorario(intervalo.inicio, intervalo.fim)}
                </Txt>
                {contaNoValor(status) ? (
                  <>
                    <Txt variant="money">{formatBRL(liquido)}</Txt>
                    {recebe !== null && (
                      <Txt variant="label" tom="success">
                        Cai na conta: {formatDiaSemana(recebe)}, {formatData(recebe)}
                      </Txt>
                    )}
                  </>
                ) : (
                  <Txt variant="label" tom="faint">
                    Não conta no que você vai receber.
                  </Txt>
                )}
              </View>
            </Card>
          )}

          {/* ---------------------------------- acoes ---------------------------------- */}
          <View style={{ gap: t.spacing.md }}>
            {tentou && pendencias.length > 0 && (
              <Card style={{ borderColor: t.colors.danger }}>
                <Txt variant="bodyStrong" tom="danger">
                  Falta corrigir
                </Txt>
                <Txt variant="label" tom="muted" style={{ marginTop: 4 }}>
                  {pendencias.join(" · ")}
                </Txt>
              </Card>
            )}
            {mensagem && (
              <Card style={{ borderColor: t.colors.danger }}>
                <Txt variant="label" tom="danger">
                  {mensagem}
                </Txt>
              </Card>
            )}

            <Button largura="cheia" onPress={salvar} disabled={salvando}>
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Lançar plantão"}
            </Button>

            {editando &&
              (confirmaExcluir ? (
                <Card>
                  <Txt variant="bodyStrong">Excluir este plantão?</Txt>
                  <Txt variant="label" tom="muted" style={{ marginTop: 4, marginBottom: t.spacing.md }}>
                    Ele sai da agenda e das contas. Se o plantão só não aconteceu, prefira marcar como cancelado ou
                    trocado: o histórico fica.
                  </Txt>
                  <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
                    <Button variant="danger" onPress={excluir} disabled={salvando}>
                      Excluir
                    </Button>
                    <Button variant="secondary" onPress={() => setConfirmaExcluir(false)}>
                      Cancelar
                    </Button>
                  </View>
                </Card>
              ) : (
                <Button variant="ghost" icone="trash-can-outline" largura="cheia" onPress={() => setConfirmaExcluir(true)}>
                  Excluir este plantão
                </Button>
              ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Moldura>
  );
}
