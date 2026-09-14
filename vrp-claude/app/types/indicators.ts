// ─── Indicator Type Definitions ───────────────────────────────────────────────
// Centralized types for all Pro Terminal indicators.
// Extend IndicatorConfig union when adding new indicator types.

export type MAType = 'SMA' | 'EMA' | 'WMA' | 'DEMA' | 'TEMA' | 'KAMA';

export type MASource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

export interface MovingAverageConfig {
  id: string;
  type: 'moving_average';
  enabled: boolean;

  // Calculation inputs
  maType: MAType;
  period: number;       // 1 – 500
  source: MASource;     // which price to use
  offset: number;       // bar shift: negative = left, positive = right
  kamaFast?: number;    // default 2 (for KAMA)
  kamaSlow?: number;    // default 30 (for KAMA)

  // Visual style
  color: string;        // hex color
  lineWidth: number;    // 1 – 5
  lineStyle: LineStyleType;
  opacity: number;      // 0.1 – 1.0

  // Label
  showLabel: boolean;
  labelPosition: 'left' | 'right';
}

export interface ICTSeekAndDestroyConfig {
  id: string;
  type: 'ict_snd';
  enabled: boolean;

  // Killzones (Sessions in HH:MM-HH:MM format, NY Time)
  asSession: string;
  asColor: string;
  loSession: string;
  loColor: string;
  nySession: string;
  nyColor: string;

  // Success Criteria
  crtInsideDay: boolean;
  crtOutsideDay: boolean;
  crtCloseInLo: boolean;
  crtSdLimit: boolean;
  sdLimit: number;

  // Labels
  showSndPre: boolean;
  sndPreColor: string;
  showSndDay: boolean;
  sndDayColor: string;

  // Warning (Table row)
  showWrnTable: boolean;
  wrnMsg: string;
  wrnText: string;
  wrnBg: string;

  // Statistics Table
  showStatTable: boolean;
  tablePosition: 'Top Right' | 'Top Left' | 'Bottom Right' | 'Bottom Left';
  tableText: string;
  tableBg: string;
  tableBorder: string;
}

export interface SessionItem {
  id: string;
  name: string;
  timeRange: string; // e.g. "09:30-16:00"
  color: string;     // hex
  enabled: boolean;
}

export interface SessionsConfig {
  id: string;
  type: 'sessions';
  enabled: boolean;
  items: SessionItem[];
  showLabels: boolean;
  showBorders: boolean;
}

export interface RSIConfig {
  id: string;
  type: 'rsi';
  enabled: boolean;

  // Calculation inputs
  period: number;       // default 14
  source: MASource;     // default 'close'

  // Visual style
  color: string;        // hex color for RSI line
  lineWidth: number;    // 1 – 5
  lineStyle: LineStyleType;
  
  // Bands
  upperBand: number;    // default 70
  lowerBand: number;    // default 30
  bandColor: string;    // color for bands
}

export interface CVDConfig {
  id: string;
  type: 'cvd';
  enabled: boolean;

  // Calculation
  sourceMethod: 'ohlc' | 'bidask'; // 'ohlc' = close-open proxy, 'bidask' = approx

  // Visual style
  lineWidth: number;    // 1 – 4
  bullColor: string;    // color when CVD is rising (positive delta)
  bearColor: string;    // color when CVD is falling (negative delta)

  // Divergence detection
  showDivergence: boolean;
  pivotLookback: number; // bars left/right to confirm pivot (2-20, default 5)
  bullDivColor: string;  // marker color for bullish divergence
  bearDivColor: string;  // marker color for bearish divergence
}

export interface GexLevelsConfig {
  id: string;
  type: 'gex_levels';
  enabled: boolean;
  colorCall: string;
  colorPut: string;
}

// Union — add new indicator configs here as they are built
export type IndicatorConfig = MovingAverageConfig | ICTSeekAndDestroyConfig | SessionsConfig | RSIConfig | CVDConfig | GexLevelsConfig;

