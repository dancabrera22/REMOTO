import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { Chip } from "@/components/form";
import { Button, Card, Icone, Pill, Secao, Txt } from "@/components/ui";
import { executorDe } from "@/db/client";
import { conectaCalendario, lerConfigCalendario } from "@/db/calendario";
import {
  configuraLembretes,
  lerConfigLembretes,
  type PermissaoLembretes,
  type ResultadoLembretes,
} from "@/db/lembretes";
import { useEstadoBanco } from "@/db/provider";
import { obtemProvedorDeCalendario } from "@/lib/calendario-provedor";
import type { ConfigCalendario } from "@/lib/calendario";
import { formatDataCurta, formatHora, mesmoDia } from "@/lib/datetime";
import {
  ANTECEDENCIAS,
  ANTECEDENCIA_PADRAO_MIN,
  HORIZONTE_LEMBRETES_DIAS,
  tempoFalta,
  type ConfigLembretes,
} from "@/lib/lembretes";
import { obtemProvedorDeLembretes } from "@/lib/lembretes-provedor";
import { useTheme } from "@/theme";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function quando(ms: number): string {
  return mesmoDia(ms, Date.now()) ? `hoje, ${formatHora(ms)}` : `${formatDataCurta(ms)}, ${formatHora(ms)}`;
}

function resumo(r: ResultadoLembretes): string {
  if (r.estado === "desligado") return r.cancelados ? `Lembretes desligados. ${plural(r.cancelados, "aviso removido", "avisos removidos")}.` : "Lembretes desligados.";
  if (r.estado === "sem_permissao") return r.mensagem ?? "";
  const partes: string[] = [];
  if (r.criados) partes.push(plural(r.criados, "aviso agendado", "avisos agendados"));
  if (r.cancelados) partes.push(plural(r.cancelados, "removido", "removidos"));
  const feito = partes.length ? partes.join(", ") : "Tudo em dia, nada a mudar";
  return r.estado === "erro" ? `${feito}. ${r.mensagem ?? ""}`.trim() : feito;
}

/**
 * O cartao dos lembretes do proprio app em Ajustes: escolher quanto antes avisar, dar a permissao
 * de notificacao e testar. Quem toca o aviso e o sistema do celular, com o app fechado.
 */
