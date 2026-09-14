'use client';

import React, { useState, useRef, useCallback } from 'react';
import type { TerminalTheme } from './TerminalThemes';
import type { Drawing } from './TerminalDrawingOverlay';

// ── Icon helpers ───────────────────────────────────────────────────────────────
const TypeIconMap: Record<Drawing['type'], React.ReactNode> = {
  trendline: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="12" x2="13" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  horizontal_line: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  fibonacci: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="11" x2="13" y2="11" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="7.5" x2="13" y2="7.5" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="4.5" x2="13" y2="4.5" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="2.5" x2="13" y2="2.5" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="2" x2="1" y2="12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  rectangle: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1.5" y="3" width="11" height="8" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  long_position: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="5" width="12" height="5" fill="rgba(34,197,94,0.2)" stroke="rgba(34,197,94,0.7)" strokeWidth="1" />
      <rect x="1" y="9" width="12" height="3" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
      <line x1="1" y1="9" x2="13" y2="9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  short_position: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="3" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
      <rect x="1" y="4" width="12" height="5" fill="rgba(34,197,94,0.2)" stroke="rgba(34,197,94,0.7)" strokeWidth="1" />
      <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  anchored_volume_profile: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="3" width="6" height="2" fill="currentColor" fillOpacity="0.3" stroke="none" />
      <rect x="2" y="6" width="10" height="2" fill="currentColor" fillOpacity="0.8" stroke="none" />
      <rect x="2" y="9" width="4" height="2" fill="currentColor" fillOpacity="0.3" stroke="none" />
      <line x1="2" y1="1" x2="2" y2="13" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  label: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M4.5 5.5H9.5M4.5 8.5H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

const TYPE_LABELS: Record<Drawing['type'], string> = {
  trendline: 'Trend Line',
  horizontal_line: 'Horizontal Line',
  fibonacci: 'Fibonacci',
  rectangle: 'Rectangle',
  long_position: 'Long Position',
  short_position: 'Short Position',
  anchored_volume_profile: 'Anchored Vol Profile',
  label: 'Text Label',
};

// ── Undo stack type ────────────────────────────────────────────────────────────
interface DeletedDrawing {
  drawing: Drawing;
  index: number;
  timestamp: number;
}

// ── Props ──────────────────────────────────────────────────────────────────────
interface DrawingObjectTreeProps {
  drawings: Drawing[];
  theme: TerminalTheme;
  onUpdate: (drawings: Drawing[]) => void;
  onClose: () => void;
}

// ── Color presets ─────────────────────────────────────────────────────────────
const COLOR_PRESETS = [
  '#f97316', '#ef4444', '#22c55e', '#3b82f6',
  '#a855f7', '#f59e0b', '#06b6d4', '#ec4899',
  '#ffffff', '#6b7280',
];

// ── Main Component ─────────────────────────────────────────────────────────────
export default function DrawingObjectTree({ drawings, theme, onUpdate, onClose }: DrawingObjectTreeProps) {
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [editLabel, setEditLabel]       = useState('');
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const [deletedStack, setDeletedStack] = useState<DeletedDrawing[]>([]);
  const [hoveredId, setHoveredId]       = useState<string | null>(null);
  const [searchText, setSearchText]     = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const updateDrawing = useCallback((id: string, patch: Partial<Drawing>) => {
    onUpdate(drawings.map(d => d.id === id ? { ...d, ...patch } : d));
  }, [drawings, onUpdate]);

  const deleteDrawing = useCallback((id: string) => {
    const idx = drawings.findIndex(d => d.id === id);
    if (idx === -1) return;
    const deleted = drawings[idx];
    setDeletedStack(prev => [
      { drawing: deleted, index: idx, timestamp: Date.now() },
      ...prev.slice(0, 9), // max 10 undo steps
    ]);
    onUpdate(drawings.filter(d => d.id !== id));
  }, [drawings, onUpdate]);

  const undoDelete = useCallback(() => {
    if (deletedStack.length === 0) return;
    const [last, ...rest] = deletedStack;
    const newDrawings = [...drawings];
    newDrawings.splice(last.index, 0, last.drawing);
    onUpdate(newDrawings);
    setDeletedStack(rest);
  }, [deletedStack, drawings, onUpdate]);

  const toggleVisible = useCallback((id: string) => {
    const d = drawings.find(x => x.id === id);
    if (!d) return;
    updateDrawing(id, { visible: !d.visible });
  }, [drawings, updateDrawing]);

  const startEdit = useCallback((d: Drawing) => {
    setEditingId(d.id);
    setEditLabel(d.label || TYPE_LABELS[d.type]);
    setTimeout(() => inputRef.current?.select(), 30);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    updateDrawing(editingId, { label: editLabel.trim() || undefined });
    setEditingId(null);
  }, [editingId, editLabel, updateDrawing]);

  const clearAll = useCallback(() => {
    // Save all to undo stack (one batch entry per drawing)
    const batch = drawings.map((d, i) => ({ drawing: d, index: i, timestamp: Date.now() }));
    setDeletedStack(prev => [...batch, ...prev].slice(0, 20));
    onUpdate([]);
  }, [drawings, onUpdate]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = searchText
    ? drawings.filter(d => {
        const lbl = (d.label || TYPE_LABELS[d.type]).toLowerCase();
        return lbl.includes(searchText.toLowerCase());
      })
    : drawings;

  // ── Styles (inline, theme-aware) ──────────────────────────────────────────
  const s = {
    panel: {
      position: 'absolute' as const,
      top: 0,
      right: 0,
      bottom: 0,
      width: 240,
      display: 'flex',
      flexDirection: 'column' as const,
      background: theme.panelBg,
      borderLeft: `1px solid ${theme.panelBorder}`,
      zIndex: 30,
      fontFamily: "'JetBrains Mono','Fira Code',monospace",
      boxShadow: '-8px 0 32px rgba(0,0,0,0.4)',
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 10px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      flexShrink: 0,
    },
    headerTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: theme.panelText,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.5,
    },
    iconBtn: {
      background: 'transparent',
      border: 'none',
      color: theme.panelTextDim,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 3,
      borderRadius: 3,
    },
    searchBox: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 10px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      flexShrink: 0,
    },
    searchInput: {
      flex: 1,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: theme.panelText,
      fontSize: 10,
      fontFamily: 'inherit',
      caretColor: theme.accent,
    },
    toolbar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 10px',
      borderBottom: `1px solid ${theme.panelBorder}`,
      flexShrink: 0,
    },
    list: {
      flex: 1,
      overflowY: 'auto' as const,
    },
    emptyState: {
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      padding: '40px 20px',
      color: theme.panelTextDim,
      opacity: 0.5,
      fontSize: 10,
      textAlign: 'center' as const,
    },
  };

  return (
    <div style={s.panel}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={s.header}>
        <div style={s.headerTitle}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2" strokeLinecap="round">
            <path d="M3 3h18v4H3zM3 10h12v4H3zM3 17h8v4H3z" />
          </svg>
          OBJECT TREE
          <span style={{
            background: theme.accentDim,
            color: theme.accent,
            fontSize: 9,
            fontWeight: 700,
            padding: '0px 5px',
            borderRadius: 3,
            letterSpacing: 0.5,
          }}>
            {drawings.length}
          </span>
        </div>
        {/* Close button */}
        <button
          style={s.iconBtn}
          onClick={onClose}
          title="Close"
          onMouseEnter={e => (e.currentTarget.style.color = theme.panelText)}
          onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <div style={s.searchBox}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={theme.panelTextDim} strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          style={s.searchInput}
          placeholder="Filter objects..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
        />
        {searchText && (
          <button style={{ ...s.iconBtn, padding: 1 }} onClick={() => setSearchText('')}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={theme.panelTextDim} strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
      <div style={s.toolbar}>
        <div style={{ display: 'flex', gap: 2 }}>
          {/* Show all */}
          <button
            style={{ ...s.iconBtn, fontSize: 9, padding: '2px 6px', color: theme.panelTextDim }}
            title="Show All"
            onClick={() => onUpdate(drawings.map(d => ({ ...d, visible: true })))}
            onMouseEnter={e => (e.currentTarget.style.color = theme.priceUp)}
            onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          {/* Hide all */}
          <button
            style={{ ...s.iconBtn, fontSize: 9, padding: '2px 6px', color: theme.panelTextDim }}
            title="Hide All"
            onClick={() => onUpdate(drawings.map(d => ({ ...d, visible: false })))}
            onMouseEnter={e => (e.currentTarget.style.color = theme.panelTextDim)}
            onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {/* Undo delete */}
          {deletedStack.length > 0 && (
            <button
              style={{ ...s.iconBtn, padding: '2px 6px', color: theme.accent, fontSize: 9 }}
              title={`Undo delete (${deletedStack.length})`}
              onClick={undoDelete}
              onMouseEnter={e => (e.currentTarget.style.background = theme.accentDim)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
              <span style={{ marginLeft: 3, fontSize: 9 }}>{deletedStack.length}</span>
            </button>
          )}
          {/* Clear all */}
          {drawings.length > 0 && (
            <button
              style={{ ...s.iconBtn, padding: '2px 6px', color: theme.priceDown, fontSize: 9 }}
              title="Clear All Drawings"
              onClick={clearAll}
              onMouseEnter={e => (e.currentTarget.style.background = `${theme.priceDown}15`)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── List ─────────────────────────────────────────────────────────────── */}
      <div style={s.list}>
        {filtered.length === 0 ? (
          <div style={s.emptyState}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            {drawings.length === 0
              ? <span>No drawings yet.<br/>Use tools to draw on the chart.</span>
              : <span>No results for "{searchText}"</span>
            }
          </div>
        ) : (
          filtered.map((d, idx) => (
            <DrawingRow
              key={d.id}
              drawing={d}
              index={idx}
              theme={theme}
              isEditing={editingId === d.id}
              editLabel={editLabel}
              editRef={inputRef}
              isHovered={hoveredId === d.id}
              showColorPicker={showColorPicker === d.id}
              onHover={setHoveredId}
              onToggleVisible={toggleVisible}
              onStartEdit={startEdit}
              onEditLabelChange={setEditLabel}
              onCommitEdit={commitEdit}
              onDelete={deleteDrawing}
              onOpenColorPicker={(id) => setShowColorPicker(showColorPicker === id ? null : id)}
              onCloseColorPicker={() => setShowColorPicker(null)}
              onColorChange={(id, color) => {
                updateDrawing(id, { color });
                setShowColorPicker(null);
              }}
            />
          ))
        )}
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 10px',
        borderTop: `1px solid ${theme.panelBorder}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      }}>
        <span style={{ color: theme.panelTextDim, fontSize: 9, opacity: 0.6 }}>
          {drawings.filter(d => d.visible !== false).length} visible · {drawings.length} total
        </span>
        {deletedStack.length > 0 && (
          <span style={{ color: theme.accent, fontSize: 9, opacity: 0.7 }}>
            · {deletedStack.length} in undo
          </span>
        )}
      </div>
    </div>
  );
}

// ── Row Sub-component ──────────────────────────────────────────────────────────
interface DrawingRowProps {
  drawing: Drawing;
  index: number;
  theme: TerminalTheme;
  isEditing: boolean;
  editLabel: string;
  editRef: React.RefObject<HTMLInputElement>;
  isHovered: boolean;
  showColorPicker: boolean;
  onHover: (id: string | null) => void;
  onToggleVisible: (id: string) => void;
  onStartEdit: (d: Drawing) => void;
  onEditLabelChange: (v: string) => void;
  onCommitEdit: () => void;
  onDelete: (id: string) => void;
  onOpenColorPicker: (id: string) => void;
  onCloseColorPicker: () => void;
  onColorChange: (id: string, color: string) => void;
}

function DrawingRow({
  drawing, theme, isEditing, editLabel, editRef, isHovered,
  showColorPicker, onHover, onToggleVisible, onStartEdit,
  onEditLabelChange, onCommitEdit, onDelete,
  onOpenColorPicker, onCloseColorPicker, onColorChange,
}: DrawingRowProps) {
  const isHidden = drawing.visible === false;
  const effectiveColor = drawing.color || theme.drawingDefault;
  const label = drawing.label || TYPE_LABELS[drawing.type] || drawing.type;

  return (
    <div
      style={{
        position: 'relative',
        borderBottom: `1px solid ${theme.panelBorder}22`,
      }}
      onMouseEnter={() => onHover(drawing.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px 5px 10px',
          background: isHovered ? `${theme.accent}08` : 'transparent',
          transition: 'background 0.1s',
          opacity: isHidden ? 0.4 : 1,
        }}
      >
        {/* Type icon */}
        <span style={{ color: effectiveColor, flexShrink: 0, lineHeight: 0 }}>
          {TypeIconMap[drawing.type]}
        </span>

        {/* Label / Edit */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input
              ref={editRef}
              value={editLabel}
              onChange={e => onEditLabelChange(e.target.value)}
              onBlur={onCommitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') onCommitEdit();
                if (e.key === 'Escape') onCommitEdit();
              }}
              style={{
                width: '100%',
                background: `${theme.accent}15`,
                border: `1px solid ${theme.accent}40`,
                borderRadius: 3,
                color: theme.panelText,
                fontSize: 10,
                fontFamily: 'inherit',
                padding: '1px 4px',
                outline: 'none',
              }}
            />
          ) : (
            <span
              style={{
                color: theme.panelText,
                fontSize: 10,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap' as const,
                cursor: 'default',
              }}
              onDoubleClick={() => onStartEdit(drawing)}
              title={label + ' (double-click to rename)'}
            >
              {label}
            </span>
          )}
          <span style={{
            display: 'block',
            fontSize: 8,
            color: theme.panelTextDim,
            opacity: 0.6,
          }}>
            {drawing.startPrice.toFixed(2)} → {drawing.endPrice.toFixed(2)}
          </span>
        </div>

        {/* Action buttons — shown on hover */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexShrink: 0,
          opacity: isHovered ? 1 : 0,
          transition: 'opacity 0.12s',
        }}>
          {/* Color swatch */}
          <button
            title="Change color"
            onClick={() => onOpenColorPicker(drawing.id)}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: effectiveColor,
              border: `1px solid ${effectiveColor}80`,
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0,
            }}
          />

          {/* Rename */}
          <button
            title="Rename (double-click label)"
            onClick={() => onStartEdit(drawing)}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.panelTextDim,
              cursor: 'pointer',
              padding: '2px 3px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = theme.panelText)}
            onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>

          {/* Toggle visible */}
          <button
            title={isHidden ? 'Show' : 'Hide'}
            onClick={() => onToggleVisible(drawing.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: isHidden ? theme.panelTextDim : theme.priceUp,
              cursor: 'pointer',
              padding: '2px 3px',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {isHidden ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          {/* Delete */}
          <button
            title="Delete"
            onClick={() => onDelete(drawing.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.panelTextDim,
              cursor: 'pointer',
              padding: '2px 3px',
              display: 'flex',
              alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = theme.priceDown)}
            onMouseLeave={e => (e.currentTarget.style.color = theme.panelTextDim)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Color Picker Dropdown ──────────────────────────────────────────── */}
      {showColorPicker && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onClick={onCloseColorPicker}
          />
          <div style={{
            position: 'absolute',
            right: 8,
            top: '100%',
            zIndex: 110,
            background: theme.panelBg,
            border: `1px solid ${theme.panelBorder}`,
            borderRadius: 6,
            padding: 8,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 4,
            width: 120,
          }}>
            {COLOR_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => onColorChange(drawing.id, color)}
                title={color}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 4,
                  background: color,
                  border: effectiveColor === color
                    ? `2px solid ${theme.panelText}`
                    : `1px solid ${color}60`,
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'transform 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
