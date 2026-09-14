import React, { useState, useEffect, useRef } from 'react';
import type { TerminalTheme } from './TerminalThemes';

interface TickerSearchDropdownProps {
  value: string;
  onChange: (ticker: string) => void;
  theme: TerminalTheme;
}

interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  type: string;
}

const POPULAR_TICKERS: SearchResult[] = [
  { symbol: 'SPY', shortname: 'S&P 500 ETF Trust', exchange: 'NYSE Arca', type: 'ETF' },
  { symbol: 'QQQ', shortname: 'Invesco QQQ Trust', exchange: 'NASDAQ', type: 'ETF' },
  { symbol: 'IWM', shortname: 'iShares Russell 2000 ETF', exchange: 'NYSE Arca', type: 'ETF' },
  { symbol: 'AAPL', shortname: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'TSLA', shortname: 'Tesla, Inc.', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'NVDA', shortname: 'NVIDIA Corporation', exchange: 'NASDAQ', type: 'EQUITY' },
  { symbol: 'BTC-USD', shortname: 'Bitcoin USD', exchange: 'CCC', type: 'CRYPTO' },
  { symbol: 'ETH-USD', shortname: 'Ethereum USD', exchange: 'CCC', type: 'CRYPTO' },
  { symbol: 'GC=F', shortname: 'Gold Futures', exchange: 'COMEX', type: 'COMMODITY' },
  { symbol: 'EURUSD=X', shortname: 'EUR/USD Currency', exchange: 'CCY', type: 'FOREX' },
];

export default function TickerSearchDropdown({ value, onChange, theme }: TickerSearchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync internal query with parent value when not focused / open
  useEffect(() => {
    if (!isOpen) {
      setQuery(value);
    }
  }, [value, isOpen]);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced API Search
  useEffect(() => {
    if (!isOpen) return;
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
          const data = await response.json();
          setResults(data.quotes || []);
        }
      } catch (err) {
        console.error('Ticker search error:', err);
      } finally {
        setLoading(false);
        setActiveIndex(-1);
      }
    }, 220); // 220ms debounce

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // Keyboard navigation handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        setActiveIndex(0);
      }
      return;
    }

    const currentList = query.trim() ? results : POPULAR_TICKERS;
    const maxItems = currentList.length;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1 >= maxItems ? 0 : prev + 1));
        break;

      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 < 0 ? maxItems - 1 : prev - 1));
        break;

      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < maxItems) {
          const selected = currentList[activeIndex];
          selectTicker(selected.symbol);
        } else if (query.trim()) {
          // If typed query is not in list but Enter is pressed, submit query directly
          selectTicker(query.trim().toUpperCase());
        }
        break;

      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        inputRef.current?.blur();
        break;
    }
  };

  const selectTicker = (symbol: string) => {
    const cleanSymbol = symbol.trim().toUpperCase();
    onChange(cleanSymbol);
    setQuery(cleanSymbol);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const activeList = query.trim() ? results : POPULAR_TICKERS;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        fontFamily: 'inherit',
      }}
    >
      {/* Search Input field inside header top-bar */}
      <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => {
            setIsOpen(true);
            setActiveIndex(-1);
            setQuery(''); // Clear on focus for quick new typing, TradingView style
          }}
          onBlur={() => {
            // Keep value if closed empty
            setTimeout(() => {
              if (!isOpen) setQuery(value);
            }, 150);
          }}
          onKeyDown={handleKeyDown}
          style={{
            background: isOpen ? `${theme.accent}12` : 'transparent',
            border: isOpen ? `1px solid ${theme.accent}44` : '1px solid transparent',
            borderRadius: 4,
            outline: 'none',
            color: theme.panelText,
            fontSize: 13,
            fontWeight: 700,
            width: 110,
            padding: '3px 8px',
            fontFamily: 'inherit',
            letterSpacing: 0.5,
            caretColor: theme.accent,
            transition: 'all 0.15s ease',
          }}
          placeholder="SEARCH..."
        />
        {/* Simple search indicator inside the input */}
        <span
          style={{
            position: 'absolute',
            right: 8,
            fontSize: 9,
            opacity: 0.35,
            pointerEvents: 'none',
            color: theme.panelTextDim,
          }}
        >
          {loading ? '...' : isOpen ? 'ESC' : '🔍'}
        </span>
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 5,
            zIndex: 100,
            background: theme.panelBg,
            border: `1px solid ${theme.panelBorder}`,
            borderRadius: 6,
            minWidth: 360,
            maxWidth: 420,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.7)',
            overflow: 'hidden',
            fontFamily: 'inherit',
            animation: 'fadeIn 0.1s ease-out',
          }}
        >
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(-4px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          {/* Section Header */}
          <div
            style={{
              padding: '6px 12px',
              fontSize: 9,
              color: theme.panelTextDim,
              borderBottom: `1px solid ${theme.panelBorder}`,
              background: `${theme.panelBg}dd`,
              fontWeight: 700,
              letterSpacing: 1,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>{query.trim() ? 'SEARCH RESULTS' : 'POPULAR TICKERS'}</span>
            <span>{activeList.length} SYMBOLS</span>
          </div>

          {/* List Area */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {loading && activeList.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: theme.panelTextDim, fontSize: 11 }}>
                Searching Yahoo Finance...
              </div>
            ) : activeList.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: theme.panelTextDim, fontSize: 11 }}>
                No symbols found for "{query}"
              </div>
            ) : (
              activeList.map((item, idx) => {
                const isSelected = idx === activeIndex;
                return (
                  <div
                    key={item.symbol + idx}
                    onClick={() => selectTicker(item.symbol)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: isSelected ? theme.accentDim : 'transparent',
                      borderBottom: `1px solid ${theme.panelBorder}33`,
                      transition: 'background 0.08s ease',
                    }}
                  >
                    {/* Left: Ticker code & Exchange badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: isSelected ? theme.accent : theme.panelText,
                        }}
                      >
                        {item.symbol}
                      </span>
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 700,
                          padding: '1px 4px',
                          borderRadius: 2,
                          background: `${theme.panelTextDim}22`,
                          color: theme.panelTextDim,
                        }}
                      >
                        {item.exchange}
                      </span>
                    </div>

                    {/* Right: Company name / description */}
                    <span
                      style={{
                        fontSize: 10,
                        color: isSelected ? theme.panelText : theme.panelTextDim,
                        maxWidth: 180,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        textAlign: 'right',
                      }}
                      title={item.shortname}
                    >
                      {item.shortname}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          {/* Dropdown Footer help text */}
          <div
            style={{
              padding: '6px 12px',
              fontSize: 8,
              color: theme.panelTextDim,
              borderTop: `1px solid ${theme.panelBorder}`,
              background: `${theme.panelBg}aa`,
              opacity: 0.6,
              display: 'flex',
              gap: 12,
            }}
          >
            <span>↑↓ Navigate</span>
            <span>Enter Select</span>
            <span>Esc Close</span>
          </div>
        </div>
      )}
    </div>
  );
}
