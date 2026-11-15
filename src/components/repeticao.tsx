import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { CalendarioMes } from "@/components/calendario-mes";
import { Campo, CampoNumero, Chip, Segmentado } from "@/components/form";
import { Card, Icone, Txt } from "@/components/ui";
import { diasSemanaLongo, diasSemanaMinimo, formatData, formatDiaSemanaLongo, inicioDoDia } from "@/lib/datetime";
import {
  DIAS_UTEIS,
  ESCALAS_COMUNS,
  FIM_DE_SEMANA,
  TODOS_OS_DIAS,
  alternaDia,
  descreveRecorrencia,
  diasDoRascunho,
  formatDiaCurto,
  proximasOcorrencias,
  regraDoRascunho,
  temDia,
  type ErrosSerie,
  type RascunhoRepeticao,
  type TipoRascunho,
} from "@/lib/recorrencia";
import { useTheme } from "@/theme";

const TIPOS: readonly { valor: TipoRascunho; rotulo: string }[] = [
  { valor: "nunca", rotulo: "Não repete" },
  { valor: "semanal", rotulo: "Semanal" },
  { valor: "intervalo", rotulo: "Ciclo" },
  { valor: "mensal", rotulo: "Mensal" },
];

/**
 * Como o plantao se repete. Quem cadastra uma escala fixa descreve uma vez e
 * a agenda preenche o resto; embaixo, a previa mostra as proximas datas para
 * conferir de relance se e isso mesmo.
 *
 * `dataMs` e o dia do plantao: enquanto nada e escolhido, "semanal" e "mensal"
 * acompanham o dia da semana e o dia do mes dele.
 */
