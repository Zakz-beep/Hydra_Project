'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { TerminalTheme } from '../core/TerminalThemes';
import type { MovingAverageConfig, MAType, MASource, LineStyleType, ICTSeekAndDestroyConfig, SessionsConfig, SessionItem, RSIConfig, CVDConfig } from '../../../types/indicators';
import type { IndicatorConfig } from '../../../types/indicators';

// ─── Sub-components ───────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: '#555', marginBottom: 8, marginTop: 4 }}>
      {children}
    </div>
  );
}

interface SegmentedProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  theme: TerminalTheme;
}
function Segmented({ options, value, onChange, theme }: SegmentedProps) {
  return (
    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 5, padding: 2, gap: 2 }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              padding: '4px 6px',
              fontSize: 10,
              fontFamily: 'inherit',
              fontWeight: active ? 700 : 400,
              background: active ? theme.accent : 'transparent',
              color: active ? theme.background : theme.panelTextDim,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  theme: TerminalTheme;
}
function Slider({ label, value, min, max, step = 1, onChange, format, theme }: SliderProps) {
  const display = format ? format(value) : String(value);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span style={{ fontSize: 10, color: theme.panelTextDim, width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: '100%',
            accentColor: theme.accent,
            cursor: 'pointer',
            height: 3,
          }}
        />
      </div>
      <span style={{
        fontSize: 10,
        color: theme.panelText,
        fontWeight: 600,
        minWidth: 32,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {display}
      </span>
    </div>
  );
}

interface FieldRowProps {
  label: string;
  children: React.ReactNode;
  theme: TerminalTheme;
}
function FieldRow({ label, children, theme }: FieldRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span style={{ fontSize: 10, color: theme.panelTextDim, width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

const selectStyle = (theme: TerminalTheme): React.CSSProperties => ({
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${theme.panelBorder}`,
  borderRadius: 5,
  color: theme.panelText,
  fontSize: 10,
  fontFamily: 'inherit',
  padding: '5px 8px',
  outline: 'none',
  cursor: 'pointer',
});

const numInputStyle = (theme: TerminalTheme): React.CSSProperties => ({
  width: '100%',
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${theme.panelBorder}`,
  borderRadius: 5,
  color: theme.panelText,
  fontSize: 10,
  fontFamily: 'inherit',
  padding: '5px 8px',
  outline: 'none',
});

// ─── Main Modal ───────────────────────────────────────────────────────────────
interface IndicatorSettingsModalProps {
  indicator: IndicatorConfig;
  theme: TerminalTheme;
  onUpdate: (updated: IndicatorConfig) => void;
  onClose: () => void;
}

export default function IndicatorSettingsModal({
  indicator,
  theme,
  onUpdate,
  onClose,
}: IndicatorSettingsModalProps) {
  // Local draft state — applied only on "Apply"
  const [draft, setDraft] = useState<IndicatorConfig>({ ...indicator });
  const modalRef = useRef<HTMLDivElement>(null);

  // Sync when indicator prop changes (e.g. switching between indicators)
  useEffect(() => {
    setDraft({ ...indicator });
  }, [indicator.id]);

  // Live-preview: push draft to parent on every change
  useEffect(() => {
    onUpdate({ ...draft });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const setMA = <K extends keyof MovingAverageConfig>(key: K, value: MovingAverageConfig[K]) => {
    setDraft(prev => (prev.type === 'moving_average' ? { ...prev, [key]: value } as MovingAverageConfig : prev));
  };

  const setICT = <K extends keyof ICTSeekAndDestroyConfig>(key: K, value: ICTSeekAndDestroyConfig[K]) => {
    setDraft(prev => (prev.type === 'ict_snd' ? { ...prev, [key]: value } as ICTSeekAndDestroyConfig : prev));
  };

  const setSessions = <K extends keyof SessionsConfig>(key: K, value: SessionsConfig[K]) => {
    setDraft(prev => (prev.type === 'sessions' ? { ...prev, [key]: value } as SessionsConfig : prev));
  };

  const setRSI = <K extends keyof RSIConfig>(key: K, value: RSIConfig[K]) => {
    setDraft(prev => (prev.type === 'rsi' ? { ...prev, [key]: value } as RSIConfig : prev));
  };

  const setCVD = <K extends keyof CVDConfig>(key: K, value: CVDConfig[K]) => {
    setDraft(prev => (prev.type === 'cvd' ? { ...prev, [key]: value } as CVDConfig : prev));
  };

  const Toggle = ({ label, checked, onChange, theme }: { label: string, checked: boolean, onChange: () => void, theme: TerminalTheme }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <div
        onClick={onChange}
        style={{
          width: 34,
          height: 18,
          borderRadius: 9,
          background: checked ? theme.accent : 'rgba(255,255,255,0.1)',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }} />
      </div>
      <span style={{ fontSize: 10, color: checked ? theme.panelText : theme.panelTextDim }}>
        {label}
      </span>
    </label>
  );

  const maTypes: { value: MAType; label: string }[] = [
    { value: 'SMA', label: 'SMA' },
    { value: 'EMA', label: 'EMA' },
    { value: 'WMA', label: 'WMA' },
    { value: 'DEMA', label: 'DEMA' },
    { value: 'TEMA', label: 'TEMA' },
    { value: 'KAMA', label: 'KAMA' },
  ];

  const sourceOptions: { value: MASource; label: string }[] = [
    { value: 'close', label: 'Close' },
    { value: 'open', label: 'Open' },
    { value: 'high', label: 'High' },
    { value: 'low', label: 'Low' },
    { value: 'hl2', label: 'HL/2' },
    { value: 'hlc3', label: 'HLC/3' },
    { value: 'ohlc4', label: 'OHLC/4' },
  ];

  const lineStyleOptions: { value: LineStyleType; label: string }[] = [
    { value: 'solid', label: 'Solid' },
    { value: 'dashed', label: 'Dashed' },
    { value: 'dotted', label: 'Dotted' },
  ];

  return (
    <>
      {/* ── Modal ── */}
      <div
        ref={modalRef}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 200,
          width: 360,
          background: 'rgba(10, 10, 14, 0.97)',
          backdropFilter: 'blur(24px)',
          border: `1px solid ${theme.panelBorder}`,
          borderRadius: 10,
          boxShadow: '0 24px 80px rgba(0,0,0,0.85)',
          fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
          overflow: 'hidden',
        }}
      >
        {/* ─ Header ─ */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 10px',
          borderBottom: `1px solid ${theme.panelBorder}`,
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Color dot as mini header accent */}
            <div style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: draft.type === 'moving_average' ? draft.color : '#089981',
              boxShadow: `0 0 8px ${draft.type === 'moving_average' ? draft.color : '#089981'}80`,
            }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: theme.panelText, letterSpacing: 0.3 }}>
              {draft.type === 'moving_average' ? 'Moving Average' : 'ICT Seek & Destroy'}
            </span>
            {draft.type === 'moving_average' && (
              <span style={{
                fontSize: 9,
                color: theme.accent,
                background: theme.accentDim,
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
              }}>
                {draft.maType} {draft.period}
              </span>
            )}
            {draft.type === 'ict_snd' && (
              <span style={{
                fontSize: 9,
                color: theme.accent,
                background: theme.accentDim,
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
              }}>
                Profile [TFO]
              </span>
            )}
            {draft.type === 'rsi' && (
              <span style={{
                fontSize: 9,
                color: theme.accent,
                background: theme.accentDim,
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
              }}>
                {draft.period}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: theme.panelTextDim,
              cursor: 'pointer',
              padding: 4,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = theme.panelText;
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = theme.panelTextDim;
              e.currentTarget.style.background = 'none';
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ─ Body ─ */}
        <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '75vh', overflowY: 'auto' }}>
          {draft.type === 'moving_average' ? (
            <>
              {/* == TYPE == */}
              <div>
                <SectionTitle>Type</SectionTitle>
                <Segmented
                  options={maTypes}
                  value={draft.maType}
                  onChange={v => setMA('maType', v as MAType)}
                  theme={theme}
                />
              </div>

              {/* == INPUTS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Inputs</SectionTitle>

                <FieldRow label="Period" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={draft.period}
                      onChange={e => {
                        const v = Math.max(1, Math.min(500, parseInt(e.target.value) || 1));
                        setMA('period', v);
                      }}
                      style={{ ...numInputStyle(theme), width: 70 }}
                    />
                    {/* Quick presets */}
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[9, 20, 50, 100, 200].map(p => (
                        <button
                          key={p}
                          onClick={() => setMA('period', p)}
                          style={{
                            padding: '3px 6px',
                            fontSize: 9,
                            fontFamily: 'inherit',
                            background: draft.period === p ? theme.accentDim : 'rgba(255,255,255,0.04)',
                            color: draft.period === p ? theme.accent : theme.panelTextDim,
                            border: `1px solid ${draft.period === p ? `${theme.accent}50` : theme.panelBorder}`,
                            borderRadius: 4,
                            cursor: 'pointer',
                            transition: 'all 0.1s',
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </FieldRow>

                {draft.maType === 'KAMA' && (
                  <>
                    <FieldRow label="Fast EMA" theme={theme}>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={draft.kamaFast ?? 2}
                        onChange={e => {
                          const v = Math.max(1, Math.min(100, parseInt(e.target.value) || 2));
                          setMA('kamaFast', v);
                        }}
                        style={{ ...numInputStyle(theme), width: 70 }}
                      />
                    </FieldRow>
                    <FieldRow label="Slow EMA" theme={theme}>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={draft.kamaSlow ?? 30}
                        onChange={e => {
                          const v = Math.max(1, Math.min(500, parseInt(e.target.value) || 30));
                          setMA('kamaSlow', v);
                        }}
                        style={{ ...numInputStyle(theme), width: 70 }}
                      />
                    </FieldRow>
                  </>
                )}

                <FieldRow label="Source" theme={theme}>
                  <select
                    value={draft.source}
                    onChange={e => setMA('source', e.target.value as MASource)}
                    style={selectStyle(theme)}
                  >
                    {sourceOptions.map(o => (
                      <option key={o.value} value={o.value} style={{ background: theme.panelBg }}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>

                <FieldRow label="Offset" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={-500}
                      max={500}
                      value={draft.offset}
                      onChange={e => setMA('offset', parseInt(e.target.value) || 0)}
                      style={{ ...numInputStyle(theme), width: 70 }}
                    />
                    <span style={{ fontSize: 9, color: theme.panelTextDim, opacity: 0.6 }}>bars</span>
                    {draft.offset !== 0 && (
                      <button
                        onClick={() => setMA('offset', 0)}
                        style={{
                          fontSize: 9,
                          fontFamily: 'inherit',
                          background: 'rgba(255,255,255,0.04)',
                          border: `1px solid ${theme.panelBorder}`,
                          color: theme.panelTextDim,
                          borderRadius: 4,
                          padding: '3px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </FieldRow>
              </div>

              {/* == STYLE == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SectionTitle>Style</SectionTitle>

                {/* Color row */}
                <FieldRow label="Color" theme={theme}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {/* Native color picker */}
                    <div style={{ position: 'relative' }}>
                      <input
                        type="color"
                        value={draft.color}
                        onChange={e => setMA('color', e.target.value)}
                        style={{
                          width: 32,
                          height: 28,
                          padding: 2,
                          border: `1px solid ${theme.panelBorder}`,
                          borderRadius: 5,
                          background: 'transparent',
                          cursor: 'pointer',
                        }}
                      />
                    </div>
                    {/* Preset swatches */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {['#f97316', '#ef4444', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b', '#ffffff', '#94a3b8'].map(c => (
                        <button
                          key={c}
                          onClick={() => setMA('color', c)}
                          title={c}
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            background: c,
                            border: draft.color === c ? `2.5px solid ${theme.panelText}` : '1.5px solid rgba(255,255,255,0.1)',
                            cursor: 'pointer',
                            padding: 0,
                            transition: 'transform 0.1s',
                            flexShrink: 0,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.25)')}
                          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                        />
                      ))}
                    </div>
                  </div>
                </FieldRow>

                {/* Line style */}
                <FieldRow label="Line Style" theme={theme}>
                  <Segmented
                    options={lineStyleOptions}
                    value={draft.lineStyle}
                    onChange={v => setMA('lineStyle', v as LineStyleType)}
                    theme={theme}
                  />
                </FieldRow>

                {/* Width */}
                <Slider
                  label="Width"
                  value={draft.lineWidth}
                  min={1}
                  max={5}
                  step={1}
                  onChange={v => setMA('lineWidth', v)}
                  format={v => `${v}px`}
                  theme={theme}
                />

                {/* Opacity */}
                <Slider
                  label="Opacity"
                  value={Math.round(draft.opacity * 100)}
                  min={10}
                  max={100}
                  step={5}
                  onChange={v => setMA('opacity', v / 100)}
                  format={v => `${v}%`}
                  theme={theme}
                />
              </div>

              {/* == LABEL == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Label</SectionTitle>

                <FieldRow label="Show Label" theme={theme}>
                  <Toggle label={draft.showLabel ? 'Visible' : 'Hidden'} checked={draft.showLabel} onChange={() => setMA('showLabel', !draft.showLabel)} theme={theme} />
                </FieldRow>

                {draft.showLabel && (
                  <FieldRow label="Position" theme={theme}>
                    <Segmented
                      options={[
                        { value: 'left', label: 'Left' },
                        { value: 'right', label: 'Right' },
                      ]}
                      value={draft.labelPosition}
                      onChange={v => setMA('labelPosition', v as 'left' | 'right')}
                      theme={theme}
                    />
                  </FieldRow>
                )}
              </div>
            </>
          ) : draft.type === 'ict_snd' ? (
            <>
              {/* == SESSIONS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Killzones (NY Time)</SectionTitle>
                <FieldRow label="Asia" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={draft.asSession} onChange={e => setICT('asSession', e.target.value)} style={{ ...numInputStyle(theme), width: 90 }} placeholder="20:00-03:00" />
                    <input type="color" value={draft.asColor.length === 7 ? draft.asColor : '#3b82f6'} onChange={e => setICT('asColor', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </FieldRow>
                <FieldRow label="London" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={draft.loSession} onChange={e => setICT('loSession', e.target.value)} style={{ ...numInputStyle(theme), width: 90 }} placeholder="03:00-08:30" />
                    <input type="color" value={draft.loColor.length === 7 ? draft.loColor : '#eab308'} onChange={e => setICT('loColor', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </FieldRow>
                <FieldRow label="New York" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="text" value={draft.nySession} onChange={e => setICT('nySession', e.target.value)} style={{ ...numInputStyle(theme), width: 90 }} placeholder="08:30-16:00" />
                    <input type="color" value={draft.nyColor.length === 7 ? draft.nyColor : '#22c55e'} onChange={e => setICT('nyColor', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </FieldRow>
              </div>

              {/* == CRITERIA == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Success Criteria</SectionTitle>
                <FieldRow label="Inside Day" theme={theme}>
                  <Toggle label="NY stays in London" checked={draft.crtInsideDay} onChange={() => setICT('crtInsideDay', !draft.crtInsideDay)} theme={theme} />
                </FieldRow>
                <FieldRow label="Outside Day" theme={theme}>
                  <Toggle label="NY exceeds London" checked={draft.crtOutsideDay} onChange={() => setICT('crtOutsideDay', !draft.crtOutsideDay)} theme={theme} />
                </FieldRow>
                <FieldRow label="Close in LO" theme={theme}>
                  <Toggle label="NY closes in London" checked={draft.crtCloseInLo} onChange={() => setICT('crtCloseInLo', !draft.crtCloseInLo)} theme={theme} />
                </FieldRow>
                <FieldRow label="SD Limit" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Toggle label="Check" checked={draft.crtSdLimit} onChange={() => setICT('crtSdLimit', !draft.crtSdLimit)} theme={theme} />
                    {draft.crtSdLimit && <input type="number" step="0.1" value={draft.sdLimit} onChange={e => setICT('sdLimit', parseFloat(e.target.value) || 1.0)} style={{ ...numInputStyle(theme), width: 60 }} />}
                  </div>
                </FieldRow>
              </div>

              {/* == LABELS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Labels</SectionTitle>
                <FieldRow label="Potential S&D" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Toggle label="Show" checked={draft.showSndPre} onChange={() => setICT('showSndPre', !draft.showSndPre)} theme={theme} />
                    <input type="color" value={draft.sndPreColor} onChange={e => setICT('sndPreColor', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </FieldRow>
                <FieldRow label="Valid S&D" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Toggle label="Show" checked={draft.showSndDay} onChange={() => setICT('showSndDay', !draft.showSndDay)} theme={theme} />
                    <input type="color" value={draft.sndDayColor} onChange={e => setICT('sndDayColor', e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  </div>
                </FieldRow>
              </div>

              {/* == STATS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Tables</SectionTitle>
                <FieldRow label="Warning" theme={theme}>
                  <Toggle label="Show Warning Row" checked={draft.showWrnTable} onChange={() => setICT('showWrnTable', !draft.showWrnTable)} theme={theme} />
                </FieldRow>
                <FieldRow label="Stats" theme={theme}>
                  <Toggle label="Show Statistics Table" checked={draft.showStatTable} onChange={() => setICT('showStatTable', !draft.showStatTable)} theme={theme} />
                </FieldRow>
                <FieldRow label="Position" theme={theme}>
                  <select value={draft.tablePosition} onChange={e => setICT('tablePosition', e.target.value as any)} style={selectStyle(theme)}>
                    <option value="Top Left">Top Left</option>
                    <option value="Top Right">Top Right</option>
                    <option value="Bottom Left">Bottom Left</option>
                    <option value="Bottom Right">Bottom Right</option>
                  </select>
                </FieldRow>
              </div>
            </>
          ) : draft.type === 'sessions' ? (
            <>
              {/* == GENERAL VISUALS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>General Visuals</SectionTitle>
                <FieldRow label="Labels" theme={theme}>
                  <Toggle label="Show Session Names" checked={draft.showLabels} onChange={() => setSessions('showLabels', !draft.showLabels)} theme={theme} />
                </FieldRow>
                <FieldRow label="Borders" theme={theme}>
                  <Toggle label="Show Session Borders" checked={draft.showBorders} onChange={() => setSessions('showBorders', !draft.showBorders)} theme={theme} />
                </FieldRow>
              </div>

              {/* == CUSTOM SESSIONS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SectionTitle>Custom Trading Sessions (NY Time)</SectionTitle>
                {draft.items.map((item, idx) => {
                  const updateItem = (field: keyof SessionItem, val: any) => {
                    const newItems = draft.items.map((it, i) => i === idx ? { ...it, [field]: val } : it);
                    setSessions('items', newItems);
                  };
                  return (
                    <div key={item.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${theme.panelBorder}`, borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Toggle label={item.enabled ? 'Enabled' : 'Disabled'} checked={item.enabled} onChange={() => updateItem('enabled', !item.enabled)} theme={theme} />
                        <input type="color" value={item.color} onChange={e => updateItem('color', e.target.value)} style={{ width: 20, height: 20, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type="text"
                          value={item.name}
                          onChange={e => updateItem('name', e.target.value)}
                          style={{ ...numInputStyle(theme), flex: 1 }}
                          placeholder="Session Name"
                        />
                        <input
                          type="text"
                          value={item.timeRange}
                          onChange={e => updateItem('timeRange', e.target.value)}
                          style={{ ...numInputStyle(theme), width: 100 }}
                          placeholder="HH:MM-HH:MM"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : draft.type === 'rsi' ? (
            <>
              {/* == RSI INPUTS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Inputs</SectionTitle>

                <FieldRow label="Period" theme={theme}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={draft.period}
                      onChange={e => {
                        const v = Math.max(1, Math.min(200, parseInt(e.target.value) || 14));
                        setRSI('period', v);
                      }}
                      style={{ ...numInputStyle(theme), width: 70 }}
                    />
                    <div style={{ display: 'flex', gap: 3 }}>
                      {[9, 14, 21].map(p => (
                        <button
                          key={p}
                          onClick={() => setRSI('period', p)}
                          style={{
                            padding: '3px 6px',
                            fontSize: 9,
                            fontFamily: 'inherit',
                            background: draft.period === p ? theme.accentDim : 'rgba(255,255,255,0.04)',
                            color: draft.period === p ? theme.accent : theme.panelTextDim,
                            border: `1px solid ${draft.period === p ? `${theme.accent}50` : theme.panelBorder}`,
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </FieldRow>
                <FieldRow label="Source" theme={theme}>
                  <select
                    value={draft.source}
                    onChange={e => setRSI('source', e.target.value as MASource)}
                    style={selectStyle(theme)}
                  >
                    {sourceOptions.map(o => (
                      <option key={o.value} value={o.value} style={{ background: theme.panelBg }}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </div>

              {/* == RSI STYLE == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <SectionTitle>Style</SectionTitle>
                <FieldRow label="Line Color" theme={theme}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="color"
                      value={draft.color}
                      onChange={e => setRSI('color', e.target.value)}
                      style={{
                        width: 32,
                        height: 28,
                        padding: 2,
                        border: `1px solid ${theme.panelBorder}`,
                        borderRadius: 5,
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                </FieldRow>

                <FieldRow label="Line Style" theme={theme}>
                  <Segmented
                    options={lineStyleOptions}
                    value={draft.lineStyle}
                    onChange={v => setRSI('lineStyle', v as LineStyleType)}
                    theme={theme}
                  />
                </FieldRow>

                <Slider
                  label="Width"
                  value={draft.lineWidth}
                  min={1}
                  max={5}
                  step={1}
                  onChange={v => setRSI('lineWidth', v)}
                  format={v => `${v}px`}
                  theme={theme}
                />
              </div>
              
              {/* == BANDS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Bands</SectionTitle>
                <FieldRow label="Upper Band" theme={theme}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.upperBand}
                    onChange={e => setRSI('upperBand', parseInt(e.target.value) || 70)}
                    style={{ ...numInputStyle(theme), width: 70 }}
                  />
                </FieldRow>
                <FieldRow label="Lower Band" theme={theme}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.lowerBand}
                    onChange={e => setRSI('lowerBand', parseInt(e.target.value) || 30)}
                    style={{ ...numInputStyle(theme), width: 70 }}
                  />
                </FieldRow>
                <FieldRow label="Band Color" theme={theme}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="color"
                      value={draft.bandColor}
                      onChange={e => setRSI('bandColor', e.target.value)}
                      style={{
                        width: 32,
                        height: 28,
                        padding: 2,
                        border: `1px solid ${theme.panelBorder}`,
                        borderRadius: 5,
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    />
                  </div>
                </FieldRow>
              </div>
            </>
          ) : draft.type === 'cvd' ? (
            <>
              {/* == CVD INPUTS == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Inputs</SectionTitle>

                <FieldRow label="Source" theme={theme}>
                  <select
                    value={draft.sourceMethod}
                    onChange={e => setCVD('sourceMethod', e.target.value as 'ohlc' | 'bidask')}
                    style={selectStyle(theme)}
                  >
                    <option value="ohlc" style={{ background: theme.panelBg }}>OHLC (Close − Open)</option>
                    <option value="bidask" style={{ background: theme.panelBg }}>Bid/Ask (Approx)</option>
                  </select>
                </FieldRow>
              </div>

              {/* == CVD STYLE == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Style</SectionTitle>
                <FieldRow label="Bull Color" theme={theme}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={draft.bullColor}
                      onChange={e => setCVD('bullColor', e.target.value)}
                      style={{ width: 32, height: 28, padding: 2, border: `1px solid ${theme.panelBorder}`, borderRadius: 5, background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 10, color: theme.panelTextDim }}>Rising / Positive Delta</span>
                  </div>
                </FieldRow>
                <FieldRow label="Bear Color" theme={theme}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="color"
                      value={draft.bearColor}
                      onChange={e => setCVD('bearColor', e.target.value)}
                      style={{ width: 32, height: 28, padding: 2, border: `1px solid ${theme.panelBorder}`, borderRadius: 5, background: 'transparent', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 10, color: theme.panelTextDim }}>Falling / Negative Delta</span>
                  </div>
                </FieldRow>
                <Slider
                  label="Width"
                  value={draft.lineWidth}
                  min={1}
                  max={4}
                  step={1}
                  onChange={v => setCVD('lineWidth', v)}
                  format={v => `${v}px`}
                  theme={theme}
                />
              </div>

              {/* == DIVERGENCE DETECTION == */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <SectionTitle>Divergence Detection</SectionTitle>
                <Toggle
                  label="Detect Divergences"
                  checked={draft.showDivergence}
                  onChange={() => setCVD('showDivergence', !draft.showDivergence)}
                  theme={theme}
                />
                {draft.showDivergence && (
                  <>
                    <FieldRow label="Pivot Lookback" theme={theme}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="number"
                          min={2}
                          max={20}
                          value={draft.pivotLookback}
                          onChange={e => {
                            const v = Math.max(2, Math.min(20, parseInt(e.target.value) || 5));
                            setCVD('pivotLookback', v);
                          }}
                          style={{ ...numInputStyle(theme), width: 70 }}
                        />
                        <div style={{ display: 'flex', gap: 3 }}>
                          {[3, 5, 8, 13].map(p => (
                            <button
                              key={p}
                              onClick={() => setCVD('pivotLookback', p)}
                              style={{
                                padding: '3px 6px', fontSize: 9, fontFamily: 'inherit',
                                background: draft.pivotLookback === p ? theme.accentDim : 'rgba(255,255,255,0.04)',
                                color: draft.pivotLookback === p ? theme.accent : theme.panelTextDim,
                                border: `1px solid ${draft.pivotLookback === p ? `${theme.accent}50` : theme.panelBorder}`,
                                borderRadius: 4, cursor: 'pointer',
                              }}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    </FieldRow>
                    <FieldRow label="Bullish Div" theme={theme}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="color"
                          value={draft.bullDivColor}
                          onChange={e => setCVD('bullDivColor', e.target.value)}
                          style={{ width: 32, height: 28, padding: 2, border: `1px solid ${theme.panelBorder}`, borderRadius: 5, background: 'transparent', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 10, color: theme.panelTextDim }}>↑ Price lower, CVD higher</span>
                      </div>
                    </FieldRow>
                    <FieldRow label="Bearish Div" theme={theme}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="color"
                          value={draft.bearDivColor}
                          onChange={e => setCVD('bearDivColor', e.target.value)}
                          style={{ width: 32, height: 28, padding: 2, border: `1px solid ${theme.panelBorder}`, borderRadius: 5, background: 'transparent', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 10, color: theme.panelTextDim }}>↓ Price higher, CVD lower</span>
                      </div>
                    </FieldRow>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* ─ Footer ─ */}
        <div style={{
          padding: '10px 16px',
          borderTop: `1px solid ${theme.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.01)',
        }}>
          <span style={{ fontSize: 9, color: theme.panelTextDim, opacity: 0.5 }}>
            Changes apply live ✦
          </span>
          <button
            onClick={onClose}
            style={{
              padding: '5px 14px',
              fontSize: 10,
              fontFamily: 'inherit',
              fontWeight: 700,
              background: theme.accent,
              color: theme.background,
              border: 'none',
              borderRadius: 5,
              cursor: 'pointer',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Done
          </button>
        </div>
      </div>

      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 199,
          background: 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(2px)',
        }}
      />
    </>
  );
}
