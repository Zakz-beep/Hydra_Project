import type { Plot } from './types';
export interface PlotStyle {
  visible: boolean; color: string; width: 1 | 2 | 3 | 4;
  dash: 'solid' | 'dashed' | 'dotted'; interpolation: 'straight' | 'step';
  opacity: number; fillOpacity: number; title: string;
  priceLabel: boolean; priceLine: boolean;
  markerShape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  markerPosition: 'aboveBar' | 'belowBar' | 'inBar'; markerSize: number;
}
export function resolvePlotStyle(plot: Plot, raw?: Partial<PlotStyle>): PlotStyle {
  const value: PlotStyle = { visible: true, color: plot.color, width: 1,
    dash: plot.kind === 'hline' ? 'dashed' : 'solid', interpolation: 'straight',
    opacity: 100, fillOpacity: plot.kind === 'box' ? 10 : 25, title: plot.title,
    priceLabel: true, priceLine: false, markerShape: 'arrowDown', markerPosition: 'aboveBar', markerSize: 1 };
  if (!raw || typeof raw !== 'object') return value;
  for (const key of ['visible', 'priceLabel', 'priceLine'] as const) if (typeof raw[key] === 'boolean') value[key] = raw[key];
  if (typeof raw.color === 'string' && /^#[a-f\d]{6}$/i.test(raw.color)) value.color = raw.color;
  if (typeof raw.title === 'string') value.title = raw.title.slice(0, 80);
  if ([1, 2, 3, 4].includes(raw.width!)) value.width = raw.width!;
  if (['solid', 'dashed', 'dotted'].includes(raw.dash!)) value.dash = raw.dash!;
  if (raw.interpolation === 'straight' || raw.interpolation === 'step') value.interpolation = raw.interpolation;
  for (const key of ['opacity', 'fillOpacity'] as const) if (Number.isFinite(raw[key])) value[key] = Math.max(0, Math.min(100, raw[key]!));
  if (['arrowUp', 'arrowDown', 'circle', 'square'].includes(raw.markerShape!)) value.markerShape = raw.markerShape!;
  if (['aboveBar', 'belowBar', 'inBar'].includes(raw.markerPosition!)) value.markerPosition = raw.markerPosition!;
  if (Number.isFinite(raw.markerSize)) value.markerSize = Math.max(.5, Math.min(4, raw.markerSize!));
  return value;
}
export const plotColor = (color: string, opacity: number) => color + Math.round(opacity * 2.55).toString(16).padStart(2, '0');
