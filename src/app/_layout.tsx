import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { executorDe } from "@/db/client";
import { sincronizaSemSobrepor } from "@/db/calendario";
import { sincronizaLembretesSemSobrepor } from "@/db/lembretes";
import { BancoProvider, useEstadoBanco, useRevisao } from "@/db/provider";
import { obtemProvedorDeCalendario } from "@/lib/calendario-provedor";
import { assinaToquesNosAvisos, preparaNotificacoes } from "@/lib/lembretes-expo";
import { obtemProvedorDeLembretes } from "@/lib/lembretes-provedor";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { TemaDoApp, useEscolhaDeTema } from "@/theme/escolha";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <BancoProvider>
        <TemaDoApp>
          <Conteudo />
        </TemaDoApp>
      </BancoProvider>
    </SafeAreaProvider>
  );
}

/**
 * Mantem o calendario do celular em dia sem a pessoa pensar nisso: sincroniza
 * pouco depois de qualquer mudanca nos dados (esperando a rajada de edicoes
 * acabar) e quando o app volta para o primeiro plano. Sem calendario conectado,
 * cada chamada e uma consulta so e nao faz nada.
 */
function SincronizadorDoCalendario() {
  const banco = useEstadoBanco();
  const revisao = useRevisao();

  useEffect(() => {
    if (banco.status !== "pronto") return;
    const prov = obtemProvedorDeCalendario();
    if (!prov) return;

    const roda = () => void sincronizaSemSobrepor(executorDe(banco.db), prov).catch(() => undefined);
    const espera = setTimeout(roda, 2000);
    const assina = AppState.addEventListener("change", (estado) => estado === "active" && roda());
    return () => {
      clearTimeout(espera);
      assina.remove();
    };
  }, [banco, revisao]);

  return null;
}

/**
 * Mantem os avisos agendados em dia: sincroniza pouco depois de qualquer mudanca nos dados e quando
 * o app volta para o primeiro plano (assim o prazo de 45 dias anda). Desligado, e so uma consulta.
 * Tambem abre o plantao quando a pessoa toca no aviso.
 */
function SincronizadorDeLembretes() {
  const banco = useEstadoBanco();
  const revisao = useRevisao();
  const router = useRouter();

  useEffect(() => {
    if (Platform.OS === "web") return;
    void preparaNotificacoes().catch(() => undefined);
    return assinaToquesNosAvisos((id) => router.push({ pathname: "/plantao/[id]", params: { id: String(id) } }));
  }, [router]);

  useEffect(() => {
    if (banco.status !== "pronto") return;
    const prov = obtemProvedorDeLembretes();
    if (!prov) return;

    const roda = () => void sincronizaLembretesSemSobrepor(executorDe(banco.db), prov).catch(() => undefined);
    const espera = setTimeout(roda, 2000);
    const assina = AppState.addEventListener("change", (estado) => estado === "active" && roda());
    return () => {
      clearTimeout(espera);
      assina.remove();
    };
  }, [banco, revisao]);

  return null;
}

function Conteudo() {
  const t = useTheme();
  const banco = useEstadoBanco();
  const { carregada } = useEscolhaDeTema();

  // A splash sai quando o banco terminou de abrir (ou falhou) e a escolha de tema foi
  // lida: assim ninguem ve a agenda piscar vazia, nem o tema errado por um instante.
  useEffect(() => {
    if (banco.status !== "carregando" && carregada) SplashScreen.hideAsync().catch(() => {});
  }, [banco.status, carregada]);

  return (
    <>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <SincronizadorDoCalendario />
      <SincronizadorDeLembretes />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.bg },
        }}
      />
    </>
  );
}
