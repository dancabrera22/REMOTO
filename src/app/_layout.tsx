import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BancoProvider, useEstadoBanco } from "@/db/provider";
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
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.colors.bg },
        }}
      />
    </>
  );
}
