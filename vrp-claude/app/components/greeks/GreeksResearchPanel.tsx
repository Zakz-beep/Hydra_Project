"use client";

import { useEffect, useState } from "react";
import { fetchGreeksBacktest, fetchGreeksHistory, fetchGreeksSignalLog, GreeksBacktestResponse, GreeksHistoryResponse, GreeksSignalLogResponse } from "../../lib/greeks";
import GreeksChart from "./GreeksChart";
import GreeksHistoryTable from "./GreeksHistoryTable";
import GreeksBacktestPanel from "./GreeksBacktestPanel";
import GreeksSignalLog from "./GreeksSignalLog";
import dynamic from 'next/dynamic';
const MarketDataHistory = dynamic(() => import('./MarketDataHistory'), {ssr:false});

type Result = { view: "History"; data: GreeksHistoryResponse } | { view: "Backtest"; data: GreeksBacktestResponse } | { view: "Signals"; data: GreeksSignalLogResponse };

export function GreeksResearchPanel({ ticker, view }: { ticker: string; view: Result["view"] }) {
  const [dataset, setDataset] = useState('marketdata');
  const historical = view !== 'Signals' && dataset === 'marketdata';
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3 text-xs text-zinc-400">
      <span>{historical ? 'MarketData historical EOD · locally reconstructed Greeks · separate archive' : view === 'History' && dataset === 'legacy-yahoo' ? 'Legacy Yahoo archive · original source quality retained' : 'Current Alpaca feed archive · separate from Yahoo and other feeds'}</span>
      {view !== 'Signals' && <label>Dataset<select aria-label="Greeks history dataset" className="ml-2 rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-100" value={dataset} onChange={e => setDataset(e.target.value)}><option value="marketdata">MarketData · EOD history</option><option value="current">Alpaca · current feed</option>{view === 'History' && <option value="legacy-yahoo">Yahoo · legacy archive</option>}</select></label>}
    </div>
    {historical ? <MarketDataHistory key={ticker} ticker={ticker} view={view}/> : <ResearchResult key={`${ticker}-${view}-${dataset}`} ticker={ticker} view={view} dataset={dataset} />}
  </div>;
}

function ResearchResult({ ticker, view, dataset }: { ticker: string; view: Result['view']; dataset: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    setResult(null); setError(null);
    const load = async (): Promise<Result> => {
      if (view === "History") return { view, data: await fetchGreeksHistory(ticker, 50, controller.signal, dataset) };
      if (view === "Backtest") return { view, data: await fetchGreeksBacktest(ticker, controller.signal) };
      return { view, data: await fetchGreeksSignalLog(ticker, 50, controller.signal) };
    };
    load().then(value => { if (active) setResult(value); }).catch(err => { if (active) setError(controller.signal.aborted ? "Permintaan melewati 90 detik. Coba lagi." : err instanceof Error ? err.message : "Request failed."); }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [ticker, view, attempt, dataset]);
  if (error) return <div role="alert" className="rounded-lg border border-amber-800 p-4 text-sm text-amber-200">{error} <button className="ml-3 underline" onClick={() => setAttempt(attempt + 1)}>Coba lagi</button></div>;
  if (!result || result.view !== view) return <div role="status" className="animate-pulse rounded-xl bg-zinc-900 p-8 text-zinc-400">Memuat {view.toLowerCase()}…</div>;
  if (result.view === "Backtest") return <GreeksBacktestPanel data={result.data} loading={false} />;
  if (result.view === "Signals") return result.data.signals.length ? <GreeksSignalLog signals={result.data.signals} /> : <p className="p-8 text-center text-zinc-400">Belum ada perubahan sinyal untuk {ticker}.</p>;
  return result.data.history.length ? <div className="min-w-0 space-y-4">{result.data.history.some(row => row.data_source === 'synthetic' || row.data_source === 'mixed') && <p className="rounded-lg border border-amber-900 p-3 text-xs text-amber-200">Arsip ini mengandung snapshot synthetic/mixed. Grafik menampilkan catatan historis termasuk data tersebut; cek Source / quality per baris sebelum membandingkan exposure.</p>}<GreeksChart history={result.data.history} /><div className="overflow-x-auto"><GreeksHistoryTable history={result.data.history} /></div></div> : <p className="p-8 text-center text-zinc-400">Belum ada histori snapshot untuk {ticker}.</p>;
}
