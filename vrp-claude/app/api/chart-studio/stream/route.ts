import { NextRequest } from 'next/server';
import { parseMarket } from '../../../lib/chart-studio/providers';
import { subscribeCandles } from '../../../lib/chart-studio/stream';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
  try {
    const { instrument, interval } = parseMarket(req.nextUrl.searchParams);
    if (instrument.provider !== 'hyperliquid') return Response.json({ error: 'Yahoo uses snapshot polling' }, { status: 400 });
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        let closed = false; const encoder = new TextEncoder();
        const send = (message: object) => { if (!closed) { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`)); } catch { cleanup(); } } };
        const unsubscribe = subscribeCandles(instrument.symbol, interval, send);
        const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15000);
        cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); unsubscribe(); req.signal.removeEventListener('abort', cleanup); try { controller.close(); } catch {} };
        req.signal.addEventListener('abort', cleanup, { once: true });
        if (req.signal.aborted) cleanup();
      }, cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
  } catch (e) { return Response.json({ error: String(e) }, { status: 400 }); }
}
