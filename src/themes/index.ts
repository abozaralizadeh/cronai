import { Platform } from 'react-native';
import { DEFAULT_RADIUS, Palette, PALETTES, PaletteName } from './palettes';

export interface CronTheme extends Palette {
  radius: { sm: number; md: number; lg: number; xl: number };
  fonts: { mono: string; body?: string };
}

const MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
}) as string;

const BODY = Platform.select({
  ios: undefined,
  android: undefined,
  default: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif',
});

const toTheme = (p: Palette): CronTheme => ({ ...p, radius: p.radius ?? DEFAULT_RADIUS, fonts: { mono: MONO, body: BODY } });

export const themes = Object.fromEntries(Object.entries(PALETTES).map(([k, p]) => [k, toTheme(p)])) as Record<PaletteName, CronTheme>;

export type ThemeName = PaletteName;
export const THEME_NAMES = Object.keys(themes) as ThemeName[];

/** Build a custom theme from an existing one. */
export function createTheme(from: ThemeName | CronTheme, overrides: Partial<Omit<CronTheme, 'colors'>> & { colors?: Partial<CronTheme['colors']> }): CronTheme {
  const b = typeof from === 'string' ? themes[from] : from;
  return { ...b, ...overrides, colors: { ...b.colors, ...(overrides.colors ?? {}) } } as CronTheme;
}

export function resolveTheme(t: ThemeName | CronTheme | undefined): CronTheme {
  if (!t) return themes.aurora;
  if (typeof t === 'string') return themes[t] ?? themes.aurora;
  return t;
}
