import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DiaCelula } from "@/components/calendario-mes";
import {
  Campo,
  CampoDinheiro,
  CampoNumero,
  CampoTexto,
  Segmentado,
  SeletorCor,
} from "@/components/form";
import { Button, Card, Icone, Secao, Txt } from "@/components/ui";
import { atualizaLocal, arquivaLocal, buscaLocal, criaLocal, listaLocais } from "@/db/locais";
import { useBanco, useConsulta, useInvalidar } from "@/db/provider";
import { formatData, formatDiaSemana, inicioDoDia, somaDias } from "@/lib/datetime";
import {
  localVazio,
  temErros,
  validaLocal,
  valorEstimado,
  valorLiquido,
  type Local,
  type LocalInput,
  type OutroLocal,
} from "@/lib/locais";
import { formatBRL, formatPercentual, lePercentual, percentualParaCampo } from "@/lib/money";
import {
  calculaDataRecebimento,
  descreveAjuste,
  type AjusteDiaUtil,
  type TipoRegra,
} from "@/lib/pagamento";
import { nomeDaCor, useTheme } from "@/theme";

const inteiro = (texto: string): number | null => (/^\d+$/.test(texto) ? Number(texto) : null);

const ROTULOS_ERRO: Record<string, string> = {
  nome: "nome do local",
  apelido: "apelido",
  cor: "cor",
  valorPadrao: "valor",
  descontoPercentual: "descontos",
  diaPagamento: "dia do pagamento",
  diasApos: "prazo em dias",
  diaFechamento: "dia do fechamento",
  mesesAdiante: "mês do pagamento",
};

/* -------------------------------------------------------------------------- */
/* Tela: carrega o necessario e entrega ao formulario                          */
/* -------------------------------------------------------------------------- */

