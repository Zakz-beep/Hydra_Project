import { NextRequest, NextResponse } from "next/server";
import { OpenRouter } from "@openrouter/sdk";

const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!, // Set via .env.local — jangan hardcode di sini
  httpReferer: "http://localhost:3000",
  appTitle: "VRP Quant Dashboard",
});

const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { greeksData, gbsData, expectedMoveData, ticker, model, stream: streamMode } = body;

    if (!greeksData) {
      return NextResponse.json({ error: "greeksData is required" }, { status: 400 });
    }

    const selectedModel = model || DEFAULT_MODEL;
    const prompt = buildGreeksPrompt({ greeksData, gbsData, expectedMoveData, ticker });

    const messages = [
      {
        role: "system" as const,
        content: `Kamu adalah analis quant profesional yang ahli di options market structure, dealer positioning, dan gamma dynamics. Berikan analisis tajam, to-the-point, dan actionable berdasarkan data Options Greeks yang diberikan. Jawab dalam Bahasa Indonesia dengan format yang terstruktur. Fokus pada: dealer positioning, potential market moves, key levels, dan trade decision yang jelas (LONG / SHORT / NEUTRAL / WAIT).`,
      },
      { role: "user" as const, content: prompt },
    ];

    // ── Streaming mode ────────────────────────────────────────────────────────
    if (streamMode) {
      const streamResult = await client.chat.send({
        chatRequest: {
          model: selectedModel,
          messages,
          temperature: 0.3,
          maxTokens: 3000,
          stream: true,
        }
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResult as AsyncIterable<{ choices?: { delta?: { content?: string } }[] }>) {
              const delta = chunk.choices?.[0]?.delta?.content;
              if (delta) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
              }
            }
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // ── Non-streaming mode ────────────────────────────────────────────────────
    const result = await client.chat.send({
      chatRequest: {
        model: selectedModel,
        messages,
        temperature: 0.3,
        maxTokens: 3000,
      },
    }) as { choices?: { message?: { content?: string } }[]; usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number } };

    const analysis = result.choices?.[0]?.message?.content ?? "Tidak ada analisis.";
    const usage = result.usage ?? {};

    return NextResponse.json({ analysis, model_used: selectedModel, usage, ticker });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Prompt Builder ─────────────────────────────────────────────────────────────
