import { MacroEvent } from './macroData';
export const REACTION_ASSETS = [{symbol:'SPY',label:'S&P 500 ETF'},{symbol:'QQQ',label:'Nasdaq-100 ETF'},{symbol:'GLD',label:'Gold ETF proxy'},{symbol:'UUP',label:'USD bullish ETF proxy'},{symbol:'TLT',label:'20+ year Treasury ETF'},{symbol:'BTC-USD',label:'Bitcoin / USD'}];
export const HORIZONS = [{value:5,label:'+5 menit'},{value:30,label:'+30 menit'},{value:60,label:'+1 jam'},{value:1440,label:'+24 jam'}];
export interface ReactionReturn {value:number|null;reason:string|null;sampled_at:string|null;lag_seconds:number|null;captured_at?:string|null}
export interface ReactionRow extends MacroEvent {
  series_key:string;score:number|null;surprise:number|null;classification:string;status:string;label:string;
  baseline:null|{price:number;sampled_at:string;lag_seconds:number;captured_at?:string|null};reaction_status:string;
  returns:Record<string,ReactionReturn>;overlaps:{id:string;title:string;date:string;source:string}[];
}
export interface ReactionData {
  symbol:string;rows:ReactionRow[];series:string[];selected_id:string|null;horizon:number;band:number;
  path:{minute:number;time:string;value:number|null;price:number|null}[];generated_at:string;
  price_source:{fetched_at:string|null;stale:boolean;error:string|null;first_bar:string|null;last_bar:string|null;provider:string;interval:string};
  summary:{n:number;median:number|null;small:number;posterior:null|{mean:number;lower:number;upper:number;positive:number}};
}