export default function TelaLocal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const editandoId = id === "novo" ? null : Number(id);

  const voltar = () => (router.canGoBack() ? router.back() : router.replace("/locais"));

  const dados = useConsulta(async (db) => {
    const ativos = await listaLocais(db, { arquivados: false });
    const local = editandoId !== null && Number.isInteger(editandoId) ? await buscaLocal(db, editandoId) : null;
    return { ativos, local };
  }, [editandoId]);

  const idInvalido = editandoId !== null && !Number.isInteger(editandoId);

  if (idInvalido || dados.status === "erro" || (dados.status === "pronto" && editandoId !== null && !dados.dados.local)) {
    return (
      <Moldura titulo="Local" onVoltar={voltar}>
        <Card>
          <Txt variant="bodyStrong" tom="danger">
            {dados.status === "erro" ? "Não consegui ler o banco" : "Local não encontrado"}
          </Txt>
          <Txt variant="label" tom="muted" style={{ marginTop: 4 }}>
            {dados.status === "erro" ? dados.erro : "Ele pode ter sido arquivado ou removido."}
          </Txt>
        </Card>
      </Moldura>
    );
  }

  if (dados.status !== "pronto") {
    return (
      <Moldura titulo={editandoId === null ? "Novo local" : "Editar local"} onVoltar={voltar}>
        <Txt variant="label" tom="muted">
          Carregando…
        </Txt>
      </Moldura>
    );
  }

  const { ativos, local } = dados.dados;
  const outros: OutroLocal[] = ativos
    .filter((l) => l.id !== editandoId)
    .map((l) => ({ id: l.id, nome: l.nome, cor: l.cor }));

  return (
    <Formulario
      key={editandoId ?? "novo"}
      editando={local}
      outros={outros}
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
  outros,
  voltar,
}: {
  editando: Local | null;
  outros: OutroLocal[];
  voltar: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const db = useBanco();
  const invalidar = useInvalidar();

  const inicial: LocalInput = editando ?? localVazio(outros.map((o) => o.cor));

  const [nome, setNome] = useState(inicial.nome);
  const [apelido, setApelido] = useState(inicial.apelido ?? "");
  const [cor, setCor] = useState(inicial.cor);
  const [endereco, setEndereco] = useState(inicial.endereco ?? "");
  const [contato, setContato] = useState(inicial.contato ?? "");
  const [observacao, setObservacao] = useState(inicial.observacao ?? "");
  const [modoValor, setModoValor] = useState(inicial.modoValor);
  const [valorPadrao, setValorPadrao] = useState(inicial.valorPadrao);
  const [descontoTxt, setDescontoTxt] = useState(percentualParaCampo(inicial.descontoPercentual));

  const [tipo, setTipo] = useState<TipoRegra>(inicial.regra.tipo);
  const [diaPag, setDiaPag] = useState(String(inicial.regra.diaPagamento ?? 10));
  const [diasApos, setDiasApos] = useState(String(inicial.regra.diasApos ?? 30));
  const [diaFech, setDiaFech] = useState(String(inicial.regra.diaFechamento ?? 20));
  const [meses, setMeses] = useState(inicial.regra.mesesAdiante);
  const [ajuste, setAjuste] = useState<AjusteDiaUtil>(inicial.regra.ajusteDiaUtil);

  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [confirmaArquivar, setConfirmaArquivar] = useState(false);

  const entrada = useMemo<LocalInput>(
    () => ({
      nome,
      apelido: apelido.trim() || null,
      cor,
      endereco: endereco.trim() || null,
      contato: contato.trim() || null,
      observacao: observacao.trim() || null,
      modoValor,
      valorPadrao,
      descontoPercentual: descontoTxt.trim() === "" ? 0 : (lePercentual(descontoTxt) ?? Number.NaN),
      regra: {
        tipo,
        diaPagamento: inteiro(diaPag),
        diasApos: inteiro(diasApos),
        diaFechamento: inteiro(diaFech),
        mesesAdiante: meses,
        ajusteDiaUtil: ajuste,
      },
    }),
    [nome, apelido, cor, endereco, contato, observacao, modoValor, valorPadrao, descontoTxt, tipo, diaPag, diasApos, diaFech, meses, ajuste],
  );

  const { erros, avisos } = useMemo(() => validaLocal(entrada, outros), [entrada, outros]);
  const mostra = (campo: keyof typeof erros) => (tentou ? erros[campo] : undefined);

  const usadasPor = useMemo(
    () => Object.fromEntries(outros.map((o) => [o.cor.toLowerCase(), o.nome])),
    [outros],
  );

  const opcoesMeses = useMemo(() => {
    const base = [
      { valor: 0, rotulo: "No mesmo mês" },
      { valor: 1, rotulo: "Mês seguinte" },
      { valor: 2, rotulo: "2 meses" },
    ];
    // Nao perde um valor salvo fora das tres opcoes comuns.
    return meses > 2 ? [...base, { valor: meses, rotulo: `${meses} meses` }] : base;
  }, [meses]);

  async function salvar() {
    setTentou(true);
    setMensagem(null);
    if (temErros(erros)) return;

    setSalvando(true);
    try {
      if (editando) {
        const ok = await atualizaLocal(db, editando.id, entrada);
        if (!ok) throw new Error("Este local não existe mais.");
      } else {
        await criaLocal(db, entrada);
      }
      invalidar();
      voltar();
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não consegui salvar.");
      setSalvando(false);
    }
  }

  async function arquivar() {
    if (!editando) return;
    setSalvando(true);
    try {
      await arquivaLocal(db, editando.id);
      invalidar();
      voltar();
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : "Não consegui arquivar.");
      setSalvando(false);
    }
  }

  const pendencias = Object.entries(erros)
    .filter(([, v]) => v)
    .map(([k]) => ROTULOS_ERRO[k] ?? k);

  return (
    <Moldura
      titulo={editando ? "Editar local" : "Novo local"}
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
          {/* ------------------------------ identificacao ------------------------------ */}
          <View style={{ gap: t.spacing.lg }}>
            <Campo rotulo="Nome do local" erro={mostra("nome")} aviso={avisos.nome}>
              <CampoTexto
                value={nome}
                onChangeText={setNome}
                placeholder="Ex.: Hospital Municipal"
                maxLength={60}
                autoCapitalize="words"
                erro={Boolean(mostra("nome"))}
                accessibilityLabel="Nome do local"
              />
            </Campo>

            <Campo
              rotulo="Apelido"
              opcional
              erro={mostra("apelido")}
              dica="Curto, para caber na agenda. Ex.: HM"
            >
              <CampoTexto
                value={apelido}
                onChangeText={setApelido}
                placeholder="HM"
                maxLength={20}
                erro={Boolean(mostra("apelido"))}
              />
            </Campo>
          </View>

          {/* ---------------------------------- cor ---------------------------------- */}
          <View style={{ gap: t.spacing.md }}>
            <Secao>Cor na agenda</Secao>
            <Campo rotulo={`Cor: ${nomeDaCor(cor)}`} aviso={avisos.cor} erro={mostra("cor")}>
              <SeletorCor valor={cor} onChange={setCor} usadasPor={usadasPor} />
            </Campo>
            <PreviaCor cor={cor} nome={nome.trim() || "Seu local"} />
          </View>

          {/* --------------------------------- valores --------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Valor do plantão</Secao>

            <Segmentado
              opcoes={[
                { valor: "plantao", rotulo: "Por plantão" },
                { valor: "hora", rotulo: "Por hora" },
              ]}
              valor={modoValor}
              onChange={setModoValor}
            />

            <Campo
              rotulo={modoValor === "hora" ? "Valor da hora" : "Valor do plantão"}
              erro={mostra("valorPadrao")}
              dica="Já vem preenchido ao lançar um plantão aqui — e pode ser mudado em cada um."
            >
              <CampoDinheiro
                valor={valorPadrao}
                onChange={setValorPadrao}
                erro={Boolean(mostra("valorPadrao"))}
                sufixo={modoValor === "hora" ? "/ hora" : undefined}
              />
            </Campo>

            <Campo
              rotulo="Descontos"
              opcional
              erro={mostra("descontoPercentual")}
              dica="IR, ISS, taxa de cooperativa… some tudo num só percentual."
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                <CampoTexto
                  value={descontoTxt}
                  onChangeText={(texto) => setDescontoTxt(texto.replace(/[^\d,.]/g, ""))}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  maxLength={5}
                  erro={Boolean(mostra("descontoPercentual"))}
                  style={{ width: 96, textAlign: "center" }}
                  accessibilityLabel="Percentual de descontos"
                />
                <Txt variant="bodyStrong" tom="muted">
                  %
                </Txt>
              </View>
            </Campo>
          </View>

          {/* ------------------------------- recebimento ------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Quando você recebe</Secao>

            <Segmentado
              opcoes={[
                { valor: "dia_mes_seguinte", rotulo: "Dia fixo" },
                { valor: "dias_apos", rotulo: "Dias após" },
                { valor: "fechamento", rotulo: "Fechamento" },
              ]}
              valor={tipo}
              onChange={setTipo}
            />
            <Txt variant="caption" tom="muted">
              {tipo === "dia_mes_seguinte" && "Todos os plantões do mês são pagos no mesmo dia."}
              {tipo === "dias_apos" && "Cada plantão é pago uma quantidade fixa de dias depois."}
              {tipo === "fechamento" && "Os plantões até o dia do fechamento entram no mesmo pagamento."}
            </Txt>

            {tipo === "fechamento" && (
              <Campo rotulo="Fecha no dia" erro={mostra("diaFechamento")}>
                <CampoNumero
                  valor={diaFech}
                  onChange={setDiaFech}
                  maxLength={2}
                  sufixo="de cada mês"
                  placeholder="20"
                  erro={Boolean(mostra("diaFechamento"))}
                  rotuloAcessivel="Dia do fechamento"
                />
              </Campo>
            )}

            {tipo !== "dias_apos" ? (
              <>
                <Campo rotulo="Paga no dia" erro={mostra("diaPagamento")}>
                  <CampoNumero
                    valor={diaPag}
                    onChange={setDiaPag}
                    maxLength={2}
                    placeholder="10"
                    erro={Boolean(mostra("diaPagamento"))}
                    rotuloAcessivel="Dia do pagamento"
                  />
                </Campo>
                <Campo
                  rotulo={tipo === "fechamento" ? "Em qual mês, contando do fechamento?" : "Em qual mês?"}
                  erro={mostra("mesesAdiante")}
                >
                  <Segmentado opcoes={opcoesMeses} valor={meses} onChange={setMeses} />
                </Campo>
              </>
            ) : (
              <Campo rotulo="Paga" erro={mostra("diasApos")}>
                <CampoNumero
                  valor={diasApos}
                  onChange={setDiasApos}
                  sufixo="dias após o plantão"
                  placeholder="30"
                  erro={Boolean(mostra("diasApos"))}
                  largura={96}
                  rotuloAcessivel="Dias após o plantão"
                />
              </Campo>
            )}

            <Campo
              rotulo="Se cair no fim de semana"
              dica={`${descreveAjuste(ajuste)}. Feriados ainda não são considerados.`}
            >
              <Segmentado
                opcoes={[
                  { valor: "nenhum", rotulo: "Manter" },
                  { valor: "proximo", rotulo: "Segunda" },
                  { valor: "anterior", rotulo: "Sexta" },
                ]}
                valor={ajuste}
                onChange={setAjuste}
              />
            </Campo>
          </View>

          {/* --------------------------------- previa --------------------------------- */}
          <PreviaPagamento entrada={entrada} />

          {/* -------------------------------- detalhes -------------------------------- */}
          <View style={{ gap: t.spacing.lg }}>
            <Secao>Detalhes</Secao>
            <Campo rotulo="Endereço" opcional>
              <CampoTexto value={endereco} onChangeText={setEndereco} placeholder="Rua, número, bairro" maxLength={300} />
            </Campo>
            <Campo rotulo="Contato" opcional>
              <CampoTexto value={contato} onChangeText={setContato} placeholder="Telefone ou e-mail do plantão" maxLength={300} />
            </Campo>
            <Campo rotulo="Observações" opcional>
              <CampoTexto
                value={observacao}
                onChangeText={setObservacao}
                placeholder="Passe na portaria, estacionamento, andar…"
                maxLength={300}
                multiline
              />
            </Campo>
          </View>

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
              {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Cadastrar local"}
            </Button>

            {editando &&
              (confirmaArquivar ? (
                <Card>
                  <Txt variant="bodyStrong">Arquivar {editando.nome}?</Txt>
                  <Txt variant="label" tom="muted" style={{ marginTop: 4, marginBottom: t.spacing.md }}>
                    O local some das listas, mas os plantões já lançados nele continuam no histórico. Você pode
                    restaurá-lo depois.
                  </Txt>
                  <View style={{ flexDirection: "row", gap: t.spacing.sm }}>
                    <Button variant="danger" onPress={arquivar} disabled={salvando}>
                      Arquivar
                    </Button>
                    <Button variant="secondary" onPress={() => setConfirmaArquivar(false)}>
                      Cancelar
                    </Button>
                  </View>
                </Card>
              ) : (
                <Button variant="ghost" icone="archive-outline" largura="cheia" onPress={() => setConfirmaArquivar(true)}>
                  Arquivar este local
                </Button>
              ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Moldura>
  );
}

/* -------------------------------------------------------------------------- */
/* Previas                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Mostra, com o mesmo componente da agenda, como a cor aparece: num dia comum,
 * no dia selecionado (onde o ponto fica fora do quadrado justamente para nao
 * perder a cor) e ao lado de outros locais.
 */
function PreviaCor({ cor, nome }: { cor: string; nome: string }) {
  const t = useTheme();
  const vizinha = "#9AAAAE";

  return (
    <Card>
      <Txt variant="caption" tom="muted" style={{ marginBottom: t.spacing.md }}>
        Assim fica na agenda, nos dias em que houver plantão aqui:
      </Txt>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <DiaCelula dia={12} />
        <DiaCelula dia={13} cores={[cor]} />
        <DiaCelula dia={14} hoje cores={[cor]} />
        <DiaCelula dia={15} selecionado cores={[cor]} />
        <DiaCelula dia={16} cores={[cor, vizinha]} />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: t.spacing.sm,
          marginTop: t.spacing.md,
        }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: cor }} />
        <Txt variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {nome}
        </Txt>
      </View>
      <Txt variant="caption" tom="faint" style={{ marginTop: t.spacing.sm }}>
        O dia 16 mostra o local junto com outro (cinza), no mesmo dia.
      </Txt>
    </Card>
  );
}

