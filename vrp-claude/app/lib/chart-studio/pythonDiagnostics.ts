export interface PythonDiagnostic {
  type: string; message: string; line?: number | null; column?: number | null;
  source?: string | null; traceback?: string;
}
export interface PythonFailure { code: string; diagnostic: PythonDiagnostic }
export class IndicatorError extends Error {
  constructor(public diagnostic: PythonDiagnostic) { super(`${diagnostic.type}: ${diagnostic.message}`); this.name = 'IndicatorError'; }
}
export function diagnosticOf(error: unknown): PythonDiagnostic {
  if (error instanceof IndicatorError) return error.diagnostic;
  return { type: 'Runtime', message: error instanceof Error ? error.message : String(error) };
}
export function diagnosticHint(d: PythonDiagnostic): string {
  if (/```|\/\/\@version|indicator\(/.test(d.source || '')) return 'Paste Python code only. Remove Markdown fences; Pine Script needs to be rewritten using calculate(ctx).';
  if (/IndentationError|TabError/.test(d.type)) return 'Use four spaces per indentation level. Keep the body of calculate(ctx) indented; avoid mixing tabs and spaces.';
  if (d.type === 'SyntaxError') return 'Check the highlighted line and the line above it: missing colon, closing bracket or quote. Function definitions use def calculate(ctx):';
  if (d.type === 'NameError') return 'Define this variable before using it and check its spelling. pandas and numpy are available as pd and np.';
  if (/ModuleNotFoundError|ImportError/.test(d.type)) return 'This runs in browser Python. Use bundled pandas / numpy or a package supported by this runtime. Read market data through ctx.data.ohlcv(); do not use yfinance in the script.';
  if (d.type === 'KeyError') return 'Check the column or dictionary key. Candle columns are open, high, low, close, volume and time. print(df.columns.tolist()) helps inspect a DataFrame.';
  if (d.type === 'IndexError') return 'The data may be empty or shorter than your lookback. Check len(df) before indexing; use rolling() for aligned series.';
  if (/truth value.*ambiguous/i.test(d.message)) return 'A pandas Series contains many booleans. Use & / | with parentheses for element-wise conditions, or .any() / .all() for one boolean.';
  if (/greeks|snapshot|replay|Dataset/.test(d.message)) return 'Check Data inputs and the selected source. Available data depends on the ticker and replay time; missing history cannot be reconstructed from the current snapshot.';
  if (d.type === 'TypeError' || d.type === 'AttributeError') return 'Check the SDK signature in Reference or Ctrl+Space. Pass a pandas Series to line/area/histogram, and use named options such as pane= and color=.';
  if (/No plots|calculate\(ctx\)/.test(d.message)) return 'Define def calculate(ctx): and add at least one ctx.plot call inside it. Printing values alone does not create a chart.';
  if (/timed out|exceeded 30/.test(d.message)) return 'Try again after the runtime loads. For slow calculations, reduce lookback and use pandas / numpy instead of nested Python loops.';
  return 'Read the message, inspect the indicated input or value, then Check syntax and Run again. Copy the diagnostic with its script when asking AI for help.';
}
