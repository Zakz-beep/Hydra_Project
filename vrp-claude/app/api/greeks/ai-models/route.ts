import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Set via .env.local — jangan hardcode API key di sini
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;


export async function GET() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 3600 }, // cache 1 jam
    });

    if (!res.ok) {
      throw new Error(`OpenRouter models fetch failed: ${res.status}`);
    }

    const data = await res.json();

    // Sort: free first, then by context length desc
    const models = (data.data ?? [])
      .map((m: Record<string, unknown>) => {
        const pricing = m.pricing as Record<string, string> | undefined;
        const promptPrice = parseFloat(pricing?.prompt ?? "999");
        const isFree = promptPrice === 0;
        const ctx = m.context_length as number ?? 0;
        const name = m.name as string ?? m.id as string;
        const id = m.id as string;

        // Tier label
        let tier: string;
        let tierOrder: number;
        if (isFree) {
          tier = "FREE";
          tierOrder = 0;
        } else if (promptPrice < 0.0000005) {
          tier = "ECON";
          tierOrder = 1;
        } else if (promptPrice < 0.000002) {
          tier = "FAST";
          tierOrder = 2;
        } else if (promptPrice < 0.000008) {
          tier = "SMART";
          tierOrder = 3;
        } else {
          tier = "BEST";
          tierOrder = 4;
        }

        return { id, label: name, tier, tierOrder, ctx, promptPrice, isFree };
      })
      // Filter: exclude image/vision-only, keep text models
      .filter((m: { id: string }) => !m.id.includes("vision") && !m.id.includes("image"))
      .sort((a: { tierOrder: number; ctx: number }, b: { tierOrder: number; ctx: number }) => {
        if (a.tierOrder !== b.tierOrder) return a.tierOrder - b.tierOrder;
        return b.ctx - a.ctx;
      });

    return NextResponse.json({ models });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg, models: [] }, { status: 500 });
  }
}