export function LembretesAjustes() {
  const t = useTheme();
  const banco = useEstadoBanco();
  const prov = useMemo(() => obtemProvedorDeLembretes(), []);
  const provCalendario = useMemo(() => obtemProvedorDeCalendario(), []);

  const [config, setConfig] = useState<ConfigLembretes | null | undefined>(undefined);
  const [calendario, setCalendario] = useState<ConfigCalendario | null>(null);
  const [permissao, setPermissao] = useState<PermissaoLembretes | null>(null);
  const [agendados, setAgendados] = useState<number | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carrega = useCallback(async () => {
    if (!prov || banco.status !== "pronto") return;
    const db = executorDe(banco.db);
    setConfig(await lerConfigLembretes(db));
    setCalendario(await lerConfigCalendario(db));
    try {
      setPermissao(await prov.permissao());
      setAgendados((await prov.listaAgendados()).length);
    } catch {
      setAgendados(null);
    }
  }, [prov, banco]);

  // A sincronizacao automatica roda por fora desta tela: ao voltar para Ajustes, relê.
  useFocusEffect(
    useCallback(() => {
      void carrega();
    }, [carrega]),
  );

  if (!prov) {
    return (
      <View>
        <Secao>Lembretes do app</Secao>
        <Card>
          <View style={{ flexDirection: "row", gap: t.spacing.md }}>
            <Icone name="bell-off-outline" size={22} color={t.colors.textFaint} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="bodyStrong">Só no aplicativo do celular</Txt>
              <Txt variant="label" tom="muted">
                O navegador não agenda avisos com o app fechado. No Android, o Meu Plantão avisa antes de cada plantão.
              </Txt>
            </View>
          </View>
        </Card>
      </View>
    );
  }

  /** Pede a permissao se ainda der; devolve se ela esta concedida. */
  async function garantePermissao(): Promise<boolean> {
    if (!prov) return false;
    let p = await prov.permissao();
    if (p === "pergunta") p = await prov.pedePermissao();
    setPermissao(p);
    return p === "concedida";
  }

  async function escolhe(minutos: number | null) {
    if (!prov || banco.status !== "pronto") return;
    setTrabalhando(true);
    setAviso(null);
    try {
      if (minutos !== null) await garantePermissao();
      setAviso(resumo(await configuraLembretes(executorDe(banco.db), prov, minutos)));
      await carrega();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui atualizar os lembretes.");
    } finally {
      setTrabalhando(false);
    }
  }

  async function testar() {
    if (!prov) return;
    setTrabalhando(true);
    setAviso(null);
    try {
      if (!(await garantePermissao())) {
        setAviso("Sem a permissão de notificação o aviso não aparece. Libere nas configurações do app.");
        return;
      }
      await prov.testeAgora("Meu Plantão", "Teste: é assim que o aviso de um plantão aparece.", 5);
      setAviso("O aviso de teste toca em 5 segundos. Pode sair do app ou bloquear a tela.");
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui enviar o teste.");
    } finally {
      setTrabalhando(false);
    }
  }

  /** Tira o lembrete do evento do calendario, para o plantao nao avisar duas vezes. */
  async function tiraLembreteDoCalendario() {
    if (!provCalendario || !calendario || banco.status !== "pronto") return;
    setTrabalhando(true);
    try {
      await conectaCalendario(executorDe(banco.db), provCalendario, {
        calendario: { id: calendario.calendarioId, nome: calendario.calendarioNome, conta: calendario.conta, cor: null, principal: false },
        lembreteMin: null,
        mostrarValor: calendario.mostrarValor,
      });
      setAviso("Pronto: o calendário não avisa mais; quem avisa é o Meu Plantão.");
      await carrega();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "Não consegui mudar o calendário.");
    } finally {
      setTrabalhando(false);
    }
  }

  const atual = config?.antecedenciaMin ?? null;
  const ligado = atual !== null;
  const bloqueada = permissao === "negada";
  const comErro = config?.ultimoErro != null;
  const duplicado = ligado && calendario !== null && calendario.lembreteMin !== null;

  return (
    <View>
      <Secao
        acao={
          ligado ? (
            <Pill tom={bloqueada || comErro ? "danger" : "success"} icone={bloqueada || comErro ? "alert-circle-outline" : "check-circle-outline"}>
              {bloqueada || comErro ? "Com problema" : "Ligados"}
            </Pill>
          ) : undefined
        }
      >
        Lembretes do app
      </Secao>
      <Card>
        <View style={{ flexDirection: "row", gap: t.spacing.md }}>
          <Icone name="bell-ring-outline" size={24} color={t.colors.primary} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt variant="bodyStrong">Aviso antes de cada plantão</Txt>
            <Txt variant="label" tom="muted">
              O Meu Plantão avisa sozinho, com o app fechado, só dos plantões agendados. O aviso não mostra valores. Cobre os
              próximos {HORIZONTE_LEMBRETES_DIAS} dias e se renova toda vez que você abre o app.
            </Txt>
          </View>
        </View>

        <View role="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, marginTop: t.spacing.lg }}>
          {ANTECEDENCIAS.map((a) => (
            <Chip key={a.rotulo} rotulo={a.rotulo} ativo={atual === a.minutos} onPress={() => void escolhe(a.minutos)} />
          ))}
        </View>

        {bloqueada && (
          <View style={{ marginTop: t.spacing.md, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.dangerSoft, gap: t.spacing.sm }}>
            <Txt variant="label" tom="danger">
              As notificações do Meu Plantão estão bloqueadas no celular. Abra as configurações do app → Notificações e ative
              “Permitir notificações”.
            </Txt>
            <Button variant="secondary" compacto icone="cog-outline" onPress={() => void Linking.openSettings()}>
              Abrir configurações do app
            </Button>
          </View>
        )}

        {ligado && !bloqueada && comErro && (
          <Txt variant="label" tom="danger" style={{ marginTop: t.spacing.md }}>
            {config?.ultimoErro}
          </Txt>
        )}

        {ligado && !bloqueada && (
          <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.md }}>
            {agendados !== null ? `${plural(agendados, "aviso agendado", "avisos agendados")}` : "Avisos agendados: não consegui ler"}
            {config?.ultimaSincronizacao ? ` · atualizado ${quando(config.ultimaSincronizacao)}` : ""}
            {` · avisa ${tempoFalta(atual ?? ANTECEDENCIA_PADRAO_MIN)} antes`}
          </Txt>
        )}

        {duplicado && (
          <View style={{ marginTop: t.spacing.md, padding: t.spacing.md, borderRadius: t.radius.md, backgroundColor: t.colors.primarySoft, gap: t.spacing.sm }}>
            <Txt variant="label">
              O calendário do celular também está avisando. Para não tocar duas vezes, deixe só um dos dois.
            </Txt>
            <Button variant="secondary" compacto icone="calendar-remove-outline" disabled={trabalhando} onPress={() => void tiraLembreteDoCalendario()}>
              Tirar o lembrete do calendário
            </Button>
          </View>
        )}

        {aviso && (
          <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.md }}>
            {aviso}
          </Txt>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, marginTop: t.spacing.lg }}>
          <Button variant="secondary" compacto icone="bell-outline" disabled={trabalhando} onPress={() => void testar()}>
            Enviar notificação de teste agora
          </Button>
        </View>
        <Txt variant="caption" tom="faint" style={{ marginTop: t.spacing.sm }}>
          Se o aviso de teste não aparecer, veja se o celular está em economia de bateria: ela pode atrasar avisos.
        </Txt>
      </Card>
    </View>
  );
}
