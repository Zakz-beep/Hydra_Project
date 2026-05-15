// app/api/tickers/route.ts
// Next.js Route Handler — proxy ke FastAPI backend
// Menggantikan next.config.js rewrite untuk mengatasi masalah drop body POST dan caching GET.

import { NextRequest, NextResponse } from "next/server";

const BACKEND_IP = process.env.NEXT_PUBLIC_BACKEND_IP || "localhost";
const BACKEND_PROTOCOL = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || "http";
const PYTHON_API = `${BACKEND_PROTOCOL}://${BACKEND_IP}:8000`;

export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${PYTHON_API}/api/tickers`, { 
        cache: "no-store",
        headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Backend unreachable";
    return NextResponse.json(
      { detail: message },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${PYTHON_API}/api/tickers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Backend unreachable";
    return NextResponse.json(
      { detail: message },
      { status: 503 }
    );
  }
}
