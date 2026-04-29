import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from statsmodels.tsa.vector_ar.vecm import coint_johansen

# ==============================================================================
# STEP 1: DOWNLOAD DATA
# ==============================================================================
tickers = ['GLD', 'SLV']
print(f"📥 Mengambil data untuk {tickers}...")
# FIX: Menggunakan auto_adjust=True dan mengambil kolom 'Close' untuk menghindari KeyError
data = yf.download(tickers, start='2025-01-01', end='2026-04-01', auto_adjust=True)['Close'].dropna()

# ==============================================================================
# STEP 2: JOHANSEN COINTEGRATION TEST
# ==============================================================================
# det_order=0 (artinya kita asumsikan ada intercept/konstanta dalam data)
# k_ar_diff=1 (jumlah lag yang digunakan dalam model VECM)
def run_johansen_test(df):
    res = coint_johansen(df, det_order=0, k_ar_diff=1)

    # Trace Statistic & Critical Values (95%)
    trace_stat = res.lr1
    trace_crit = res.cvt[:, 1] # Kolom 1 adalah level kepercayaan 95%

    print("\n" + "="*50)
    print("📊 HASIL JOHANSEN COINTEGRATION TEST")
    print("="*50)

    for i in range(len(tickers)):
        status = "✅ TERKOINTEGRASI" if trace_stat[i] > trace_crit[i] else "❌ TIDAK TERKOINTEGRASI"
        print(f"Hipotetik r <= {i}: Stat={trace_stat[i]:.2f} | Crit(95%)={trace_crit[i]:.2f} -> {status}")

    # Ambil Eigenvector pertama (Bobot optimal untuk membuat spread stasioner)
    # Ini adalah "Tali" yang mengikat SPY dan QQQ
    weights = res.evec[:, 0]
    return weights

weights = run_johansen_test(data)

# ==============================================================================
# STEP 3: CALCULATE & VISUALIZE THE SPREAD
# ==============================================================================
# Spread = (Weight_SPY * Harga_SPY) + (Weight_QQQ * Harga_QQQ)
spread = data.values @ weights
data['Spread'] = spread

# Visualisasi
fig = make_subplots(rows=2, cols=1,
                    subplot_titles=('Normalized Prices (Movement)', 'Cointegration Spread (The Mean-Reverting Loop)'),
                    vertical_spacing=0.1)

# Plot 1: Pergerakan Harga (Normalisasi ke 1 agar skala sama)
norm_data = data[tickers] / data[tickers].iloc[0]
fig.add_trace(go.Scatter(x=data.index, y=norm_data[tickers[0]], name=tickers[0]), row=1, col=1)
fig.add_trace(go.Scatter(x=data.index, y=norm_data[tickers[1]], name=tickers[1]), row=1, col=1)

# Plot 2: The Spread (Harusnya bolak-balik di sekitar garis rata-rata)
fig.add_trace(go.Scatter(x=data.index, y=data['Spread'], name='Spread (Arbitrage Line)', line=dict(color='purple')), row=2, col=1)
fig.add_hline(y=np.mean(spread), line_dash="dash", line_color="black", annotation_text="Mean", row=2, col=1)

fig.update_layout(height=800, title_text="<b>Johansen Cointegration Analysis: SPY vs QQQ</b>", template='plotly_white')
fig.show()

print("\n💡 STRATEGY INSIGHT:")
print(f"Bobot Portofolio Arbitrase: {tickers[0]} = {weights[0]:.4f} | {tickers[1]} = {weights[1]:.4f}")
print("Jika Spread naik jauh di atas Mean -> Jual Spread (Short SPY, Long QQQ - tergantung tanda bobot).")
print("Jika Spread turun jauh di bawah Mean -> Beli Spread.")