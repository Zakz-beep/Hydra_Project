import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from arch import arch_model
from scipy.optimize import minimize
from plotly.subplots import make_subplots

# ==============================================================================
# STEP 1: CONFIGURATION (CUSTOM ETF TICKERS, TF, & HISTORY)
# ==============================================================================
# Lo bisa tambah ETF apa aja (contoh: SPY=S&P500, QQQ=Nasdaq, GLD=Emas, TLT=Bond)
tickers = ['BBRI.JK', 'BBCA.JK', 'GLD','UNVR.JK']
timeframe = '1d'    # Pilihan yfinance: '1m','5m','15m','30m','60m','1h','1d'
history = '3y'     # Pilihan yfinance: '7d','30d','60d','1mo','1y'

print(f"Downloading {timeframe} data for {tickers} (History: {history})...")

# FIX: Menggunakan auto_adjust=True dan mengambil kolom 'Close' untuk menghindari KeyError
data = yf.download(tickers, period=history, interval=timeframe, auto_adjust=True)['Close']

# Bersihkan data: Hapus row yang ada NaN (penting karena jam buka market ETF ketat)
df_prices = data.dropna()

# Hitung Log Returns (skala 100 agar optimizer stabil)
returns = 100 * np.log(df_prices / df_prices.shift(1)).dropna()
print(f"Data Ready! Total Baris: {len(returns)}")

# ==============================================================================
# STEP 2: STAGE 1 - UNIVARIATE GARCH(1,1)
# ==============================================================================
std_residuals = []
print("Fitting GARCH models...")
for asset in tickers:
    # Menggunakan model GARCH(1,1) standar
    res = arch_model(returns[asset], vol='Garch', p=1, q=1, dist='normal').fit(disp='off')
    std_residuals.append(res.resid / res.conditional_volatility)

Z = np.column_stack(std_residuals)
T, N = Z.shape
Q_bar = np.cov(Z.T)

# ==============================================================================
# STEP 3: STAGE 2 - DCC OPTIMIZATION (THE ENGINE)
# ==============================================================================
def dcc_log_likelihood(params):
    a, b = params
    if a + b >= 0.99: return 1e10 # Constraint stabilitas

    Q_t = Q_bar
    ll = 0
    for t in range(T):
        z_t = Z[t].reshape(N, 1)
        # Update matriks korelasi Qt
        Q_t = (1 - a - b) * Q_bar + a * (z_t @ z_t.T) + b * Q_t
        D_inv = np.diag(1.0 / np.sqrt(np.diag(Q_t)))
        R_t = D_inv @ Q_t @ D_inv

        det_R = np.linalg.det(R_t)
        if det_R <= 0: return 1e10
        ll += np.log(det_R) + (z_t.T @ np.linalg.inv(R_t) @ z_t)[0,0]
    return ll

print("Optimizing DCC parameters...")
opt = minimize(dcc_log_likelihood, [0.02, 0.95], bounds=[(0.001, 0.99)]*2, method='SLSQP')
a_opt, b_opt = opt.x
print(f"Optimal Parameters: alpha={a_opt:.4f}, beta={b_opt:.4f}")

# Reconstruct Average Correlation Portofolio
avg_corrs = []
Q_t = Q_bar
for t in range(T):
    z_t = Z[t].reshape(N, 1)
    Q_t = (1 - a_opt - b_opt) * Q_bar + a_opt * (z_t @ z_t.T) + b_opt * Q_t
    D_inv = np.diag(1.0 / np.sqrt(np.diag(Q_t)))
    R_t = D_inv @ Q_t @ D_inv
    # Ambil rata-rata korelasi antar semua pasangan ETF
    avg_corrs.append(np.mean(R_t[np.triu_indices(N, k=1)]))

# ==============================================================================
# STEP 4: BACKTESTING STRATEGY
# ==============================================================================
df_bt = pd.DataFrame({'Avg_Corr': avg_corrs}, index=returns.index)
df_bt['Market_Ret'] = (returns / 100).mean(axis=1)

# Logic: Kurangi eksposur ke ETF kalau korelasi antar mereka melonjak tajam
def adaptive_logic(row):
    if row['Avg_Corr'] > 0.60: return 0.2 # Mode Bertahan (Cash 80%)
    elif row['Avg_Corr'] < 0.35: return 1.0 # Mode Agresif (Invest 100%)
    else: return 0.6 # Neutral

df_bt['Weight'] = df_bt['Avg_Corr'].apply(lambda x: 0.2 if x > 0.60 else (1.0 if x < 0.35 else 0.6))
df_bt['Adaptive_Ret'] = df_bt['Weight'] * df_bt['Market_Ret']

initial_equity = 10000
df_bt['Passive_Equity'] = initial_equity * (1 + df_bt['Market_Ret']).cumprod()
df_bt['Adaptive_Equity'] = initial_equity * (1 + df_bt['Adaptive_Ret']).cumprod()
# ==============================================================================
# STEP 5: VISUALISASI KELAS PRO (TRADINGVIEW STYLE)
# ==============================================================================
from plotly.subplots import make_subplots

# 1. Hitung Drawdown untuk Plot Tambahan
df_bt['Passive_DD'] = (df_bt['Passive_Equity'] / df_bt['Passive_Equity'].cummax() - 1) * 100
df_bt['Adaptive_DD'] = (df_bt['Adaptive_Equity'] / df_bt['Adaptive_Equity'].cummax() - 1) * 100

