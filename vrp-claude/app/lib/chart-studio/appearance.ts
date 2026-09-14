export interface ChartAppearance {
  background: string; text: string; grid: string; crosshair: string;
  up: string; down: string; wickUp: string; wickDown: string;
  borderUp: string; borderDown: string; borders: boolean; wicks: boolean;
  gridMode: 'both' | 'horizontal' | 'none'; volume: boolean; watermark: boolean;
}
export const appearanceDefaults = (light = false): ChartAppearance => ({
  background: light ? '#ffffff' : '#131722', text: light ? '#434651' : '#b2b5be',
  grid: light ? '#f0f3fa' : '#1e222d', crosshair: '#787b86',
  up: '#089981', down: '#f23645', wickUp: '#089981', wickDown: '#f23645',
  borderUp: '#089981', borderDown: '#f23645', borders: true, wicks: true,
  gridMode: 'both', volume: true, watermark: false,
});
export function normalizeAppearance(value: unknown, light = false): ChartAppearance {
  const result = appearanceDefaults(light); const raw = value as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return result;
  for (const key of Object.keys(result) as (keyof ChartAppearance)[]) {
    const v = raw[key];
    if (key === 'gridMode') { if (v === 'both' || v === 'horizontal' || v === 'none') result[key] = v; }
    else if (typeof result[key] === 'boolean') { if (typeof v === 'boolean') Object.assign(result, { [key]: v }); }
    else if (typeof v === 'string' && /^#[a-f\d]{6}$/i.test(v)) Object.assign(result, { [key]: v });
  }
  return result;
}
