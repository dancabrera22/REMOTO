import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { Tabs } from "expo-router/tabs";
import { StyleSheet, type ColorValue } from "react-native";
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
