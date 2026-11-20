import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Folha } from "@/components/folha";
import { Chip, Segmentado } from "@/components/form";
import { Button, Card, Icone, Pill, Secao, Txt } from "@/components/ui";
import { executorDe } from "@/db/client";
import {
  conectaCalendario,
  contaEventosMapeados,
  desconectaCalendario,
  lerConfigCalendario,
  sincronizaSemSobrepor,
  type CalendarioDisponivel,
  type PermissaoCalendario,
  type ProvedorCalendario,
  type ResultadoSincronizacao,
} from "@/db/calendario";
import { useBanco, useEstadoBanco } from "@/db/provider";
import { LEMBRETES, LEMBRETE_PADRAO_MIN, rotuloLembrete, type ConfigCalendario } from "@/lib/calendario";
import { obtemProvedorDeCalendario } from "@/lib/calendario-provedor";
import { formatDataCurta, formatHora, mesmoDia } from "@/lib/datetime";
import { useTheme } from "@/theme";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "tudo em dia" ou o que a sincronizacao fez. */
function resumoDoResultado(r: ResultadoSincronizacao): string {
  if (r.estado !== "ok" && r.estado !== "erro") return r.mensagem ?? "";
  const partes: string[] = [];
  if (r.criados) partes.push(plural(r.criados, "evento criado", "eventos criados"));
  if (r.atualizados) partes.push(plural(r.atualizados, "atualizado", "atualizados"));
  if (r.recriados) partes.push(plural(r.recriados, "refeito", "refeitos"));
  if (r.removidos) partes.push(plural(r.removidos, "removido", "removidos"));
  const feito = partes.length ? partes.join(", ") : "Tudo em dia, nada a mudar";
  return r.estado === "erro" ? `${feito}. ${r.mensagem ?? ""}`.trim() : feito;
}

function quando(ms: number): string {
  return mesmoDia(ms, Date.now()) ? `hoje, ${formatHora(ms)}` : `${formatDataCurta(ms)}, ${formatHora(ms)}`;
}

/**
 * O cartao do calendario em Ajustes: conectar, ver o estado, sincronizar na
 * hora, trocar de calendario e parar (apagando ou nao os eventos).
 */
