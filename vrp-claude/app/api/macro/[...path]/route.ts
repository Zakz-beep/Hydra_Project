import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
async function proxy(req: NextRequest) {
  const host = process.env.NEXT_PUBLIC_BACKEND_IP || '127.0.0.1';
  const protocol = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || 'http';
  try {
    const body = req.method === 'POST' ? await req.text() : undefined;
    if (body && new TextEncoder().encode(body).length > 2_000_000) return NextResponse.json({detail:'Import request exceeds 2 MB'}, {status:413});
    const response = await fetch(`${protocol}://${host}:8015${req.nextUrl.pathname}${req.nextUrl.search}`, { method:req.method, body, headers:body ? {'Content-Type':'application/json'} : undefined, cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    return new NextResponse(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ detail: 'Macro API unavailable. Start the dashboard launcher with the macro service (port 8015).' }, { status: 503 });
  }
}
export const GET=proxy;
export const POST=proxy;
