// TerminalThemes.ts — Theme System for Pro Terminal Chart
// Supports 4 built-in themes with localStorage persistence

export interface TerminalTheme {
  id: string;
  name: string;
  label: string;
  // Chart
  background: string;
  gridLines: string;
  textColor: string;
  borderColor: string;
  crosshairColor: string;
  // Candlesticks
  candleUp: string;
  candleDown: string;
  wickUp: string;
  wickDown: string;
  // Volume
  volumeUp: string;
  volumeDown: string;
  // Overlays / Indicators
  smaColor: string;
  vwapColor: string;
  // UI Chrome
  panelBg: string;
  panelBorder: string;
  panelText: string;
  panelTextDim: string;
  accent: string;
  accentDim: string;
  // Toolbar
  toolbarBg: string;
  toolbarBorder: string;
  toolbarIcon: string;
  toolbarIconActive: string;
  toolbarActiveBg: string;
  // Price change colors
  priceUp: string;
  priceDown: string;
  // Drawing
  drawingDefault: string;
  fibColor: string;
  fibFill: string;
}

export const THEMES: Record<string, TerminalTheme> = {
  'pro-dark': {
    id: 'pro-dark',
    name: 'Pro Dark',
    label: 'Kiyotaka',
    background: '#0a0a0c',
    gridLines: '#141418',
    textColor: '#9ca3af',
    borderColor: '#1f1f24',
    crosshairColor: '#4b5563',
    candleUp: '#f97316',
    candleDown: '#3f3f46',
    wickUp: '#f97316',
    wickDown: '#52525b',
    volumeUp: 'rgba(249, 115, 22, 0.35)',
    volumeDown: 'rgba(63, 63, 70, 0.35)',
    smaColor: '#6366f1',
    vwapColor: '#f59e0b',
    panelBg: '#0e0e11',
    panelBorder: '#1f1f24',
    panelText: '#e5e7eb',
    panelTextDim: '#6b7280',
    accent: '#f97316',
    accentDim: 'rgba(249, 115, 22, 0.15)',
    toolbarBg: '#0e0e11',
    toolbarBorder: '#1f1f24',
    toolbarIcon: '#6b7280',
    toolbarIconActive: '#f97316',
    toolbarActiveBg: 'rgba(249, 115, 22, 0.12)',
    priceUp: '#f97316',
    priceDown: '#ef4444',
    drawingDefault: '#f97316',
    fibColor: '#f59e0b',
    fibFill: 'rgba(245, 158, 11, 0.06)',
  },

  'bloomberg': {
    id: 'bloomberg',
    name: 'Bloomberg',
    label: 'Bloomberg',
    background: '#000000',
    gridLines: '#111111',
    textColor: '#d4d4d8',
    borderColor: '#1c1c1c',
    crosshairColor: '#525252',
    candleUp: '#22c55e',
    candleDown: '#ef4444',
    wickUp: '#22c55e',
    wickDown: '#ef4444',
    volumeUp: 'rgba(34, 197, 94, 0.35)',
    volumeDown: 'rgba(239, 68, 68, 0.35)',
    smaColor: '#f59e0b',
    vwapColor: '#06b6d4',
    panelBg: '#050505',
    panelBorder: '#1c1c1c',
    panelText: '#fbbf24',
    panelTextDim: '#78716c',
    accent: '#22c55e',
    accentDim: 'rgba(34, 197, 94, 0.12)',
    toolbarBg: '#050505',
    toolbarBorder: '#1c1c1c',
    toolbarIcon: '#78716c',
    toolbarIconActive: '#22c55e',
    toolbarActiveBg: 'rgba(34, 197, 94, 0.12)',
    priceUp: '#22c55e',
    priceDown: '#ef4444',
    drawingDefault: '#22c55e',
    fibColor: '#fbbf24',
    fibFill: 'rgba(251, 191, 36, 0.06)',
  },

  'cyberpunk': {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    label: 'Cyberpunk',
    background: '#0c0a1a',
    gridLines: '#151228',
    textColor: '#c4b5fd',
    borderColor: '#1e1b4b',
    crosshairColor: '#6d28d9',
    candleUp: '#06b6d4',
    candleDown: '#ec4899',
    wickUp: '#22d3ee',
    wickDown: '#f472b6',
    volumeUp: 'rgba(6, 182, 212, 0.35)',
    volumeDown: 'rgba(236, 72, 153, 0.35)',
    smaColor: '#a78bfa',
    vwapColor: '#fbbf24',
    panelBg: '#0c0a1a',
    panelBorder: '#1e1b4b',
    panelText: '#e0e7ff',
    panelTextDim: '#7c3aed',
    accent: '#06b6d4',
    accentDim: 'rgba(6, 182, 212, 0.12)',
    toolbarBg: '#0c0a1a',
    toolbarBorder: '#1e1b4b',
    toolbarIcon: '#7c3aed',
    toolbarIconActive: '#06b6d4',
    toolbarActiveBg: 'rgba(6, 182, 212, 0.12)',
    priceUp: '#06b6d4',
    priceDown: '#ec4899',
    drawingDefault: '#06b6d4',
    fibColor: '#a78bfa',
    fibFill: 'rgba(167, 139, 250, 0.06)',
  },

  'koyfin': {
    id: 'koyfin',
    name: 'Koyfin Slate',
    label: 'Koyfin',
    background: '#131722',
    gridLines: '#1c2030',
    textColor: '#a1a7bb',
    borderColor: '#232840',
    crosshairColor: '#4c5575',
    candleUp: '#10b981',
    candleDown: '#f43f5e',
    wickUp: '#10b981',
    wickDown: '#f43f5e',
    volumeUp: 'rgba(16, 185, 129, 0.3)',
    volumeDown: 'rgba(244, 63, 94, 0.3)',
    smaColor: '#3b82f6',
    vwapColor: '#f59e0b',
    panelBg: '#131722',
    panelBorder: '#232840',
    panelText: '#d1d5db',
    panelTextDim: '#6b7280',
    accent: '#3b82f6',
    accentDim: 'rgba(59, 130, 246, 0.12)',
    toolbarBg: '#131722',
    toolbarBorder: '#232840',
    toolbarIcon: '#6b7280',
    toolbarIconActive: '#3b82f6',
    toolbarActiveBg: 'rgba(59, 130, 246, 0.12)',
    priceUp: '#10b981',
    priceDown: '#f43f5e',
    drawingDefault: '#3b82f6',
    fibColor: '#f59e0b',
    fibFill: 'rgba(245, 158, 11, 0.06)',
  },
};

export const THEME_IDS = Object.keys(THEMES);

const STORAGE_KEY = 'vrp-terminal-theme';

export function getSavedThemeId(): string {
  if (typeof window === 'undefined') return 'pro-dark';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES[saved]) return saved;
  } catch {}
  return 'pro-dark';
}

export function saveThemeId(themeId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, themeId);
  } catch {}
}

export function getTheme(id?: string): TerminalTheme {
  const themeId = id || getSavedThemeId();
  return THEMES[themeId] || THEMES['pro-dark'];
}
