import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from statsmodels.tsa.vector_ar.vecm import coint_johansen

# ==============================================================================
# STEP 1: CONFIGURATION (CUSTOM TICKERS, TF, & HISTORY)
# ==============================================================================
# Masukin >2 aset yang secara fundamental mirip (contoh: 4 Raksasa Minyak)
TICKERS = ['XOM', 'CVX', 'SHEL', 'BP']
TIMEFRAME = '1d'    # Pilihan: '1h', '1d', '1wk'
HISTORY = '3y'      # Pilihan: '60d', '1y', '2y', '5y'

print(f"🚀 Memulai Analisis Johansen untuk Geng: {TICKERS}")
print(f"📈 Timeframe: {TIMEFRAME} | History: {HISTORY}")

# FIX: Menggunakan auto_adjust=True dan mengambil kolom 'Close' untuk menghindari KeyError
data = yf.download(TICKERS, period=HISTORY, interval=TIMEFRAME, auto_adjust=True)['Close'].dropna()
print(f"✅ Data Ready! Total Baris: {len(data)}")

# ==============================================================================
# STEP 2: JOHANSEN COINTEGRATION ENGINE
# ==============================================================================
# Menjalankan Johansen Test (det_order=0 untuk constant, k_ar_diff=1 untuk 1 lag)
res = coint_johansen(data, det_order=0, k_ar_diff=1)

print("\n" + "═"*60)
print(" 📊 HASIL UJI KOINTEGRASI (TRACE STATISTIC) ".center(60, "═"))
print("═"*60)

cointegration_ranks = 0
for i in range(len(TICKERS)):
    trace_stat = res.lr1[i]
    trace_crit = res.cvt[i, 1] # Ambil Critical Value 95%

    if trace_stat > trace_crit:
        status = "✅ TERKOINTEGRASI (Ada Hubungan)"
        cointegration_ranks += 1
    else:
        status = "❌ TIDAK TERKOINTEGRASI"

    print(f"Hipotetik r <= {i}: Stat = {trace_stat:>6.2f} | Crit(95%) = {trace_crit:>6.2f} -> {status}")

# Ambil Eigenvector Pertama (Hubungan yang paling kuat/stasioner)
weights = res.evec[:, 0]

print("\n" + "═"*60)
print(" ⚖️ BOBOT PORTOFOLIO (BASKET WEIGHTS) ".center(60, "═"))
print("═"*60)
for t, w in zip(TICKERS, weights):
    direction = "LONG (Beli)" if w > 0 else "SHORT (Jual)"
    print(f" • {t:<6} : {w:>8.4f}  -> {direction}")

# ==============================================================================
# STEP 3: CALCULATE THE BASKET SPREAD
# ==============================================================================
# Spread adalah hasil perkalian matriks harga dengan bobot
data['Basket_Spread'] = data[TICKERS].values @ weights

# ==============================================================================
# STEP 4: PRO VISUALIZATION
# ==============================================================================
fig = make_subplots(
    rows=2, cols=1,
    shared_xaxes=True,
    vertical_spacing=0.05,
    subplot_titles=(
        f'<b>1. Normalized Prices Movement</b> (Apakah mereka gerak bareng?)',
        f'<b>2. The Basket Spread</b> (Garis Arbitrase Stasioner)'
    )
)

# Plot 1: Normalized Prices (Biar semua mulai dari angka 1 di grafik)
norm_data = data[TICKERS] / data[TICKERS].iloc[0]
colors = ['#0984e3', '#d63031', '#00b894', '#fdcb6e', '#6c5ce7', '#e84393']

for i, asset in enumerate(TICKERS):
    fig.add_trace(go.Scatter(
        x=data.index, y=norm_data[asset],
        name=asset,
        line=dict(width=1.5, color=colors[i % len(colors)])
    ), row=1, col=1)

# Plot 2: Basket Spread
mean_spread = data['Basket_Spread'].mean()
std_spread = data['Basket_Spread'].std()

# Garis Spread Utama
fig.add_trace(go.Scatter(
    x=data.index, y=data['Basket_Spread'],
    name='Basket Spread',
    line=dict(color='#9b59b6', width=2)
), row=2, col=1)

# Garis Mean (Rata-rata)
fig.add_hline(y=mean_spread, line_dash="solid", line_color="#2d3436", annotation_text="Mean", row=2, col=1)

# Garis Upper & Lower Band (Z-Score +2 dan -2 untuk area Take Profit / Entry)
fig.add_hline(y=mean_spread + (2 * std_spread), line_dash="dash", line_color="#d63031", annotation_text="+2 STD (Jual/Short Basket)", row=2, col=1)
fig.add_hline(y=mean_spread - (2 * std_spread), line_dash="dash", line_color="#00b894", annotation_text="-2 STD (Beli/Long Basket)", row=2, col=1)

# Layouting
fig.update_layout(
    height=800,
    template='plotly_white',
    hovermode='x unified',
    title=dict(text=f"<b>MULTI-ASSET STATISTICAL ARBITRAGE</b><br><sup>Cointegration Ranks: {cointegration_ranks} dari {len(TICKERS)} aset</sup>")
)

fig.show()