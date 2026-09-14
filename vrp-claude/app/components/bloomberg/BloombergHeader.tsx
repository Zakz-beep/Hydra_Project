'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Search, Star, Grid2X2, ChevronRight, History, RotateCw, Link2, Settings2, Download, Command } from 'lucide-react';
import { COMMAND_REGISTRY, TerminalPage, findCommand, searchCommands, parseCommand } from '../../lib/terminal/commands';
import styles from './TerminalController.module.css';
interface Props {
  activePage: TerminalPage; activeTicker: string; inputCommand: string;
  setInputCommand: (value: string) => void; onExecute: (value: string) => boolean;
  onGoBack: () => void; onGoForward: () => void; canGoBack: boolean; canGoForward: boolean;
  onOpenHelp: () => void; onOpenWatermark?: () => void; onOpenExport?: () => void;
  historyIndex: number; historyTotal: number; commandError: string;
  recentCommands: string[]; favorites: string[]; currentCommand: string;
  onToggleFavorite: () => void; onClearRecent: () => void; onRefresh: () => void;
}
export default function BloombergHeader(p: Props) {
  const [open, setOpen] = useState(false), [selected, setSelected] = useState(-1), [linkStatus, setLinkStatus] = useState('');
  const input = useRef<HTMLInputElement>(null), root = useRef<HTMLElement>(null);
  const current = findCommand(p.activePage)!;
  const query = p.inputCommand === p.currentCommand ? '' : p.inputCommand.trim();
  const words = query.split(/\s+/);
  let matches = searchCommands(query);
  let ticker: string | undefined;
  if (words.length === 2 && !matches.length && !findCommand(words[0])) { ticker = words[0]; matches = searchCommands(words[1]); }
  const options = matches.slice(0, 8).map(c => ({ command: ticker && c.ticker === 'global' ? `${ticker} ${c.code}` : c.code, label: c.label, detail: c.ticker === 'local' ? 'Instruments selected on page' : c.description }));
  const recents = !query ? p.recentCommands.slice(0, 4).map(command => ({ command, label: 'Recent command', detail: 'Open saved destination' })) : [];
  const suggestions = [...recents, ...options];
  const parsed = parseCommand(p.inputCommand, { page: p.activePage, ticker: p.activeTicker });
  const run = (command: string) => { if (p.onExecute(command)) { setOpen(false); setSelected(-1); input.current?.blur(); } };
  useEffect(() => { setSelected(-1); }, [p.inputCommand]);
  useEffect(() => { root.current?.querySelector('nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [p.activePage]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (document.querySelector('dialog[open]') || target.closest('[role="dialog"]')) return;
      const typing = target.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' || e.key === '/' && !typing) {
        e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true);
      } else if ((!typing || target === input.current) && e.key === 'F1') { e.preventDefault(); setOpen(false); p.onOpenHelp(); }
      // Alt+arrows use the browser's own history, shared with these buttons.
    };
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', outside); };
  }, [p.onOpenHelp]);
  useEffect(() => { if (selected >= 0) document.getElementById(`terminal-option-${selected}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  useEffect(() => { if (!linkStatus) return; const t = setTimeout(() => setLinkStatus(''), 2500); return () => clearTimeout(t); }, [linkStatus]);
  async function copyLink() { try { await navigator.clipboard.writeText(location.href); setLinkStatus('Link copied'); } catch { setLinkStatus('Copy the address from your browser'); } }
  return <header className={styles.header} ref={root}>
    <div className={styles.identity}>
      <a className={styles.brand} href="/" aria-label="VRP Terminal home"><span className={styles.logo}><Command size={17} /></span><strong>VRP<span>TERMINAL</span></strong></a>
      <span className={styles.workspace}>Research workspace <ChevronRight size={12} /> {current.group}</span>
      <div className={styles.actions}>
        <button onClick={p.onOpenHelp}><Grid2X2 size={14} /><span>Functions</span><kbd>F1</kbd></button>
        {p.onOpenWatermark && <button onClick={p.onOpenWatermark} aria-label="Watermark settings" title="Watermark settings"><Settings2 size={15} /></button>}
        {p.onOpenExport && <button onClick={p.onOpenExport} aria-label="Export chart" title="Export chart"><Download size={15} /></button>}
      </div>
    </div>
    <div className={styles.commandRow}>
      <div className={styles.history}>
        <button aria-label="Back" title="Back · Alt + Left" disabled={!p.canGoBack} onClick={p.onGoBack}><ArrowLeft size={17} /></button>
        <button aria-label="Forward" title="Forward · Alt + Right" disabled={!p.canGoForward} onClick={p.onGoForward}><ArrowRight size={17} /></button>
      </div>
      <div className={styles.searchWrap}>
        <form onSubmit={e => { e.preventDefault(); run(selected >= 0 ? suggestions[selected].command : p.inputCommand); }} className={`${styles.commandForm} ${p.commandError ? styles.invalid : ''}`}>
          <Search size={17} />
          <input ref={input} aria-label="Terminal command" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls="terminal-suggestions" aria-activedescendant={open && selected >= 0 ? `terminal-option-${selected}` : undefined} aria-invalid={Boolean(p.commandError)} aria-describedby={p.commandError ? 'terminal-command-error' : undefined} value={p.inputCommand} spellCheck={false} autoComplete="off" placeholder="Search functions or enter SPY GEX" onChange={e => { p.setInputCommand(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={e => { if (!e.currentTarget.parentElement?.parentElement?.contains(e.relatedTarget as Node)) setOpen(false); }} onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setSelected(-1); }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); if (suggestions.length) setSelected(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length); }
          }} />
          <kbd className={styles.hint}>Ctrl K</kbd><button type="submit" className={styles.go}>GO <ArrowUpRight size={15} /></button>
        </form>
        {open && <div className={styles.dropdown}>
          <div className={styles.dropHeading}><span>{query ? 'Matching functions' : 'Jump to a destination'}</span>{!query && p.recentCommands.length > 0 && <button onMouseDown={e => e.preventDefault()} onClick={p.onClearRecent}>Clear recent</button>}</div>
          <div role="listbox" id="terminal-suggestions" aria-label="Command suggestions" className={styles.options}>
            {suggestions.map((s, i) => <button type="button" role="option" aria-selected={selected === i} id={`terminal-option-${i}`} key={`${i}-${s.command}`} onMouseDown={e => e.preventDefault()} onClick={() => run(s.command)} className={selected === i ? styles.selected : ''}>
              <span className={styles.optionIcon}>{s.label === 'Recent command' ? <History size={16} /> : <ArrowUpRight size={16} />}</span><code>{s.command}</code><span><strong>{s.label}</strong><small>{s.detail}</small></span><ChevronRight size={14} />
            </button>)}
          </div>
          {!suggestions.length && <p className={styles.empty}>{parsed.state ? `Press Enter to open ${findCommand(parsed.state.page)?.label} for ${parsed.state.ticker}.` : 'No matching function. Check the code or open Functions.'}</p>}
          <div className={styles.dropFooter}><span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>Enter</kbd> open <kbd>Esc</kbd> close</span><button onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); p.onOpenHelp(); }}>All {COMMAND_REGISTRY.length} functions</button></div>
        </div>}
      </div>
      <button className={`${styles.iconButton} ${p.favorites.includes(p.currentCommand) ? styles.favorited : ''}`} aria-label="Favorite current command" aria-pressed={p.favorites.includes(p.currentCommand)} title="Save this destination" onClick={p.onToggleFavorite}><Star size={17} /></button>
      <button className={styles.iconButton} aria-label="Copy page link" title="Copy page link" onClick={copyLink}><Link2 size={17} /></button>
      <button className={styles.iconButton} aria-label="Reload current module" title="Reload current module" onClick={p.onRefresh}><RotateCw size={16} /></button>
    </div>
    {p.commandError && <p role="alert" id="terminal-command-error" className={styles.error}>{p.commandError}</p>}
    {linkStatus && <p role="status" className={styles.notice}>{linkStatus}</p>}
    <nav className={styles.tabs} aria-label="Dashboard functions">{COMMAND_REGISTRY.map(c => <button key={c.code} aria-current={c.page === p.activePage ? 'page' : undefined} onClick={() => run(c.code)} title={c.description}><code>{c.code}</code>{c.label}</button>)}</nav>
    {p.favorites.length > 0 && <div className={styles.favorites}><Star size={12} /><span>Pinned</span>{p.favorites.map(c => <button key={c} onClick={() => run(c)}>{c}</button>)}</div>}
    <div className={styles.breadcrumb}><span><code>{current.code}</code><strong>{current.label}</strong><ChevronRight size={12} />{current.ticker === 'global' ? <b>{p.activeTicker}</b> : 'Instruments selected on page'}</span><small aria-label="Navigation position">{p.historyIndex + 1} / {Math.max(1, p.historyTotal)} <span>in session</span></small></div>
  </header>;
}
