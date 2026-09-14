import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q") || "";

  if (!query.trim()) {
    return NextResponse.json({ quotes: [] });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=10&newsCount=0&listsCount=0`;

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Search API responded with status: ${response.status}`);
    }

    const data = await response.json();
    const quotes = (data.quotes || []).map((q: any) => ({
      symbol: q.symbol,
      shortname: q.shortname || q.longname || "",
      exchange: q.exchange || q.exchDisp || "",
      type: q.quoteType || q.typeDisp || "",
    }));

    return NextResponse.json({ quotes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