export function CalendarioAjustes() {
  const t = useTheme();
  const banco = useEstadoBanco();
  const prov = useMemo(() => obtemProvedorDeCalendario(), []);

  const [config, setConfig] = useState<ConfigCalendario | null | undefined>(undefined);
  const [eventos, setEventos] = useState(0);
  const [folha, setFolha] = useState<"escolher" | "parar" | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carrega = useCallback(async () => {
    if (banco.status !== "pronto") return;
    const db = executorDe(banco.db);
    setConfig(await lerConfigCalendario(db));
    setEventos(await contaEventosMapeados(db));
  }, [banco]);

  // A sincronizacao automatica roda por fora desta tela: ao voltar para Ajustes, relê.
  useFocusEffect(
    useCallback(() => {
      void carrega();
    }, [carrega]),
  );

  async function sincronizarAgora() {
    if (!prov || banco.status !== "pronto") return;
    setTrabalhando(true);
    setAviso(null);
    try {
      setAviso(resumoDoResultado(await sincronizaSemSobrepor(executorDe(banco.db), prov)));
      await carrega();
    } finally {
      setTrabalhando(false);
    }
  }

  /* ------------------------------ sem calendario ------------------------------ */

  if (!prov) {
    return (
      <View>
        <Secao>Calendário do celular</Secao>
        <Card>
          <View style={{ flexDirection: "row", gap: t.spacing.md }}>
            <Icone name="calendar-remove-outline" size={22} color={t.colors.textFaint} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="bodyStrong">Só no aplicativo do celular</Txt>
              <Txt variant="label" tom="muted">
                O navegador não tem um calendário para o app escrever. No Android, seus plantões aparecem no calendário do
                aparelho — inclusive no Google Calendar, se a conta dele estiver no celular.
              </Txt>
            </View>
          </View>
        </Card>
      </View>
    );
  }

  const comErro = config?.ultimoErro != null;

  return (
    <View>
      <Secao
        acao={
          config ? (
            <Pill tom={comErro ? "danger" : "success"} icone={comErro ? "alert-circle-outline" : "check-circle-outline"}>
              {comErro ? "Com problema" : "Sincronizando"}
            </Pill>
          ) : undefined
        }
      >
        Calendário do celular
      </Secao>

      {/* ------------------------------ ainda nao conectado ------------------------------ */}
      {config === null && (
        <Card>
          <View style={{ flexDirection: "row", gap: t.spacing.md }}>
            <Icone name="calendar-sync-outline" size={24} color={t.colors.primary} />
            <View style={{ flex: 1, gap: 4 }}>
              <Txt variant="bodyStrong">Seus plantões no calendário</Txt>
              <Txt variant="label" tom="muted">
                Cada plantão vira um evento, com lembrete se você quiser. Se escolher o calendário da sua conta Google, eles
                aparecem também no Google Calendar. Os próximos 6 meses e o último mês entram.
              </Txt>
            </View>
          </View>
          {aviso && (
            <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.md }}>
              {aviso}
            </Txt>
          )}
          <View style={{ marginTop: t.spacing.md }}>
            <Button icone="calendar-plus" onPress={() => setFolha("escolher")}>
              Conectar calendário
            </Button>
          </View>
        </Card>
      )}

      {/* ---------------------------------- conectado ---------------------------------- */}
      {config && (
        <Card>
          <View style={{ gap: t.spacing.md }}>
            <Linha rotulo="Calendário" valor={config.conta ? `${config.calendarioNome} · ${config.conta}` : config.calendarioNome} />
            <Linha rotulo="Lembrete" valor={rotuloLembrete(config.lembreteMin)} />
            <Linha rotulo="Valor nas notas" valor={config.mostrarValor ? "Aparece" : "Não aparece"} />
            <Linha
              rotulo="Última sincronização"
              valor={config.ultimaSincronizacao ? `${quando(config.ultimaSincronizacao)} · ${plural(eventos, "evento", "eventos")}` : "ainda não"}
            />
          </View>

          {comErro && (
            <View
              style={{
                marginTop: t.spacing.md,
                padding: t.spacing.md,
                borderRadius: t.radius.md,
                backgroundColor: t.colors.dangerSoft,
                gap: t.spacing.sm,
              }}
            >
              <Txt variant="label" tom="danger">
                {config.ultimoErro}
              </Txt>
              {config.ultimoErro?.includes("permissão") && (
                <Button variant="secondary" compacto icone="cog-outline" onPress={() => void Linking.openSettings()}>
                  Abrir configurações do app
                </Button>
              )}
            </View>
          )}

          {aviso && (
            <Txt variant="label" tom="muted" style={{ marginTop: t.spacing.md }}>
              {aviso}
            </Txt>
          )}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm, marginTop: t.spacing.lg }}>
            <Button icone="sync" compacto onPress={sincronizarAgora} disabled={trabalhando}>
              {trabalhando ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
            <Button variant="secondary" compacto icone="pencil-outline" onPress={() => setFolha("escolher")} disabled={trabalhando}>
              Alterar
            </Button>
            <Button variant="ghost" compacto onPress={() => setFolha("parar")} disabled={trabalhando}>
              Parar
            </Button>
          </View>
        </Card>
      )}

      {folha === "escolher" && (
        <FolhaEscolha
          prov={prov}
          atual={config ?? null}
          onFechar={() => setFolha(null)}
          onConcluido={async (r) => {
            setFolha(null);
            setAviso(resumoDoResultado(r));
            await carrega();
          }}
        />
      )}

      {folha === "parar" && config && (
        <FolhaParar
          prov={prov}
          eventos={eventos}
          onFechar={() => setFolha(null)}
          onConcluido={async (msg) => {
            setFolha(null);
            setAviso(msg);
            await carrega();
          }}
        />
      )}
    </View>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt variant="caption" tom="muted">
        {rotulo}
      </Txt>
      <Txt variant="label" style={{ fontWeight: "600" }}>
        {valor}
      </Txt>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

