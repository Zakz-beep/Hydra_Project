import { Instrument } from './types';
import { hyperInfo } from './hyperliquidInfo';

interface Meta { collateralToken: number; universe: { name: string; isDelisted?: boolean }[] }
interface SpotMeta { tokens: { index: number; name: string }[] }
let cached: Instrument[] = []; let expires = 0; let pending: Promise<Instrument[]> | undefined;

export function buildCatalog(metas: Meta[], spot: SpotMeta): Instrument[] {
  if (!Array.isArray(metas) || !Array.isArray(spot.tokens)) throw new Error('Invalid Hyperliquid catalog');
  const tokens = new Map(spot.tokens.map(t => [t.index, t.name]));
  const markets = new Map<string, Instrument>();
  for (const meta of metas) for (const asset of meta.universe) {
    if (asset.isDelisted) continue;
    const venue = asset.name.includes(':') ? asset.name.split(':')[0] : 'native';
    const collateral = tokens.get(meta.collateralToken);
    markets.set(asset.name, { provider: 'hyperliquid', symbol: asset.name, venue, collateral,
      name: `${asset.name.split(':').at(-1)} perpetual · ${venue === 'native' ? 'Hyperliquid' : venue.toUpperCase() + ' / HIP-3'}${collateral ? ' · ' + collateral : ''}` });
  }
  if (!markets.size) throw new Error('Hyperliquid catalog is empty');
  return Array.from(markets.values());
}

export async function getHyperliquidCatalog(): Promise<Instrument[]> {
  if (expires > Date.now()) return cached;
  if (!pending) pending = Promise.all([hyperInfo({ type: 'allPerpMetas' }), hyperInfo({ type: 'spotMeta' })])
    .then(([metas, spot]) => { cached = buildCatalog(metas, spot); expires = Date.now() + 300000; return cached; })
    .finally(() => { pending = undefined; });
  return pending;
}

// TradingView-style suffixes are search aliases only; never change the actual coin or collateral.
export function searchCatalog(catalog: Instrument[], query: string, scope = 'all'): Instrument[] {
  const q = query.trim().toUpperCase();
  const alias = q.replace(/(?:USDT|USDC|USD)\.P$|\.P$|[-/]PERP$/, '');
  const filtered = catalog.filter(i => scope === 'native' ? i.venue === 'native' : scope === 'hip3' ? i.venue !== 'native' : true);
  return filtered.map((i, index) => {
    const symbol = i.symbol.toUpperCase(); const base = symbol.split(':').at(-1)!;
    const rank = !q ? 5 : symbol === q ? 0 : base === q ? 1 : symbol === alias || base === alias ? 2 : symbol.includes(q) || i.name.toUpperCase().includes(q) ? 3 : alias !== q && symbol.includes(alias) ? 4 : 99;
    return { i, index, rank };
  }).filter(x => x.rank < 99).sort((a, b) => a.rank - b.rank || a.index - b.index).map(x => x.i);
}
