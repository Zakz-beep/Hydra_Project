// app/api/greeks/route.ts
import { NextRequest, NextResponse } from "next/server";

const BACKEND_IP = process.env.NEXT_PUBLIC_BACKEND_IP || "localhost";
const BACKEND_PROTOCOL = process.env.NEXT_PUBLIC_BACKEND_PROTOCOL || "http";
const GREEKS_API = `${BACKEND_PROTOCOL}://${BACKEND_IP}:8001`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker") ?? "^GSPC";
  const force = searchParams.get("force") === "true";

  try {
    const res = await fetch(
      `${GREEKS_API}/api/greeks?ticker=${encodeURIComponent(ticker)}${force ? "&force=true" : ""}`,
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
