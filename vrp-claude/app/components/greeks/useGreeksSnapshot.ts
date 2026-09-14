"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGreeks, GreeksSnapshot } from "../../lib/greeks";

export function useGreeksSnapshot(ticker: string) {
  const [data, setData] = useState<GreeksSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async (force = false) => {
    const id = ++sequence.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), 90_000);
    try {
      const snapshot = await fetchGreeks(ticker, force, controller.signal);
      if (id !== sequence.current) return;
      if (snapshot.ticker.toUpperCase() !== ticker.toUpperCase()) throw new Error("Ticker respons tidak sesuai permintaan.");
      setData(snapshot);
      setLastChecked(new Date());
    } catch (err) {
      if (id === sequence.current) {
        setError(controller.signal.aborted ? "Permintaan melewati 90 detik. Coba lagi." : err instanceof Error ? err.message : "Gagal memuat Greeks.");
      }
    } finally {
      clearTimeout(timeout);
      if (id === sequence.current) { setLoading(false); request.current = null; }
    }
  }, [ticker]);

  useEffect(() => {
    setData(null);
    setLastChecked(null);
    void refresh();
    return () => { ++sequence.current; request.current?.abort(); request.current = null; };
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (!document.hidden && !request.current) void refresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [autoRefresh, refresh]);

  // Also guard the render between a ticker change and effect cleanup.
  return { data: data?.ticker.toUpperCase() === ticker.toUpperCase() ? data : null, error, loading, autoRefresh, setAutoRefresh, lastChecked, refresh };
}
