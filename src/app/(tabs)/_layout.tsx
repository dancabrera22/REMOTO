import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router/tabs";
import { StyleSheet, type ColorValue } from "react-native";
import { listaPlantoesFinanceiro } from "@/db/financeiro";
import { useConsulta } from "@/db/provider";
import { itensFinanceiros, resumoDosAtrasos } from "@/lib/financeiro";
import { useTheme } from "@/theme";

type NomeIcone = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * Quatro abas, e so quatro.
 *
 * Agenda e o que se abre dez vezes por dia; Locais e cadastro, usado de vez em
 * quando; Financeiro responde a pergunta que motiva o app; Ajustes guarda
 * calendario e backup. Qualquer coisa alem disso vira submenu, nao aba.
 */
export default function TabsLayout() {
  const t = useTheme();

  // O unico aviso de atraso que existe fora da aba: um numero no icone do Financeiro.
  // Nao e notificacao (o app nunca fala sozinho); quem quiser lembrete tem o calendario do celular.
  const financeiro = useConsulta((db) => listaPlantoesFinanceiro(db), []);
  const atrasados = financeiro.status === "pronto" ? resumoDosAtrasos(itensFinanceiros(financeiro.dados)).plantoes : 0;

  const icone =
    (nome: NomeIcone, nomeAtivo?: NomeIcone) =>
    ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
      <MaterialCommunityIcons
        name={focused ? (nomeAtivo ?? nome) : nome}
        size={size}
        color={color as string}
      />
    );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.colors.primary,
        tabBarInactiveTintColor: t.colors.textFaint,
        tabBarStyle: {
          backgroundColor: t.colors.surface,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: t.colors.border,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarIconStyle: { marginTop: 2 },
        sceneStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Agenda",
          tabBarIcon: icone("calendar-blank-outline", "calendar-month"),
        }}
      />
      <Tabs.Screen
        name="locais"
        options={{
          title: "Locais",
          tabBarIcon: icone("map-marker-outline", "map-marker"),
        }}
      />
      <Tabs.Screen
        name="financeiro"
        options={{
          title: "Financeiro",
          tabBarIcon: icone("cash-multiple", "cash-multiple"),
          tabBarBadge: atrasados > 0 ? (atrasados > 99 ? "99+" : atrasados) : undefined,
          tabBarBadgeStyle: { backgroundColor: t.colors.danger, color: t.colors.primaryOn, fontSize: 10, fontWeight: "700" },
          tabBarAccessibilityLabel: atrasados > 0 ? `Financeiro, ${atrasados} em atraso` : "Financeiro",
        }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{
          title: "Ajustes",
          tabBarIcon: icone("cog-outline", "cog"),
        }}
      />
    </Tabs>
  );
}