function FolhaEscolha({
  prov,
  atual,
  onFechar,
  onConcluido,
}: {
  prov: ProvedorCalendario;
  atual: ConfigCalendario | null;
  onFechar: () => void;
  onConcluido: (r: ResultadoSincronizacao) => void | Promise<void>;
}) {
  const t = useTheme();
  const db = useBanco();

  const [permissao, setPermissao] = useState<PermissaoCalendario | null>(null);
  const [calendarios, setCalendarios] = useState<CalendarioDisponivel[] | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(atual?.calendarioId ?? null);
  const [lembrete, setLembrete] = useState<number | null>(atual ? atual.lembreteMin : LEMBRETE_PADRAO_MIN);
  const [mostrarValor, setMostrarValor] = useState(atual?.mostrarValor ?? false);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    prov
      .permissao()
      .then((p) => vivo && setPermissao(p))
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não consegui ler a permissão."));
    return () => {
      vivo = false;
    };
  }, [prov]);

  useEffect(() => {
    if (permissao !== "concedida") return;
    let vivo = true;
    prov
      .listaCalendarios()
      .then((lista) => {
        if (!vivo) return;
        setCalendarios(lista);
        setEscolhido((atualId) => (atualId && lista.some((c) => c.id === atualId) ? atualId : (lista.find((c) => c.principal) ?? lista[0])?.id ?? null));
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não consegui listar os calendários."));
    return () => {
      vivo = false;
    };
  }, [prov, permissao]);

  async function confirma() {
    const calendario = calendarios?.find((c) => c.id === escolhido);
    if (!calendario) return;
    setTrabalhando(true);
    setErro(null);
    try {
      const r = await conectaCalendario(db, prov, { calendario, lembreteMin: lembrete, mostrarValor });
      await onConcluido(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui conectar.");
      setTrabalhando(false);
    }
  }

  return (
    <Folha
      titulo={atual ? "Alterar o calendário" : "Conectar o calendário"}
      subtitulo="Escolha onde os plantões aparecem"
      onFechar={onFechar}
      acoes={
        permissao === "concedida" && calendarios && calendarios.length > 0 ? (
          <View style={{ gap: t.spacing.sm }}>
            {erro && (
              <Txt variant="label" tom="danger">
                {erro}
              </Txt>
            )}
            <Button icone="sync" largura="cheia" disabled={!escolhido || trabalhando} onPress={confirma}>
              {trabalhando ? "Sincronizando…" : atual ? "Salvar e sincronizar" : "Conectar e sincronizar"}
            </Button>
            <Button variant="secondary" largura="cheia" onPress={onFechar} disabled={trabalhando}>
              Cancelar
            </Button>
          </View>
        ) : (
          <Button variant="secondary" largura="cheia" onPress={onFechar}>
            Fechar
          </Button>
        )
      }
    >
      {permissao === null && erro === null && (
        <Txt variant="label" tom="muted">
          Verificando…
        </Txt>
      )}
      {erro !== null && permissao === null && (
        <Txt variant="label" tom="danger">
          {erro}
        </Txt>
      )}

      {permissao === "pergunta" && (
        <View style={{ gap: t.spacing.md }}>
          <Txt variant="label" tom="muted">
            Para colocar os plantões no calendário, o Android precisa da sua permissão. O app só mexe nos eventos que ele
            mesmo criou.
          </Txt>
          <Button icone="shield-check-outline" onPress={() => prov.pedePermissao().then(setPermissao)}>
            Permitir acesso ao calendário
          </Button>
        </View>
      )}

      {permissao === "negada" && (
        <View style={{ gap: t.spacing.md }}>
          <Txt variant="label" tom="danger">
            O acesso ao calendário está bloqueado. Libere em Configurações do aplicativo → Permissões → Agenda (em alguns celulares o nome é Calendário).
          </Txt>
          <Button variant="secondary" icone="cog-outline" onPress={() => void Linking.openSettings()}>
            Abrir configurações do app
          </Button>
        </View>
      )}

      {permissao === "concedida" && calendarios === null && (
        <Txt variant="label" tom="muted">
          Procurando calendários…
        </Txt>
      )}

      {permissao === "concedida" && calendarios !== null && calendarios.length === 0 && (
        <Txt variant="label" tom="warning">
          Nenhum calendário em que o app possa escrever. Adicione sua conta Google nas configurações do celular (Contas) e
          ative a sincronização do calendário dela.
        </Txt>
      )}

      {permissao === "concedida" && calendarios !== null && calendarios.length > 0 && (
        <>
          <Txt variant="label" style={{ fontWeight: "600" }}>
            Calendário
          </Txt>
          <View role="radiogroup" style={{ gap: t.spacing.sm }}>
            {calendarios.map((c) => {
              const ativo = c.id === escolhido;
              return (
                <Pressable
                  key={c.id}
                  role="radio"
                  aria-checked={ativo}
                  onPress={() => setEscolhido(c.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: t.spacing.md,
                    padding: t.spacing.md,
                    borderRadius: t.radius.md,
                    borderWidth: ativo ? 2 : 1,
                    borderColor: ativo ? t.colors.primary : t.colors.borderStrong,
                    backgroundColor: ativo ? t.colors.primarySoft : t.colors.surface,
                  }}
                >
                  <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.cor ?? t.colors.textFaint }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Txt variant="bodyStrong" tom={ativo ? "primary" : "normal"}>
                      {c.nome}
                    </Txt>
                    {c.conta && (
                      <Txt variant="caption" tom="muted">
                        {c.conta}
                      </Txt>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Txt variant="caption" tom="faint">
            Dica: o calendário da sua conta Google faz os plantões aparecerem também no Google Calendar do computador e de
            outros aparelhos.
          </Txt>

          <Txt variant="label" style={{ fontWeight: "600", marginTop: t.spacing.sm }}>
            Lembrete
          </Txt>
          <View role="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm }}>
            {LEMBRETES.map((l) => (
              <Chip key={l.id} rotulo={l.rotulo} ativo={lembrete === l.minutos} onPress={() => setLembrete(l.minutos)} />
            ))}
          </View>
          <Txt variant="caption" tom="faint">
            Quem avisa é o próprio calendário do celular, no horário combinado — o Meu Plantão não precisa estar aberto.
          </Txt>

          <Txt variant="label" style={{ fontWeight: "600", marginTop: t.spacing.sm }}>
            Valor nas notas do evento
          </Txt>
          <Segmentado
            opcoes={[
              { valor: "nao", rotulo: "Não mostrar" },
              { valor: "sim", rotulo: "Mostrar" },
            ]}
            valor={mostrarValor ? "sim" : "nao"}
            onChange={(v) => setMostrarValor(v === "sim")}
          />
          <Txt variant="caption" tom={mostrarValor ? "warning" : "faint"}>
            {mostrarValor
              ? "O valor líquido e a data de recebimento ficam visíveis para quem tiver acesso a esse calendário."
              : "Por padrão o dinheiro fica só no app."}
          </Txt>
        </>
      )}
    </Folha>
  );
}

/* -------------------------------------------------------------------------- */

function FolhaParar({
  prov,
  eventos,
  onFechar,
  onConcluido,
}: {
  prov: ProvedorCalendario;
  eventos: number;
  onFechar: () => void;
  onConcluido: (mensagem: string) => void | Promise<void>;
}) {
  const t = useTheme();
  const db = useBanco();
  const [trabalhando, setTrabalhando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function para(removerEventos: boolean) {
    setTrabalhando(true);
    setErro(null);
    try {
      const r = await desconectaCalendario(db, prov, { removerEventos });
      await onConcluido(
        removerEventos
          ? `Sincronização desligada. ${plural(r.removidos, "evento removido", "eventos removidos")}${r.falhas ? `; ${plural(r.falhas, "não pôde ser removido", "não puderam ser removidos")}` : ""}.`
          : "Sincronização desligada. Os eventos continuam no calendário.",
      );
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui desligar.");
      setTrabalhando(false);
    }
  }

  return (
    <Folha
      titulo="Parar de sincronizar?"
      subtitulo={`O app criou ${plural(eventos, "evento", "eventos")} no calendário`}
      onFechar={onFechar}
      acoes={
        <View style={{ gap: t.spacing.sm }}>
          {erro && (
            <Txt variant="label" tom="danger">
              {erro}
            </Txt>
          )}
          <Button variant="danger" icone="calendar-remove-outline" largura="cheia" disabled={trabalhando} onPress={() => para(true)}>
            Parar e remover os eventos
          </Button>
          <Button variant="secondary" largura="cheia" disabled={trabalhando} onPress={() => para(false)}>
            Parar e manter os eventos
          </Button>
          <Button variant="ghost" largura="cheia" disabled={trabalhando} onPress={onFechar}>
            Cancelar
          </Button>
        </View>
      }
    >
      <Txt variant="label" tom="muted">
        Se mantiver, os eventos ficam no calendário como eventos comuns, sem ligação com o app: mudanças nos plantões não
        chegam mais a eles, e conectar de novo cria eventos novos.
      </Txt>
    </Folha>
  );
}
