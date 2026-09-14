import type { FlowTrade } from './orderflow';
export interface FootprintLevel { index: number; low: number; high: number; buy: number; sell: number; volume: number; delta: number; trades: number; buyImbalance: boolean; sellImbalance: boolean; stackedBuy: boolean; stackedSell: boolean }
export interface FootprintBar { time: number; open: number; high: number; low: number; close: number; buy: number; sell: number; delta: number; volume: number; trades: number; levels: FootprintLevel[]; poc: number }
export interface FootprintSettings { interval: number; step: number; ratio: number; minimum: number; stack: number; units: 'base' | 'quote' }
/** Readable price increment, locked by the UI to the first captured price. Not exchange tick size. */
export function suggestedStep(price: number) { const value = Math.max(1e-10, price * .0001); const power = 10 ** Math.floor(Math.log10(value)); return Number(((value / power >= 5 ? 5 : value / power >= 2 ? 2 : 1) * power).toPrecision(10)); }
export function aggregateFootprint(input: FlowTrade[], settings: FootprintSettings) {
  if (![settings.interval, settings.step, settings.ratio, settings.minimum, settings.stack].every(Number.isFinite) || settings.interval < 1 || settings.step <= 0 || settings.ratio < 1 || settings.minimum < 0 || settings.stack < 2) throw new Error('Invalid footprint settings');
  const unique = new Map<string, FlowTrade>();
  for (const t of input) if (t && ['buy','sell'].includes(t.side) && [t.time,t.price,t.size].every(Number.isFinite) && t.time > 0 && t.price > 0 && t.size > 0) unique.set(t.id,t);
  const trades = Array.from(unique.values()).sort((a,b)=>a.time-b.time);
  let low = Infinity, high = -Infinity;
  for (const t of trades) { low = Math.min(low,t.price); high = Math.max(high,t.price); }
  // Bound sparse price grids even if a user requests an impractically tiny step.
  const minimumStep = trades.length ? Math.max(settings.step, (high-low)/240, high*Number.EPSILON*16) : settings.step;
  const roundedStep = Math.ceil(minimumStep/settings.step)*settings.step;
  const step = Number.isFinite(roundedStep) ? roundedStep : minimumStep;
  const index = (price: number) => Math.floor(price/step + 1e-8);
  const groups = new Map<number,{ bar: FootprintBar; levels: Map<number,FootprintLevel> }>();
  for (const t of trades) {
    const time = Math.floor(t.time / 1000 / settings.interval) * settings.interval;
    let group = groups.get(time);
    if (!group) { group={bar:{time,open:t.price,high:t.price,low:t.price,close:t.price,buy:0,sell:0,delta:0,volume:0,trades:0,levels:[],poc:0},levels:new Map()}; groups.set(time,group); }
    const b=group.bar, i=index(t.price), volume=t.size*(settings.units==='quote'?t.price:1);
    let row=group.levels.get(i);
    if (!row) { row={index:i,low:i*step,high:(i+1)*step,buy:0,sell:0,delta:0,volume:0,trades:0,buyImbalance:false,sellImbalance:false,stackedBuy:false,stackedSell:false}; group.levels.set(i,row); }
    row[t.side]+=volume;row.volume+=volume;row.delta=row.buy-row.sell;row.trades++;
    b[t.side]+=volume;b.volume+=volume;b.delta=b.buy-b.sell;b.trades++;b.high=Math.max(b.high,t.price);b.low=Math.min(b.low,t.price);b.close=t.price;
  }
  const bars=Array.from(groups.values()).map(({bar,levels})=>{
    bar.levels=Array.from(levels.values()).sort((a,b)=>a.index-b.index);
    for(const row of bar.levels){
      const lower=levels.get(row.index-1), upper=levels.get(row.index+1);
      // Diagonal: ask at P against bid at P-step; bid at P against ask at P+step.
      // Missing/zero denominators are deliberately not treated as infinite imbalance.
      row.buyImbalance=Boolean(lower && lower.sell>0 && row.buy>=settings.minimum && row.buy/lower.sell>=settings.ratio);
      row.sellImbalance=Boolean(upper && upper.buy>0 && row.sell>=settings.minimum && row.sell/upper.buy>=settings.ratio);
    }
    for(const side of ['Buy','Sell'] as const){let run:FootprintLevel[]=[];const flush=()=>{if(run.length>=settings.stack)for(const r of run)r[`stacked${side}`]=true;run=[];};
      for(const row of bar.levels){if(!row[side==='Buy'?'buyImbalance':'sellImbalance']){flush();continue;}if(run.length && row.index!==run[run.length-1].index+1)flush();run.push(row);}flush();}
    const poc=bar.levels.reduce((a,b)=>b.volume>a.volume?b:a);bar.poc=(poc.low+poc.high)/2;return bar;
  });
  return {bars,step,coarsened:step>settings.step,trades:trades.length,total:bars.reduce((n,b)=>n+b.volume,0),delta:bars.reduce((n,b)=>n+b.delta,0),from:trades[0]?.time,to:trades.at(-1)?.time};
}
export function footprintCsv(bars:FootprintBar[]) { return ['time_utc,price_low,price_high,bid_sell,ask_buy,delta,volume,trade_count,buy_imbalance,sell_imbalance,stacked_buy,stacked_sell',...bars.flatMap(b=>b.levels.map(r=>[new Date(b.time*1000).toISOString(),r.low,r.high,r.sell,r.buy,r.delta,r.volume,r.trades,r.buyImbalance,r.sellImbalance,r.stackedBuy,r.stackedSell].join(',')))].join('\n'); }
