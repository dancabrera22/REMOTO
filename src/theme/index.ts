import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { themes, type Theme, type ThemeName } from "./tokens";

const ThemeContext = createContext<Theme>(themes.light);

/**
 * Segue o tema do sistema. A Etapa 7 acrescenta a opcao de fixar claro ou
 * escuro em Ajustes; o contexto ja esta aqui para isso nao exigir refatoracao.
 */
export function AppThemeProvider({ children, force }: { children: ReactNode; force?: ThemeName }) {
  const scheme = useColorScheme();
  const name: ThemeName = force ?? (scheme === "dark" ? "dark" : "light");
  const theme = useMemo(() => themes[name], [name]);
  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export * from "./tokens";