function buildGreeksPrompt({
  greeksData, gbsData, expectedMoveData, ticker,
}: {
  greeksData: Record<string, unknown>;
  gbsData?: Record<string, unknown> | null;
  expectedMoveData?: Record<string, unknown> | null;
  ticker: string;
}) {
  const g = greeksData as {
    spot: number; total_net_gex: number; total_gross_gex: number;
    total_net_vanna: number; total_net_charm: number; total_net_vex: number;
    gex_regime: string; gamma_flip: number | null; data_source: string;
    signals?: { gex_regime: string; gex_desc: string; vanna_signal: string; vanna_desc: string; charm_signal: string; charm_desc: string; dai_bias: string; dai_desc: string; vex_signal: string; vex_desc: string; dgci?: number; dgci_desc?: string };
    by_expiry?: Record<string, { dte_bucket: number; n_strikes: number; total_oi_calls: number; total_oi_puts: number; pcr_oi: number; net_gex_spotgamma: number; gamma_flip: number | null; max_pain: number | null }>;
  };

  let prompt = `## DATA OPTIONS GREEKS — ${ticker}\n**Spot Price:** $${g.spot?.toLocaleString()}\n**Timestamp:** ${new Date().toLocaleString("id-ID")}\n\n### POSISI GREEKS AGREGAT\n| Metrik | Nilai |\n|--------|-------|\n| Net GEX | ${fmtNum(g.total_net_gex)} |\n| Gross GEX | ${fmtNum(g.total_gross_gex)} |\n| Net Vanna | ${fmtNum(g.total_net_vanna)} |\n| Net Charm | ${fmtNum(g.total_net_charm)} |\n| Net VEX | ${fmtNum(g.total_net_vex)} |\n| GEX Regime | ${g.gex_regime} |\n| Gamma Flip | ${g.gamma_flip ? `$${g.gamma_flip.toLocaleString()}` : "N/A"} |\n`;

  if (g.signals) {
    const s = g.signals;
    prompt += `\n### SINYAL MARKET STRUCTURE\n| Signal | Nilai | Deskripsi |\n|--------|-------|-----------|\n| GEX Regime | ${s.gex_regime} | ${s.gex_desc} |\n| Vanna | ${s.vanna_signal} | ${s.vanna_desc} |\n| Charm | ${s.charm_signal} | ${s.charm_desc} |\n| DAI Bias | ${s.dai_bias} | ${s.dai_desc} |\n| VEX | ${s.vex_signal} | ${s.vex_desc} |\n`;
    if (s.dgci !== undefined) prompt += `| DGCI | ${s.dgci}/100 | ${s.dgci_desc} |\n`;
  }

  if (g.by_expiry) {
    prompt += `\n### EXPIRY BUCKETS\n| DTE | Strikes | OI Calls | OI Puts | PCR | Net GEX | Flip | Max Pain |\n|-----|---------|----------|---------|-----|---------|------|----------|\n`;
    Object.values(g.by_expiry).sort((a, b) => a.dte_bucket - b.dte_bucket).forEach(b => {
      prompt += `| ${b.dte_bucket}d | ${b.n_strikes} | ${b.total_oi_calls.toLocaleString()} | ${b.total_oi_puts.toLocaleString()} | ${b.pcr_oi?.toFixed(2) ?? "-"} | ${fmtNum(b.net_gex_spotgamma)} | ${b.gamma_flip ? `$${b.gamma_flip}` : "-"} | ${b.max_pain ? `$${b.max_pain}` : "-"} |\n`;
    });
  }

  if (gbsData) {
    const gbs = gbsData as { overall_score: number; regime: string; rvol: number; rvol_regime: string; vix_change: number; nearest_resistance?: { strike: number; score: number; dist_pct: number; behavior: string } | null; nearest_support?: { strike: number; score: number; dist_pct: number; behavior: string } | null };
    prompt += `\n### GAMMA BOUNCE SCORE\n- Score: ${gbs.overall_score?.toFixed(1)}/100 (${gbs.regime})\n- RVol: ${(gbs.rvol * 100).toFixed(1)}% (${gbs.rvol_regime})\n- VIX Change: ${gbs.vix_change?.toFixed(2)}%\n`;
    if (gbs.nearest_resistance) prompt += `- Resistance: $${gbs.nearest_resistance.strike} | ${gbs.nearest_resistance.dist_pct?.toFixed(2)}% away | ${gbs.nearest_resistance.behavior}\n`;
    if (gbs.nearest_support) prompt += `- Support: $${gbs.nearest_support.strike} | ${gbs.nearest_support.dist_pct?.toFixed(2)}% away | ${gbs.nearest_support.behavior}\n`;
  }

  if (expectedMoveData) {
    const em = expectedMoveData as { em_1d: number; annualized_iv: number; overextension: number; overextension_regime: string; actual_move_pct: number; range_utilization: number; spot: number };
    prompt += `\n### EXPECTED MOVE\n- EM 1D: ±${em.em_1d?.toFixed(2)} (±${((em.em_1d / (em.spot || 1)) * 100).toFixed(2)}%)\n- Ann. IV: ${(em.annualized_iv * 100).toFixed(1)}%\n- Overextension: ${em.overextension?.toFixed(1)}% (${em.overextension_regime})\n- Actual Move: ${em.actual_move_pct?.toFixed(2)}%\n- Range Util: ${(em.range_utilization * 100).toFixed(0)}%\n`;
  }

  prompt += `\n---\n## TUGAS ANALISIS\n\nBerikan analisis komprehensif dan keputusan trading yang jelas:\n\n1. **Konteks Market Structure**: Apa yang data Greeks ceritakan tentang posisi dealer?\n2. **Key Levels**: Level support/resistance paling kritis berdasarkan gamma?\n3. **Potensi Price Action**: Ke mana harga berpotensi bergerak 1-5 hari ke depan?\n4. **Catalyst & Risk**: Faktor apa yang bisa memicu pergerakan besar?\n5. **KEPUTUSAN TRADING**:\n   - **Bias:** [BULLISH / BEARISH / NEUTRAL]\n   - **Action:** [LONG / SHORT / WAIT / HEDGE]\n   - **Entry Zone:** [level harga]\n   - **Target:** [profit taking]\n   - **Stop:** [invalidasi]\n   - **Conviction:** [LOW / MEDIUM / HIGH]\n\nJadilah spesifik, gunakan angka dari data, berikan reasoning yang jelas.`;

  return prompt;
}

function fmtNum(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return "--";
  const sign = val >= 0 ? "+" : "";
  const abs = Math.abs(val);
  if (abs >= 1e9) return `${sign}$${(val / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(val / 1e3).toFixed(2)}K`;
  return `${sign}$${val.toFixed(2)}`;
}
