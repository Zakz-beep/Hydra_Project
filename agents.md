# 🧠 VRP Dashboard — Project Memory for AI Agents

> **Baca dokumen ini di awal setiap sesi** agar kamu memiliki konteks penuh tentang proyek ini.  
> Diperbarui terakhir: 2026-05-10

---

## 📌 Ringkasan Proyek

**Options Quant Dashboard** adalah platform analitik keuangan kuantitatif berbasis web yang menggabungkan model statistik canggih (HAR-RV, GRU, HMM, DCC-GARCH) dengan antarmuka dashboard interaktif. Proyek ini dirancang untuk **paper trading, analisis volatilitas, manajemen risiko, dan deteksi regime pasar**.

- **Stack Frontend**: Next.js 14 + TypeScript + TailwindCSS + Recharts + Plotly.js + Lightweight Charts v5
- **Stack Backend**: Python (FastAPI) — beberapa server API terpisah, dijalankan via `uv run`
- **Database**: SQLite (beberapa file `.db` per domain, disimpan di `python/data/`)
- **Root Direktori**: `c:\Users\Akbar Alviansyah\Downloads\vrp-dashboard\`

---

## 🗂️ Struktur Direktori

```
vrp-dashboard/
├── agents.md                # ← Dokumen ini (Project Memory)
├── implementation_plan.md   # ← Rencana implementasi aktif
├── task.md                  # ← Task checklist aktif
├── api.txt                  # ← Catatan API
├── model/                   # ← Eksperimen model standalone (research)
│   ├── transformer-2.py     # Transformer model research
│   ├── transforme.py        # Versi awal transformer
│   ├── ltsm.py / ltsm-1.py  # LSTM research
│   ├── johansem.py / johansen-backtest.py # Johansen cointegration
│   ├── johansem-kalman.py   # Johansen + Kalman
│   ├── k-means.py           # K-Means clustering
│   ├── sharlq.py            # Sharpe/Sharpe-ratio research
│   ├── vix-har.py           # VIX + HAR research
│   └── HAR-RV.PY            # HAR-RV baseline
│
├── vrp-claude/              # ← Frontend Next.js (MAIN)
│   ├── app/
│   │   ├── page.tsx         # ← Halaman utama dashboard (mode switcher)
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── lib/             # TypeScript API client helpers
│   │   │   ├── vrp.ts       # VRP fetch & types
│   │   │   ├── greeks.ts    # Greeks fetch & types
│   │   │   ├── risk.ts      # Risk pipeline fetch & types
│   │   │   ├── dcc.ts       # DCC correlation fetch & types
│   │   │   ├── volatility.ts # Vol engine fetch & types
│   │   │   └── regime.ts    # GRU Regime fetch & types
│   │   ├── api/             # Next.js API routes (proxy/passthrough)
│   │   │   ├── vrp/route.ts
│   │   │   ├── greeks/
│   │   │   ├── alpaca/
│   │   │   ├── yahoo/
│   │   │   ├── tickers/route.ts  # ← SQLite ticker data storage API
│   │   │   └── paper/            # ← Paper trading persistence API
│   │   │       └── [...path]/    # Dynamic catch-all route
│   │   └── components/      # React components (dibagi per domain)
│   │       ├── MetricCard.tsx
│   │       ├── VRPChart.tsx
│   │       ├── VRPGauge.tsx
│   │       ├── Pipeline.tsx
│   │       ├── RVBreakdown.tsx
│   │       ├── BacktestPanel.tsx
│   │       ├── SignalLog.tsx
│   │       ├── TickerInput.tsx
│   │       ├── SignalBadge.tsx
│   │       ├── MarketChart.tsx
│   │       ├── greeks/      # Options Greeks components
│   │       ├── risk/        # Risk Pipeline components
│   │       ├── dcc/         # DCC Correlation components
│   │       ├── volatility/  # Volatility Engine components
│   │       ├── regime/      # GRU Regime components
│   │       └── lwc/         # Lightweight Charts components
│   ├── next.config.js       # ← API rewrites/proxy config
│   └── package.json
│
└── python/                  # ← Backend Python (beberapa API server)
    ├── start_servers.py     # ← Script untuk menjalankan SEMUA server sekaligus
    ├── vrp_api3.py          # ← VRP Engine API (port 8000, AKTIF) — termasuk paper trading persistence
    ├── vrp_api2.py          # ← Versi lama VRP API (tidak digunakan)
    ├── vrp_api.py           # ← Versi paling awal VRP API (tidak digunakan)
    ├── greeks_api.py        # ← Greeks API (port 8001)
    ├── risk_api.py          # ← Risk Management API (port 8002)
    ├── regime_api.py        # ← GRU Regime API (port 8007)
    ├── db.py                # ← SQLite helper (VRP)
    ├── greeks_db.py         # ← SQLite helper (Greeks)
    ├── rv_engine.py         # ← Realized Volatility engine
    ├── vrp_model.py         # ← Core VRP calculation
    ├── Greeks.py            # ← Options Greeks computation
    ├── test_gru.py          # ← Script test GRU model
    ├── requirements.txt     # ← Python dependencies
    ├── risk_portfolio.db    # ← SQLite DB: Risk management
    ├── data/                # ← SQLite DB files (per domain)
    │   ├── vrp.db           # VRP snapshots
    │   └── greeks.db        # Greeks data
    ├── volatality/          # ← Volatility Engine API
    │   ├── api.py           # FastAPI server (port 8006)
    │   ├── har_cj_model.py  # HAR-CJ model
    │   ├── har_kalman_model.py # HAR + Kalman filter
    │   ├── hmm_har_volatility.py # HMM volatility
    │   ├── hmm_volatality.py    # HMM standalone
    │   ├── msar.py          # Markov-Switching AR
    │   ├── har-cj.py        # HAR-CJ research/reference
    │   ├── har-kalman.py    # HAR-Kalman research/reference
    │   └── har_x_dashboard.html # Standalone HTML dashboard (dev)
    ├── correlaction/        # ← DCC Correlation API
    │   ├── api.py           # FastAPI server (port 8004)
    │   ├── copula_model.py
    │   ├── modeldcc.py
    │   ├── hmm_model.py
    │   ├── hiddenmarkov.py
    │   ├── db.py            # Correlation DB helper
    │   └── correlaction.db  # SQLite DB (~62MB)
    ├── ml_models/           # ← GRU Trained Models
    │   ├── gru_regim.py     # GRU regime engine
    │   ├── hybrid_engine.py # Hybrid LSTM+HAR engine
    │   ├── train_lstm.py    # Training script
    │   ├── SPY_gru_regime_v5.keras   # + _scaler_v5.pkl + _feature_cols_v5.json
    │   ├── QQQ_gru_regime_v5.keras   # + _scaler_v5.pkl + _feature_cols_v5.json
    │   ├── IWM_gru_regime_v5.keras   # + _scaler_v5.pkl + _feature_cols_v5.json
    │   ├── TSLA_gru_regime_v5.keras  # + _scaler_v5.pkl + _feature_cols_v5.json
    │   └── SPY_gru_metrics_v5.json  # Training metrics
    ├── riskManagement/      # ← Risk Management modules
    │   ├── main.py
    │   ├── data_layer.py    # ← Data layer (fetching, caching)
    │   ├── risk_db.py       # ← SQLite DB helper for risk
    │   ├── module_1_gate.py # Pre-trade gate logic
    │   ├── module_2_portfolio.py # Portfolio module
    │   ├── module_3_behavior.py  # Behavior/regime module
    │   ├── phase2_model.py  # Monte Carlo + GARCH
    │   ├── phase3_simulation.py
    │   ├── phase4_metrics.py # VaR, CVaR
    │   ├── phase5_stress.py  # Stress testing
    │   └── phase6_dashboard.py
    └── yield/               # ← Yield/FRED data fetchers
        └── legatruu.py      # Term Premium (LEGATRUU/ACM Model)
