import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarioMes } from "@/components/calendario-mes";
import { Campo, CampoDinheiro, CampoHora, CampoTexto, Chip, Segmentado } from "@/components/form";
import { EscopoModal, ExcluirPlantao } from "@/components/escopo-serie";
import { Repeticao } from "@/components/repeticao";
import { Button, Card, Icone, Pill, Secao, Txt } from "@/components/ui";
import { listaLocais } from "@/db/locais";
import {
  atualizaPlantao,
  buscaPlantao,
  criaPlantao,
  excluiPlantao,
  listaPlantoesPeriodo,
  marcaPagamento,
  ultimoLocalUsado,
  unidadesDoLocal,
} from "@/db/plantoes";
import { buscaSerie, criaSerie, editaSerie, type EscopoSerie } from "@/db/series";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import {
  deChaveDia,
  fimDoDia,
  formatData,
  formatDataCurta,
  formatDiaSemana,
  formatDiaSemanaLongo,
  formatDuracao,
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
  LIMITE_UNIDADE,
  chaveUnidade,
  descreveHorario,
  formatHoraMin,
  liquidoDoPlantao,
  minutosDoDia,
  montaIntervalo,
  normalizaUnidade,
  parseHora,
  temErrosPlantao,
  tituloDoPlantao,
  validaPlantao,
  valorParaUnidade,
  type PlantaoComLocal,
  type PlantaoInput,
  type StatusPlantao,
} from "@/lib/plantoes";
import {
  descreveRecorrencia,
  rascunhoDaRegra,
  rascunhoInicial,
  regraDoRascunho,
  validaSerie,
  type ModeloSerie,
  type RascunhoRepeticao,
  type RegraRecorrencia,
  type Serie,
} from "@/lib/recorrencia";
import { useTheme } from "@/theme";

