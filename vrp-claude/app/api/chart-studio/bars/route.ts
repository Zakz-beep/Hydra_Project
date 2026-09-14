import { NextRequest, NextResponse } from 'next/server';
import { getBars, parseMarket } from '../../../lib/chart-studio/providers';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  try { const { instrument, interval } = parseMarket(req.nextUrl.searchParams); return NextResponse.json(await getBars(instrument, interval)); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Market data unavailable' }, { status: 400 }); }
}
