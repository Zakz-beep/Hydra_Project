'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Code2, Download, FilePlus2, Play, Save, Sparkles, Square, Upload, X, ChevronDown, CheckCheck, Copy, ArrowUpRight } from 'lucide-react';
import CodeEditor from './CodeEditor';
import './pythonStudio.css';
import { Study, StudyResult } from '../../../lib/chart-studio/types';
import { diagnosticHint, PythonFailure } from '../../../lib/chart-studio/pythonDiagnostics';
import { PYTHON_SDK, PYTHON_SNIPPETS } from '../../../lib/chart-studio/pythonAuthoring';
import { TEMPLATES } from '../../../lib/chart-studio/templates';
interface Props { checkedCode?: string; failure?: PythonFailure; onCheck: () => void; studies: Study[]; active: string; onActive: (id: string) => void; onChange: (s: Study) => void; onAdd: (name: string, code: string) => void; onRun: () => void; onStop: () => void; busy: boolean; status: string; result?: StudyResult; error: string; onSave: () => void; onClose: () => void }
export default function PythonStudio(p: Props) {
  const study = p.studies.find(s => s.id === p.active); const file = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false); const [prompt, setPrompt] = useState(''); const [ai, setAI] = useState(false); const [aiError, setAIError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [jump, setJump] = useState<{ line: number; column?: number | null; key: number }>();
  const [referenceQuery, setReferenceQuery] = useState(''); const [copyStatus, setCopyStatus] = useState('');
  const diagnostic = p.failure?.diagnostic;
  const stale = Boolean(p.failure && p.failure.code !== study?.code);
  useEffect(() => { setCopyStatus(''); setJump(undefined); setCursor({ line: 1, column: 1 }); }, [p.active]);
  useEffect(() => { setCopyStatus(''); }, [p.failure]);
  async function copyDiagnostic() {
    if (!study || !diagnostic) return;
    const report = [study.name + '.py · Python 3.12 · Chart Studio calculate(ctx)', diagnostic.type + ': ' + diagnostic.message, diagnostic.line ? 'Line ' + diagnostic.line : '', diagnosticHint(diagnostic), diagnostic.traceback || '', 'Script that produced this error:', p.failure?.code || study.code].join('\n\n');
    try { await navigator.clipboard.writeText(report); setCopyStatus('Copied script + error'); } catch { setCopyStatus('Clipboard unavailable. Select the traceback to copy.'); }
  }
  function jumpToError() { if (!diagnostic?.line || stale) return; setJump({ line: diagnostic.line, column: diagnostic.column, key: Date.now() }); }

  async function generate() {
    setGenerating(true); setAIError('');
    try {
      const response = await fetch('/api/chart-studio/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, code: study?.code, error: p.error }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      p.onAdd('AI draft', result.code); setAI(false);
    } catch (e) { setAIError(e instanceof Error ? e.message : 'Draft generation failed'); } finally { setGenerating(false); }
  }
  function download() { if (!study) return; const url = URL.createObjectURL(new Blob([study.code], { type: 'text/x-python' })); const a = document.createElement('a'); a.href = url; a.download = `${study.name.replace(/[^\w-]/g, '_')}.py`; a.click(); URL.revokeObjectURL(url); }
  return <section className="cs-python" aria-label="Python indicator studio">
    <div className="cs-editor-toolbar"><div className="cs-editor-title"><Code2 size={16} /><strong>Python Studio</strong><button className="cs-language-badge" onClick={() => setHelp(!help)} aria-expanded={help} title="Python language and SDK">Python 3.12<ChevronDown size={12} /></button></div><div className="cs-editor-actions">
      <button title="SDK reference" aria-label="SDK reference" className={help ? 'active' : ''} onClick={() => setHelp(!help)}><BookOpen size={15} /></button>
      <a className="cs-guide-download" href="/chart-studio/INDICATOR_AI_GUIDE.md" download="INDICATOR_AI_GUIDE.md" title="Download indicator instructions for Codex, Antigravity and other AI tools"><BookOpen size={14} />AI guide .md</a>
      <button title="Import Python script" aria-label="Import Python script" onClick={() => file.current?.click()}><Upload size={15} /></button>
      <button title="Download Python script" aria-label="Download Python script" onClick={download} disabled={!study}><Download size={15} /></button>
      <button title="Save workspace" aria-label="Save scripts" onClick={p.onSave}><Save size={15} /></button>
      <button onClick={() => setAI(!ai)} className={ai ? 'active' : ''}><Sparkles size={14} /><span>AI draft</span></button>
      <button className="cs-syntax-check" title="Check syntax without running code (Ctrl Shift Enter)" disabled={p.busy || !study} onClick={p.onCheck}><CheckCheck size={14} />Check syntax</button>
      <button className="cs-run" disabled={p.busy || !study} onClick={p.onRun}><Play size={13} fill="currentColor" />Run</button>
      {p.busy && <button onClick={p.onStop}><Square size={13} />Stop</button>}
      <button aria-label="Collapse Python editor" onClick={p.onClose}><ChevronDown size={17} /></button>
    </div></div>
    <div className="cs-script-tabs">{p.studies.map(s => <button className={s.id === p.active ? 'active' : ''} key={s.id} onClick={() => p.onActive(s.id)}><span className="cs-python-dot">py</span>{s.name}</button>)}<label className="cs-template"><FilePlus2 size={14} /><select aria-label="Add indicator template" value="" onChange={async e => { const t = TEMPLATES[Number(e.target.value)]; if (!t) return; try { if (t.file) { const r = await fetch(t.file); if (!r.ok) throw new Error("Template unavailable"); p.onAdd(t.name, await r.text()); } else p.onAdd(t.name, t.code); } catch (e) { setAIError(String(e)); setAI(true); } }}><option value="">New indicator</option>{TEMPLATES.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}</select></label></div>
    {ai && <div className="cs-ai-input"><input aria-label="Describe Python indicator" placeholder="Describe an indicator, or ask AI to fix the error below…" value={prompt} onChange={e => setPrompt(e.target.value)} /><button onClick={generate} disabled={generating || !prompt.trim()}>{generating ? 'Generating…' : 'Create draft'}</button><button aria-label="Close AI draft" onClick={() => setAI(false)}><X size={14} /></button>{aiError && <p role="alert">{aiError}</p>}</div>}
    <div className="cs-language-strip"><span><b>Python</b> · calculate(ctx) · pandas / numpy</span><span>4 spaces · UTF-8 · Ctrl Space autocomplete</span></div>
    <div className="cs-editor-body">
      {study ? <CodeEditor id={study.id} code={study.code} onChange={code => p.onChange({ ...study, code })} onRun={() => { if (!p.busy) p.onRun(); }} onCheck={() => { if (!p.busy) p.onCheck(); }} onSave={p.onSave} diagnostic={stale ? undefined : diagnostic} jump={jump} onCursor={(line, column) => setCursor({ line, column })} /> : <div className="cs-empty">Choose a template to create your first Python indicator.</div>}
      {help && <aside className="cs-sdk-reference" aria-label="Python language reference">
        <div className="cs-sdk-heading"><strong>Language & SDK</strong><button aria-label="Close language reference" onClick={() => setHelp(false)}><X size={14} /></button></div>
        <p>Python 3.12 runs in your browser. Use <code>def calculate(ctx):</code> with four-space indentation. Read supplied market data through <code>ctx</code>; plot with <code>ctx.plot</code>.</p>
        <p><b>Check syntax</b> only compiles your code. <b>Run</b> checks data and produces plots. Pine Script and JavaScript require conversion to Python.</p>
        <input aria-label="Search SDK reference" placeholder="Search functions, inputs, Greeks…" value={referenceQuery} onChange={e => setReferenceQuery(e.target.value)} />
        {[...PYTHON_SDK, ...PYTHON_SNIPPETS].filter(entry => (entry.label + entry.info).toLowerCase().includes(referenceQuery.toLowerCase())).map(entry => <details key={entry.label}><summary><code>{entry.label}</code><small>{entry.detail}</small></summary><p>{entry.info}</p>{'snippet' in entry && entry.snippet && <pre>{entry.snippet.replace(/\$\{([^}]+)\}/g, '$1')}</pre>}</details>)}
        <a href="/chart-studio/INDICATOR_AI_GUIDE.md" download>Download full AI guide .md</a>
      </aside>}
    </div>
    <div className="cs-console" role="status"><span className={p.error ? 'cs-error' : 'cs-muted'}>{p.busy ? '● ' : '› '}{p.status.startsWith('Syntax valid') && p.checkedCode !== study?.code ? 'Code changed or not checked · Check syntax again' : p.status}{stale ? ' · Code changed; check again' : ''}</span><span className="cs-muted">Ln {cursor.line}, Col {cursor.column} · Ctrl ↵ Run · Ctrl S Save</span></div>
    {diagnostic ? <div className="cs-diagnostic cs-console-output" role="alert">
      <div className="cs-diagnostic-title"><strong>{diagnostic.type}</strong><span>{stale ? 'Previous version' : 'Needs attention'}</span>{diagnostic.line && <button disabled={stale} onClick={jumpToError}><ArrowUpRight size={13} />Line {diagnostic.line}{diagnostic.column ? ':' + diagnostic.column : ''}</button>}</div>
      <p>{diagnostic.message}</p><p className="cs-diagnostic-hint">{diagnosticHint(diagnostic)}</p>
      {diagnostic.source && <code className="cs-diagnostic-source">{diagnostic.source}</code>}
      <div className="cs-diagnostic-actions"><button onClick={() => void copyDiagnostic()}><Copy size={13} />Copy for AI</button><button onClick={() => { setPrompt('Fix this Python indicator error while preserving its intended calculations: ' + diagnostic.type + ': ' + diagnostic.message); setAI(true); }}>Ask AI to fix</button><span role="status">{copyStatus}</span></div>
      {diagnostic.traceback && <details><summary>Full traceback</summary><pre>{diagnostic.traceback}</pre></details>}
    </div> : p.error ? <pre className="cs-console-output cs-error" role="alert">{p.error}</pre> : null}
    {!!p.result?.logs.length && <details className="cs-python-logs"><summary>Output · {p.result.logs.length} messages{p.result.code !== study?.code ? ' · previous run' : ''}</summary><pre className="cs-console-output" role="log">{p.result.logs.join('\n')}</pre></details>}
    <input hidden ref={file} type="file" accept=".py,text/x-python" onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 100000) { setAIError('Script exceeds 100 KB'); setAI(true); } else p.onAdd(f.name.replace(/\.py$/, ''), await f.text()); } e.target.value = ''; }} />
  </section>;
}
