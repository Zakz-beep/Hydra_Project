import { NextRequest, NextResponse } from "next/server";
import { OpenRouter } from "@openrouter/sdk";
import { callModel, tool, stepCountIs, maxCost, createInitialState } from "@openrouter/agent";
import { z } from "zod";
import { getSystemPrompt } from "../../lib/systemPrompt";
import type { PersonaId } from "../../lib/personas";

// ─── OpenRouter client ────────────────────────────────────────────────────────
const client = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!, // Set via .env.local — jangan hardcode di sini
  httpReferer: "http://localhost:3000",
  appTitle: "VRP Quant Agent",
});

// ─── Internal API base URLs ───────────────────────────────────────────────────
const APIS = {
  VRP:     "http://localhost:8000",
  GREEKS:  "http://localhost:8001",
  RISK:    "http://localhost:8002",
  REGIME:  "http://localhost:8007",
  VOL:     "http://localhost:8006",
};

// ─── TOOLS ────────────────────────────────────────────────────────────────────

/** Tool 1: Fetch Greeks data for any ticker */
const getGreeksTool = tool({
  name: "get_greeks",
  description: "Mengambil data Options Greeks lengkap (GEX, Vanna, Charm, VEX, Gamma Flip, sinyal market structure) untuk ticker tertentu. Gunakan ini untuk menganalisis posisi dealer dan market structure.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker saham, contoh: SPY, QQQ, AAPL, TSLA"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker }) => {
    try {
      const res = await fetch(`${APIS.GREEKS}/api/greeks/summary?ticker=${ticker}&source=cboe`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { success: true, data };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : "Error fetching Greeks" };
    }
  },
});

/** Tool 1b: Fetch Greeks data for a specific expiry bucket */
const getGreeksByExpiryTool = tool({
  name: "get_greeks_by_expiry",
  description: "Mengambil data Options Greeks granular (termasuk breakdown per strike price) khusus untuk satu expiry bucket tertentu. Gunakan ini jika user menanyakan detail spesifik pada waktu tertentu, seperti 'Vanna terbesar di 7DTE' atau 'Strike dengan GEX tertinggi untuk 0DTE'.",
  inputSchema: z.object({
    ticker: z.string(),
    bucket: z.number().describe("Angka expiry bucket yang valid: 0, 1, 7, 14, atau 30. (Misal: untuk 7DTE, masukkan angka 7)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker, bucket }) => {
    try {
      const res = await fetch(`${APIS.GREEKS}/api/greeks/expiry/${bucket}?ticker=${ticker}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      // Limit returned strikes to top 20 by absolute GEX/Vanna to save context window, or return as is if small
      if (data && data.data && data.data.strikes && data.data.strikes.length > 50) {
        // Sort by absolute vanna + gex to find the most "interesting" strikes
        data.data.strikes = data.data.strikes.sort((a: any, b: any) => 
          (Math.abs(b.vanna || 0) + Math.abs(b.gex_spotgamma || 0)) - (Math.abs(a.vanna || 0) + Math.abs(a.gex_spotgamma || 0))
        ).slice(0, 30);
      }

      return { success: true, data };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : "Error fetching Greeks Expiry" };
    }
  },
});

/** Tool 2: Fetch GRU Regime detection */
const getRegimeTool = tool({
  name: "get_regime",
  description: "Mengambil hasil deteksi regime pasar menggunakan model GRU (Gated Recurrent Unit). Mengembalikan: Bull / Bear / Transitional beserta probabilitas dan fitur-fitur utama. Gunakan untuk memahami arah trend pasar secara keseluruhan.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker saham yang didukung: SPY, QQQ, IWM, TSLA"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker }) => {
    try {
      const res = await fetch(`${APIS.REGIME}/api/regime/predict?ticker=${ticker}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.history) delete data.history;
      return { success: true, data };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : "Error fetching regime" };
    }
  },
});

/** Tool 3: Fetch VRP (Volatility Risk Premium) */
const getVrpTool = tool({
  name: "get_vrp",
  description: "Mengambil data Volatility Risk Premium (VRP) — selisih antara Implied Volatility dan Realized Volatility. Termasuk HAR-RV forecast, Z-Score, sinyal trading, dan riwayat historis. Gunakan untuk menilai apakah opsi mahal/murah secara relatif.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker saham, contoh: SPY, QQQ, AAPL"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker }) => {
    try {
      const res = await fetch(`${APIS.VRP}/api/vrp?ticker=${ticker}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.history) delete data.history;
      return { success: true, data };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : "Error fetching VRP" };
    }
  },
});

/** Tool 4: Fetch Volatility forecast (HAR-RV, HMM) */
const getVolForecastTool = tool({
  name: "get_vol_forecast",
  description: "Mengambil forecast volatilitas menggunakan model HAR-RV, HAR-CJ, Kalman, dan HMM regime. Mengembalikan prediksi realized volatility untuk 1, 5, 22 hari ke depan beserta komponen jump dan continuous. Gunakan untuk menilai ekspektasi volatilitas pasar.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker saham"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: z.unknown(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker }) => {
    try {
      const res = await fetch(`${APIS.VOL}/api/vol/forecast?ticker=${ticker}`, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.history) delete data.history;
      if (data.series) delete data.series;
      return { success: true, data };
    } catch (e) {
      return { success: false, data: null, error: e instanceof Error ? e.message : "Error fetching vol forecast" };
    }
  },
});

/** Tool 5: Execute paper trade */
const executePaperTradeTool = tool({
  name: "execute_paper_trade",
  description: "Mengeksekusi paper trade secara otomatis pada sistem paper trading internal. PENTING: Hanya gunakan tool ini jika user secara eksplisit meminta Agent untuk mengeksekusi trade. Pastikan ticker, arah (BUY/SELL), jumlah saham, dan harga sudah jelas sebelum mengeksekusi.",
  inputSchema: z.object({
    ticker: z.string().describe("Ticker saham"),
    side: z.enum(["BUY", "SELL"]).describe("BUY untuk long, SELL untuk short"),
    quantity: z.number().int().positive().describe("Jumlah lembar saham"),
    price: z.number().positive().describe("Harga eksekusi"),
    reason: z.string().describe("Alasan singkat mengapa trade ini diambil"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    trade_id: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ ticker, side, quantity, price, reason }) => {
    try {
      const res = await fetch(`${APIS.VRP}/api/paper/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, side, quantity, price, reason, source: "agent" }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { id?: string; message?: string };
      return { success: true, trade_id: data.id, message: data.message ?? `${side} ${quantity} ${ticker} @ $${price} executed` };
    } catch (e) {
      return { success: false, message: "Trade gagal dieksekusi", error: e instanceof Error ? e.message : "Error" };
    }
  },
});

