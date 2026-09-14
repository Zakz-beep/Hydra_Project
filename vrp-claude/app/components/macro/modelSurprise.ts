export function defaultUsdDirection(series: string): 1 | -1 {
  return ['claims','unemployment'].includes(series) ? -1 : 1;
}
export function modelLabel(z: number | undefined | null, direction: number, neutral: number, shock: number) {
  if (z == null || !Number.isFinite(z)) return { label: 'Belum dinilai', tone: 'muted', reason: 'Ketidakpastian prediksi belum tersedia.' };
  if (Math.abs(z) <= neutral) return { label: 'Netral', tone: 'neutral', reason: 'Actual masih dekat dengan perkiraan model.' };
  const bull=z*direction>0, big=Math.abs(z)>=shock;
  return {label:`${bull?'Bullish':'Bearish'}${big?' shock':''} USD`,tone:bull?'bull':'bear',
    reason:`Actual ${z>0?'di atas':'di bawah'} model; ${big?'kejutan besar':'deviasi moderat'} menurut skenario USD yang dipilih.`};
}
