// app/api/vrp/route.ts
// Next.js Route Handler — proxy ke FastAPI backend
// Diakses dari frontend via /api/vrp?ticker=...

import { NextRequest, NextResponse } from "next/server";

const PYTHON_API = process.env.PYTHON_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "^GSPC";

  try {
    const res = await fetch(
      `${PYTHON_API}/api/vrp?ticker=${encodeURIComponent(ticker)}`,
      { cache: "no-store" }
    );

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