/** Tool 6: Web Search (Mencari informasi/berita terbaru dari internet secara gratis) */
const webSearchTool = tool({
  name: "web_search",
  description: "Mencari berita finansial, rilis data makroekonomi (misalnya inflasi CPI, suku bunga FOMC), sentimen pasar, atau berita emiten terbaru di internet secara real-time. Gunakan tool ini jika user menanyakan info terbaru di luar data teknikal lokal.",
  inputSchema: z.object({
    query: z.string().describe("Query pencarian yang spesifik, contoh: 'TSLA news today' atau 'US CPI release May 2026'"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    results: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ query }) => {
    try {
      const encodedQuery = encodeURIComponent(query);
      const headers: Record<string, string> = { "Accept": "text/plain" };
      if (process.env.JINA_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
      }
      const res = await fetch(`https://s.jina.ai/${encodedQuery}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Search HTTP error ${res.status}`);
      const text = await res.text();
      // Slice results to keep context length reasonable (approx. 7000 characters)
      return { success: true, results: text.slice(0, 7000) };
    } catch (e) {
      return { success: false, results: "", error: e instanceof Error ? e.message : "Search error" };
    }
  },
});

/** Tool 7: Fetch Webpage (Membaca konten penuh suatu halaman web secara gratis) */
const fetchWebpageTool = tool({
  name: "fetch_webpage",
  description: "Membaca teks utuh dari suatu URL halaman web (artikel berita, siaran pers, dll). Gunakan ini jika Anda ingin informasi lebih mendalam dari salah satu hasil web_search.",
  inputSchema: z.object({
    url: z.string().url().describe("URL halaman web yang ingin dibaca kontennya"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    content: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ url }) => {
    try {
      const headers: Record<string, string> = {};
      if (process.env.JINA_API_KEY) {
        headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
      }
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Reader HTTP error ${res.status}`);
      const text = await res.text();
      // Slice content to keep context length reasonable (approx. 8000 characters)
      return { success: true, content: text.slice(0, 8000) };
    } catch (e) {
      return { success: false, content: "", error: e instanceof Error ? e.message : "Scraping error" };
    }
  },
});

/** Tool 8: Save Memory — agent autonomously stores important facts/preferences to persistent memory */
const saveMemoryTool = tool({
  name: "save_memory",
  description: `Simpan fact, preferensi, opini, atau rencana penting dari user ke dalam long-term memory yang persisten. 
Gunakan tool ini secara PROAKTIF saat kamu mendeteksi informasi penting tentang user, seperti:
- Preferensi trading (timeframe, risk tolerance, ticker favorit)
- Opini/pandangan pasar user (bearish/bullish pada suatu ticker)
- Rencana trading yang sedang dipertimbangkan
- Konteks penting yang relevan untuk analisis berikutnya
Jangan berlebihan — simpan hanya informasi yang benar-benar penting dan akan berguna di sesi berikutnya.`,
  inputSchema: z.object({
    category: z.enum(["preference", "opinion", "plan", "context", "observation"])
      .describe("Kategori memory: 'preference' (preferensi trading), 'opinion' (pandangan pasar), 'plan' (rencana trade), 'context' (konteks umum), 'observation' (observasi pasar)"),
    content: z.string().describe("Konten yang ingin disimpan, ditulis jelas dan ringkas. Maks 150 karakter."),
    ticker: z.string().optional().describe("Ticker terkait jika ada, contoh: SPY, QQQ"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ category, content, ticker }) => {
    // The actual saving is handled client-side via the memoryUpdates field in the response.
    // Here we just acknowledge the intent — the client will process it.
    return {
      success: true,
      message: `Memory saved: [${category}] ${content}${ticker ? ` (${ticker})` : ""}`,
    };
  },
});

// ─── Agent tools registry ─────────────────────────────────────────────────────
const AGENT_TOOLS = [
  getGreeksTool, 
  getGreeksByExpiryTool, 
  getRegimeTool, 
  getVrpTool, 
  getVolForecastTool, 
  executePaperTradeTool,
  webSearchTool,
  fetchWebpageTool,
  saveMemoryTool,
] as const;

// ─── POST Handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, model, ticker, conversationState, memoryContext, personaId, activeTools, stream: streamMode } = body;

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const selectedModel = model || "meta-llama/llama-3.3-70b-instruct";

    // Restore state or create new
    const state = conversationState ?? createInitialState();

    // Build system prompt — inject persona + long-term memory context
    const systemPrompt = getSystemPrompt(ticker || "SPY", memoryContext, personaId as PersonaId | undefined);

    const finalInput = [
      { id: "system-msg", role: "system" as const, content: systemPrompt },
      { id: "user-msg", role: "user" as const, content: message }
    ];

    // Filter tools based on activeTools list (empty = all enabled)
    const filteredTools = (activeTools && Array.isArray(activeTools) && activeTools.length > 0)
      ? AGENT_TOOLS.filter(t => (activeTools as string[]).includes((t as any).name))
      : AGENT_TOOLS;

    // StateAccessor untuk callModel
    const stateAccessor = {
      load: async () => state,
      save: async (newState: any) => {
        // Disini kita bisa simpan ke DB nanti.
        // Untuk sekarang, kita kembalikan di akhir stream/request
      }
    };

    // ── Streaming Agent response ──────────────────────────────────────────────
    if (streamMode) {
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          const send = (data: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

          try {
            const result = callModel(client, {
              model: selectedModel,
              input: finalInput,
              tools: filteredTools as typeof AGENT_TOOLS,
              state: stateAccessor,
              stopWhen: [stepCountIs(6), maxCost(0.50)],
            });

            // Stream text token by token
            const stream = result.getTextStream();
            for await (const chunk of await stream) {
              send({ type: "delta", content: chunk });
            }

            const response = await result.getResponse();
            const finalState = await result.getState();

            // Extract save_memory tool calls from the response state messages or steps to send to client
            const memoryUpdates: Array<{ category: string; content: string; ticker?: string }> = [];
            try {
              const processToolCall = (tc: any) => {
                if (!tc) return;
                
                // Case 1: Standard function calling (e.g. OpenAI format)
                if (tc.function?.name === "save_memory") {
                  const args = typeof tc.function.arguments === "string"
                    ? JSON.parse(tc.function.arguments)
                    : tc.function.arguments;
                  if (args) memoryUpdates.push(args);
                  return;
                }
                
                // Case 2: Simple SDK format (e.g. { name: "...", arguments/args: ... })
                if (tc.name === "save_memory") {
                  const rawArgs = tc.arguments ?? tc.args;
                  const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
                  if (args) memoryUpdates.push(args);
                  return;
                }
              };

              // Check conversation messages
              const msgs = (finalState as any)?.messages ?? [];
              for (const msg of msgs) {
                if (msg) {
                  // Direct flat function_call object from @openrouter/agent SDK
                  if (msg.type === "function_call" && msg.name === "save_memory") {
                    const args = typeof msg.arguments === "string"
                      ? JSON.parse(msg.arguments)
                      : msg.arguments;
                    if (args) memoryUpdates.push(args);
                  }
                  
                  // Support nested tool_calls if they exist
                  if (msg.tool_calls) {
                    for (const tc of msg.tool_calls) {
                      processToolCall(tc);
                    }
                  }
                }
              }
              // Fallback to steps if present
              const steps = (finalState as any)?.steps ?? [];
              for (const step of steps) {
                if (step?.tool_calls) {
                  for (const tc of step.tool_calls) {
                    processToolCall(tc);
                  }
                }
              }
            } catch (err) {
              console.error("Error parsing memoryUpdates:", err);
            }

            send({ type: "done", state: finalState, usage: response.usage, memoryUpdates });
          } catch (e) {
            console.error("Agent execution error:", e);
            send({ type: "error", error: e instanceof Error ? e.message : "Agent error" });
          } finally {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
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

    // ── Non-streaming Agent ───────────────────────────────────────────────────
    const result = callModel(client, {
      model: selectedModel,
      input: finalInput,
      tools: filteredTools as typeof AGENT_TOOLS,
      state: stateAccessor,
      stopWhen: [stepCountIs(6), maxCost(0.50)],
    });

    const [text, response, finalState] = await Promise.all([
      result.getText(), 
      result.getResponse(),
      result.getState()
    ]);

    return NextResponse.json({
      answer: text,
      state: finalState,
      usage: response.usage,
      model_used: selectedModel,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