export function Repeticao({
  valor,
  onChange,
  dataMs,
  erros,
  podeNaoRepetir = true,
}: {
  valor: RascunhoRepeticao;
  onChange: (v: RascunhoRepeticao) => void;
  dataMs: number;
  erros: ErrosSerie;
  /** Ao editar uma escala existente nao ha "nao repete": para isso e so excluir. */
  podeNaoRepetir?: boolean;
}) {
  const t = useTheme();
  const [calendarioAberto, setCalendarioAberto] = useState(false);
  const [refCalendario, setRefCalendario] = useState(valor.fimDia ?? dataMs);

  const set = (parcial: Partial<RascunhoRepeticao>) => onChange({ ...valor, ...parcial });

  const regra = useMemo(() => regraDoRascunho(valor, dataMs), [valor, dataMs]);
  const dias = diasDoRascunho(valor, dataMs);
  const proximas = useMemo(() => (regra && Object.keys(erros).length === 0 ? proximasOcorrencias(regra, 4) : []), [regra, erros]);

  const tipos = podeNaoRepetir ? TIPOS : TIPOS.filter((x) => x.valor !== "nunca");

  const nomeDoDia = (i: number) => diasSemanaLongo[i]!;

  return (
    <View style={{ gap: t.spacing.lg }}>
      <Segmentado opcoes={tipos} valor={valor.tipo} onChange={(tipo) => set({ tipo })} />

      {valor.tipo === "semanal" && (
        <>
          <Campo rotulo="Dias da semana" erro={erros.diasSemana}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {diasSemanaMinimo.map((letra, i) => {
                const ativo = temDia(dias, i);
                return (
                  <Pressable
                    key={i}
                    role="checkbox"
                    aria-checked={ativo}
                    aria-label={nomeDoDia(i)}
                    onPress={() => set({ diasSemana: alternaDia(dias, i) })}
                    style={{
                      flex: 1,
                      height: 44,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: t.radius.md,
                      borderWidth: ativo ? 0 : 1,
                      borderColor: t.colors.borderStrong,
                      backgroundColor: ativo ? t.colors.primary : t.colors.surface,
                    }}
                  >
                    <Txt variant="label" tom={ativo ? "inverso" : "normal"} style={{ fontWeight: "700" }}>
                      {letra}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
              <Chip rotulo="Seg a sex" ativo={dias === DIAS_UTEIS} onPress={() => set({ diasSemana: DIAS_UTEIS })} />
              <Chip rotulo="Fim de semana" ativo={dias === FIM_DE_SEMANA} onPress={() => set({ diasSemana: FIM_DE_SEMANA })} />
              <Chip rotulo="Todos os dias" ativo={dias === TODOS_OS_DIAS} onPress={() => set({ diasSemana: TODOS_OS_DIAS })} />
            </View>
          </Campo>
          <Campo rotulo="A cada quantas semanas" erro={erros.cada} dica="1 = toda semana; 2 = semana sim, semana não.">
            <CampoNumero
              valor={valor.cada}
              onChange={(cada) => set({ cada })}
              sufixo={valor.cada === "1" ? "semana" : "semanas"}
              maxLength={1}
              erro={Boolean(erros.cada)}
              rotuloAcessivel="A cada quantas semanas"
            />
          </Campo>
        </>
      )}

      {valor.tipo === "intervalo" && (
        <Campo
          rotulo="Ciclo de dias"
          erro={erros.cada}
          dica="Trabalha um dia e folga os seguintes. 12×36 = a cada 2 dias; 24×72 = a cada 4."
        >
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
            {ESCALAS_COMUNS.map((e) => (
              <Chip key={e.id} rotulo={e.rotulo} rotuloAcessivel={`${e.rotulo}: ${e.detalhe}`} ativo={valor.cada === String(e.cada)} onPress={() => set({ cada: String(e.cada) })} />
            ))}
          </View>
          <CampoNumero
            valor={valor.cada}
            onChange={(cada) => set({ cada })}
            sufixo={valor.cada === "1" ? "dia (todo dia)" : "dias"}
            maxLength={2}
            erro={Boolean(erros.cada)}
            rotuloAcessivel="A cada quantos dias"
          />
        </Campo>
      )}

      {valor.tipo === "mensal" && (
        <>
          <Campo rotulo="Dia do mês" erro={erros.diaDoMes} dica="Dia 31 vale em todo mês: nos mais curtos cai no último dia.">
            <CampoNumero
              valor={valor.diaDoMes === "" ? String(new Date(dataMs).getDate()) : valor.diaDoMes}
              onChange={(diaDoMes) => set({ diaDoMes })}
              maxLength={2}
              erro={Boolean(erros.diaDoMes)}
              rotuloAcessivel="Dia do mês"
            />
          </Campo>
          <Campo rotulo="A cada quantos meses" erro={erros.cada}>
            <CampoNumero
              valor={valor.cada}
              onChange={(cada) => set({ cada })}
              sufixo={valor.cada === "1" ? "mês" : "meses"}
              maxLength={2}
              erro={Boolean(erros.cada)}
              rotuloAcessivel="A cada quantos meses"
            />
          </Campo>
        </>
      )}

      {valor.tipo !== "nunca" && (
        <>
          <Campo rotulo="Até quando" erro={erros.fimDia}>
            <Segmentado
              opcoes={[
                { valor: "sem", rotulo: "Sem data final" },
                { valor: "ate", rotulo: "Até uma data" },
              ]}
              valor={valor.fimDia === null ? "sem" : "ate"}
              onChange={(v) => {
                if (v === "sem") {
                  setCalendarioAberto(false);
                  set({ fimDia: null });
                } else {
                  set({ fimDia: valor.fimDia ?? inicioDoDia(dataMs) });
                  setRefCalendario(valor.fimDia ?? dataMs);
                }
              }}
            />
            {valor.fimDia !== null && (
              <>
                <Pressable
                  onPress={() => setCalendarioAberto((a) => !a)}
                  role="button"
                  aria-label={`Data final: ${formatDiaSemanaLongo(valor.fimDia)}, ${formatData(valor.fimDia)}. Tocar para mudar.`}
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
                  <Icone name="calendar-end" size={20} color={t.colors.primary} />
                  <Txt variant="bodyStrong" style={{ flex: 1 }}>
                    {formatDiaSemanaLongo(valor.fimDia)}, {formatData(valor.fimDia)}
                  </Txt>
                  <Icone name={calendarioAberto ? "chevron-up" : "chevron-down"} size={20} color={t.colors.textFaint} />
                </Pressable>
                {calendarioAberto && (
                  <Card>
                    <CalendarioMes
                      referenciaMs={refCalendario}
                      selecionadoMs={valor.fimDia}
                      onSelecionar={(ms) => {
                        set({ fimDia: inicioDoDia(ms) });
                        setRefCalendario(ms);
                        setCalendarioAberto(false);
                      }}
                      onTrocarMes={setRefCalendario}
                    />
                  </Card>
                )}
              </>
            )}
          </Campo>

          {regra && (
            <Card style={{ borderColor: t.colors.primary }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
                <Icone name="repeat" size={18} color={t.colors.primary} />
                <Txt variant="bodyStrong" tom="primary" style={{ flex: 1 }}>
                  {descreveRecorrencia(regra)}
                </Txt>
              </View>
              {proximas.length > 0 ? (
                <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.sm }}>
                  Próximos: {proximas.map(formatDiaCurto).join(" · ")}
                </Txt>
              ) : (
                Object.keys(erros).length === 0 && (
                  <Txt variant="label" tom="warning" style={{ marginTop: t.spacing.sm }}>
                    Nenhuma data cai nesse período.
                  </Txt>
                )
              )}
            </Card>
          )}
        </>
      )}
    </View>
  );
}
