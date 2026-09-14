export type TerminalPage = 'vrp' | 'gp' | 'gex' | 'risk' | 'vol' | 'dcc' | 'cot' | 'disp' | 'hrp' | 'beta' | 'crypto' | 'onchain' | 'propfirm' | 'agent' | 'decision' | 'regime' | 'macro' | 'agent-center';
export interface CommandDefinition {
  code: string; page: TerminalPage; label: string; description: string;
  group: 'Markets' | 'Options & volatility' | 'Portfolio & risk' | 'Research';
  aliases: string[];
  /** global: consumes controller ticker; local: selects instruments inside the page. */
  ticker: 'global' | 'local';
}
export const COMMAND_REGISTRY: CommandDefinition[] = [
  { code: 'AGT', page: 'agent-center', label: 'Agent Center', description: 'MCP connections, portable skills, research tasks, agent results and tool diagnostics', group: 'Research', aliases: ['mcp', 'integrations'], ticker: 'local' },
  { code: 'ECO', page: 'macro', label: 'Macro Research', description: 'USD high-impact economic calendar, release history, news and Bayesian forecasts', group: 'Research', aliases: ['economic', 'calendar'], ticker: 'local' },
  { code: 'VRP', page: 'vrp', label: 'VRP Engine', description: 'Implied vs realized volatility, HAR forecasts and signals', group: 'Options & volatility', aliases: [], ticker: 'global' },
  { code: 'GP', page: 'gp', label: 'Chart Studio', description: 'Charts, Python indicators, drawings and order flow', group: 'Markets', aliases: ['lwc', 'chart', 'terminal'], ticker: 'global' },
  { code: 'GEX', page: 'gex', label: 'The Greeks', description: 'Gamma, vanna, charm, strike walls and options inventory', group: 'Options & volatility', aliases: ['greeks'], ticker: 'global' },
  { code: 'VOL', page: 'vol', label: 'Vol Engine', description: 'HAR models and volatility forecasts; run analysis on the page', group: 'Options & volatility', aliases: ['volatility'], ticker: 'global' },
  { code: 'RISK', page: 'risk', label: 'Risk Pipeline', description: 'Pre-trade gates, simulations and portfolio risk', group: 'Portfolio & risk', aliases: [], ticker: 'global' },
  { code: 'DCC', page: 'dcc', label: 'Correlation', description: 'Dynamic correlation and copula analysis', group: 'Portfolio & risk', aliases: ['correlation'], ticker: 'local' },
  { code: 'DISP', page: 'disp', label: 'Dispersion', description: 'Index and component volatility comparisons', group: 'Options & volatility', aliases: ['dispersion'], ticker: 'local' },
  { code: 'HRP', page: 'hrp', label: 'HRP Allocator', description: 'Hierarchical risk parity and portfolio weights', group: 'Portfolio & risk', aliases: [], ticker: 'local' },
  { code: 'BETA', page: 'beta', label: 'Beta Market', description: 'Market sensitivity; choose the universe on the page', group: 'Portfolio & risk', aliases: [], ticker: 'local' },
  { code: 'COT', page: 'cot', label: 'COT Report', description: 'Institutional positioning and commitment of traders', group: 'Research', aliases: [], ticker: 'local' },
  { code: 'CRYP', page: 'crypto', label: 'Crypto Suite', description: 'Crypto open interest, volume and liquidation radar', group: 'Markets', aliases: [], ticker: 'local' },
  { code: 'ONCH', page: 'onchain', label: 'On-Chain Flow', description: 'Ethereum activity, gas and whale tracking', group: 'Markets', aliases: [], ticker: 'local' },
  { code: 'PROP', page: 'propfirm', label: 'Prop Firm Risk', description: 'Drawdown limits and prop firm evaluation', group: 'Portfolio & risk', aliases: [], ticker: 'local' },
  { code: 'AI', page: 'agent', label: 'Quant Agent', description: 'Research agents and market analysis', group: 'Research', aliases: [], ticker: 'global' },
  { code: 'TREE', page: 'decision', label: 'Decision Tree', description: 'Strategy decision models and scenario trees', group: 'Research', aliases: [], ticker: 'local' },
  { code: 'REG', page: 'regime', label: 'GRU Regime', description: 'Bull, bear and transitional market regimes', group: 'Research', aliases: ['gru'], ticker: 'local' },
];
export interface NavigationState { page: TerminalPage; ticker: string }
export function findCommand(value: string) {
  const q = value.toLowerCase();
  return COMMAND_REGISTRY.find(c => [c.code, c.page, ...c.aliases].some(a => a.toLowerCase() === q));
}
export function normalizeTicker(raw: string): string | null {
  if (!/^[a-z0-9^][a-z0-9.^=:_-]{0,39}$/i.test(raw)) return null;
  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length !== 2 || !/^[a-z0-9_-]+$/i.test(parts[0]) || !/^[a-z0-9][a-z0-9._-]*$/i.test(parts[1])) return null;
    return `${parts[0].toLowerCase()}:${parts[1].toUpperCase()}`;
  }
  return raw.toUpperCase();
}
export function formatCommand(state: NavigationState) {
  const c = findCommand(state.page)!;
  return c.ticker === 'global' ? `${state.ticker} ${c.code}` : c.code;
}
export type ParseResult = { state: NavigationState; error?: never } | { error: string; state?: never };
export function parseCommand(raw: string, current: NavigationState): ParseResult {
  const parts = raw.trim().replace(/\s*<GO>\s*$/i, '').trim().split(/\s+/);
  if (!parts[0]) return { error: 'Enter a function or a ticker, for example SPY GEX.' };
  if (parts.length > 2) return { error: 'Use TICKER FUNCTION or FUNCTION TICKER. Only two terms are supported.' };
  let c: CommandDefinition | undefined, symbol: string | undefined;
  if (parts.length === 1) { c = findCommand(parts[0]); if (!c) { c = findCommand(current.page); symbol = parts[0]; } }
  else {
    const first = findCommand(parts[0]), second = findCommand(parts[1]);
    if (Boolean(first) === Boolean(second)) return { error: first ? 'Choose one function and one ticker.' : 'Unknown function. Try SPY GEX, NVDA GP, or open the directory.' };
    c = first || second; symbol = first ? parts[1] : parts[0];
  }
  if (!c) return { error: 'Function is unavailable.' };
  if (symbol && c.ticker === 'local') return { error: `${c.code} selects instruments inside its page. Run ${c.code} without a ticker.` };
  const ticker = symbol ? normalizeTicker(symbol) : current.ticker;
  if (!ticker) return { error: 'Invalid ticker format. Examples: SPY, BBRI.JK, BTC-USD, xyz:TSLA.' };
  if (c.page !== 'gp' && c.ticker === 'global' && (ticker.includes(':') || ticker.endsWith('.P'))) return { error: 'Perpetual symbols belong in Chart Studio (GP). Use an underlying ticker such as TSLA for options and equity models.' };
  return { state: { page: c.page, ticker } };
}
export function stateFromUrl(url: URL, fallback: NavigationState): ParseResult {
  const view = url.searchParams.get('view');
  const c = view ? findCommand(view) : findCommand(fallback.page);
  if (!c) return { error: `Unknown page “${view}”. Open the function directory to choose a page.` };
  const ticker = normalizeTicker(url.searchParams.get('ticker') || fallback.ticker);
  if (!ticker) return { error: 'Invalid ticker in URL.' };
  return c.ticker === 'local' ? { state: { page: c.page, ticker } } : parseCommand(`${ticker} ${c.code}`, fallback);
}
export function commandUrl(state: NavigationState, href: string) {
  const url = new URL(href); url.searchParams.set('view', state.page); url.searchParams.set('ticker', state.ticker); return url;
}
export function searchCommands(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const q = query.trim().toLowerCase();
  const score = (c: CommandDefinition) => c.code.toLowerCase() === q ? 100 : c.code.toLowerCase().startsWith(q) ? 90 : c.aliases.some(a => a.startsWith(q)) ? 80 : c.label.toLowerCase().startsWith(q) ? 70 : 0;
  return COMMAND_REGISTRY.filter(c => words.every(w => `${c.code} ${c.label} ${c.description} ${c.group} ${c.aliases.join(' ')}`.toLowerCase().includes(w))).sort((a, b) => score(b) - score(a));
}