# 2. Setup 3 Subplots dengan proporsi tinggi yang beda-beda
fig = make_subplots(
    rows=3, cols=1, 
    shared_xaxes=True, 
    vertical_spacing=0.05,
    row_heights=[0.25, 0.55, 0.20], # Porsi paling besar untuk Equity Curve
    subplot_titles=(
        '<b>1. Systemic Risk Index</b> (DCC Average Correlation)', 
        '<b>2. Portfolio Growth</b> (Equity Curve)', 
        '<b>3. Underwater Chart</b> (Drawdown %)'
    )
)

# --- ROW 1: KORELASI DENGAN BACKGROUND ZONES ---
# Tambahin blok warna di background untuk Regime
fig.add_hrect(y0=0.60, y1=1.0, fillcolor="#ff7675", opacity=0.15, layer="below", row=1, col=1) # Danger Zone
fig.add_hrect(y0=-1.0, y1=0.35, fillcolor="#55efc4", opacity=0.15, layer="below", row=1, col=1) # Safe Zone

fig.add_trace(go.Scatter(
    x=df_bt.index, y=df_bt['Avg_Corr'], 
    name='Avg Correlation', 
    line=dict(color='#2d3436', width=1.5),
    hovertemplate='Correlation: %{y:.2f}<extra></extra>'
), row=1, col=1)

# Garis batas
fig.add_hline(y=0.60, line_dash="dot", line_color="#d63031", row=1, col=1)
fig.add_hline(y=0.35, line_dash="dot", line_color="#00b894", row=1, col=1)


# --- ROW 2: EQUITY CURVE (PRO STYLING) ---
# Passive Strategy (Warna Abu-abu kalem)
fig.add_trace(go.Scatter(
    x=df_bt.index, y=df_bt['Passive_Equity'], 
    name='Passive (Hold)', 
    line=dict(color='#b2bec3', width=2),
    hovertemplate='Passive: $%{y:,.2f}<extra></extra>'
), row=2, col=1)

# Adaptive Strategy (Warna Hijau terang dengan fill area)
fig.add_trace(go.Scatter(
    x=df_bt.index, y=df_bt['Adaptive_Equity'], 
    name='DCC Adaptive', 
    line=dict(color='#00b894', width=2.5),
    fill='tozeroy', 
    fillcolor='rgba(0, 184, 148, 0.05)', # Efek transparan di bawah garis
    hovertemplate='Adaptive: $%{y:,.2f}<extra></extra>'
), row=2, col=1)


# --- ROW 3: DRAWDOWN (UNDERWATER CHART) ---
# Drawdown Passive
fig.add_trace(go.Scatter(
    x=df_bt.index, y=df_bt['Passive_DD'], 
    name='Passive DD', 
    line=dict(color='#b2bec3', width=1),
    hovertemplate='DD Passive: %{y:.2f}%<extra></extra>'
), row=3, col=1)

# Drawdown Adaptive (Merah karena ini nunjukin kerugian/penurunan)
fig.add_trace(go.Scatter(
    x=df_bt.index, y=df_bt['Adaptive_DD'], 
    name='Adaptive DD', 
    line=dict(color='#d63031', width=1.5),
    fill='tozeroy',
    fillcolor='rgba(214, 48, 49, 0.15)',
    hovertemplate='DD Adaptive: %{y:.2f}%<extra></extra>'
), row=3, col=1)


# --- LAYOUTING TAHAP AKHIR ---
fig.update_layout(
    height=900,
    title=dict(
        text=f"<b>QUANTITATIVE STRATEGY DASHBOARD</b><br><sup>Assets: {', '.join(tickers)} | TF: {timeframe} | Engine: DCC-GARCH</sup>",
        font=dict(size=20)
    ),
    template='plotly_white',
    hovermode='x unified',
    legend=dict(
        orientation="h",
        yanchor="bottom", y=1.02,
        xanchor="right", x=1
    ),
    margin=dict(t=120, b=50, l=50, r=50) # Bikin margin lega
)

# Format Y-Axis biar angkanya cakep
fig.update_yaxes(title_text="Correlation", range=[0, 1], row=1, col=1)
fig.update_yaxes(title_text="Balance ($)", tickprefix="$", row=2, col=1)
fig.update_yaxes(title_text="Drop (%)", ticksuffix="%", row=3, col=1)

fig.show()

# Print Metrics Singkat di terminal
print("\n" + "="*50)
print("🏆 STRATEGY PERFORMANCE SUMMARY")
print("="*50)
print(f"PASSIVE STRATEGY:")
print(f" - Final Balance : ${df_bt['Passive_Equity'].iloc[-1]:,.2f}")
print(f" - Max Drawdown  : {df_bt['Passive_DD'].min():.2f}%\n")
print(f"DCC ADAPTIVE STRATEGY:")
print(f" - Final Balance : ${df_bt['Adaptive_Equity'].iloc[-1]:,.2f}")
print(f" - Max Drawdown  : {df_bt['Adaptive_DD'].min():.2f}%")
print("="*50)

# ==============================================================================
# STEP 6: DIVERGENCE & MOMENTUM SCANNER
# ==============================================================================
print("\nMenghitung Divergence Score...")

# Kita pakai rolling window (misal 10 candle/jam) untuk lihat momentum
rolling_window = 10 

# 1. Hitung persen perubahan harga tiap aset selama window tersebut
asset_momentum = df_prices.pct_change(rolling_window) * 100

# 2. Hitung rata-rata pergerakan market
market_momentum = asset_momentum.mean(axis=1)

# 3. DIVERGENCE SCORE: (Momentum Aset - Momentum Market)
# Kalau nilainya +, berarti dia "outperform" (terbang sendirian). Kalau -, dia "underperform"
df_divergence = asset_momentum.sub(market_momentum, axis=0).dropna()
