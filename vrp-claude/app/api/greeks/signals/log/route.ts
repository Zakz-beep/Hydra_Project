// app/api/greeks/signals/log/route.ts
import { NextRequest, NextResponse } from "next/server";

const GREEKS_API = process.env.GREEKS_API_URL ?? "http://localhost:8001";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "^GSPC";
  const n = searchParams.get("n") ?? "50";

  try {
    const res = await fetch(
      `${GREEKS_API}/api/greeks/signals/log?ticker=${encodeURIComponent(ticker)}&n=${n}`,
      { cache: "no-store" }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      return NextResponse.json(err, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Greeks Backend unreachable";
    return NextResponse.json({ detail: message }, { status: 503 });
  }
}
