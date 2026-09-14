'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bar, MarketContext, Study, StudyResult } from './types';
import type { GreeksInput } from './greeksInput';
import { IndicatorError } from './pythonDiagnostics';
export function usePython() {
  const worker = useRef<Worker | null>(null);
  const job = useRef<{ id: string; resolve: (r: StudyResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [status, setStatus] = useState('Python ready to start');
  const [busy, setBusy] = useState(false);
  const stop = useCallback((message = 'Stopped') => {
    worker.current?.terminate(); worker.current = null;
    if (job.current) { clearTimeout(job.current.timer); job.current.reject(new Error(message)); job.current = null; }
    setBusy(false); setStatus(message);
  }, []);
  useEffect(() => () => { worker.current?.terminate(); if (job.current) { clearTimeout(job.current.timer); job.current.reject(new Error('Workspace closed')); job.current = null; } }, []);
  const run = useCallback((study: Study, datasets: Record<string, Bar[]>, context: string, symbol: string, interval: string, market?: MarketContext, greeks?: GreeksInput, operation: 'run' | 'validate' = 'run'): Promise<StudyResult> => {
    if (job.current) return Promise.reject(new Error('Another indicator is running. Stop it or wait.'));
    if (study.code.length > 100000) return Promise.reject(new Error('Script exceeds 100 KB'));
    setBusy(true); setStatus('Starting Python…');
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID(); const logs: string[] = [];
      if (!worker.current) worker.current = new Worker('/chart-studio/python-worker.js');
      const finish = () => { if (job.current) clearTimeout(job.current.timer); job.current = null; setBusy(false); };
      job.current = { id, resolve, reject, timer: setTimeout(() => stop('Python startup timed out. Check that the local chart runtime is installed and the dashboard server is running.'), 120000) };
      worker.current.onerror = e => { finish(); worker.current?.terminate(); worker.current = null; setStatus('Python failed'); reject(new Error(e.message || 'Python worker failed')); };
      worker.current.onmessage = ({ data }) => {
        if (!job.current || job.current.id !== data.id) return;
        if (data.status) setStatus(data.status);
        if (data.ready) { clearTimeout(job.current.timer); job.current.timer = setTimeout(() => stop('Execution exceeded 30 seconds'), 30000); }
        if (data.log) logs.push(String(data.log));
        if (data.error) {
          finish(); if (data.fatal) { worker.current?.terminate(); worker.current = null; }
          setStatus('Script error'); reject(data.diagnostic ? new IndicatorError(data.diagnostic) : new Error(data.error)); return;
        }
        if (data.valid) {
          finish(); setStatus('Syntax valid · Run to check data and outputs');
          resolve({ plots: [], inputs: [], logs: [], duration: 0, context, code: study.code, params: study.params }); return;
        }
        if (data.result) {
          finish();
          if (!Array.isArray(data.result.plots) || data.result.plots.length > 32) { reject(new Error('Invalid Python output')); return; }
          setStatus(`Completed in ${(data.duration / 1000).toFixed(2)}s`);
          resolve({ ...data.result, logs, duration: data.duration, context, code: study.code, params: study.params });
        }
      };
      worker.current.postMessage({ id, operation, code: study.code, payload: { datasets, params: study.params, symbol, interval, market, greeks } });
    });
  }, [stop]);
  const validate = useCallback((study: Study) => run(study, {}, '', '', '', undefined, undefined, 'validate').then(() => undefined), [run]);
  return { run, validate, stop, status, busy };
}
