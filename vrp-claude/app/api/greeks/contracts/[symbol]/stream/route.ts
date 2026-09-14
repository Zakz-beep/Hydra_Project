import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { symbol: string } }) {
  if (!/^[A-Z][A-Z0-9.]{0,5}\d{6}[CP]\d{8}$/.test(params.symbol)) return Response.json({detail:'Invalid contract symbol'}, {status:422});
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  req.signal.addEventListener('abort', disconnect, {once:true});
  const timeout = setTimeout(disconnect, 20_000);
  try {
    const host = process.env.NEXT_PUBLIC_BACKEND_IP || 'localhost';
    const protocol = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || 'http';
    const upstream = await fetch(`${protocol}://${host}:8001/api/greeks/contracts/${params.symbol}/stream`, {cache:'no-store',signal:abort.signal});
    clearTimeout(timeout);
    if (!upstream.ok || !upstream.body) {
      disconnect(); req.signal.removeEventListener('abort',disconnect);
      return Response.json({detail:'Contract stream unavailable; check credentials, feed, or active connection limits.'},{status:upstream.status || 502});
    }
    const reader = upstream.body.getReader();
    const cleanup = () => { disconnect(); req.signal.removeEventListener('abort',disconnect); };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try { const chunk = await reader.read(); if (chunk.done) { cleanup(); controller.close(); } else controller.enqueue(chunk.value); }
        catch { cleanup(); controller.error(new Error('Stream interrupted')); }
      },
      async cancel() { cleanup(); await reader.cancel().catch(()=>{}); },
    });
    return new Response(body, {headers:{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
  } catch {
    clearTimeout(timeout); disconnect(); req.signal.removeEventListener('abort',disconnect);
    return Response.json({detail:'Contract streaming backend unavailable.'},{status:503});
  }
}
