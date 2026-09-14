'use client';

import React, { useState, useRef, useEffect } from 'react';
import type { TerminalTheme } from '../core/TerminalThemes';
import type { IndicatorConfig, MovingAverageConfig, ICTSeekAndDestroyConfig, SessionsConfig, RSIConfig, CVDConfig, GexLevelsConfig } from '../../../types/indicators';
import { createDefaultMA, getMALabel, createDefaultICT, createDefaultSessions, createDefaultRSI, createDefaultCVD, createDefaultGexLevels } from '../../../types/indicators';
import IndicatorSettingsModal from './IndicatorSettingsModal';

// ─── Icons ────────────────────────────────────────────────────────────────────
function IconPlus() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function IconClose() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function IconEye({ visible }: { visible: boolean }) {
  return visible ? (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface IndicatorManagerProps {
  indicators: IndicatorConfig[];
  onChange: (indicators: IndicatorConfig[]) => void;
  theme: TerminalTheme;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function IndicatorManager({ indicators, onChange, theme }: IndicatorManagerProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAddMA = () => {
    const newMA = createDefaultMA({ period: [20, 50, 200][indicators.filter(i => i.type === 'moving_average').length % 3] || 20 });
    const updated = [...indicators, newMA];
    onChange(updated);
    // Auto-open settings for the newly created indicator
    setEditingId(newMA.id);
  };

  const handleAddICT = () => {
    // Only allow one ICT S&D at a time
    if (indicators.some(i => i.type === 'ict_snd')) return;
    const newICT = createDefaultICT();
    const updated = [...indicators, newICT];
    onChange(updated);
    setEditingId(newICT.id);
  };

  const handleAddSessions = () => {
    // Only allow one custom Sessions indicator at a time
    if (indicators.some(i => i.type === 'sessions')) return;
    const newSes = createDefaultSessions();
    const updated = [...indicators, newSes];
    onChange(updated);
    setEditingId(newSes.id);
  };

  const handleAddRSI = () => {
    const newRSI = createDefaultRSI();
    const updated = [...indicators, newRSI];
    onChange(updated);
    setEditingId(newRSI.id);
  };

  const handleAddCVD = () => {
    // Only one CVD at a time
    if (indicators.some(i => i.type === 'cvd')) return;
    const newCVD = createDefaultCVD();
    const updated = [...indicators, newCVD];
    onChange(updated);
    setEditingId(newCVD.id);
  };

  const handleAddGexLevels = () => {
    // Only one GEX Levels at a time
    if (indicators.some(i => i.type === 'gex_levels')) return;
    const newGex = createDefaultGexLevels();
    const updated = [...indicators, newGex];
    onChange(updated);
    // setEditingId(newGex.id); // Wait, no settings needed for GEX yet, or maybe just simple colors
  };

  const handleToggle = (id: string) => {
    onChange(indicators.map(ind => ind.id === id ? { ...ind, enabled: !ind.enabled } : ind));
  };

  const handleDelete = (id: string) => {
    onChange(indicators.filter(ind => ind.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const handleUpdate = (updated: IndicatorConfig) => {
    onChange(indicators.map(ind => ind.id === updated.id ? updated : ind));
  };

  const editingIndicator = editingId ? indicators.find(i => i.id === editingId) ?? null : null;
  const maCount = indicators.filter(i => i.type === 'moving_average').length;
  const ictCount = indicators.filter(i => i.type === 'ict_snd').length;
  const sessionsCount = indicators.filter(i => i.type === 'sessions').length;
  const rsiCount = indicators.filter(i => i.type === 'rsi').length;
  const cvdCount = indicators.filter(i => i.type === 'cvd').length;
  const gexCount = indicators.filter(i => i.type === 'gex_levels').length;
  const totalCount = maCount + ictCount + sessionsCount + rsiCount + cvdCount + gexCount;

  return (
    <>
      {/* ── Trigger Button ── */}
      <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 9px',
            fontSize: 10,
            fontFamily: 'inherit',
            background: open ? theme.accentDim : 'transparent',
            color: open ? theme.accent : theme.panelTextDim,
            border: `1px solid ${open ? `${theme.accent}50` : theme.panelBorder}`,
            borderRadius: 4,
            cursor: 'pointer',
            transition: 'all 0.12s',
            position: 'relative',
          }}
          title="Manage Indicators"
        >
          {/* Tiny sparkline icon */}
          <svg width="12" height="10" viewBox="0 0 24 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,16 7,8 12,12 17,4 22,9" />
          </svg>
          Indicators
          {totalCount > 0 && (
            <span style={{
              background: theme.accent,
              color: theme.background,
              fontSize: 8,
              fontWeight: 700,
              borderRadius: 10,
              padding: '0px 4px',
              minWidth: 14,
              textAlign: 'center',
              lineHeight: '14px',
            }}>
              {totalCount}
            </span>
          )}
          <span style={{ opacity: 0.5, fontSize: 8, marginLeft: 1 }}>{open ? '▴' : '▾'}</span>
        </button>

        {/* ── Dropdown Panel ── */}
        {open && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              zIndex: 55,
              width: 260,
              background: 'rgba(12, 12, 16, 0.97)',
              backdropFilter: 'blur(20px)',
              border: `1px solid ${theme.panelBorder}`,
              borderRadius: 8,
              boxShadow: '0 16px 50px rgba(0,0,0,0.7)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '10px 14px 8px',
              borderBottom: `1px solid ${theme.panelBorder}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: theme.panelText, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                Indicators
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: theme.panelTextDim, cursor: 'pointer', padding: 2 }}
              >
                <IconClose />
              </button>
            </div>

            {/* Moving Average Section */}
            <div style={{ padding: '8px 0' }}>
              {/* Section Header */}
              <div style={{
                padding: '4px 14px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 9, color: theme.panelTextDim, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                  Moving Averages
                </span>
                <button
                  onClick={handleAddMA}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 7px',
                    fontSize: 9,
                    fontFamily: 'inherit',
                    background: `${theme.accent}18`,
                    color: theme.accent,
                    border: `1px solid ${theme.accent}40`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontWeight: 600,
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = `${theme.accent}28`;
                    e.currentTarget.style.borderColor = `${theme.accent}80`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = `${theme.accent}18`;
                    e.currentTarget.style.borderColor = `${theme.accent}40`;
                  }}
                  title="Add Moving Average"
                >
                  <IconPlus /> Add MA
                </button>
              </div>

              {/* MA List */}
              {indicators.filter(i => i.type === 'moving_average').length === 0 ? (
                <div style={{
                  padding: '10px 14px 14px',
                  textAlign: 'center',
                  color: theme.panelTextDim,
                  fontSize: 10,
                  opacity: 0.5,
                }}>
                  No indicators added yet.
                </div>
              ) : (
                <div>
                  {indicators.filter(i => i.type === 'moving_average').map(ind => {
                    const ma = ind as MovingAverageConfig;
                    return (
                      <div
                        key={ma.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '5px 14px',
                          background: editingId === ma.id ? `${theme.accent}08` : 'transparent',
                          borderLeft: editingId === ma.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                          transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => {
                          if (editingId !== ma.id) {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          }
                        }}
                        onMouseLeave={e => {
                          if (editingId !== ma.id) {
                            e.currentTarget.style.background = 'transparent';
                          }
                        }}
                      >
                        {/* Color dot */}
                        <div style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: ma.enabled ? ma.color : theme.panelTextDim,
                          flexShrink: 0,
                          opacity: ma.enabled ? 1 : 0.4,
                          transition: 'all 0.15s',
                        }} />

                        {/* Label */}
                        <span style={{
                          flex: 1,
                          fontSize: 11,
                          color: ma.enabled ? theme.panelText : theme.panelTextDim,
                          opacity: ma.enabled ? 1 : 0.5,
                          transition: 'all 0.15s',
                          fontWeight: 500,
                        }}>
                          {getMALabel(ma)}
                        </span>

                        {/* Source badge */}
                        <span style={{
                          fontSize: 8,
                          color: theme.panelTextDim,
                          background: 'rgba(255,255,255,0.05)',
                          padding: '1px 4px',
                          borderRadius: 3,
                          opacity: ma.enabled ? 0.7 : 0.3,
                        }}>
                          {ma.source.toUpperCase()}
                        </span>

                        {/* Toggle visibility */}
                        <button
                          onClick={() => handleToggle(ma.id)}
                          title={ma.enabled ? 'Hide' : 'Show'}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: ma.enabled ? theme.panelText : theme.panelTextDim,
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            opacity: ma.enabled ? 0.7 : 0.4,
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={e => (e.currentTarget.style.opacity = ma.enabled ? '0.7' : '0.4')}
                        >
                          <IconEye visible={ma.enabled} />
                        </button>

                        {/* Edit settings */}
                        <button
                          onClick={() => { setEditingId(editingId === ma.id ? null : ma.id); }}
                          title="Edit Settings"
                          style={{
                            background: editingId === ma.id ? `${theme.accent}20` : 'none',
                            border: 'none',
                            color: editingId === ma.id ? theme.accent : theme.panelTextDim,
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = theme.accent;
                            e.currentTarget.style.background = `${theme.accent}15`;
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = editingId === ma.id ? theme.accent : theme.panelTextDim;
                            e.currentTarget.style.background = editingId === ma.id ? `${theme.accent}20` : 'none';
                          }}
                        >
                          <IconSettings />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(ma.id)}
                          title="Remove Indicator"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: theme.panelTextDim,
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 3,
                            display: 'flex',
                            alignItems: 'center',
                            transition: 'all 0.12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = theme.priceDown;
                            e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = theme.panelTextDim;
                            e.currentTarget.style.background = 'none';
                          }}
                        >
                          <IconClose />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Oscillators Section */}
            <div style={{ padding: '8px 0', borderTop: `1px solid ${theme.panelBorder}` }}>
              <div style={{
                padding: '4px 14px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 9, color: theme.panelTextDim, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                  Oscillators
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleAddRSI}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      fontSize: 9,
                      fontFamily: 'inherit',
                      background: `${theme.accent}18`,
                      color: theme.accent,
                      border: `1px solid ${theme.accent}40`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = `${theme.accent}28`;
                      e.currentTarget.style.borderColor = `${theme.accent}80`;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = `${theme.accent}18`;
                      e.currentTarget.style.borderColor = `${theme.accent}40`;
                    }}
                    title="Add RSI"
                  >
                    <IconPlus /> RSI
                  </button>
                  <button
                    onClick={handleAddCVD}
                    disabled={cvdCount > 0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      fontSize: 9,
                      fontFamily: 'inherit',
                      background: cvdCount > 0 ? 'rgba(255,255,255,0.03)' : '#26a69a18',
                      color: cvdCount > 0 ? theme.panelTextDim : '#26a69a',
                      border: `1px solid ${cvdCount > 0 ? theme.panelBorder : '#26a69a40'}`,
                      borderRadius: 4,
                      cursor: cvdCount > 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.12s',
                      opacity: cvdCount > 0 ? 0.5 : 1,
                    }}
                    title={cvdCount > 0 ? 'CVD already added' : 'Add CVD'}
                  >
                    <IconPlus /> CVD
                  </button>
                </div>
              </div>

              {/* RSI List */}
              {indicators.filter(i => i.type === 'rsi').map(ind => {
                const rsi = ind as RSIConfig;
                return (
                  <div
                    key={rsi.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 14px',
                      background: editingId === rsi.id ? `${theme.accent}08` : 'transparent',
                      borderLeft: editingId === rsi.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (editingId !== rsi.id) {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (editingId !== rsi.id) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: rsi.enabled ? rsi.color : theme.panelTextDim,
                      flexShrink: 0,
                      opacity: rsi.enabled ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }} />

                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      color: rsi.enabled ? theme.panelText : theme.panelTextDim,
                      opacity: rsi.enabled ? 1 : 0.5,
                      transition: 'all 0.15s',
                      fontWeight: 500,
                    }}>
                      RSI {rsi.period}
                    </span>

                    <span style={{
                      fontSize: 8,
                      color: theme.panelTextDim,
                      background: 'rgba(255,255,255,0.05)',
                      padding: '1px 4px',
                      borderRadius: 3,
                      opacity: rsi.enabled ? 0.7 : 0.3,
                    }}>
                      {rsi.source.toUpperCase()}
                    </span>

                    <button
                      onClick={() => handleToggle(rsi.id)}
                      title={rsi.enabled ? 'Hide' : 'Show'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: rsi.enabled ? theme.panelText : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        opacity: rsi.enabled ? 0.7 : 0.4,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = rsi.enabled ? '0.7' : '0.4')}
                    >
                      <IconEye visible={rsi.enabled} />
                    </button>

                    <button
                      onClick={() => { setEditingId(editingId === rsi.id ? null : rsi.id); }}
                      title="Edit Settings"
                      style={{
                        background: editingId === rsi.id ? `${theme.accent}20` : 'none',
                        border: 'none',
                        color: editingId === rsi.id ? theme.accent : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.accent;
                        e.currentTarget.style.background = `${theme.accent}15`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = editingId === rsi.id ? theme.accent : theme.panelTextDim;
                        e.currentTarget.style.background = editingId === rsi.id ? `${theme.accent}20` : 'none';
                      }}
                    >
                      <IconSettings />
                    </button>

                    <button
                      onClick={() => handleDelete(rsi.id)}
                      title="Remove Indicator"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.priceDown;
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = theme.panelTextDim;
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}

              {/* CVD List */}
              {indicators.filter(i => i.type === 'cvd').map(ind => {
                const cvd = ind as CVDConfig;
                return (
                  <div
                    key={cvd.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 14px',
                      background: editingId === cvd.id ? `${theme.accent}08` : 'transparent',
                      borderLeft: editingId === cvd.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (editingId !== cvd.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    }}
                    onMouseLeave={e => {
                      if (editingId !== cvd.id) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* Gradient dot for CVD */}
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: cvd.enabled
                        ? `linear-gradient(135deg, ${cvd.bullColor}, ${cvd.bearColor})`
                        : theme.panelTextDim,
                      flexShrink: 0,
                      opacity: cvd.enabled ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }} />

                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      color: cvd.enabled ? theme.panelText : theme.panelTextDim,
                      opacity: cvd.enabled ? 1 : 0.5,
                      transition: 'all 0.15s',
                      fontWeight: 500,
                    }}>
                      CVD
                    </span>

                    <span style={{
                      fontSize: 8,
                      color: theme.panelTextDim,
                      background: 'rgba(255,255,255,0.05)',
                      padding: '1px 4px',
                      borderRadius: 3,
                      opacity: cvd.enabled ? 0.7 : 0.3,
                    }}>
                      {cvd.showDivergence ? 'DIV' : 'RAW'}
                    </span>

                    <button
                      onClick={() => handleToggle(cvd.id)}
                      title={cvd.enabled ? 'Hide' : 'Show'}
                      style={{
                        background: 'none', border: 'none',
                        color: cvd.enabled ? theme.panelText : theme.panelTextDim,
                        cursor: 'pointer', padding: 3, borderRadius: 3,
                        display: 'flex', alignItems: 'center',
                        opacity: cvd.enabled ? 0.7 : 0.4, transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = cvd.enabled ? '0.7' : '0.4')}
                    >
                      <IconEye visible={cvd.enabled} />
                    </button>

                    <button
                      onClick={() => { setEditingId(editingId === cvd.id ? null : cvd.id); }}
                      title="Edit Settings"
                      style={{
                        background: editingId === cvd.id ? `${theme.accent}20` : 'none',
                        border: 'none',
                        color: editingId === cvd.id ? theme.accent : theme.panelTextDim,
                        cursor: 'pointer', padding: 3, borderRadius: 3,
                        display: 'flex', alignItems: 'center', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.accent;
                        e.currentTarget.style.background = `${theme.accent}15`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = editingId === cvd.id ? theme.accent : theme.panelTextDim;
                        e.currentTarget.style.background = editingId === cvd.id ? `${theme.accent}20` : 'none';
                      }}
                    >
                      <IconSettings />
                    </button>

                    <button
                      onClick={() => handleDelete(cvd.id)}
                      title="Remove Indicator"
                      style={{
                        background: 'none', border: 'none', color: theme.panelTextDim,
                        cursor: 'pointer', padding: 3, borderRadius: 3,
                        display: 'flex', alignItems: 'center', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.priceDown;
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = theme.panelTextDim;
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Smart Money Concepts Section */}
            <div style={{ padding: '8px 0', borderTop: `1px solid ${theme.panelBorder}` }}>
              <div style={{
                padding: '4px 14px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 9, color: theme.panelTextDim, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                  Smart Money & Greeks
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onClick={handleAddICT}
                    disabled={ictCount > 0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      fontSize: 9,
                      fontFamily: 'inherit',
                      background: ictCount > 0 ? 'transparent' : `${theme.accent}18`,
                      color: ictCount > 0 ? theme.panelTextDim : theme.accent,
                      border: `1px solid ${ictCount > 0 ? theme.panelBorder : theme.accent + '40'}`,
                      borderRadius: 4,
                      cursor: ictCount > 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.12s',
                      opacity: ictCount > 0 ? 0.5 : 1,
                    }}
                    onMouseEnter={e => {
                      if (ictCount > 0) return;
                      e.currentTarget.style.background = `${theme.accent}28`;
                      e.currentTarget.style.borderColor = `${theme.accent}80`;
                    }}
                    onMouseLeave={e => {
                      if (ictCount > 0) return;
                      e.currentTarget.style.background = `${theme.accent}18`;
                      e.currentTarget.style.borderColor = `${theme.accent}40`;
                    }}
                    title="Add ICT Seek & Destroy"
                  >
                    <IconPlus /> S&D Profile
                  </button>

                  <button
                    onClick={handleAddGexLevels}
                    disabled={gexCount > 0}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      padding: '2px 7px',
                      fontSize: 9,
                      fontFamily: 'inherit',
                      background: gexCount > 0 ? 'transparent' : 'rgba(245, 158, 11, 0.1)',
                      color: gexCount > 0 ? theme.panelTextDim : '#f59e0b',
                      border: `1px solid ${gexCount > 0 ? theme.panelBorder : 'rgba(245, 158, 11, 0.3)'}`,
                      borderRadius: 4,
                      cursor: gexCount > 0 ? 'not-allowed' : 'pointer',
                      fontWeight: 600,
                      transition: 'all 0.12s',
                      opacity: gexCount > 0 ? 0.5 : 1,
                    }}
                    onMouseEnter={e => {
                      if (gexCount > 0) return;
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)';
                    }}
                    onMouseLeave={e => {
                      if (gexCount > 0) return;
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                    }}
                    title="Add GEX Levels"
                  >
                    <IconPlus /> GEX
                  </button>
                </div>
              </div>

              {/* ICT S&D List */}
              {indicators.filter(i => i.type === 'ict_snd').map(ind => {
                const ict = ind as ICTSeekAndDestroyConfig;
                return (
                  <div
                    key={ict.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 14px',
                      background: editingId === ict.id ? `${theme.accent}08` : 'transparent',
                      borderLeft: editingId === ict.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (editingId !== ict.id) {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (editingId !== ict.id) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: ict.enabled ? '#089981' : theme.panelTextDim,
                      flexShrink: 0,
                      opacity: ict.enabled ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }} />

                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      color: ict.enabled ? theme.panelText : theme.panelTextDim,
                      opacity: ict.enabled ? 1 : 0.5,
                      transition: 'all 0.15s',
                      fontWeight: 500,
                    }}>
                      ICT S&D Profile [TFO]
                    </span>

                    <button
                      onClick={() => handleToggle(ict.id)}
                      title={ict.enabled ? 'Hide' : 'Show'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: ict.enabled ? theme.panelText : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        opacity: ict.enabled ? 0.7 : 0.4,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = ict.enabled ? '0.7' : '0.4')}
                    >
                      <IconEye visible={ict.enabled} />
                    </button>

                    <button
                      onClick={() => { setEditingId(editingId === ict.id ? null : ict.id); }}
                      title="Edit Settings"
                      style={{
                        background: editingId === ict.id ? `${theme.accent}20` : 'none',
                        border: 'none',
                        color: editingId === ict.id ? theme.accent : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.accent;
                        e.currentTarget.style.background = `${theme.accent}15`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = editingId === ict.id ? theme.accent : theme.panelTextDim;
                        e.currentTarget.style.background = editingId === ict.id ? `${theme.accent}20` : 'none';
                      }}
                    >
                      <IconSettings />
                    </button>

                    <button
                      onClick={() => handleDelete(ict.id)}
                      title="Remove Indicator"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.priceDown;
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = theme.panelTextDim;
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}

              {/* GEX Levels List */}
              {indicators.filter(i => i.type === 'gex_levels').map(ind => {
                const gex = ind as GexLevelsConfig;
                return (
                  <div
                    key={gex.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 14px',
                      background: editingId === gex.id ? `${theme.accent}08` : 'transparent',
                      borderLeft: editingId === gex.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (editingId !== gex.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    }}
                    onMouseLeave={e => {
                      if (editingId !== gex.id) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: gex.enabled ? '#f59e0b' : theme.panelTextDim,
                      flexShrink: 0,
                      opacity: gex.enabled ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }} />

                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      color: gex.enabled ? theme.panelText : theme.panelTextDim,
                      opacity: gex.enabled ? 1 : 0.5,
                      transition: 'all 0.15s',
                      fontWeight: 500,
                    }}>
                      GEX Levels
                    </span>

                    <button
                      onClick={() => handleToggle(gex.id)}
                      title={gex.enabled ? 'Hide' : 'Show'}
                      style={{
                        background: 'none', border: 'none',
                        color: gex.enabled ? theme.panelText : theme.panelTextDim,
                        cursor: 'pointer', padding: 3, borderRadius: 3,
                        display: 'flex', alignItems: 'center',
                        opacity: gex.enabled ? 0.7 : 0.4, transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = gex.enabled ? '0.7' : '0.4')}
                    >
                      <IconEye visible={gex.enabled} />
                    </button>

                    <button
                      onClick={() => handleDelete(gex.id)}
                      title="Remove Indicator"
                      style={{
                        background: 'none', border: 'none', color: theme.panelTextDim,
                        cursor: 'pointer', padding: 3, borderRadius: 3,
                        display: 'flex', alignItems: 'center', transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.priceDown;
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = theme.panelTextDim;
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Trading Sessions Section */}
            <div style={{ padding: '8px 0', borderTop: `1px solid ${theme.panelBorder}` }}>
              <div style={{
                padding: '4px 14px 6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 9, color: theme.panelTextDim, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: 600 }}>
                  Trading Sessions
                </span>
                <button
                  onClick={handleAddSessions}
                  disabled={sessionsCount > 0}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '2px 7px',
                    fontSize: 9,
                    fontFamily: 'inherit',
                    background: sessionsCount > 0 ? 'transparent' : `${theme.accent}18`,
                    color: sessionsCount > 0 ? theme.panelTextDim : theme.accent,
                    border: `1px solid ${sessionsCount > 0 ? theme.panelBorder : theme.accent + '40'}`,
                    borderRadius: 4,
                    cursor: sessionsCount > 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    transition: 'all 0.12s',
                    opacity: sessionsCount > 0 ? 0.5 : 1,
                  }}
                  onMouseEnter={e => {
                    if (sessionsCount > 0) return;
                    e.currentTarget.style.background = `${theme.accent}28`;
                    e.currentTarget.style.borderColor = `${theme.accent}80`;
                  }}
                  onMouseLeave={e => {
                    if (sessionsCount > 0) return;
                    e.currentTarget.style.background = `${theme.accent}18`;
                    e.currentTarget.style.borderColor = `${theme.accent}40`;
                  }}
                  title="Add Trading Sessions"
                >
                  <IconPlus /> Sessions
                </button>
              </div>

              {/* Sessions List */}
              {indicators.filter(i => i.type === 'sessions').map(ind => {
                const ses = ind as SessionsConfig;
                return (
                  <div
                    key={ses.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 14px',
                      background: editingId === ses.id ? `${theme.accent}08` : 'transparent',
                      borderLeft: editingId === ses.id ? `2px solid ${theme.accent}` : '2px solid transparent',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (editingId !== ses.id) {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (editingId !== ses.id) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: ses.enabled ? '#3b82f6' : theme.panelTextDim,
                      flexShrink: 0,
                      opacity: ses.enabled ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }} />

                    <span style={{
                      flex: 1,
                      fontSize: 11,
                      color: ses.enabled ? theme.panelText : theme.panelTextDim,
                      opacity: ses.enabled ? 1 : 0.5,
                      transition: 'all 0.15s',
                      fontWeight: 500,
                    }}>
                      Session Highlighter
                    </span>

                    <button
                      onClick={() => handleToggle(ses.id)}
                      title={ses.enabled ? 'Hide' : 'Show'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: ses.enabled ? theme.panelText : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        opacity: ses.enabled ? 0.7 : 0.4,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = ses.enabled ? '0.7' : '0.4')}
                    >
                      <IconEye visible={ses.enabled} />
                    </button>

                    <button
                      onClick={() => { setEditingId(editingId === ses.id ? null : ses.id); }}
                      title="Edit Settings"
                      style={{
                        background: editingId === ses.id ? `${theme.accent}20` : 'none',
                        border: 'none',
                        color: editingId === ses.id ? theme.accent : theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.accent;
                        e.currentTarget.style.background = `${theme.accent}15`;
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = editingId === ses.id ? theme.accent : theme.panelTextDim;
                        e.currentTarget.style.background = editingId === ses.id ? `${theme.accent}20` : 'none';
                      }}
                    >
                      <IconSettings />
                    </button>

                    <button
                      onClick={() => handleDelete(ses.id)}
                      title="Remove Indicator"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: theme.panelTextDim,
                        cursor: 'pointer',
                        padding: 3,
                        borderRadius: 3,
                        display: 'flex',
                        alignItems: 'center',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = theme.priceDown;
                        e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = theme.panelTextDim;
                        e.currentTarget.style.background = 'none';
                      }}
                    >
                      <IconClose />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Settings Modal (outside dropdown so it doesn't close) ── */}
      {editingIndicator && (
        <IndicatorSettingsModal
          indicator={editingIndicator}
          theme={theme}
          onUpdate={handleUpdate}
          onClose={() => setEditingId(null)}
        />
      )}
    </>
  );
}
