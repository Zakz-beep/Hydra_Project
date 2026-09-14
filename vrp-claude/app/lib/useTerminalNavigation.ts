'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { TerminalPage, NavigationState, parseCommand, formatCommand, stateFromUrl, commandUrl, findCommand } from './terminal/commands';
export { COMMAND_REGISTRY } from './terminal/commands';
export type { TerminalPage, CommandDefinition } from './terminal/commands';
const entryId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const STORAGE = 'vrp.terminal.commands.v1';
type Entry = { id: string; state: NavigationState };
type Trail = { entries: Entry[]; index: number };
export function useTerminalNavigation(initialPage: TerminalPage = 'vrp', initialTicker = 'SPY') {
  const initial = { page: initialPage, ticker: initialTicker };
  const [active, setActive] = useState<NavigationState>(initial);
  const activeRef = useRef(active);
  const [inputCommand, setDraft] = useState(formatCommand(initial));
  const [commandError, setCommandError] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [executionTimestamp, setExecutionTimestamp] = useState(0);
  const [trail, setTrail] = useState<Trail>({ entries: [], index: 0 });
  const trailRef = useRef(trail);
  const [recentCommands, setRecent] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const apply = useCallback((state: NavigationState) => {
    activeRef.current = state; setActive(state); setDraft(formatCommand(state)); setCommandError('');
  }, []);
  const saveTrail = useCallback((next: Trail) => {
    trailRef.current = next; setTrail(next);
    try { sessionStorage.setItem(`${STORAGE}.history`, JSON.stringify(next)); } catch { /* Navigation works without storage. */ }
  }, []);
  useEffect(() => {
    const parsed = stateFromUrl(new URL(location.href), initial);
    const state = parsed.state || initial;
    let restored: Trail | null = null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`${STORAGE}.history`) || 'null');
      if (saved && Array.isArray(saved.entries) && saved.entries.length <= 500 && saved.entries.every((e: Entry) => e && typeof e.id === 'string' && e.state && !stateFromUrl(commandUrl(e.state, location.href), initial).error)) {
        const index = saved.entries.findIndex((e: Entry) => e.id === window.history.state?.vrpTerminalId);
        if (index >= 0 && JSON.stringify(saved.entries[index].state) === JSON.stringify(state)) restored = { entries: saved.entries, index };
      }
      const preferences = JSON.parse(localStorage.getItem(STORAGE) || '{}');
      const valid = (xs: unknown): string[] => Array.isArray(xs) ? xs.filter(x => typeof x === 'string' && x.length < 100 && !parseCommand(x, initial).error).slice(0, 12) : [];
      setRecent(valid(preferences.recent)); setFavorites(valid(preferences.favorites));
    } catch { /* Ignore damaged or unavailable browser storage. */ }
    const next = restored || { entries: [{ id: entryId(), state }], index: 0 };
    window.history.replaceState({ ...window.history.state, vrpTerminalId: next.entries[next.index].id }, '', commandUrl(state, location.href));
    saveTrail(next); apply(state); if (parsed.error) setCommandError(parsed.error); setReady(true);
    const pop = () => {
      const result = stateFromUrl(new URL(location.href), initial);
      if (!result.state) { setCommandError(result.error); return; }
      const current = trailRef.current;
      const index = current.entries.findIndex(e => e.id === window.history.state?.vrpTerminalId);
      if (index >= 0) saveTrail({ ...current, index });
      else {
        const entry = { id: entryId(), state: result.state };
        window.history.replaceState({ ...window.history.state, vrpTerminalId: entry.id }, '', location.href);
        saveTrail({ entries: [entry], index: 0 });
      }
      apply(result.state);
    };
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop);
    // Initialize once; subsequent browser navigation arrives through popstate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, saveTrail]);
  useEffect(() => {
    if (ready) try { localStorage.setItem(STORAGE, JSON.stringify({ recent: recentCommands, favorites })); } catch { /* Optional storage. */ }
  }, [ready, recentCommands, favorites]);
  const executeCommand = useCallback((raw: string) => {
    const parsed = parseCommand(raw, activeRef.current);
    if (!parsed.state) { setCommandError(parsed.error); return false; }
    const next = parsed.state, canonical = formatCommand(next), current = activeRef.current;
    setRecent(xs => [canonical, ...xs.filter(x => x !== canonical)].slice(0, 12));
    if (next.page !== current.page || next.ticker !== current.ticker) {
      const entry = { id: entryId(), state: next };
      const entries = [...trailRef.current.entries.slice(0, trailRef.current.index + 1), entry].slice(-500);
      window.history.pushState({ ...window.history.state, vrpTerminalId: entry.id }, '', commandUrl(next, location.href));
      saveTrail({ entries, index: entries.length - 1 });
    }
    apply(next); return true;
  }, [apply, saveTrail]);
  const switchPage = useCallback((page: TerminalPage, ticker?: string) => executeCommand(ticker ? `${ticker} ${findCommand(page)!.code}` : findCommand(page)!.code), [executeCommand]);
  const setTicker = useCallback((ticker: string) => { executeCommand(`${ticker} ${findCommand(activeRef.current.page)!.code}`); }, [executeCommand]);
  const toggleFavorite = useCallback(() => { const value = formatCommand(activeRef.current); setFavorites(xs => xs.includes(value) ? xs.filter(x => x !== value) : [value, ...xs].slice(0, 12)); }, []);
  const goBack = useCallback(() => { if (trailRef.current.index > 0) window.history.back(); }, []);
  const goForward = useCallback(() => { if (trailRef.current.index < trailRef.current.entries.length - 1) window.history.forward(); }, []);
  return { activePage: active.page, activeTicker: active.ticker, inputCommand,
    setInputCommand: (value: string) => { setDraft(value); setCommandError(''); },
    executeCommand, goBack, goForward, canGoBack: trail.index > 0, canGoForward: trail.index < trail.entries.length - 1,
    switchPage, setTicker, isHelpOpen, setIsHelpOpen, executionTimestamp, refresh: () => setExecutionTimestamp(x => x + 1),
    historyIndex: trail.index, historyTotal: trail.entries.length, commandError, recentCommands, favorites, toggleFavorite, ready,
    clearRecent: () => setRecent([]), currentCommand: formatCommand(active),
  };
}
