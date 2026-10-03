/**
 * Pure colour data for the 7 CronAI themes. No React Native import, so the
 * framework-free web widget can share it with the React Native component.
 */
export interface Palette {
  name: string;
  label: string;
  dark: boolean;
  radius?: { sm: number; md: number; lg: number; xl: number };
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    textFaint: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    success: string;
    warning: string;
    danger: string;
    /** minute, hour, day-of-month, month, day-of-week */
    fields: [string, string, string, string, string];
    roles: { interval: string; time: string; day: string; month: string; except: string };
    shadow: string;
  };
}

export const DEFAULT_RADIUS = { sm: 8, md: 12, lg: 18, xl: 26 };

export const PALETTES = {
  aurora: {
    name: 'aurora',
    label: 'Aurora',
    dark: true,
    colors: {
      background: '#070B1A',
      surface: '#10172E',
      surfaceAlt: '#18213F',
      border: '#26305A',
      text: '#EEF2FF',
      textMuted: '#A3ADD6',
      textFaint: '#6B76A6',
      accent: '#8B9BFF',
      accentSoft: 'rgba(139,155,255,0.16)',
      onAccent: '#0A0F24',
      success: '#2EE6C5',
      warning: '#FFC46B',
      danger: '#FF7A90',
      fields: ['#8B9BFF', '#2EE6C5', '#FFB86B', '#FF7AC6', '#7FD8FF'],
      roles: { interval: '#8B9BFF', time: '#2EE6C5', day: '#FFB86B', month: '#FF7AC6', except: '#FF7A90' },
      shadow: '#000000',
    },
  },
  paper: {
    name: 'paper',
    label: 'Paper',
    dark: false,
    colors: {
      background: '#F4F0E8',
      surface: '#FFFDF9',
      surfaceAlt: '#F1ECE2',
      border: '#E3DCCF',
      text: '#1E1A15',
      textMuted: '#6B6358',
      textFaint: '#A39A8C',
      accent: '#C2410C',
      accentSoft: 'rgba(194,65,12,0.10)',
      onAccent: '#FFFFFF',
      success: '#2F7D4F',
      warning: '#B7791F',
      danger: '#C53030',
      fields: ['#C2410C', '#2F7D4F', '#1D63B8', '#8E3BB0', '#B7791F'],
      roles: { interval: '#C2410C', time: '#2F7D4F', day: '#1D63B8', month: '#8E3BB0', except: '#C53030' },
      shadow: '#6B5A3E',
    },
  },
  terminal: {
    name: 'terminal',
    label: 'Terminal',
    dark: true,
    radius: { sm: 4, md: 6, lg: 8, xl: 10 },
    colors: {
      background: '#000000',
      surface: '#070C08',
      surfaceAlt: '#0D1710',
      border: '#1B3322',
      text: '#D6FFE1',
      textMuted: '#7DB38E',
      textFaint: '#4A7356',
      accent: '#39FF88',
      accentSoft: 'rgba(57,255,136,0.12)',
      onAccent: '#001A0A',
      success: '#39FF88',
      warning: '#F5D547',
      danger: '#FF5F56',
      fields: ['#39FF88', '#5CE1E6', '#F5D547', '#FF9F43', '#C792EA'],
      roles: { interval: '#39FF88', time: '#5CE1E6', day: '#F5D547', month: '#FF9F43', except: '#FF5F56' },
      shadow: '#000000',
    },
  },
  sunset: {
    name: 'sunset',
    label: 'Sunset',
    dark: true,
    colors: {
      background: '#170C12',
      surface: '#24141C',
      surfaceAlt: '#311C26',
      border: '#4A2A38',
      text: '#FFF0EA',
      textMuted: '#D4A5A5',
      textFaint: '#8F6670',
      accent: '#FF7A59',
      accentSoft: 'rgba(255,122,89,0.15)',
      onAccent: '#2A0E08',
      success: '#6EE7B7',
      warning: '#FFC15E',
      danger: '#FF5D8F',
      fields: ['#FF7A59', '#FFC15E', '#FF5D8F', '#B79CFF', '#6EE7B7'],
      roles: { interval: '#FF7A59', time: '#FFC15E', day: '#FF5D8F', month: '#B79CFF', except: '#FF8A8A' },
      shadow: '#000000',
    },
  },
  glacier: {
    name: 'glacier',
    label: 'Glacier',
    dark: false,
    colors: {
      background: '#EAF1F8',
      surface: '#FFFFFF',
      surfaceAlt: '#EEF3F9',
      border: '#D3DEEA',
      text: '#14202E',
      textMuted: '#556579',
      textFaint: '#94A3B5',
      accent: '#2563EB',
      accentSoft: 'rgba(37,99,235,0.09)',
      onAccent: '#FFFFFF',
      success: '#0E9F8E',
      warning: '#D97706',
      danger: '#DC2647',
      fields: ['#2563EB', '#0E9F8E', '#D97706', '#DB2777', '#7C3AED'],
      roles: { interval: '#2563EB', time: '#0E9F8E', day: '#D97706', month: '#DB2777', except: '#DC2647' },
      shadow: '#1E3A5F',
    },
  },
  forest: {
    name: 'forest',
    label: 'Forest',
    dark: true,
    colors: {
      background: '#0B120F',
      surface: '#131D18',
      surfaceAlt: '#1A2A22',
      border: '#29402F',
      text: '#E9F5EC',
      textMuted: '#9DB8A5',
      textFaint: '#5F7A67',
      accent: '#86D99A',
      accentSoft: 'rgba(134,217,154,0.14)',
      onAccent: '#0B1A10',
      success: '#86D99A',
      warning: '#E9C46A',
      danger: '#F28482',
      fields: ['#86D99A', '#A3D9FF', '#E9C46A', '#F4A261', '#CDB4DB'],
      roles: { interval: '#86D99A', time: '#A3D9FF', day: '#E9C46A', month: '#F4A261', except: '#F28482' },
      shadow: '#000000',
    },
  },
  candy: {
    name: 'candy',
    label: 'Candy',
    dark: false,
    radius: { sm: 12, md: 18, lg: 24, xl: 32 },
    colors: {
      background: '#FFF1F8',
      surface: '#FFFFFF',
      surfaceAlt: '#FDEAF4',
      border: '#F6D3E6',
      text: '#38152E',
      textMuted: '#8C5E7E',
      textFaint: '#C49BB6',
      accent: '#E2459B',
      accentSoft: 'rgba(226,69,155,0.10)',
      onAccent: '#FFFFFF',
      success: '#20A86B',
      warning: '#E08A00',
      danger: '#E03131',
      fields: ['#E2459B', '#7A5AF8', '#12A8C0', '#E08A00', '#20A86B'],
      roles: { interval: '#E2459B', time: '#7A5AF8', day: '#12A8C0', month: '#E08A00', except: '#E03131' },
      shadow: '#9C3D72',
    },
  },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;
export const PALETTE_NAMES = Object.keys(PALETTES) as PaletteName[];
