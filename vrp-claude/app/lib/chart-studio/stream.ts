import { hyperBar } from './providers';
type Listener = (message: object) => void;
type Hub = { listeners: Set<Listener>; socket: WebSocket | null; retry?: ReturnType<typeof setTimeout>; ping?: ReturnType<typeof setInterval>; attempts: number; close: () => void };
const hubs = new Map<string, Hub>();
export function subscribeCandles(symbol: string, interval: string, listener: Listener) {
  const key = `${symbol}:${interval}`;
  let hub = hubs.get(key);
  if (!hub) {
    if (hubs.size >= 8) throw new Error('Eight market streams are already open. Close an unused chart.');
    hub = { listeners: new Set(), socket: null, attempts: 0, close: () => {} };
    const h = hub;
    const emit = (message: object) => h.listeners.forEach(fn => fn(message));
    const connect = () => {
      if (!h.listeners.size) return;
      emit({ type: 'status', status: 'Connecting' });
      const ws = new WebSocket('wss://api.hyperliquid.xyz/ws'); h.socket = ws;
      let lastMessage = Date.now(); let lastContext = 0;
      ws.onopen = () => {
        h.attempts = 0;
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'candle', coin: symbol, interval } }));
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'activeAssetCtx', coin: symbol } }));
        emit({ type: 'status', status: 'Connected' });
        h.ping = setInterval(() => {
          if (Date.now() - lastMessage > 45000) { ws.close(); return; }
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ method: 'ping' }));
        }, 15000);
      };
      ws.onmessage = event => {
        lastMessage = Date.now();
        try {
          const msg = JSON.parse(String(event.data));
          if (msg.channel === 'candle' && msg.data) emit({ type: 'bar', bar: hyperBar(msg.data) });
          if (msg.channel === 'activeAssetCtx' && msg.data?.ctx && Date.now() - lastContext > 2000) {
            const ctx = msg.data.ctx;
            const market = { markPrice: Number(ctx.markPx), oraclePrice: Number(ctx.oraclePx), openInterest: Number(ctx.openInterest), funding: Number(ctx.funding), volume24h: Number(ctx.dayNtlVlm), asOf: Date.now() };
            if (Object.values(market).every(Number.isFinite)) { lastContext = Date.now(); emit({ type: 'context', market }); }
          }
        } catch { /* Provider control frames are not candle data. */ }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        if (h.ping) clearInterval(h.ping);
        if (!h.listeners.size) return;
        emit({ type: 'status', status: 'Reconnecting' });
        h.retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(h.attempts++, 5)) + Math.random() * 500);
      };
    };
    h.close = () => { if (h.retry) clearTimeout(h.retry); if (h.ping) clearInterval(h.ping); h.socket?.close(); hubs.delete(key); };
    hubs.set(key, h); h.listeners.add(listener); connect();
  } else {
    hub.listeners.add(listener);
    listener({ type: 'status', status: hub.socket?.readyState === WebSocket.OPEN ? 'Connected' : 'Connecting' });
  }
  const current = hub;
  return () => { current.listeners.delete(listener); if (!current.listeners.size) current.close(); };
}