const ROTULOS_ERRO: Record<string, string> = {
  localId: "local",
  unidade: "unidade",
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
    const serie = plantao?.serieId != null ? await buscaSerie(db, plantao.serieId) : null;
    return { ativos, arquivados, plantao, ultimo, serie };
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

  const { ativos, arquivados, plantao, ultimo, serie } = dados.dados;

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
      serie={serie}
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

/** Duas regras iguais para o que importa a quem edita (o inicio e decidido a parte). */
function mesmaRegra(a: RegraRecorrencia, b: RegraRecorrencia): boolean {
  return (
    a.tipo === b.tipo &&
    a.cada === b.cada &&
    a.diasSemana === b.diasSemana &&
    a.diaDoMes === b.diaDoMes &&
    a.fimDia === b.fimDia
  );
}

function Formulario({
  editando,
  serie,
  locais,
  localInicial,
  diaInicial,
  voltar,
}: {
  editando: PlantaoComLocal | null;
  /** A escala do plantao que esta sendo editado, se ele for de escala. */
  serie: Serie | null;
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
  const [unidade, setUnidade] = useState(editando?.unidade ?? "");

  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);

  // Repeticao: ao lancar, descreve a escala nova; ao editar um plantao de escala,
  // e a regra dela. Plantao avulso ja lancado nao vira escala por aqui.
  const [rep, setRep] = useState<RascunhoRepeticao>(serie ? rascunhoDaRegra(serie.regra) : rascunhoInicial());
  const [repAberta, setRepAberta] = useState(false);
  const [pago, setPago] = useState(editando?.pagoEm != null);
  const [escopoAberto, setEscopoAberto] = useState(false);
  const [excluindoSerie, setExcluindoSerie] = useState(false);

  // Cadastrar um local sem sair do plantao: guardamos quais locais existiam, e o que
  // aparecer a mais ao voltar e o que a pessoa acabou de criar — ja vem escolhido.
  const [locaisAntes, setLocaisAntes] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (!locaisAntes) return;
    const novo = locais.find((l) => !locaisAntes.has(l.id));
    if (novo) {
      escolheLocal(novo);
      setLocaisAntes(null);
    }
    // escolheLocal so usa setters estaveis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locais, locaisAntes]);

  const local = locais.find((l) => l.id === localId) ?? null;

  /* ------------------------------- horario ------------------------------- */

  const horaEntrada = parseHora(entrada);
  const horaSaida = parseHora(saida);
  const intervalo = useMemo(
    () => (horaEntrada !== null && horaSaida !== null ? montaIntervalo(dia, horaEntrada, horaSaida) : null),
    [dia, horaEntrada, horaSaida],
  );

  /* --------------------------- sugestao de valor --------------------------- */

  // As unidades que a pessoa ja usou neste local, cada uma com o ultimo valor: ao digitar (ou
  // tocar) o nome de uma, o valor ja vem preenchido.
  const unidadesLida = useConsulta((ex) => (localId === null ? Promise.resolve([]) : unidadesDoLocal(ex, localId)), [localId]);
  const unidadesConhecidas = unidadesLida.status === "pronto" ? unidadesLida.dados : [];

  const proposta = useMemo(
    () =>
      local && intervalo
        ? valorParaUnidade({ unidade, inicio: intervalo.inicio, fim: intervalo.fim, sugestoes: unidadesConhecidas, local })
        : null,
    [local, intervalo, unidade, unidadesConhecidas],
  );
  const sugerido = proposta ? proposta.valor : null;

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
            unidade: normalizaUnidade(unidade),
            inicio: intervalo.inicio,
            fim: intervalo.fim,
            valorBruto: valor,
            descontoPercentual: descontoPct,
            status,
            observacao: observacao.trim() || null,
          }
        : null,
    [intervalo, local, unidade, valor, descontoPct, status, observacao],
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

  /* ------------------------------- repeticao ------------------------------- */

  const regra = useMemo(
    () => (editando && !serie ? null : regraDoRascunho(rep, serie ? serie.regra.inicioDia : dia)),
    [rep, dia, editando, serie],
  );
  const modelo: ModeloSerie | null =
    local && horaEntrada !== null && horaSaida !== null
      ? {
          localId: local.id,
          unidade: normalizaUnidade(unidade),
          inicioMin: horaEntrada,
          fimMin: horaSaida,
          valorBruto: valor,
          descontoPercentual: descontoPct,
          observacao: observacao.trim() || null,
        }
      : null;
  const serieInput = modelo && regra ? { ...modelo, regra } : null;
  const errosSerie = serieInput ? validaSerie(serieInput) : {};
  const errosRepeticao = {
    ...(errosSerie.diasSemana ? { diasSemana: errosSerie.diasSemana } : {}),
    ...(errosSerie.cada ? { cada: errosSerie.cada } : {}),
    ...(errosSerie.diaDoMes ? { diaDoMes: errosSerie.diaDoMes } : {}),
    ...(errosSerie.fimDia ? { fimDia: errosSerie.fimDia } : {}),
  };
  const temErroRepeticao = Object.keys(errosRepeticao).length > 0;

  // O que o usuario mexeu, comparado com o plantao COMO ELE ESTAVA (e nao com o modelo
  // da escala): um plantao ja ajustado a mao nao deve perguntar nada se nada mudou.
  const mudouModelo =
    Boolean(editando && serie && modelo) &&
    (modelo!.localId !== editando!.localId ||
      (modelo!.unidade ?? null) !== (editando!.unidade ?? null) ||
      modelo!.inicioMin !== minutosDoDia(editando!.inicio) ||
      modelo!.fimMin !== minutosDoDia(editando!.fim) ||
      modelo!.valorBruto !== editando!.valorBruto ||
      modelo!.descontoPercentual !== editando!.descontoPercentual ||
      (modelo!.observacao ?? null) !== (editando!.observacao ?? null));
  const mudouRegra = Boolean(serie && regra && !mesmaRegra(regra, serie.regra));

  /** O texto que diz de onde veio o valor proposto (so enquanto a pessoa nao o digitou). */
  function dicaDoValor(): string | undefined {
    if (valorManual || !local || !proposta) return undefined;
    const nome = normalizaUnidade(unidade);
    if (proposta.origem === "unidade") {
      return `Último valor de ${nome}${proposta.minutos ? ` (plantão de ${formatDuracao(proposta.minutos)})` : ""}. Pode mudar.`;
    }
    if (proposta.origem === "unidade_outra_duracao") {
      return `Último valor de ${nome}, mas era um plantão de ${formatDuracao(proposta.minutos ?? 0)}. Confira: esta duração é outra.`;
    }
    if (proposta.origem === "local") {
      return `Sugerido pelo local: ${local.modoValor === "hora" ? "valor da hora × duração" : "valor do plantão"}.`;
    }
    return "Informe o valor deste plantão: o local não tem um valor padrão.";
  }

  async function salvar() {
    setTentou(true);
    setMensagem(null);
    if (!input || temErrosPlantao(erros) || temErroRepeticao) return;

    // Mexeu no que vale para a escala toda: pergunta o alcance antes de gravar.
    if (editando && serie && (mudouModelo || mudouRegra)) {
      setEscopoAberto(true);
      return;
    }

    setSalvando(true);
    try {
      await grava(null);
      invalidar();
      voltar();
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não consegui salvar.");
      setSalvando(false);
    }
  }

  /** `escopo` so existe para plantao de escala; `null` = so este (ou plantao avulso). */
  async function grava(escopo: EscopoSerie | null) {
    if (!input) return;

    if (!editando) {
      if (regra && serieInput) {
        await criaSerie(db, serieInput);
      } else {
        const novoId = await criaPlantao(db, input);
        if (pago) await marcaPagamento(db, novoId, Date.now());
      }
      return;
    }

    // Tudo ou nada: editar a escala e acertar este plantao nao ficam pela metade.
    await db.transacao(async (ex) => {
      if (serie && serieInput && (escopo === "proximos" || escopo === "todos")) {
        await editaSerie(ex, editando.id, escopo, serieInput);
        // Data e situacao sao deste plantao so; o resto ja veio pela escala.
        if (inicioDoDia(input.inicio) !== inicioDoDia(editando.inicio) || input.status !== editando.status) {
          await atualizaPlantao(ex, editando.id, input);
        }
      } else {
        const ok = await atualizaPlantao(ex, editando.id, input);
        if (!ok) throw new Error("Este plantão não existe mais.");
      }

      if (pago && editando.pagoEm === null) await marcaPagamento(ex, editando.id, Date.now());
      else if (!pago && editando.pagoEm !== null) await marcaPagamento(ex, editando.id, null);
    });
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

  const pendencias = [
    ...Object.entries(erros)
      .filter(([, v]) => v)
      .map(([k]) => ROTULOS_ERRO[k] ?? k),
    ...(temErroRepeticao ? ["repetição"] : []),
  ];

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
              O local é a rede ou o hospital: nome, cor e como você recebe (prazo e descontos). O valor e a unidade você informa em cada plantão.
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
              <Pressable
                role="button"
                aria-label="Cadastrar novo local"
                onPress={() => {
                  setLocaisAntes(new Set(locais.map((l) => l.id)));
                  router.push("/local/novo");
                }}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.colors.primary,
                  backgroundColor: pressed ? t.colors.primarySoft : "transparent",
                })}
              >
                <Icone name="plus" size={22} color={t.colors.primary} aria-hidden importantForAccessibility="no" />
              </Pressable>
            </View>
            {local && local.arquivadoEm !== null && (
              <Txt variant="caption" tom="warning">
                Este local está arquivado.
              </Txt>
            )}
          </Campo>

          {/* --------------------------------- unidade --------------------------------- */}
          <Campo
            rotulo="Unidade"
            opcional
            erro={mostra("unidade")}
            dica={
              unidadesConhecidas.length === 0
                ? 'O nome do lugar dentro do local, como "Itaim" na Rede D\'Or. Cada unidade pode ter o seu valor.'
                : undefined
            }
          >
            <CampoTexto
              value={unidade}
              onChangeText={setUnidade}
              placeholder={local ? `Ex.: Itaim, Central (dentro de ${local.nome})` : "Ex.: Itaim, Central"}
              maxLength={LIMITE_UNIDADE + 20}
              autoCapitalize="words"
              accessibilityLabel="Unidade"
              erro={Boolean(mostra("unidade"))}
            />
            {unidadesConhecidas.length > 0 && (
              <View role="radiogroup" aria-label="Unidades usadas neste local" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
                {unidadesConhecidas.slice(0, 8).map((u) => (
                  <Chip
                    key={u.chave}
                    rotulo={u.unidade}
                    rotuloAcessivel={`Unidade ${u.unidade}`}
                    ativo={chaveUnidade(unidade) === u.chave}
                    onPress={() => setUnidade(chaveUnidade(unidade) === u.chave ? "" : u.unidade)}
                  />
                ))}
              </View>
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

          {/* -------------------------------- repeticao -------------------------------- */}
          {!editando && (
            <View style={{ gap: t.spacing.lg }}>
              <Secao>Repetição</Secao>
              <Repeticao valor={rep} onChange={setRep} dataMs={dia} erros={tentou || rep.tipo !== "nunca" ? errosRepeticao : {}} />
            </View>
          )}

          {editando && serie && (
            <View style={{ gap: t.spacing.lg }}>
              <Secao>Escala</Secao>
              <Card>
                <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                  <Icone name="repeat" size={18} color={t.colors.primary} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {descreveRecorrencia(regra ?? serie.regra)}
                  </Txt>
                </View>
                <Txt variant="caption" tom="muted" style={{ marginTop: t.spacing.sm, marginBottom: t.spacing.md }}>
                  Este plantão faz parte de uma escala. Ao mudar horário, valor ou repetição, você escolhe se vale só
                  para este, para os próximos ou para todos.
                </Txt>
                <Button variant="secondary" compacto icone="calendar-sync-outline" onPress={() => setRepAberta((a) => !a)}>
                  {repAberta ? "Fechar repetição" : "Alterar repetição"}
                </Button>
              </Card>
              {repAberta && (
                <Repeticao valor={rep} onChange={setRep} dataMs={dia} erros={errosRepeticao} podeNaoRepetir={false} />
              )}
            </View>
          )}

          {/* ---------------------------------- valor ---------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Valor</Secao>

            <Campo
              rotulo="Valor bruto"
              erro={mostra("valorBruto")}
              dica={dicaDoValor()}
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
                    {proposta && (proposta.origem === "unidade" || proposta.origem === "unidade_outra_duracao")
                      ? `Usar o último valor de ${normalizaUnidade(unidade)}: ${formatBRL(sugerido)}`
                      : `Usar o valor do local: ${formatBRL(sugerido)}`}
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
          {!(!editando && regra) && (
            <View style={{ gap: t.spacing.md }}>
              <Secao>Situação</Secao>
              <Segmentado
                opcoes={STATUS_PLANTAO.map((s) => ({ valor: s, rotulo: ROTULO_STATUS[s] }))}
                valor={status}
                onChange={(s) => {
                  setStatus(s);
                  setStatusTocado(true);
                  // Cancelado e trocado nao tem o que receber.
                  if (s !== "realizado") setPago(false);
                }}
              />
              <Txt variant="caption" tom="muted">
                {DESCRICAO_STATUS[status]}
              </Txt>
            </View>
          )}

          {/* --------------------------------- pagamento --------------------------------- */}
          {!(!editando && regra) && contaNoValor(status) && (
            <View style={{ gap: t.spacing.md }}>
              <Secao>Pagamento</Secao>
              <Segmentado
                opcoes={[
                  { valor: "receber", rotulo: "A receber" },
                  { valor: "pago", rotulo: "Já recebi" },
                ]}
                valor={pago ? "pago" : "receber"}
                onChange={(v) => {
                  setPago(v === "pago");
                  // Quem recebeu, trabalhou: marcar como pago confirma o plantao.
                  if (v === "pago") {
                    setStatus("realizado");
                    setStatusTocado(true);
                  }
                }}
              />
              <Txt variant="caption" tom="muted">
                {pago
                  ? editando?.pagoEm != null
                    ? `Pago em ${formatDataCurta(editando.pagoEm)}. Já recebido, este plantão fica como realizado.`
                    : "Vai ficar marcado como pago hoje e como realizado."
                  : "Ainda não caiu na conta."}
              </Txt>
            </View>
          )}

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
                    {tituloDoPlantao({ unidade, local })}
                  </Txt>
                  <Pill tom={status === "realizado" ? "success" : status === "agendado" ? "primary" : "warning"}>
                    {ROTULO_STATUS[status]}
                  </Pill>
                </View>
                <Txt variant="label" tom="muted">
                  {formatDiaSemana(intervalo.inicio)}, {formatData(intervalo.inicio)} ·{" "}
                  {descreveHorario(intervalo.inicio, intervalo.fim)}
                </Txt>
                {!editando && regra && !temErroRepeticao && (
                  <Txt variant="label" tom="primary">
                    {descreveRecorrencia(regra)}
                  </Txt>
                )}
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
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : regra ? "Criar escala" : "Lançar plantão"}
            </Button>

            {editando &&
              (serie ? (
                <Button variant="ghost" icone="trash-can-outline" largura="cheia" onPress={() => setExcluindoSerie(true)}>
                  Excluir este plantão
                </Button>
              ) : confirmaExcluir ? (
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

      {escopoAberto && editando && (
        <EscopoModal
          plantaoId={editando.id}
          inicio={editando.inicio}
          titulo="Aplicar a quais plantões?"
          acao="editar"
          escopos={mudouRegra ? ["proximos", "todos"] : ["este", "proximos", "todos"]}
          rotuloConfirmar="Salvar"
          tomConfirmar="primary"
          onFechar={() => setEscopoAberto(false)}
          onConfirmar={async (escopo) => {
            await grava(escopo);
            invalidar();
            voltar();
          }}
        />
      )}

      {excluindoSerie && editando && (
        <ExcluirPlantao
          plantao={editando}
          onFechar={() => setExcluindoSerie(false)}
          onExcluido={() => {
            invalidar();
            voltar();
          }}
        />
      )}
    </Moldura>
  );
}
