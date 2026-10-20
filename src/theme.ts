import React, { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { keys } from './storage/keys';
import { load, save } from './storage/store';

export const lightColors = {
  primary: '#006B5E', onPrimary: '#FFFFFF', primaryContainer: '#B5F1E4', onPrimaryContainer: '#00201B',
  secondary: '#4A635E', onSecondary: '#FFFFFF', secondaryContainer: '#CDE8E0', onSecondaryContainer: '#06201B',
  tertiary: '#3D617B', onTertiary: '#FFFFFF', tertiaryContainer: '#C7E7FF', error: '#BA1A1A', onError: '#FFFFFF',
  surface: '#F8FAF7', onSurface: '#191D1B', onSurfaceVariant: '#404945', surfaceContainerLowest: '#FFFFFF',
  surfaceContainerLow: '#F1F4F1', surfaceContainer: '#EAEEEB', surfaceContainerHigh: '#E4E9E5',
  surfaceContainerHighest: '#DEE4E0', outline: '#707A75', outlineVariant: '#C0CBC5', inverseSurface: '#2E3230',
  inverseOnSurface: '#EFF1EE', warning: '#795900', warningContainer: '#FFDF9E', success: '#176B4A',
  ink: '#191D1B', teal: '#006B5E', tealDark: '#00574D', mint: '#CDE8E0', paper: '#FFFFFF', canvas: '#F8FAF7',
  muted: '#59635E', line: '#C0CBC5', amber: '#795900', amberBg: '#FFDF9E', red: '#BA1A1A', blue: '#3D617B',
  navy: '#123E37', soft: '#F1F4F1', lime: '#B5F1E4', forestMuted: '#CDE8E0', sand: '#F7F2E7',
} as const;

export const darkColors: Record<keyof typeof lightColors, string> = {
  primary: '#8DD8C8', onPrimary: '#00372F', primaryContainer: '#005047', onPrimaryContainer: '#B5F1E4',
  secondary: '#B3CCC5', onSecondary: '#203530', secondaryContainer: '#354B45', onSecondaryContainer: '#CDE8E0',
  tertiary: '#A9CBE5', onTertiary: '#183247', tertiaryContainer: '#28485E', error: '#FFB4AB', onError: '#690005',
  surface: '#111714', onSurface: '#E0E5E1', onSurfaceVariant: '#C0C9C3', surfaceContainerLowest: '#0D120F',
  surfaceContainerLow: '#171E1A', surfaceContainer: '#1B231F', surfaceContainerHigh: '#252D29',
  surfaceContainerHighest: '#303934', outline: '#89948E', outlineVariant: '#414B45', inverseSurface: '#E0E5E1',
  inverseOnSurface: '#2E3230', warning: '#E7C36B', warningContainer: '#594500', success: '#8ED5AE',
  ink: '#E0E5E1', teal: '#8DD8C8', tealDark: '#A3E6D7', mint: '#263C35', paper: '#171E1A', canvas: '#111714',
  muted: '#B0BAB4', line: '#414B45', amber: '#E7C36B', amberBg: '#594500', red: '#FFB4AB', blue: '#A9CBE5',
  navy: '#102E29', soft: '#171E1A', lime: '#B5F1E4', forestMuted: '#CDE8E0', sand: '#28271F',
};

export type Palette = typeof lightColors;
export const colors: Palette = lightColors;
type ThemeContextValue = { dark: boolean; colors: Palette; setDark: (value: boolean) => void };
const ThemeContext = createContext<ThemeContextValue>({ dark: false, colors: lightColors, setDark: () => {} });

export function ThemeProvider({ children }: React.PropsWithChildren) {
  const [dark, setDarkState] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    load(keys.theme)
      .then(preference => { if (active) setDarkState(preference.dark); })
      .catch(() => {})
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (ready) save(keys.theme, { dark });
  }, [dark, ready]);
  const setDark = useCallback((value: boolean) => setDarkState(value), []);
  const value = useMemo(() => ({ dark, colors: (dark ? darkColors : lightColors) as Palette, setDark }), [dark, setDark]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme() { return useContext(ThemeContext); }
