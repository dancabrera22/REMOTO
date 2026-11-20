/**
 * As notificacoes agendadas do aparelho, pelo `expo-notifications`.
 *
 * Camada fina de proposito: o que agendar e quando esta em `lib/lembretes.ts` e a conversa com o
 * sistema (criar, trocar, cancelar) em `db/lembretes.ts`, ambos provados em Node. Aqui so se
 * traduz para o modulo nativo, que so existe no Android/iOS.
 */
import type { PermissaoLembretes, ProvedorLembretes } from "@/db/lembretes";
import { ehLembreteDoApp } from "./lembretes";

type Modulo = typeof import("expo-notifications");

let carregando: Promise<Modulo> | null = null;
/** Carrega o modulo so quando preciso: na web ele nao agenda nada e importa-lo cedo quebraria a tela. */
const modulo = (): Promise<Modulo> => (carregando ??= import("expo-notifications"));

/** O canal e criado antes da primeira notificacao (no Android 8+ sem canal ela nem aparece). */
export const CANAL_LEMBRETES = "lembretes";
let canalPronto: Promise<unknown> | null = null;

async function garanteCanal(N: Modulo) {
  canalPronto ??= N.setNotificationChannelAsync(CANAL_LEMBRETES, {
    name: "Lembretes de plantão",
    description: "Aviso antes de cada plantão",
    importance: N.AndroidImportance.HIGH,
    lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC,
  }).catch((e) => {
    canalPronto = null;
    throw e;
  });
  await canalPronto;
}

const traduz = (p: { granted: boolean; canAskAgain: boolean }): PermissaoLembretes =>
  p.granted ? "concedida" : p.canAskAgain ? "pergunta" : "negada";

/** Com o app aberto o aviso tambem aparece (a pessoa pediu o lembrete). */
export async function preparaNotificacoes(): Promise<void> {
  const N = await modulo();
  N.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** Id do plantao que o aviso carrega (`lp:<id>:...`), ou `null` se a notificacao nao e do app. */
export function plantaoDoIdentificador(id: string): number | null {
  if (!ehLembreteDoApp(id)) return null;
  const n = Number(id.split(":")[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function criaProvedorDeLembretesExpo(): ProvedorLembretes {
  return {
    async permissao() {
      return traduz(await (await modulo()).getPermissionsAsync());
    },
    async pedePermissao() {
      const N = await modulo();
      await garanteCanal(N);
      return traduz(await N.requestPermissionsAsync());
    },
    async listaAgendados() {
      const N = await modulo();
      return (await N.getAllScheduledNotificationsAsync()).map((n) => n.identifier).filter(ehLembreteDoApp);
    },
    async agenda(l) {
      const N = await modulo();
      await garanteCanal(N);
      await N.scheduleNotificationAsync({
        identifier: l.id,
        content: { title: l.titulo, body: l.corpo, data: { plantaoId: l.plantaoId } },
        trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: new Date(l.quando), channelId: CANAL_LEMBRETES },
      });
    },
    async cancela(ids) {
      const N = await modulo();
      for (const id of ids) await N.cancelScheduledNotificationAsync(id);
    },
    async testeAgora(titulo, corpo, emSegundos) {
      const N = await modulo();
      await garanteCanal(N);
      // Sem identificador do app: a sincronizacao nao mexe nele.
      await N.scheduleNotificationAsync({
        content: { title: titulo, body: corpo },
        trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(1, emSegundos), channelId: CANAL_LEMBRETES },
      });
    },
  };
}

/**
 * Chama `aoAbrir(plantaoId)` quando a pessoa toca num aviso do app — inclusive o toque que ABRIU o
 * app (ele ja tinha acontecido quando esta funcao roda). Cada notificacao e tratada uma vez so.
 */
export function assinaToquesNosAvisos(aoAbrir: (plantaoId: number) => void): () => void {
  let vivo = true;
  let assinatura: { remove(): void } | null = null;
  let ultimo: string | null = null;

  const trata = (r: { notification: { request: { identifier: string } } } | null) => {
    if (!r || !vivo) return;
    const id = r.notification.request.identifier;
    if (id === ultimo) return;
    const plantao = plantaoDoIdentificador(id);
    if (plantao === null) return;
    ultimo = id;
    aoAbrir(plantao);
  };

  void modulo().then(async (N) => {
    if (!vivo) return;
    assinatura = N.addNotificationResponseReceivedListener(trata);
    trata(await N.getLastNotificationResponseAsync().catch(() => null));
  });

  return () => {
    vivo = false;
    assinatura?.remove();
  };
}
