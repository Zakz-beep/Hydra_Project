'use client';
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchCommands, COMMAND_REGISTRY } from '../../lib/terminal/commands';
import styles from './TerminalController.module.css';
export default function BloombergHelpModal({ isOpen, onClose, onSelectCommand }: { isOpen: boolean; onClose: () => void; onSelectCommand: (code: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const [query, setQuery] = useState('');
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    setQuery(''); element?.showModal();
    return () => {
      element?.close();
      // Chrome can leave focus in a closed dialog when opened from an unfocused chart.
      const target = previous && previous !== document.body && previous.isConnected && !element?.contains(previous)
        ? previous : document.querySelector<HTMLInputElement>('[aria-label="Terminal command"]');
      target?.focus();
    };
  }, [isOpen]);
  const matches = searchCommands(query);
  const groups = Array.from(new Set(COMMAND_REGISTRY.map(c => c.group)));
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="terminal-directory-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className={styles.dialogHead}><div><p className={styles.eyebrow}>WORKSPACE DIRECTORY</p><h2 id="terminal-directory-title">One command. Any workspace.</h2><p>Explore {COMMAND_REGISTRY.length} functions across markets, options and risk.</p></div><button aria-label="Close function directory" onClick={onClose}><X size={18} /></button></div>
    <label className={styles.directorySearch}><Search size={16} /><input autoFocus aria-label="Search function directory" placeholder="Search a function, code or topic…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className={styles.directoryBody}>{groups.map(g => { const rows = matches.filter(c => c.group === g); return rows.length > 0 && <section key={g}><h3>{g}</h3><div className={styles.directoryGrid}>{rows.map(c => <button key={c.code} onClick={() => { onSelectCommand(c.code); onClose(); }}><code>{c.code}</code><span><strong>{c.label}</strong><small>{c.description}</small><em>{c.ticker === 'global' ? `Ticker command · SPY ${c.code}` : 'Choose instruments inside this page'}</em></span></button>)}</div></section>; })}{!matches.length && <p className={styles.empty}>No function found. Try “volatility”, “chart” or “risk”.</p>}</div>
    <div className={styles.syntax}><p><code>SPY GEX</code> or <code>GEX SPY</code> opens a ticker. <code>GEX</code> keeps the current ticker.</p><p><code>xyz:TSLA GP</code> opens a Hyperliquid market; <code>TSLA GP</code> opens Yahoo Finance. Codes such as <code>COT</code> manage their own instruments.</p><p>A single unknown word is treated as a ticker; availability is checked by the destination data source.</p></div>
    <div className={styles.directoryFoot}><span><kbd>Ctrl K</kbd> command bar · <kbd>F1</kbd> directory · <kbd>Alt ← / →</kbd> history</span><a href="/terminal/agents.md" download>AI extension guide .md ↗</a></div>
  </dialog>;
}
