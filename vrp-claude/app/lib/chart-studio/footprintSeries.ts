import { customSeriesDefaultOptions } from 'lightweight-charts';
import type { CustomData, CustomSeriesOptions, CustomSeriesWhitespaceData, ICustomSeriesPaneView, ICustomSeriesPaneRenderer, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import type { FootprintBar } from './footprint';
export interface FootprintPoint extends CustomData<Time> { footprint: FootprintBar }
export interface FootprintOptions extends CustomSeriesOptions { buyColor:string; sellColor:string; pocColor:string; textColor:string; mode:'bidask'|'delta'; showPoc:boolean; fontSize:number }
export const compactVolume = (n:number) => Math.abs(n)>=1e6?`${(n/1e6).toFixed(1)}m`:Math.abs(n)>=1e3?`${(n/1e3).toFixed(1)}k`:Math.abs(n)>=10?n.toFixed(0):Math.abs(n)>=1?n.toFixed(1):n===0?'0':n.toPrecision(2);
class FootprintRenderer implements ICustomSeriesPaneRenderer {
  data:PaneRendererCustomData<Time,FootprintPoint>|null=null;
  options:FootprintOptions|null=null;
  draw(target:Parameters<ICustomSeriesPaneRenderer['draw']>[0],convert:PriceToCoordinateConverter) {
    const data=this.data,o=this.options;if(!data?.visibleRange||!o)return;
    // LWC's media coordinate target scales the backing canvas for devicePixelRatio.
    target.useMediaCoordinateSpace(({context:ctx,mediaSize})=>{
      ctx.save();ctx.beginPath();ctx.rect(0,0,mediaSize.width,mediaSize.height);ctx.clip();
      const width=Math.max(2,Math.min(210,data.barSpacing*.87)), half=width/2;
      ctx.font=`500 ${o.fontSize}px ui-monospace, monospace`;ctx.textBaseline='middle';
      for(let i=Math.max(0,data.visibleRange!.from);i<Math.min(data.bars.length,data.visibleRange!.to);i++){
        const item=data.bars[i],b=item.originalData.footprint,x=item.x;
        if(x+half<0||x-half>mediaSize.width)continue;
        const peak=Math.max(...b.levels.map(r=>r.volume),1e-20);
        for(const r of b.levels){
          const top=convert(r.high),bottom=convert(r.low);if(top==null||bottom==null||bottom<0||top>mediaSize.height)continue;
          const y=top+.5,h=Math.max(1,bottom-top-1),cy=(top+bottom)/2;
          if(o.mode==='bidask'){
            for(const side of ['sell','buy'] as const){const left=side==='sell'?x-half:x+1;const color=side==='sell'?o.sellColor:o.buyColor;const imbalance=side==='sell'?r.sellImbalance:r.buyImbalance,stacked=side==='sell'?r.stackedSell:r.stackedBuy;
              ctx.globalAlpha=r[side]>0?.1+.65*r[side]/peak:0;ctx.fillStyle=color;ctx.fillRect(left,y,half-1,h);ctx.globalAlpha=1;
              if(imbalance){ctx.strokeStyle=color;ctx.lineWidth=stacked?2:1;ctx.strokeRect(left+1,y+1,Math.max(0,half-3),Math.max(0,h-2));}
              const text=compactVolume(r[side]);if(h>=o.fontSize+3&&half>ctx.measureText(text).width+10){ctx.textAlign='center';ctx.fillStyle=imbalance?color:o.textColor;ctx.fillText(text,left+half/2,cy);}
            }
          }else{ctx.globalAlpha=.12+.65*Math.abs(r.delta)/peak;ctx.fillStyle=r.delta>=0?o.buyColor:o.sellColor;ctx.fillRect(x-half,y,width,h);ctx.globalAlpha=1;const text=(r.delta>0?'+':'')+compactVolume(r.delta);if(h>=o.fontSize+3&&width>ctx.measureText(text).width+10){ctx.fillStyle=o.textColor;ctx.textAlign='center';ctx.fillText(text,x,cy);}}
          if(o.showPoc&&b.poc>=r.low&&b.poc<r.high){ctx.strokeStyle=o.pocColor;ctx.lineWidth=1;ctx.strokeRect(x-half,y,width,h);}
        }
        const hi=convert(b.high),lo=convert(b.low),open=convert(b.open),close=convert(b.close);
        if(hi!=null&&lo!=null&&open!=null&&close!=null){ctx.strokeStyle=b.close>=b.open?o.buyColor:o.sellColor;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,hi);ctx.lineTo(x,lo);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(x-2,Math.min(open,close),4,Math.max(2,Math.abs(open-close)));}
      }
      ctx.restore();
    });
  }
}
export class FootprintSeries implements ICustomSeriesPaneView<Time,FootprintPoint,FootprintOptions> {
  private painter=new FootprintRenderer();
  renderer(){return this.painter;}
  update(data:PaneRendererCustomData<Time,FootprintPoint>,options:FootprintOptions){this.painter.data=data;this.painter.options=options;}
  priceValueBuilder(p:FootprintPoint){return [p.footprint.levels.at(-1)!.high,p.footprint.levels[0].low,p.footprint.close];}
  isWhitespace(p:FootprintPoint|CustomSeriesWhitespaceData<Time>):p is CustomSeriesWhitespaceData<Time>{return !('footprint' in p);}
  defaultOptions():FootprintOptions{return {...customSeriesDefaultOptions,buyColor:'#4bd6b0',sellColor:'#f0808c',pocColor:'#ecc17c',textColor:'#e7edf7',mode:'bidask',showPoc:true,fontSize:11,priceLineVisible:false,lastValueVisible:true};}
  destroy(){this.painter.data=null;}
}
