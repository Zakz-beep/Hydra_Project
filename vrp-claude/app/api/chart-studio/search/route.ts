import { NextRequest, NextResponse } from 'next/server';
import { getHyperliquidCatalog, searchCatalog } from '../../../lib/chart-studio/hyperliquidCatalog';
export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider'); const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 80);
  try {
    if (provider === 'hyperliquid') {
      const catalog = await getHyperliquidCatalog();
      const matches = searchCatalog(catalog, q, req.nextUrl.searchParams.get('scope') || 'all');
      const requested = Number(req.nextUrl.searchParams.get('limit') || 50);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.min(5000, Math.floor(requested))) : 50;
      return NextResponse.json(matches.slice(0, limit), { headers: { 'X-Total-Count': String(matches.length), 'X-Catalog-Count': String(catalog.length) } });
    }
    if (provider !== 'yahoo') throw new Error('Unsupported provider');
    const r = await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Yahoo search returned ${r.status}`);
    const data = await r.json();
    return NextResponse.json((data.quotes || []).filter((v: { symbol?: string }) => v.symbol).map((v: { symbol: string; shortname?: string; longname?: string }) => ({ provider, symbol: v.symbol, name: v.shortname || v.longname || v.symbol })));
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Search unavailable' }, { status: 502 }); }
}