// ─── Default Factory ───────────────────────────────────────────────────────────
const MA_COLORS = [
  '#f97316', // orange
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
  '#ef4444', // red
];

let _colorIndex = 0;

export function createDefaultMA(overrides?: Partial<MovingAverageConfig>): MovingAverageConfig {
  const color = MA_COLORS[_colorIndex % MA_COLORS.length];
  _colorIndex++;
  return {
    id: `ma_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'moving_average',
    enabled: true,
    maType: 'SMA',
    period: 20,
    source: 'close',
    offset: 0,
    kamaFast: 2,
    kamaSlow: 30,
    color,
    lineWidth: 1,
    lineStyle: 'solid',
    opacity: 1.0,
    showLabel: true,
    labelPosition: 'right',
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function getMALabel(cfg: MovingAverageConfig): string {
  return `${cfg.maType} ${cfg.period}`;
}

export function createDefaultICT(overrides?: Partial<ICTSeekAndDestroyConfig>): ICTSeekAndDestroyConfig {
  return {
    id: `ict_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'ict_snd',
    enabled: true,
    asSession: '20:00-03:00',
    asColor: '#3b82f6', // Blue
    loSession: '03:00-08:30',
    loColor: '#eab308',   // Yellow
    nySession: '08:30-16:00',
    nyColor: '#22c55e',   // Green
    crtInsideDay: true,
    crtOutsideDay: true,
    crtCloseInLo: true,
    crtSdLimit: true,
    sdLimit: 1.0,
    showSndPre: true,
    sndPreColor: '#f23645',
    showSndDay: true,
    sndDayColor: '#089981',
    showWrnTable: true,
    wrnMsg: 'Potential S&D Day',
    wrnText: '#ffffff',
    wrnBg: '#f23645',
    showStatTable: true,
    tablePosition: 'Top Right',
    tableText: '#ffffff',
    tableBg: 'rgba(10, 10, 14, 0.9)',
    tableBorder: '#333333',
    ...overrides,
  };
}

export function createDefaultSessions(overrides?: Partial<SessionsConfig>): SessionsConfig {
  return {
    id: `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'sessions',
    enabled: true,
    showLabels: true,
    showBorders: true,
    items: [
      { id: '1', name: 'Asia', timeRange: '20:00-03:00', color: '#3b82f6', enabled: true },
      { id: '2', name: 'London', timeRange: '03:00-08:30', color: '#eab308', enabled: true },
      { id: '3', name: 'New York', timeRange: '08:30-16:00', color: '#22c55e', enabled: true },
    ],
    ...overrides,
  };
}

export function createDefaultRSI(overrides?: Partial<RSIConfig>): RSIConfig {
  return {
    id: `rsi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'rsi',
    enabled: true,
    period: 14,
    source: 'close',
    color: '#a855f7', // purple
    lineWidth: 1,
    lineStyle: 'solid',
    upperBand: 70,
    lowerBand: 30,
    bandColor: '#71717a', // zinc-500
    ...overrides,
  };
}
export function createDefaultCVD(overrides?: Partial<CVDConfig>): CVDConfig {
  return {
    id: `cvd_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'cvd',
    enabled: true,
    sourceMethod: 'ohlc',
    lineWidth: 1,
    bullColor: '#26a69a', // teal
    bearColor: '#ef5350', // red
    showDivergence: true,
    pivotLookback: 5,
    bullDivColor: '#00e5ff', // cyan
    bearDivColor: '#ff1744', // bright red
    ...overrides,
  };
}

export function createDefaultGexLevels(overrides?: Partial<GexLevelsConfig>): GexLevelsConfig {
  return {
    id: `gex_levels_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: 'gex_levels',
    enabled: true,
    colorCall: '#34d399', // emerald-400
    colorPut: '#f87171',  // red-400
    ...overrides,
  };
}
