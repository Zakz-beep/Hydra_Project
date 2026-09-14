import { NextRequest, NextResponse } from "next/server";

// ─── Internal API base URLs ───────────────────────────────────────────────────
const APIS = {
  VRP:    "http://localhost:8000",
  GREEKS: "http://localhost:8001",
  RISK:   "http://localhost:8002",
  REGIME: "http://localhost:8007",
  VOL:    "http://localhost:8006",
  DCC:    "http://localhost:8004",
};

// ─── Tool executor map ────────────────────────────────────────────────────────
type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  get_greeks: async ({ ticker }) => {
    const res = await fetch(`${APIS.GREEKS}/api/greeks/summary?ticker=${ticker}&source=cboe`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { success: false, data: null, error: `HTTP ${res.status}` };
    return { success: true, data: await res.json() };
  },

  get_greeks_by_expiry: async ({ ticker, bucket }) => {
    const res = await fetch(`${APIS.GREEKS}/api/greeks/expiry/${bucket}?ticker=${ticker}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { success: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    // Limit strikes
    if (data?.data?.strikes?.length > 50) {
      data.data.strikes = data.data.strikes
        .sort((a: any, b: any) =>
          (Math.abs(b.vanna || 0) + Math.abs(b.gex_spotgamma || 0)) -
          (Math.abs(a.vanna || 0) + Math.abs(a.gex_spotgamma || 0))
        )
        .slice(0, 30);
    }
    return { success: true, data };
  },

  get_regime: async ({ ticker }) => {
    const res = await fetch(`${APIS.REGIME}/api/regime/predict?ticker=${ticker}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { success: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.history) delete data.history;
    return { success: true, data };
  },

  get_vrp: async ({ ticker }) => {
    const res = await fetch(`${APIS.VRP}/api/vrp?ticker=${ticker}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { success: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.history) delete data.history;
    return { success: true, data };
  },

  get_vol_forecast: async ({ ticker }) => {
    const res = await fetch(`${APIS.VOL}/api/vol/forecast?ticker=${ticker}`, {
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { success: false, data: null, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (data.history) delete data.history;
    if (data.series) delete data.series;
    return { success: true, data };
  },

  execute_paper_trade: async ({ ticker, side, quantity, price, reason }) => {
    const res = await fetch(`${APIS.VRP}/api/paper/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker, side, quantity, price, reason, source: "agent" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { success: false, message: "Trade failed", error: `HTTP ${res.status}` };
    const data = await res.json() as { id?: string; message?: string };
    return {
      success: true,
      trade_id: data.id,
      message: data.message ?? `${side} ${quantity} ${ticker} @ $${price} executed`,
    };
  },

  web_search: async ({ query }) => {
    const encodedQuery = encodeURIComponent(query as string);
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
    }
    const res = await fetch(`https://s.jina.ai/${encodedQuery}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { success: false, results: "", error: `HTTP ${res.status}` };
    const text = await res.text();
    return { success: true, results: text.slice(0, 7000) };
  },

  fetch_webpage: async ({ url }) => {
    const headers: Record<string, string> = {};
    if (process.env.JINA_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.JINA_API_KEY}`;
    }
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { success: false, content: "", error: `HTTP ${res.status}` };
    const text = await res.text();
    return { success: true, content: text.slice(0, 8000) };
  },

  save_memory: async ({ category, content, ticker }) => {
    // Actual saving is done client-side; server just acknowledges
    return {
      success: true,
      message: `Memory saved: [${category}] ${content}${ticker ? ` (${ticker})` : ""}`,
    };
  },

  get_market_history: async ({ ticker, interval, period }) => {
    const params = new URLSearchParams();
    if (ticker) params.set("ticker", ticker as string);
    if (interval) params.set("interval", interval as string);
    if (period) params.set("period", period as string);

    const res = await fetch(`${APIS.VRP}/api/market/history?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} from market history api` };
    }
    const data = await res.json();
    return { success: true, data };
  },

  tune_hmm_model: async ({ ticker, features, n_components, covariance_type, period, interval }) => {
    const res = await fetch(`${APIS.VOL}/api/vol/hmm/tune`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker,
        features,
        n_components,
        covariance_type: covariance_type ?? "diag",
        period: period ?? "2y",
        interval: interval ?? "1d",
      }),
      signal: AbortSignal.timeout(35000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: errText };
    }
    const data = await res.json();
    return { success: true, data };
  },

  get_price_action: async ({ ticker, interval, period }) => {
    const params = new URLSearchParams();
    if (ticker) params.set("ticker", ticker as string);
    if (interval) params.set("interval", interval as string);
    if (period) params.set("period", period as string);

    const res = await fetch(`${APIS.VRP}/api/market/price-action?${params.toString()}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} from price action api` };
    }
    const data = await res.json();
    return { success: true, data };
  },

  run_dcc_analysis: async ({ tickers, mode }) => {
    const res = await fetch(`${APIS.DCC}/api/dcc/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, mode: mode ?? "4" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: errText };
    }
    const data = await res.json();
    if (data && data.timeseries && Array.isArray(data.timeseries)) {
      data.timeseries = data.timeseries.slice(-100);
    }
    return { success: true, data };
  },
};

// ─── POST: Execute a single tool by name ─────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { toolName, toolArgs } = await req.json() as {
      toolName: string;
      toolArgs: Record<string, unknown>;
    };

    if (!toolName) {
      return NextResponse.json({ error: "toolName is required" }, { status: 400 });
    }

    const executor = TOOL_EXECUTORS[toolName];
    if (!executor) {
      return NextResponse.json({ error: `Unknown tool: ${toolName}` }, { status: 400 });
    }

    const result = await executor(toolArgs ?? {});
    return NextResponse.json({ success: true, result });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Tool execution error";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
