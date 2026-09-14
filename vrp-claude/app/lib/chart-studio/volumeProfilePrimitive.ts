import type { ISeriesPrimitive, IPrimitivePaneRenderer, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { VolumeProfile } from './orderflow';

/** LWC primitive follows price transforms (including log scale) and is included in PNG export. */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private attachedTo?: SeriesAttachedParameter<Time>;
  private profile: VolumeProfile | null = null;
  private light = false;
  private readonly view = { zOrder: () => 'top' as const, renderer: () => ({ draw: (target: Parameters<IPrimitivePaneRenderer['draw']>[0]) => this.draw(target) }) };
  attached(params: SeriesAttachedParameter<Time>) { this.attachedTo = params; params.requestUpdate(); }
  detached() { this.attachedTo = undefined; }
  paneViews() { return [this.view]; }
  setData(profile: VolumeProfile | null, light: boolean) { this.profile = profile; this.light = light; this.attachedTo?.requestUpdate(); }
  private draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]) {
    const profile = this.profile, api = this.attachedTo; if (!profile || !api) return;
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const width = Math.min(150, mediaSize.width * .23), edge = mediaSize.width - 4;
      const peak = Math.max(...profile.bins.map(b => b.volume)); if (!peak) return;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mediaSize.width, mediaSize.height); ctx.clip();
      for (const bin of profile.bins) {
        const y1 = api.series.priceToCoordinate(bin.high), y2 = api.series.priceToCoordinate(bin.low);
        if (y1 == null || y2 == null || y2 < 0 || y1 > mediaSize.height) continue;
        const size = width * bin.volume / peak, height = Math.max(1, y2 - y1 - 1);
        const inValue = bin.low >= profile.val - 1e-9 && bin.high <= profile.vah + 1e-9;
        ctx.globalAlpha = inValue ? .55 : .22;
        if (profile.source === 'trades') {
          const buyWidth = bin.volume ? size * bin.buy / bin.volume : 0;
          ctx.fillStyle = this.light ? '#157d69' : '#45c9b0'; ctx.fillRect(edge - size, y1, buyWidth, height);
          ctx.fillStyle = this.light ? '#b33e50' : '#df7884'; ctx.fillRect(edge - size + buyWidth, y1, size - buyWidth, height);
        } else { ctx.fillStyle = this.light ? '#526f97' : '#829abb'; ctx.fillRect(edge - size, y1, size, height); }
      }
      ctx.globalAlpha = 1; ctx.font = '10px ui-monospace, monospace';
      for (const [label, price] of [['VAH', profile.vah], ['VAL', profile.val], ['POC', profile.poc]] as const) {
        const y = api.series.priceToCoordinate(price); if (y == null || y < 0 || y > mediaSize.height) continue;
        ctx.strokeStyle = label === 'POC' ? this.light ? '#946018' : '#eab86b' : this.light ? '#526079' : '#8a9ab0';
        ctx.setLineDash(label === 'POC' ? [] : [3, 4]); ctx.lineWidth = label === 'POC' ? 1.5 : 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(edge, y); ctx.stroke();
        ctx.fillStyle = this.light ? '#ffffff' : '#101721'; ctx.fillRect(edge - width - 31, y - 12, 30, 12);
        ctx.fillStyle = ctx.strokeStyle; ctx.fillText(label, edge - width - 29, y - 3);
      }
      ctx.restore();
    });
  }
}
