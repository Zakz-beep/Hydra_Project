# VRP Dashboard — Next.js Frontend

Frontend untuk **Volatility Risk Premium (VRP) Signal Engine**, dibangun dengan Next.js 14 App Router.

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** — dark terminal aesthetic
- **Recharts** — chart IV/RV/VRP history
- **Google Fonts** — Syne (display), DM Sans (body), JetBrains Mono (mono)

## Cara Jalankan

```bash
# Install dependencies
npm install

# Development
npm run dev
# → http://localhost:3000

# Build production
npm run build && npm start
```

## Struktur File

```
vrp-dashboard/
├── app/
│   ├── api/
│   │   └── vrp/
│   │       └── route.ts          ← GET /api/vrp?ticker=XXXX
│   ├── components/
│   │   ├── MetricCard.tsx        ← Kartu metrik individual
│   │   ├── Pipeline.tsx          ← Visualisasi pipeline steps
│   │   ├── SignalBadge.tsx       ← Badge signal (LONG/SHORT/NEUTRAL)
│   │   ├── TickerInput.tsx       ← Input ticker + preset buttons
│   │   ├── VRPChart.tsx          ← Chart IV/RV/VRP (Recharts)
│   │   └── VRPGauge.tsx          ← Gauge z-score VRP
│   ├── lib/
│   │   └── vrp.ts                ← Semua math logic (port dari Python)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                  ← Main dashboard
├── package.json
├── tailwind.config.js
└── tsconfig.json
```

## Data Flow

```
User input ticker
       │
       ▼
GET /api/vrp?ticker=XXXX
       │
       ├── Coba Yahoo Finance (yfinance equivalent via fetch)
       │   └── OHLC daily, intraday 15m, VIX
       │
       └── Fallback: synthetic GBM + Ornstein-Uhlenbeck VIX
              │
              ▼
         computeVRP() [lib/vrp.ts]
              │
              ├── RV Garman-Klass + HV20 blending
              ├── HAR-RV forecast (Corsi 2009)
              ├── IV dari BSM Newton-Raphson
              └── VRP = IV - RV, normalized z-score
                         │
                         ▼
                   JSON response → Dashboard UI
```

## Ganti Ticker

Default: `^GSPC` (S&P 500). Bisa diganti di UI atau via URL:

```
http://localhost:3000   → ketik ticker di input
```

Contoh ticker:
- `^GSPC` — S&P 500
- `^NDX`  — Nasdaq 100  
- `BBRI.JK` — Bank BRI (IDX)
- `TLKM.JK` — Telkom (IDX)
- `AAPL` — Apple
- `NVDA` — NVIDIA

## Update Interval

Default: **15 detik** (bisa diubah di `app/page.tsx` → `UPDATE_INTERVAL`)

## Catatan

- Yahoo Finance API bersifat tidak resmi, bisa berubah sewaktu-waktu
- Untuk production, ganti dengan broker API yang proper (Interactive Brokers, Alpaca, dsb.)
- Options chain real tidak tersedia di Yahoo Finance gratis → IV dihitung dari VIX sebagai proxy
