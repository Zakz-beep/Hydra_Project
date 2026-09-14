'use client';
import { useEffect, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { bracketMatching, indentUnit, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, CompletionContext, snippetCompletion } from '@codemirror/autocomplete';
import { PYTHON_SDK, PYTHON_SNIPPETS } from '../../../lib/chart-studio/pythonAuthoring';
import type { PythonDiagnostic } from '../../../lib/chart-studio/pythonDiagnostics';
import { tags } from '@lezer/highlight';
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#bb9ff3' }, { tag: tags.string, color: '#b5d39c' },
  { tag: tags.number, color: '#eab86b' }, { tag: tags.comment, color: '#6e839e', fontStyle: 'italic' },
  { tag: tags.function(tags.variableName), color: '#78bddf' }, { tag: tags.operator, color: '#99b2c8' },
]);
const markError = StateEffect.define<number | null>();
const errorLines = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const effect of tr.effects) if (effect.is(markError)) {
      const line = effect.value;
      value = line && line <= tr.state.doc.lines ? Decoration.set([Decoration.line({ class: 'cm-python-error-line' }).range(tr.state.doc.line(line).from)]) : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
function complete(context: CompletionContext) {
  const word = context.matchBefore(/[\w.]+/);
  if (!word && !context.explicit) return null;
  return { from: word?.from ?? context.pos, validFor: /^[\w.]*$/,
    options: [...PYTHON_SDK, ...PYTHON_SNIPPETS].map(entry => {
      const completion = { label: entry.label, type: 'snippet' in entry ? 'function' : 'property', detail: entry.detail, info: entry.info };
      return 'snippet' in entry && entry.snippet ? snippetCompletion(entry.snippet, completion) : completion;
    }) };
}
export default function CodeEditor({ id, code, onChange, onRun, onSave, onCheck, diagnostic, jump, onCursor }: { id: string; code: string; onChange: (s: string) => void; onRun: () => void; onSave: () => void; onCheck: () => void; diagnostic?: PythonDiagnostic; jump?: { line: number; column?: number | null; key: number }; onCursor: (line: number, column: number) => void }) {
  const host = useRef<HTMLDivElement>(null); const view = useRef<EditorView | null>(null); const callback = useRef({ onChange, onRun, onSave, onCheck, onCursor }); callback.current = { onChange, onRun, onSave, onCheck, onCursor };
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: code, extensions: [
      lineNumbers(), errorLines, indentUnit.of('    '), EditorState.tabSize.of(4), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(), python(), syntaxHighlighting(highlight), autocompletion(), pythonLanguage.data.of({ autocomplete: complete }),
      keymap.of([{ key: 'Mod-Shift-Enter', run: () => { callback.current.onCheck(); return true; } }, { key: 'Mod-Enter', run: () => { callback.current.onRun(); return true; } }, { key: 'Mod-s', run: () => { callback.current.onSave(); return true; } }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.contentAttributes.of({ 'aria-label': 'Python code', spellcheck: 'false' }),
      EditorView.updateListener.of(update => { if (update.docChanged) callback.current.onChange(update.state.doc.toString()); if (update.docChanged || update.selectionSet) { const pos = update.state.selection.main.head; const line = update.state.doc.lineAt(pos); callback.current.onCursor(line.number, pos - line.from + 1); } }),
      EditorView.theme({ '&': { height: '100%', backgroundColor: 'var(--cs-bg)', color: 'var(--cs-text)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, ui-monospace, monospace', fontSize: '12px', lineHeight: '20px' }, '.cm-content': { padding: '12px 0', caretColor: 'var(--cs-accent)' }, '.cm-gutters': { background: 'var(--cs-bg)', color: 'var(--cs-faint)', border: 'none', paddingRight: '8px' }, '.cm-activeLineGutter': { background: 'var(--cs-raised)' }, '.cm-activeLine': { background: '#45c9b008' }, '.cm-cursor': { borderLeftColor: 'var(--cs-accent)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { background: '#457e9b55' }, '.cm-tooltip': { background: 'var(--cs-raised)', border: '1px solid var(--cs-border)', color: 'var(--cs-text)' }, '&.cm-focused': { outline: 'none' } }),
    ] }) }); view.current = editor;
    return () => { editor.destroy(); view.current = null; };
    // A new script gets an independent editor undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { const v = view.current; if (v && v.state.doc.toString() !== code) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } }); }, [code]);
  useEffect(() => { view.current?.dispatch({ effects: markError.of(diagnostic?.line ?? null) }); }, [id, diagnostic]);
  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.line < 1 || jump.line > v.state.doc.lines) return;
    const line = v.state.doc.line(jump.line);
    const offset = Array.from(line.text).slice(0, Math.max(0, (jump.column || 1) - 1)).join('').length;
    const anchor = Math.min(line.to, line.from + offset);
    v.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) }); v.focus();
  }, [id, jump]);
  return <div ref={host} className="cs-codemirror" />;
}
