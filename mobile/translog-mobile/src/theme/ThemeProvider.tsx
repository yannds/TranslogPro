import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors } from './colors';

export interface Theme {
  colors: typeof lightColors;
  isDark: boolean;
}

const LIGHT_THEME: Theme = { colors: lightColors, isDark: false };
const DARK_THEME:  Theme = { colors: darkColors,  isDark: true  };

const ThemeCtx = createContext<Theme>(LIGHT_THEME);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = scheme === 'dark' ? DARK_THEME : LIGHT_THEME;
  return <ThemeCtx.Provider value={theme}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeCtx);
}
