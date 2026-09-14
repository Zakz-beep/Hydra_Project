import { NextRequest, NextResponse } from "next/server";
import { getSystemPrompt } from "../../../lib/systemPrompt";
import type { PersonaId } from "../../../lib/personas";

// Set via .env.local — jangan hardcode API key di sini
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY!;
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ─── Tool definitions (JSON Schema for OpenRouter) ────────────────────────────
const TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "get_greeks",
      description: "Mengambil data Options Greeks lengkap (GEX, Vanna, Charm, VEX, Gamma Flip) untuk ticker tertentu.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", description: "Ticker saham, contoh: SPY, QQQ, AAPL, TSLA" } },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_greeks_by_expiry",
      description: "Mengambil data Options Greeks granular per-strike untuk satu expiry bucket tertentu.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          bucket: { type: "number", description: "Expiry bucket: 0, 1, 7, 14, atau 30" },
        },
        required: ["ticker", "bucket"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_regime",
      description: "Mengambil hasil deteksi regime pasar menggunakan model GRU. Mengembalikan Bull / Bear / Transitional.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", description: "Ticker yang didukung: SPY, QQQ, IWM, TSLA" } },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_vrp",
      description: "Mengambil data Volatility Risk Premium (VRP) — selisih IV vs RV, HAR-RV forecast, Z-Score.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", description: "Ticker saham, contoh: SPY, QQQ, AAPL" } },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_vol_forecast",
      description: "Mengambil forecast volatilitas menggunakan HAR-RV, HAR-CJ, Kalman, dan HMM regime.",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string", description: "Ticker saham" } },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "execute_paper_trade",
      description: "Mengeksekusi paper trade. HANYA jika user meminta eksplisit.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string" },
          side: { type: "string", enum: ["BUY", "SELL"] },
          quantity: { type: "number" },
          price: { type: "number" },
          reason: { type: "string" },
        },
        required: ["ticker", "side", "quantity", "price", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description: "Mencari berita finansial atau info makroekonomi terbaru dari internet.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Query pencarian spesifik" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fetch_webpage",
      description: "Membaca teks utuh dari suatu URL halaman web.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "URL halaman web yang ingin dibaca" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "save_memory",
      description: "Simpan preferensi/insight user ke long-term memory persisten.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["preference", "opinion", "plan", "context", "observation"] },
          content: { type: "string", description: "Konten ringkas (maks 150 karakter)" },
          ticker: { type: "string", description: "Ticker terkait jika ada" },
        },
        required: ["category", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_market_history",
      description: "Mengambil data historis OHLCV (Open, High, Low, Close, Volume) untuk ticker instrumen keuangan seperti SPY, QQQ, TSLA, ^GSPC (S&P 500), atau ^VIX (VIX Index). Mendukung interval 5m, 15m, 1h, 4h (resampled), dan 1d.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker simbol instrumen, contoh: SPY, QQQ, AAPL, ^GSPC, ^VIX" },
          interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"], description: "Interval candle. Pilihan: 5m, 15m, 1h, 4h, 1d" },
          period: { type: "string", description: "Jangka waktu data historis, contoh: '5d', '30d', '60d', '1y'" },
        },
        required: ["ticker", "interval"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "tune_hmm_model",
      description: "Melatih (tune/racik) model HMM (Hidden Markov Model) secara dinamis dengan kustomisasi fitur, jumlah state, jenis kovarians, dan hyperparameter lainnya untuk analisis regime pasar yang paling optimal.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker saham atau indeks, contoh: SPY, QQQ, TSLA, ^GSPC, ^VIX" },
          features: {
            type: "array",
            items: {
              type: "string",
              enum: ["returns", "volatility_5", "volatility_10", "volatility_22", "range", "volume_change", "ma_ratio_5_22"],
            },
            description: "Daftar fitur kuantitatif untuk melatih HMM. Rekomendasi pilih 2-4 fitur saja.",
          },
          n_components: {
            type: "number",
            description: "Jumlah state/regime pasar yang ingin dideteksi (antara 2 sampai 5). Rekomendasi coba 2 atau 3.",
          },
          covariance_type: {
            type: "string",
            enum: ["diag", "full", "spherical", "tied"],
            description: "Tipe kovarians untuk matriks emisi. Pilihan: diag (default), full, spherical, tied.",
          },
          period: {
            type: "string",
            description: "Jangka waktu data historis yfinance, contoh: '1y', '2y', '5y' (default: '2y').",
          },
          interval: {
            type: "string",
            enum: ["1d", "1h", "15m"],
            description: "Interval data historis, pilihan: '1d' (default), '1h', '15m'.",
          },
        },
        required: ["ticker", "features", "n_components"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_price_action",
      description: "Mengambil analisis Price Action real-time (candlestick patterns, EMA crossover, support/resistance key levels, Bollinger squeeze) untuk ticker tertentu.",
      parameters: {
        type: "object",
        properties: {
          ticker: { type: "string", description: "Ticker simbol instrumen, contoh: SPY, QQQ, AAPL, TSLA" },
          interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"], description: "Interval candle. Pilihan: 5m, 15m, 1h, 4h, 1d (default: 15m)" },
          period: { type: "string", description: "Jangka waktu data historis, contoh: '5d', '30d' (default: 5d)" },
        },
        required: ["ticker"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_dcc_analysis",
      description: "Menjalankan model korelasi dinamis DCC-GARCH & Copula tail dependence untuk mengukur keterkaitan ekstrim antar aset/portofolio secara statistik.",
      parameters: {
        type: "object",
        properties: {
          tickers: {
            type: "array",
            items: { type: "string" },
            description: "Daftar ticker simbol instrumen keuangan (minimal 2 ticker), contoh: ['SPY', 'QQQ'] atau ['AAPL', 'TSLA']",
          },
          mode: {
            type: "string",
            enum: ["1", "2", "3", "4"],
            description: "Mode analisis: '1' untuk Scalper (5m, 7d), '2' untuk Day Trade (15m, 14d), '3' untuk Swing (1h, 30d), '4' untuk Core (1d, 3y - default)",
          },
        },
        required: ["tickers"],
      },
    },
  },
];

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  description: string;
}