function PreviaPagamento({ entrada }: { entrada: LocalInput }) {
  const t = useTheme();
  const bruto = valorEstimado(entrada.modoValor, entrada.valorPadrao);
  const desconto = Number.isFinite(entrada.descontoPercentual) ? entrada.descontoPercentual : 0;
  const liquido = valorLiquido(bruto, desconto);

  const hoje = inicioDoDia(Date.now());
  const amostras = [hoje, somaDias(hoje, 15)].map((plantao) => {
    const paga = calculaDataRecebimento(entrada.regra, plantao);
    return { plantao, paga };
  });
  const regraCompleta = amostras.every((a) => a.paga !== null);

  return (
    <Card style={{ borderColor: t.colors.primary }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm, marginBottom: t.spacing.md }}>
        <Icone name="eye-outline" size={18} color={t.colors.primary} />
        <Txt variant="section" tom="primary">
          Prévia
        </Txt>
      </View>

      <View style={{ gap: t.spacing.lg }}>
        <View style={{ gap: 2 }}>
          <Txt variant="caption" tom="muted">
            {entrada.modoValor === "hora" ? "Plantão de 12 h" : "Um plantão"}
          </Txt>
          {bruto > 0 ? (
            <>
              <Txt variant="money">{formatBRL(liquido)}</Txt>
              <Txt variant="caption" tom="faint">
                {desconto > 0
                  ? `líquido · bruto ${formatBRL(bruto)}, menos ${formatPercentual(desconto)}`
                  : "sem descontos"}
              </Txt>
            </>
          ) : (
            <Txt variant="label" tom="faint">
              Informe o valor para ver quanto sobra.
            </Txt>
          )}
        </View>

        <View style={{ gap: t.spacing.sm }}>
          <Txt variant="caption" tom="muted">
            Quando cai na conta
          </Txt>
          {regraCompleta ? (
            amostras.map(({ plantao, paga }) => (
              <View
                key={plantao}
                style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: t.spacing.sm, rowGap: 2 }}
              >
                <Txt variant="label" tom="muted">
                  Plantão {formatDiaSemana(plantao)}, {formatData(plantao).slice(0, 5)}
                </Txt>
                <Icone name="arrow-right" size={14} color={t.colors.textFaint} />
                <Txt variant="bodyStrong" tom="success">
                  {formatDiaSemana(paga!)}, {formatData(paga!)}
                </Txt>
              </View>
            ))
          ) : (
            <Txt variant="label" tom="faint">
              Complete a regra para ver a data.
            </Txt>
          )}
        </View>
      </View>
    </Card>
  );
}
