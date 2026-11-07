import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColorScheme = 'system' | 'light' | 'dark';
export type Theme = 'monaco' | 'darcula';

export interface Appearance {
  colorScheme: ColorScheme;
  lightTheme: Theme;
  darkTheme: Theme;
}

export function parseAppearance(value: unknown): Appearance {
  const saved = value as Partial<Appearance> | null;
  return {
    colorScheme:
      saved?.colorScheme === 'light' || saved?.colorScheme === 'dark'
        ? saved.colorScheme
        : 'system',
    lightTheme: saved?.lightTheme === 'darcula' ? 'darcula' : 'monaco',
    darkTheme: saved?.darkTheme === 'darcula' ? 'darcula' : 'monaco',
  };
}

export function resolveAppearance(appearance: Appearance, systemDark: boolean) {
  const scheme =
    appearance.colorScheme === 'system' ? (systemDark ? 'dark' : 'light') : appearance.colorScheme;
  return { scheme, theme: scheme === 'dark' ? appearance.darkTheme : appearance.lightTheme };
}

export const useAppearance = create(
  persist(() => parseAppearance(null), {
    name: 'superfluid:appearance',
    merge: (saved) => parseAppearance(saved),
  }),
);

export const useSystemDark = create(
  () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
);

export function editorTheme(appearance: Appearance, systemDark: boolean) {
  const { scheme, theme } = resolveAppearance(appearance, systemDark);
  return theme === 'monaco' ? (scheme === 'dark' ? 'vs-dark' : 'vs') : `darcula-${scheme}`;
}
