import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { executorDe } from "@/db/client";
import { sincronizaSemSobrepor } from "@/db/calendario";
import { BancoProvider, useEstadoBanco, useRevisao } from "@/db/provider";
import { obtemProvedorDeCalendario } from "@/lib/calendario-provedor";
import { AppThemeProvider, useTheme } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppThemeProvider>
        <BancoProvider>
          <Conteudo />
        </BancoProvider>
      </AppThemeProvider>
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

function Conteudo() {
  const t = useTheme();
  const banco = useEstadoBanco();

  // A splash sai quando o banco terminou de abrir (ou falhou): assim ninguem ve
  // a agenda piscar vazia antes dos dados aparecerem.
  useEffect(() => {
    if (banco.status !== "carregando") SplashScreen.hideAsync().catch(() => {});
  }, [banco.status]);

  return (
    <>
      <StatusBar style={t.name === "dark" ? "light" : "dark"} />
      <SincronizadorDoCalendario />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.bg },
        }}
      />
    </>
  );
}