```

---

## 🖥️ Mode Dashboard (Navigasi Utama)

`page.tsx` menggunakan `appMode` state untuk beralih antar modul. Ada **7 mode utama**:

| Mode           | Label UI         | Deskripsi                                                   |
| -------------- | ---------------- | ----------------------------------------------------------- |
| `"vrp"`        | VRP Engine       | Volatility Risk Premium, HAR-RV, BSM Newton-Raphson         |
| `"greeks"`     | Greeks Inventory | Gamma/Vanna/Charm Exposure, Dealer Regime                   |
| `"risk"`       | Risk Pipeline    | Monte Carlo, GARCH+HMM, VaR/CVaR, Prop Firm Challenge       |
| `"dcc"`        | Correlation      | DCC-GARCH Dynamic Correlation, Systemic Risk Index          |
| `"volatility"` | Vol Engine       | HAR-RV Forecast, HMM Market Regime, Realized Vol Engine     |
| `"regime"`     | GRU Regime       | GRU Market Regime Detection                                 |
| `"lwc"`        | LWC Chart        | Advanced Trading Chart (Lightweight Charts + Paper Trading) |

---

## 🔌 API Backend — Port & Endpoint

| Server      | File                         | Port Default   | Endpoint Prefix                                                 |
| ----------- | ---------------------------- | -------------- | --------------------------------------------------------------- |
| VRP API     | `python/vrp_api3.py`         | `8000`         | `/api/vrp`, `/api/backtest`, `/api/signal-log`, `/api/db-stats`, `/api/paper/*` |
| Greeks API  | `python/greeks_api.py`       | `8001`         | `/api/greeks`                                                   |
| Risk API    | `python/risk_api.py`         | `8002`         | `/api/risk/...`                                                 |
| Correlation | `python/correlaction/api.py` | `8004`         | `/api/dcc/...`                                                  |
| Vol Engine  | `python/volatality/api.py`   | `8006`         | `/api/vol/...`                                                  |
| GRU Regime  | `python/regime_api.py`       | `8007`         | `/api/regime/...`                                               |

**Next.js Proxy Rewrites** (`next.config.js`):

- `/api/risk/*` → `http://localhost:8002/api/risk/*`
- `/api/regime/*` → `http://localhost:8007/api/regime/*`
- `/api/*` → `http://localhost:8000/api/*` (fallback ke VRP API)

> ⚠️ Vol Engine (8006) dan Correlation (8004) **tidak** memiliki rewrite di `next.config.js` — mereka dipanggil langsung atau melalui fallback. Perlu ditambahkan jika diperlukan.

**Cara menjalankan semua server:**
*Semua server berjalan via Uvicorn dengan flag `--host 0.0.0.0 --reload`, sehingga bisa diakses perangkat lain di WiFi yang sama.*

```bash
cd python
uv run python start_servers.py
```

**Cara menjalankan frontend:**

```bash
cd vrp-claude
npm run dev
# → Otomatis listen di 0.0.0.0:3000 (bisa diakses via http://<IP_LOKAL>:3000 dari HP)
```

---

## 🧩 Komponen Frontend — Peta Detail

### Root Components (generic)

- `MetricCard.tsx` — Kartu metrik dengan highlight color (green/red/neutral)
- `VRPChart.tsx` — Recharts line chart untuk historical VRP
- `VRPGauge.tsx` — Gauge visual untuk VRP Z-Score
- `Pipeline.tsx` — Visualisasi pipeline kalkulasi VRP
- `RVBreakdown.tsx` — Breakdown RV (intraday, HAR, blended)
- `BacktestPanel.tsx` — Panel hasil backtest signal
- `SignalLog.tsx` — Log sinyal trading historis
- `TickerInput.tsx` — Input ticker dengan suggestions
- `SignalBadge.tsx` — Badge warna untuk sinyal (LONG/SHORT/NEUTRAL)

### `components/greeks/`

- `GreeksOverview.tsx` — Overview snapshot Greeks (GEX, Vanna, Charm)
- `GreeksChart.tsx` — Chart historis Greeks
- `GreeksHistoryTable.tsx` — Tabel data historis
- `GreeksBacktestPanel.tsx` — Backtest Greeks signals
- `GreeksSignalLog.tsx` — Log sinyal Greeks
- `GreeksSurfaces.tsx` — 3D surface chart options (Plotly)

### `components/risk/`

- `RiskDashboardLayout.tsx` — Layout utama Risk Pipeline
- `PreTradeGate.tsx` — Gate pre-trade (modul 1)
- `MonteCarloMetrics.tsx` — Metrik Monte Carlo simulation
- `PostTradeEval.tsx` — Evaluasi post-trade
- `PipelineControl.tsx` — Kontrol pipeline
- `RegimePanel.tsx` — Panel regime dalam risk context

### `components/dcc/`

- `DCCDashboard.tsx` — Main dashboard DCC Correlation
- `DCCChart.tsx` — Chart dynamic conditional correlation
- `DCCMetrics.tsx` — Metrik korelasi
- `CopulaDashboard.tsx` — Copula analysis
- `CopulaChart.tsx` — Chart copula
- `HMMDashboard.tsx` — HMM regime dalam konteks korelasi
- `ContourHeatmap.tsx` — Heatmap contour
- `JointContourPlot.tsx` — Joint contour plot

### `components/volatility/`

- `VolatilityDashboard.tsx` — Main volatility engine dashboard
- `HARChart.tsx` — HAR-RV chart
- `HAR_CJChart.tsx` — HAR-CJ (Jump/Continuous decomposition)
- `HMMRegimeChart.tsx` — HMM regime overlay
- `KalmanHARCJChart.tsx` — Kalman filtered HAR-CJ
- `MSARChart.tsx` — Markov-Switching AR chart
- `HybridArbChart.tsx` — Hybrid arbitrage visualization

### `components/regime/`

- `RegimeDashboard.tsx` — GRU Regime Detection dashboard utama

### `components/lwc/` (Lightweight Charts)

- `LightweightChartDashboard.tsx` — Main LWC dashboard (paper trading hub)
- `TradingChart.tsx` — **Chart utama** (HTML5 Canvas, Lightweight Charts v5)
- `MarketOverview.tsx` — Overview pasar (multi-ticker)
- `GEXComponent.tsx` — GEX (Gamma Exposure) component
- `RealYieldChart.tsx` — Real Yield (TIPS-implied) chart
- `YieldSpreadChart.tsx` — Yield Spread / Term Premium chart
- `NetLiquidityChart.tsx` — Global Net Liquidity (WALCL, WTREGEN, RRPONTSYD) chart
- `LegatruuDashboard.tsx` — Term Premium Dashboard (ACM/10Y Model, LEGATRUU)
- `RiskCalculator.tsx` — ← **BARU** Position sizing & risk calculator widget

---

## 🤖 ML Models & Engines

### GRU Regime Detection

- **Lokasi**: `python/ml_models/gru_regim.py`
- **Trained models**: SPY, QQQ, IWM, TSLA (v5 checkpoint `.keras` + `.pkl` scaler + `.json` feature cols)
- **Output**: Bull / Bear / Transitional regime labels
- **API**: `regime_api.py` port 8007

### Volatility Engine Suite

| Model       | File                               | Keterangan                           |
| ----------- | ---------------------------------- | ------------------------------------ |
| HAR-RV      | `volatality/har_cj_model.py`       | Heterogeneous AR Realized Volatility |
| HAR-CJ      | `volatality/har_cj_model.py`       | Jump + Continuous decomposition      |
| Kalman-HAR  | `volatality/har_kalman_model.py`   | Kalman filter overlay                |
| HMM-HAR     | `volatality/hmm_har_volatility.py` | HMM regime-conditional HAR           |
| MSAR        | `volatality/msar.py`               | Markov-Switching AR                  |
| Hybrid LSTM | `ml_models/hybrid_engine.py`       | LSTM + HAR ensemble                  |

### Risk Management

| Phase    | File                                  | Keterangan               |
| -------- | ------------------------------------- | ------------------------ |
| Data     | `riskManagement/data_layer.py`        | Data fetching & caching  |
| DB       | `riskManagement/risk_db.py`           | SQLite helper            |
| Module 1 | `riskManagement/module_1_gate.py`     | Pre-trade gate           |
| Module 2 | `riskManagement/module_2_portfolio.py`| Portfolio module         |
| Module 3 | `riskManagement/module_3_behavior.py` | Behavior/regime module   |
| Phase 2  | `riskManagement/phase2_model.py`      | GARCH + HMM model        |
| Phase 3  | `riskManagement/phase3_simulation.py` | Monte Carlo simulation   |
| Phase 4  | `riskManagement/phase4_metrics.py`    | VaR, CVaR, Sharpe        |
| Phase 5  | `riskManagement/phase5_stress.py`     | Stress testing scenarios |
| Phase 6  | `riskManagement/phase6_dashboard.py`  | Dashboard output         |

### Research Models (`model/`)

File-file ini adalah **eksperimen standalone** (tidak terintegrasi ke dashboard):

| File                  | Deskripsi                              |
| --------------------- | -------------------------------------- |
| `transformer-2.py`    | Transformer model for regime detection |
| `transforme.py`       | Transformer v1                         |
| `ltsm.py`             | LSTM baseline                          |
| `johansem-kalman.py`  | Johansen cointegration + Kalman filter |
| `k-means.py`          | K-Means clustering research            |
| `sharlq.py`           | Sharpe-ratio analysis                  |
| `vix-har.py`          | VIX + HAR model                        |

---

## 📦 Dependencies Frontend

```json
{
  "lightweight-charts": "^5.2.0",
  "lucide-react": "^1.14.0",
  "next": "14.2.3",
  "plotly.js": "^3.5.1",
  "react": "^18",
  "react-dom": "^18",
  "react-plotly.js": "^2.6.0",
  "recharts": "^2.12.7"
}
```

---

## 🗄️ Database (SQLite)

| File                          | Lokasi                                | Domain                              |
| ----------------------------- | ------------------------------------- | ----------------------------------- |
| `vrp.db`                      | `python/data/vrp.db`                  | VRP snapshots, HAR records, signals |
| `greeks.db`                   | `python/data/greeks.db`               | Greeks data (21MB+)                 |
| `risk_portfolio.db`           | `python/risk_portfolio.db`            | Risk management                     |
| `correlaction.db`             | `python/correlaction/correlaction.db` | DCC correlation data (62MB)         |

> Paper trading state (balance, positions, transactions) **disimpan di `vrp_api3.py`** via SQLite yang di-manage oleh `db.py`.

---

## ⚠️ Hal Penting untuk AI Agent

1. **Jangan ubah struktur `page.tsx`** tanpa memahami sistem `appMode` — ini adalah controller utama navigasi.
2. **API Proxy** — Frontend **tidak memanggil Python langsung**; semua melalui Next.js proxy di `next.config.js`. Pastikan `rewrites` sudah sesuai untuk endpoint baru.
3. **Port Conventions**: VRP=8000, Greeks=8001, Risk=8002, Correlation=8004, Vol=8006, Regime=8007.
4. **LWC module** (`lwc/TradingChart.tsx`) menggunakan Lightweight Charts v5 API — **berbeda** dari v4. Selalu gunakan context7 untuk dokumentasi terbaru jika mengubah chart ini.
5. **Styling & Layout**: Menggunakan TailwindCSS, UI sudah sepenuhnya **Mobile-Responsive** (scrollable pill-bars, stacked layout flex-col di mobile).
6. **Font mono**: Semua teks data/angka menggunakan `font-mono` untuk konsistensi quant aesthetic.
7. **Auto-refresh**: Mode VRP dan Greeks memiliki polling otomatis (15 detik). Mode `risk`, `regime`, dan `lwc` tidak di-poll otomatis.
8. **Network Access**: Backend menggunakan `uvicorn --host 0.0.0.0` dan Next.js berjalan di `0.0.0.0`. Akses proyek dari HP melalui `http://<IP_KOMPUTER>:3000`.
9. **Data source**: Data real-time menggunakan yfinance (Yahoo Finance) dan Alpaca API (via Next.js API routes di `app/api/alpaca/`).
10. **Paper Trading Persistence**: State paper trading (balance, posisi, histori transaksi) disimpan persistent di SQLite melalui endpoint `/api/paper/*` di `vrp_api3.py`. Gunakan Next.js route `app/api/paper/[...path]/route.ts` sebagai proxy.
11. **`vrp_api.py` / `vrp_api2.py`** adalah versi lama — **jangan dimodifikasi**. File aktif yang digunakan adalah `vrp_api3.py`.
12. **`model/`** direktori berisi eksperimen research standalone — **bukan** bagian dari pipeline dashboard.
13. **`python/yield/legatruu.py`** adalah fetcher data LEGATRUU/Term Premium untuk `LegatruuDashboard.tsx`.
14. **Menjalankan backend**: Gunakan `uv run python start_servers.py` dari folder `python/`. Jangan jalankan server individual secara manual kecuali untuk debug.

---

## 🚀 Quick Start

```bash
# Terminal 1: Backend
cd c:\Users\Akbar Alviansyah\Downloads\vrp-dashboard\python
uv run python start_servers.py

# Terminal 2: Frontend
cd c:\Users\Akbar Alviansyah\Downloads\vrp-dashboard\vrp-claude
npm run dev
# → http://localhost:3000
```

---

## 📝 Riwayat Pengembangan (Fitur yang Sudah Ada)

| Fitur                                                    | Status      |
| -------------------------------------------------------- | ----------- |
| VRP Engine (IV vs RV, HAR-RV, Z-Score)                  | ✅ Complete |
| Greeks Inventory (GEX, Vanna, Charm, Delta)              | ✅ Complete |
| Intraday RV Engine (5m/15m candles)                      | ✅ Complete |
| Risk Pipeline (Monte Carlo, VaR, Prop Firm)              | ✅ Complete |
| Risk Data Layer (data_layer.py, risk_db.py)              | ✅ Complete |
| Risk Module 1/2/3 (Gate, Portfolio, Behavior)            | ✅ Complete |
| DCC-GARCH Correlation Dashboard                          | ✅ Complete |
| Copula Analysis                                          | ✅ Complete |
| HMM Market Regime                                        | ✅ Complete |
| HAR-CJ Volatility Engine                                 | ✅ Complete |
| Kalman-HAR Volatility                                    | ✅ Complete |
| MSAR Model                                               | ✅ Complete |
| Hybrid LSTM+HAR Arbitrage Engine                         | ✅ Complete |
| GRU Regime Detection (SPY/QQQ/IWM/TSLA) v5              | ✅ Complete |
| GRU Scaler + Feature Cols per ticker                     | ✅ Complete |
| Lightweight Charts Trading Dashboard                     | ✅ Complete |
| Paper Trading (LWC) — Persistent SQLite                  | ✅ Complete |
| Paper Trading — Edit Balance Feature                     | ✅ Complete |
| Paper Trading — Multi-Position Tracking                  | ✅ Complete |
| Paper Trading — Transaction History Log                  | ✅ Complete |
| Paper Trading — Audio Feedback (SL/TP/Trade events)      | ✅ Complete |
| Market Overview (Multi-ticker)                           | ✅ Complete |
| GEX Component (LWC)                                      | ✅ Complete |
| Risk Calculator Widget (LWC)                             | ✅ Complete |
| Real Yield (TIPS-implied) Chart                          | ✅ Complete |
| Yield Spread / Term Premium Chart                        | ✅ Complete |
| Combined Macro Indicators View                           | ✅ Complete |
| FRED Macro Indicators Integration                        | ✅ Complete |
| Global Net Liquidity Chart (WALCL, WTREGEN, RRPONTSYD)   | ✅ Complete |
| LegatruuDashboard (Term Premium ACM/10Y)                 | ✅ Complete |
| SQLite Ticker Data Storage (`tickers` API route)         | ✅ Complete |
| Mobile Layout Optimization (Responsive UI)               | ✅ Complete |
| Local Network (WiFi) Accessibility (0.0.0.0 binding)    | ✅ Complete |
| Unified Server Launcher (`start_servers.py` via `uv`)   | ✅ Complete |
| Research Model Directory (`model/`)                      | ✅ In Progress |
| Transformer Regime Model Integration                     | 🔄 Research |
