import { hyperInfo } from './hyperliquidInfo';
import { FlowBook, FlowTrade, mergeTrades, parseBook, parseTrades } from './orderflow';
type Listener = (message: object) => void;
interface Hub { listeners: Set<Listener>; close: () => void; snapshot: () => object }
const hubs = new Map<string, Hub>();

export function subscribeOrderFlow(symbol: string, listener: Listener) {
  let hub = hubs.get(symbol);
  if (!hub) {
    if (hubs.size >= 8) throw new Error('Eight order-flow streams are open. Close an unused flow panel.');
    const listeners = new Set<Listener>(); let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined, ping: ReturnType<typeof setInterval> | undefined;
    let attempts = 0, closed = false, dirty = false, gap = false, pending: FlowTrade[] = [], recent: FlowTrade[] = [], book: FlowBook | null = null, status = 'Connecting';
    const abort = new AbortController();
    const emit = (message: object) => listeners.forEach(fn => fn(message));
    const state = (next: string) => { status = next; emit({ type: 'status', status }); };
    const accept = (rawTrades: unknown, rawBook?: unknown) => {
      pending.push(...parseTrades(rawTrades, symbol));
      if (pending.length > 20000) { pending = pending.slice(-20000); gap = true; }
      const next = parseBook(rawBook, symbol); if (next && (!book || next.time >= book.time)) book = next;
      dirty = true;
    };
    const flush = setInterval(() => {
      if (!dirty) return;
      const seen = new Set(recent.map(t => t.id)); const trades = mergeTrades([], pending).filter(t => !seen.has(t.id));
      recent = mergeTrades(recent, trades, Date.now() - 3600000, 2000);
      emit({ type: 'flow', trades, book, gap, receivedAt: Date.now() }); pending = []; dirty = false; gap = false;
    }, 500);
    const connect = () => {
      if (closed) return;
      state(attempts ? 'Reconnecting · possible trade gap' : 'Connecting');
      socket = new WebSocket('wss://api.hyperliquid.xyz/ws'); const ws = socket;
      let lastMessage = Date.now();
      ws.onopen = () => {
        state('Live'); attempts = 0;
        for (const type of ['trades', 'l2Book']) ws.send(JSON.stringify({ method: 'subscribe', subscription: { type, coin: symbol } }));
      };
      ping = setInterval(() => { if (Date.now() - lastMessage > 45000) ws.close(); else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' })); }, 15000);
      ws.onmessage = event => {
        lastMessage = Date.now();
        try { const msg = JSON.parse(String(event.data)); if (msg.channel === 'trades') accept(msg.data); if (msg.channel === 'l2Book') accept([], msg.data); if (msg.channel === 'error') state('Provider error · reconnecting'); } catch { /* Ignore non-data control frames. */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (ping) clearInterval(ping); if (closed) return;
        gap = true; dirty = true; book = null; state('Reconnecting · possible trade gap');
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500);
      };
    };
    hub = { listeners, snapshot: () => ({ type: 'flow', trades: recent, book, receivedAt: Date.now(), status }), close: () => { closed = true; abort.abort(); clearInterval(flush); if (retry) clearTimeout(retry); if (ping) clearInterval(ping); socket?.close(); hubs.delete(symbol); } };
    hubs.set(symbol, hub); listeners.add(listener); connect();
    // A recent-trades seed is a bounded sample, not full historical trade coverage.
    const seedSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]);
    void Promise.allSettled([hyperInfo({ type: 'recentTrades', coin: symbol }, seedSignal), hyperInfo({ type: 'l2Book', coin: symbol }, seedSignal)]).then(([trades, depth]) => {
      if (closed) return; accept(trades.status === 'fulfilled' ? trades.value : [], depth.status === 'fulfilled' ? depth.value : undefined);
      if (trades.status === 'rejected' && depth.status === 'rejected' && status !== 'Live') state('Waiting for Hyperliquid feed');
    });
  } else { hub.listeners.add(listener); listener(hub.snapshot()); }
  const current = hub;
  return () => { current.listeners.delete(listener); if (!current.listeners.size) current.close(); };
}
