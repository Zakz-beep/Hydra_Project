import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_IP = process.env.NEXT_PUBLIC_BACKEND_IP || "localhost";
const BACKEND_PROTOCOL = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || "http";
const GREEKS_API = `${BACKEND_PROTOCOL}://${BACKEND_IP}:8001`;

async function handleProxy(req: NextRequest, { params }: { params: { path?: string[] } }) {
  const pathname = req.nextUrl.pathname;
  const search = req.nextUrl.search;
  
  // Construct the exact target URL
  const targetUrl = `${GREEKS_API}${pathname}${search}`;

  const method = req.method;
  const headers = new Headers(req.headers);
  // Remove host header to prevent proxy/routing issues
  headers.delete("host");

  let body: any = null;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await req.blob();
    } catch {
      body = null;
    }
  }

  try {
    const backendResponse = await fetch(targetUrl, {
      method,
      headers,
      body: ["GET", "HEAD"].includes(method) ? undefined : body,
      cache: "no-store",
      signal: AbortSignal.timeout(95_000),
    });
    
    // Create new response to forward headers
    const response = new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
    });
    
    // Forward backend headers to client
    backendResponse.headers.forEach((value, key) => {
      if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) response.headers.set(key, value);
    });
    
    // DEBUG: Send the target URL back as a header to see what we actually fetched
    response.headers.set("Cache-Control", "no-store");
    
    return response;
  } catch (e: unknown) {
    // Gracefully catch connection failures and log a single-line warning
    console.warn(`[Proxy Warning] Greeks API on port 8001 is unreachable: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      { error: "Greeks API service is currently unavailable" },
      { status: 503 }
    );
  }
}

export async function GET(req: NextRequest, context: { params: { path?: string[] } }) {
  return handleProxy(req, context);
}

export async function POST(req: NextRequest, context: { params: { path?: string[] } }) {
  return handleProxy(req, context);
}

export async function PUT(req: NextRequest, context: { params: { path?: string[] } }) {
  return handleProxy(req, context);
}

export async function DELETE(req: NextRequest, context: { params: { path?: string[] } }) {
  return handleProxy(req, context);
}
