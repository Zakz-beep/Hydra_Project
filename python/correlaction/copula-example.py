import yfinance as yf
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from arch import arch_model
from scipy.optimize import minimize
from scipy.stats import rankdata
from plotly.subplots import make_subplots

# ==============================================================================
# CONFIGURATION (CUSTOMIZABLE)
# ==============================================================================
TICKERS = ['SPY', 'QQQ', 'GLD', 'TLT'] # Bisa isi banyak ticker
TIMEFRAME = '5m'                       # 1m, 5m, 15m, 1h, 1d
HISTORY = '7d'                        # 7d, 30d, 60d, 1y, 2y
INITIAL_CASH = 10000

print(f"♀ Initializing Engine for {TICKERS}...")
print(f"  Timeframe: {TIMEFRAME} | History: {HISTORY}")

# ==============================================================================
# STEP 1: DATA ACQUISITION & GARCH FILTERING
# ==============================================================================
# FIX: Menggunakan auto_adjust=True dan mengambil kolom 'Close' untuk menghindari KeyError
data = yf.download(TICKERS, period=HISTORY, interval=TIMEFRAME, auto_adjust=True)['Close'].dropna()
returns = 100 * np.log(data / data.shift(1)).dropna()

std_resid = pd.DataFrame(index=returns.index)
volatility = pd.DataFrame(index=returns.index)

print("  Fitting GARCH Models...")
for asset in TICKERS:
    res = arch_model(returns[asset], vol='Garch', p=1, q=1, dist='normal').fit(disp='off')
    std_resid[asset] = res.resid / res.conditional_volatility
    volatility[asset] = res.conditional_volatility

# ==============================================================================
# STEP 2: DCC ENGINE (DYNAMIC CORRELATION)
# ==============================================================================
Z = std_resid.values
T, N = Z.shape
Q_bar = np.cov(Z.T)

def dcc_loss(params):
    a, b = params
    if a + b >= 0.995: return 1e10
    Q_t = Q_bar
    ll = 0
    for t in range(T):
        z_t = Z[t].reshape(N, 1)
        Q_t = (1 - a - b) * Q_bar + a * (z_t @ z_t.T) + b * Q_t
        D_inv = np.diag(1.0 / np.sqrt(np.diag(Q_t)))
        R_t = D_inv @ Q_t @ D_inv
        det_R = np.linalg.det(R_t)
        if det_R <= 0: return 1e10
        ll += np.log(det_R) + (z_t.T @ np.linalg.inv(R_t) @ z_t)[0,0]
    return ll

print("  Optimizing DCC Correlation...")
opt = minimize(dcc_loss, [0.03, 0.93], bounds=[(0.001, 0.99)]*2, method='SLSQP')
a_opt, b_opt = opt.x

# Reconstruct Average Correlation
avg_corrs = []
Q_t = Q_bar
for t in range(T):
    z_t = Z[t].reshape(N, 1)
    Q_t = (1 - a_opt - b_opt) * Q_bar + a_opt * (z_t @ z_t.T) + b_opt * Q_t
    D_inv = np.diag(1.0 / np.sqrt(np.diag(Q_t)))
    R_t = D_inv @ Q_t @ D_inv
    avg_corrs.append(np.mean(R_t[np.triu_indices(N, k=1)]))

# ==============================================================================
# STEP 3: COPULA TAIL DEPENDENCE SCANNER
# ==============================================================================
# Transform to Uniform Space [0, 1]
u_space = pd.DataFrame({col: rankdata(std_resid[col])/(T+1) for col in std_resid.columns})

# Calculate Tail Dependence (Lower 10% quantile)
# Ini menghitung seberapa sering aset jatuh barengan di level ekstrem
tail_threshold = 0.1
tail_dep_series = []

for i in range(T):
    # Cross-sectional tail check pada waktu t
    row = u_space.iloc[i]
    extreme_count = np.sum(row <= tail_threshold)
    tail_dep_series.append(extreme_count / N)

# ==============================================================================
# STEP 4: BACKTEST STRATEGY
# ==============================================================================
df_bt = pd.DataFrame({'Avg_Corr': avg_corrs, 'Tail_Dep': tail_dep_series}, index=returns.index)
df_bt['Market_Ret'] = (returns / 100).mean(axis=1)

# Logic: Mode Bertahan jika korelasi > 0.6 atau Tail Dependence tinggi
df_bt['Weight'] = df_bt.apply(lambda x: 0.1 if (x['Avg_Corr'] > 0.65 or x['Tail_Dep'] > 0.5) else 1.0, axis=1)
df_bt['Adaptive_Equity'] = INITIAL_CASH * (1 + (df_bt['Weight'] * df_bt['Market_Ret'])).cumprod()

# ==============================================================================
# STEP 5: PRO VISUALIZATION (EYE CANDY)
# ==============================================================================
fig = make_subplots(
    rows=4, cols=1,
    shared_xaxes=True,
    vertical_spacing=0.04,
    row_heights=[0.2, 0.2, 0.4, 0.2],
    subplot_titles=('<b>VOLATILITY PANIC INDEX</b>', '<b>DYNAMIC CORRELATION (DCC)</b>', '<b>STRATEGY GROWTH</b>', '<b>TAIL RISK SCANNER (COPULA)</b>')
)

# Row 1: Volatility (GARCH)
for asset in TICKERS:
    fig.add_trace(go.Scatter(x=volatility.index, y=volatility[asset], name=f'Vol {asset}', opacity=0.6), row=1, col=1)

# Row 2: DCC Correlation
fig.add_trace(go.Scatter(x=df_bt.index, y=df_bt['Avg_Corr'], name='DCC Index', line=dict(color='#00d1b2', width=2)), row=2, col=1)
fig.add_hrect(y0=0.65, y1=1.0, fillcolor="red", opacity=0.1, row=2, col=1) # Danger Zone

# Row 3: Equity Curve
fig.add_trace(go.Scatter(x=df_bt.index, y=df_bt['Adaptive_Equity'], name='DCC+Copula Strategy',
                         line=dict(color='#3273dc', width=3), fill='tozeroy', fillcolor='rgba(50, 115, 220, 0.1)'), row=3, col=1)

# Row 4: Tail Dependence (Copula)
fig.add_bar(x=df_bt.index, y=df_bt['Tail_Dep'], name='Tail Risk', marker_color='#ff3860', row=4, col=1)

# Styling
fig.update_layout(
    height=1000,
    template='plotly_dark',
    title=f"<b>QUANT RISK DASHBOARD: {', '.join(TICKERS)}</b>",
    hovermode='x unified',
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
)

fig.update_yaxes(title_text="Volatility", row=1, col=1)
fig.update_yaxes(title_text="Correlation", row=2, col=1)
fig.update_yaxes(title_text="Equity ($)", row=3, col=1)
fig.update_yaxes(title_text="Tail Risk", row=4, col=1)

fig.show()

print(f"\n✅ Dashboard Complete!")
print(f"Final Balance: ${df_bt['Adaptive_Equity'].iloc[-1]:,.2f}")

