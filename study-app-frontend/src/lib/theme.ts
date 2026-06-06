// Design tokens lifted from study-app-frontend/project/wf/styles.css in the
// wireframe handoff. Light palette is the locked design; dark palette mirrors
// it (paper -> charcoal, ink -> warm white) while preserving the accent blue.
//
// Components use `useTheme()` to get the active palette. F (fonts) and R
// (radii) stay static because typography and shape are locked.

import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SystemUI from 'expo-system-ui';

export type Palette = {
  paper: string;
  paper2: string;
  card: string;
  card2: string;
  ink: string;
  ink2: string;
  ink3: string;
  grey: string;
  grey2: string;
  line: string;
  accent: string;
  accentD: string;
  accentSoft: string;
  accentInk: string;
  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  err: string;
  errSoft: string;
};

export const LIGHT: Palette = {
  paper: '#eceadf',
  paper2: '#e4e1d4',
  card: '#fbfaf6',
  card2: '#f3f1ea',
  ink: '#2a2823',
  ink2: '#6f6a5c',
  ink3: '#9a9486',
  grey: '#dcd7cb',
  grey2: '#cbc5b6',
  line: '#bdb6a4',
  accent: '#3a5ba0',
  accentD: '#2b457c',
  accentSoft: '#e2e8f4',
  accentInk: '#2b457c',
  ok: '#3f7d56',
  okSoft: '#e0ede4',
  warn: '#b3742a',
  warnSoft: '#f1e6d4',
  err: '#a8472f',
  errSoft: '#f0dfd9',
};

export const DARK: Palette = {
  paper: '#1c1d20',
  paper2: '#16171a',
  card: '#25272b',
  card2: '#2d2f34',
  ink: '#ece9df',
  ink2: '#a8a39a',
  ink3: '#7a766e',
  grey: '#3a3c40',
  grey2: '#4a4d52',
  line: '#52555a',
  accent: '#7f9fde',
  accentD: '#5b78b8',
  accentSoft: '#2c3a55',
  accentInk: '#cbd9f0',
  ok: '#7fbf90',
  okSoft: '#22382a',
  warn: '#d8a063',
  warnSoft: '#3c2f1e',
  err: '#e57858',
  errSoft: '#3c241e',
};

export const F = {
  // Caveat clips descenders on Android no matter the lineHeight tuning.
  // Kalam is the same handwritten family with clean Android metrics, already
  // loaded for the "note" face, so we route F.hand to it.
  hand: 'Kalam_700Bold',
  handReg: 'Kalam_400Regular',
  note: 'Kalam_400Regular',
  noteBold: 'Kalam_700Bold',
} as const;

export const R = { sm: 6, md: 10, lg: 14, xl: 18, pill: 999 } as const;

export type ThemeMode = 'light' | 'dark' | 'system';

// Text-size override for the whole app. 1.0 = the default sizes baked
// into T variants; 1.18 = "larger text" mode. The T component multiplies
// every variant's fontSize / lineHeight / paddingBottom by this scale.
// Two levels keeps the toggle simple — on/off — while still making a
// visible difference on small screens.
export const TEXT_SCALE_DEFAULT = 1.0;
export const TEXT_SCALE_LARGE = 1.18;

type ThemeCtx = {
  colors: Palette;
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
  largerText: boolean;
  setLargerText: (v: boolean) => void;
  textScale: number;
};

const STORAGE_KEY = 'studae.themeMode';
const TEXT_KEY = 'studae.largerText';

const Ctx = createContext<ThemeCtx>({
  colors: LIGHT,
  mode: 'system',
  resolved: 'light',
  setMode: () => {},
  largerText: false,
  setLargerText: () => {},
  textScale: TEXT_SCALE_DEFAULT,
});

export function useTheme(): Palette {
  return useContext(Ctx).colors;
}

export function useThemeMode(): ThemeCtx {
  return useContext(Ctx);
}

// Cheap convenience hook for components that only need the scale (T).
export function useTextScale(): number {
  return useContext(Ctx).textScale;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [largerText, setLargerTextState] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(TEXT_KEY),
    ]).then(([m, t]) => {
      if (m === 'light' || m === 'dark' || m === 'system') setModeState(m);
      if (t === '1') setLargerTextState(true);
      setHydrated(true);
    });
  }, []);

  function setMode(m: ThemeMode) {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => {});
  }
  function setLargerText(v: boolean) {
    setLargerTextState(v);
    AsyncStorage.setItem(TEXT_KEY, v ? '1' : '0').catch(() => {});
  }

  const resolved: 'light' | 'dark' = mode === 'system'
    ? (system === 'dark' ? 'dark' : 'light')
    : mode;
  const colors = resolved === 'dark' ? DARK : LIGHT;
  const textScale = largerText ? TEXT_SCALE_LARGE : TEXT_SCALE_DEFAULT;

  // Set the native window background so the OS doesn't paint a white frame
  // during stack transitions (e.g. when the user presses the phone's back
  // button in dark mode, you'd otherwise see a white flash before the
  // destination screen draws).
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.paper).catch(() => {});
  }, [colors.paper]);

  if (!hydrated) return null;

  return createElement(
    Ctx.Provider,
    {
      value: {
        colors, mode, resolved, setMode,
        largerText, setLargerText, textScale,
      },
    },
    children,
  );
}

// Legacy static export. Kept so that any code that still references `C` keeps
// compiling, but always resolves to the LIGHT palette. New code should use
// `const C = useTheme()` so it reacts to dark mode.
export const C: Palette = LIGHT;
