// app/api/vrp/route.ts
// ─────────────────────────────────────────────────────────────────
// Next.js API Route — proxy ke Python FastAPI backend.
//
// Prioritas:
//   1. Python FastAPI di PYTHON_API_URL (default: http://localhost:8000)
//   2. Fallback ke Yahoo Finance langsung (kalau Python backend mati)
//   3. Fallback ke synthetic data (kalau semuanya gagal)
// ─────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import {
  computeVRP,
  generateSyntheticDaily,
  generateSyntheticIntraday,
  generateSyntheticVIX,
  OHLC,
} from '../../lib/vrp'

const PYTHON_API_URL = process.env.PYTHON_API_URL ?? 'http://localhost:8000'

// ── 1. Try Python FastAPI backend ────────────────────────────────

async function fetchFromPythonAPI(ticker: string) {
  const url = `${PYTHON_API_URL}/api/vrp?ticker=${encodeURIComponent(ticker)}`
  const res = await fetch(url, {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Python API HTTP ${res.status}`)
  return res.json()
}

// ── 2. Fallback: Yahoo Finance directly ──────────────────────────

async function fetchYahooOHLC(ticker: string, interval: string, range: string): Promise<OHLC[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}&includePrePost=false`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`)
  const data = await res.json()
  const chart = data?.chart?.result?.[0]
  if (!chart) throw new Error('No chart data')
  const ts: number[] = chart.timestamp
  const q            = chart.indicators.quote[0]
  return ts.map((t, i) => ({
    open:      q.open[i]  ?? q.close[i],
    high:      q.high[i]  ?? q.close[i],
    low:       q.low[i]   ?? q.close[i],
    close:     q.close[i],
    timestamp: new Date(t * 1000).toISOString(),
  })).filter(c => c.close != null && !isNaN(c.close))
}

async function fetchFromYahoo(ticker: string) {
  const [daily, intraday, vixCandles] = await Promise.all([
    fetchYahooOHLC(ticker, '1d',  '6mo'),
    fetchYahooOHLC(ticker, '15m', '5d'),
    fetchYahooOHLC('^VIX', '1d',  '6mo'),
  ])
  if (daily.length < 20 || vixCandles.length < 10) throw new Error('Insufficient data')
  const vixHistory   = vixCandles.map(c => c.close / 100)
  const todayCandles = intraday.slice(-26)
  return computeVRP({ dailyCandles: daily, intradayCandles: todayCandles, vixHistory, ticker })
}

// ── 3. Fallback: full synthetic ──────────────────────────────────

function fetchSynthetic(ticker: string) {
  const daily    = generateSyntheticDaily(130)
  const spot     = daily[daily.length - 1].close
  const intraday = generateSyntheticIntraday(spot, 26)
  const vix      = generateSyntheticVIX(130, 0.19)
  return {
    ...computeVRP({ dailyCandles: daily, intradayCandles: intraday, vixHistory: vix, ticker }),
    data_source: 'synthetic',
  }
}

// ── Main handler ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get('ticker') ?? '^GSPC'

  // Priority 1: Python FastAPI
  try {
    const data = await fetchFromPythonAPI(ticker)
    return NextResponse.json({ ...data, _via: 'python_api' })
  } catch (pyErr) {
    console.warn('[VRP] Python API unavailable:', pyErr)
  }

  // Priority 2: Yahoo Finance direct
  try {
    const data = await fetchFromYahoo(ticker)
    return NextResponse.json({ ...data, _via: 'yahoo_direct', data_source: 'live' })
  } catch (yhErr) {
    console.warn('[VRP] Yahoo Finance failed:', yhErr)
  }

  // Priority 3: Synthetic fallback
  try {
    const data = fetchSynthetic(ticker)
    return NextResponse.json({ ...data, _via: 'synthetic' })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
