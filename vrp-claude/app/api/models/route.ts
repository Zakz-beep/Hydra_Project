import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      // Revalidate cache every hour
      next: { revalidate: 3600 }
    });
    
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`);
    }

    const data = await res.json();
    
    // Transform models to a simpler format for the UI
    const models = data.data.map((model: any) => {
      const isFree = parseFloat(model.pricing?.prompt || "0") === 0 && parseFloat(model.pricing?.completion || "0") === 0;
      return {
        id: model.id,
        name: model.name,
        context_length: model.context_length,
        tier: isFree ? "FREE" : "PAID",
      };
    });

    // Sort models: FREE first, then alphabetical
    models.sort((a: any, b: any) => {
      if (a.tier === "FREE" && b.tier !== "FREE") return -1;
      if (a.tier !== "FREE" && b.tier === "FREE") return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ models });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch models" },
      { status: 500 }
    );
  }
}
