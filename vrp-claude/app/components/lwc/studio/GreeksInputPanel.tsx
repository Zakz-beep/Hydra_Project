'use client';
import { Code2, ExternalLink } from 'lucide-react';
import type { GreeksInput } from '../../../lib/chart-studio/greeksInput';
import type { Instrument } from '../../../lib/chart-studio/types';
interface Props { ticker: string; instrument: Instrument; status: string; data: GreeksInput | null; onTicker: (ticker: string) => void; onChart: () => void; onTemplate: (file: string, name: string) => void; onClose: () => void }
export default function GreeksInputPanel(p: Props) {
  const matches = p.instrument.symbol.split(':').at(-1)?.toUpperCase() === p.ticker;
  return <section className="cs-greeks-input" aria-label="The Greeks data input"><div className="cs-greeks-input-head"><div><strong>THE GREEKS</strong><span>Editable Python indicators · options inventory & chain activity</span></div><button onClick={p.onClose} aria-label="Disable Greeks data">×</button></div>
    <div className="cs-greeks-input-controls"><label>Options source<input aria-label="Greeks source ticker" value={p.ticker} placeholder="SPY, QQQ, TSLA…" maxLength={30} onChange={e => p.onTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9.^=-]/g, ''))} /></label><button disabled={!p.ticker} onClick={p.onChart}><ExternalLink size={12} />Use {p.ticker || 'source'} Yahoo chart</button><button className="cs-run" onClick={() => p.onTemplate('the_greeks_complete.py', 'The Greeks · Complete')}><Code2 size={13} />Add complete indicator</button><select aria-label="Add focused Greeks indicator" value="" onChange={e => { const value = e.target.value; if (value) p.onTemplate(value, value === 'options_activity_levels.py' ? 'Options activity · Levels' : 'Greeks · Regime history'); }}><option value="">Focused templates…</option><option value="options_activity_levels.py">Options activity levels</option><option value="greeks_regime_history.py">GEX regime history</option></select></div>
    <p className="cs-greeks-input-note" role="status">{p.status || 'Add an indicator, then Run. Source and parameters are saved with this workspace.'}{p.data ? ` · ${p.data.meta.source} · ${p.data.chain.length} contracts · ${p.data.history.length} history snapshots${p.data.snapshot ? ` · as of ${p.data.snapshot.timestamp}` : ' · replay history only'}` : ''}</p>
    {!matches && <p className="cs-greeks-input-warning">Chart {p.instrument.symbol} differs from source {p.ticker || '—'}. Current strike levels require matching underlyings; use the source Yahoo chart.</p>}
    {p.instrument.provider === 'hyperliquid' && matches && <p className="cs-greeks-input-note">Equity options levels are shown on a Hyperliquid perpetual. Basis and trading sessions may differ.</p>}
    <p className="cs-greeks-input-note">Snapshot reference levels + recorded history. Activity uses chain volume/OI and a mid-price premium proxy; it does not identify executed sweeps, blocks or aggressor direction. Edit formulas in Python Studio and inputs in Studies.</p>
  </section>;
}