// ─── POST: Single LLM step — returns tool requests OR final text ──────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages: historyMessages = [],
      model,
      ticker,
      memoryContext,
      personaId,
      activeTools,
      reactMode,
    } = body;

    const selectedModel = model || "meta-llama/llama-3.3-70b-instruct";
    const systemPrompt = getSystemPrompt(
      ticker || "SPY",
      memoryContext,
      personaId as PersonaId | undefined,
      reactMode as boolean | undefined
    );

    // Build messages array with system prompt prepended
    const messages: any[] = [
      { role: "system", content: systemPrompt },
      ...historyMessages,
    ];

    // Filter tools if activeTools whitelist provided
    const filteredTools =
      activeTools && Array.isArray(activeTools) && activeTools.length > 0
        ? TOOL_SCHEMAS.filter((t) => (activeTools as string[]).includes(t.function.name))
        : TOOL_SCHEMAS;

    // ── Direct fetch to OpenRouter (no SDK wrapper) ──────────────────────────
    const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "VRP Quant Agent",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        tools: filteredTools,
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!orRes.ok) {
      const errText = await orRes.text().catch(() => orRes.statusText);
      return NextResponse.json(
        { type: "error", error: `OpenRouter ${orRes.status}: ${errText}` },
        { status: 500 }
      );
    }

    const data = await orRes.json();
    const choice = data.choices?.[0];
    const assistantMessage = choice?.message;

    if (!assistantMessage) {
      return NextResponse.json({ type: "error", error: "No message in OpenRouter response" }, { status: 500 });
    }

    // ── Model wants to call tools ─────────────────────────────────────────────
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolRequests: ToolCallRequest[] = assistantMessage.tool_calls.map((tc: any) => {
        let args: Record<string, unknown> = {};
        try {
          args =
            typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : (tc.function.arguments ?? {});
        } catch { /* malformed JSON args — leave empty */ }

        const schema = TOOL_SCHEMAS.find((s) => s.function.name === tc.function.name);
        return {
          id: tc.id,
          name: tc.function.name,
          args,
          description: schema?.function.description ?? tc.function.name,
        };
      });

      return NextResponse.json({
        type: "tool_requests",
        calls: toolRequests,
        assistantMessage,   // client appends this to history before next step
        usage: data.usage,
      });
    }

    // ── Final text response ───────────────────────────────────────────────────
    const text = assistantMessage.content ?? "";
    return NextResponse.json({
      type: "final",
      text,
      assistantMessage,
      usage: data.usage,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown server error";
    console.error("[/api/agent/step] error:", msg);
    return NextResponse.json({ type: "error", error: msg }, { status: 500 });
  }
}
