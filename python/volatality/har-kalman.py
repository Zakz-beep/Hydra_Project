import yfinance as yf
import numpy as np
import pandas as pd
import warnings
warnings.filterwarnings('ignore')

try:
    from pykalman import KalmanFilter
except ImportError:
    import subprocess, sys
    subprocess.run([sys.executable, "-m", "pip", "install", "pykalman"], check=True)
    from pykalman import KalmanFilter

import plotly.graph_objects as go
from plotly.subplots import make_subplots

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────
TICKER      = 'SPY'
WINDOW_VOL  = 20
OBS_NOISE   = 0.01
TRANS_NOISE = 1e-4

PALETTE = {
    "bg":       "#0d1117",
    "panel":    "#161b22",
    "border":   "#30363d",
    "text":     "#e6edf3",
    "muted":    "#8b949e",
    "green":    "#3fb950",
    "red":      "#f85149",
    "blue":     "#58a6ff",
    "purple":   "#bc8cff",
    "orange":   "#ffa657",
    "yellow":   "#d29922",
}

print("=" * 60)
print("  KALMAN HAR-RV-CJ  |  VOLATILITY ENGINE")
print("=" * 60)

# ─────────────────────────────────────────────
# 1. DATA PULL
# ─────────────────────────────────────────────
print(f"\n[1] Pulling data for {TICKER}...")
df_intraday = yf.download(TICKER, period='730d', interval='1h',  progress=False)
df_daily    = yf.download(TICKER, period='730d', interval='1d',  progress=False)

for df in [df_intraday, df_daily]:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

df_daily['Return(%)'] = df_daily['Close'].pct_change() * 100

# ─────────────────────────────────────────────
# 2. INTRADAY RV DECOMPOSITION  (C + J)
# ─────────────────────────────────────────────
print("[2] Decomposing RV → Continuous (C) + Jump (J)...")
df_intraday['log_ret'] = np.log(df_intraday['Close'] / df_intraday['Close'].shift(1))
df_intraday.dropna(inplace=True)

def calc_rv_components(x):
    r = x.values
    if len(r) < 2:
        return pd.Series({'RV': np.nan, 'BPV': np.nan})
    rv  = np.sum(r ** 2)
    bpv = (np.pi / 2) * np.sum(np.abs(r[1:]) * np.abs(r[:-1]))
    return pd.Series({'RV': rv, 'BPV': bpv})

daily_data = (
    df_intraday.groupby(df_intraday.index.date)['log_ret']
    .apply(calc_rv_components)
    .unstack()
)
daily_data['C'] = daily_data['BPV']
daily_data['J'] = np.maximum(daily_data['RV'] - daily_data['BPV'], 0)

# ─────────────────────────────────────────────
# 3. RANGE-BASED ESTIMATORS  (Yang-Zhang, Garman-Klass)
# ─────────────────────────────────────────────
print("[3] Computing range-based estimators (YZ & GK)...")
log_ho     = np.log(df_daily['High']  / df_daily['Open'])
log_lo     = np.log(df_daily['Low']   / df_daily['Open'])
log_co     = np.log(df_daily['Close'] / df_daily['Open'])
log_oc_lag = np.log(df_daily['Open']  / df_daily['Close'].shift(1))
log_hl_sq  = np.log(df_daily['High']  / df_daily['Low']) ** 2

V_rs = (log_ho * (log_ho - log_co) + log_lo * (log_lo - log_co)).rolling(WINDOW_VOL).mean()
V_o  = log_oc_lag.rolling(WINDOW_VOL).var(ddof=1)
V_c  = log_co.rolling(WINDOW_VOL).var(ddof=1)
k    = 0.34 / (1.34 + (WINDOW_VOL + 1) / (WINDOW_VOL - 1))
df_daily['Yang_Zhang']  = V_o + k * V_c + (1 - k) * V_rs
df_daily['Garman_Klass'] = (0.5 * log_hl_sq - (2 * np.log(2) - 1) * log_co**2).rolling(WINDOW_VOL).mean()

# ─────────────────────────────────────────────
# 4. HAR FEATURE ENGINEERING
# ─────────────────────────────────────────────
print("[4] Building HAR feature matrix (d / w / m)...")
daily_data.index = pd.to_datetime(daily_data.index)
model_df = daily_data.join(
    df_daily[['Open', 'Close', 'Return(%)', 'Yang_Zhang', 'Garman_Klass']],
    how='inner'
).dropna()

for col in ['RV', 'C', 'J']:
    model_df[f'log_{col}'] = np.log(model_df[col] + 1e-8)

for comp in ['C', 'J']:
    lag = model_df[f'log_{comp}'].shift(1)
    model_df[f'log_{comp}_d'] = lag
    model_df[f'log_{comp}_w'] = lag.rolling(5).mean()
    model_df[f'log_{comp}_m'] = lag.rolling(22).mean()

train_df = model_df.dropna().copy()

# ─────────────────────────────────────────────
# 5. KALMAN FILTER  (Time-Varying Betas)
# ─────────────────────────────────────────────
print("[5] Training Kalman Filter state-space model...")
X_COLS   = ['log_C_d', 'log_C_w', 'log_C_m', 'log_J_d', 'log_J_w', 'log_J_m']
X_feat   = train_df[X_COLS].values
obs_mat  = np.hstack([np.ones((len(X_feat), 1)), X_feat])
obs_mat_kf = obs_mat[:, np.newaxis, :]
y        = train_df['log_RV'].values
N_STATES = 7

kf = KalmanFilter(
    n_dim_obs=1, n_dim_state=N_STATES,
    initial_state_mean=np.zeros(N_STATES),
    initial_state_covariance=np.ones((N_STATES, N_STATES)),
    transition_matrices=np.eye(N_STATES),
    observation_matrices=obs_mat_kf,
    observation_covariance=OBS_NOISE,
    transition_covariance=np.eye(N_STATES) * TRANS_NOISE,
)
state_means, _ = kf.filter(y)

train_df['Forecast_log_RV'] = np.sum(state_means * obs_mat, axis=1)
train_df['Kalman_HAR_CJ(%)'] = np.sqrt(np.exp(train_df['Forecast_log_RV'])) * 100
train_df['YZ_24H(%)']        = np.sqrt(train_df['Yang_Zhang']) * 100
train_df['GK_Intraday(%)']   = np.sqrt(train_df['Garman_Klass']) * 100
train_df['Actual_Vol(%)']    = np.sqrt(train_df['RV']) * 100

betas_df = pd.DataFrame(
    state_means,
    index=train_df.index,
    columns=['β0_intercept', 'βC_d', 'βC_w', 'βC_m', 'βJ_d', 'βJ_w', 'βJ_m']
)

# ─────────────────────────────────────────────
# 6. ERROR METRICS  (in log-RV space & vol % space)
# ─────────────────────────────────────────────
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

y_true_log = train_df['log_RV'].values
y_pred_log = train_df['Forecast_log_RV'].values

y_true_vol = np.sqrt(np.exp(y_true_log)) * 100
y_pred_vol = np.sqrt(np.exp(y_pred_log)) * 100

metrics = {
    # log-RV space (model native)
    'R²  (log-RV)' : r2_score(y_true_log, y_pred_log),
    'MSE (log-RV)' : mean_squared_error(y_true_log, y_pred_log),
    'RMSE(log-RV)' : np.sqrt(mean_squared_error(y_true_log, y_pred_log)),
    'MAE (log-RV)' : mean_absolute_error(y_true_log, y_pred_log),
    # Vol % space (interpretable)
    'R²  (vol %)'  : r2_score(y_true_vol, y_pred_vol),
    'MSE (vol %)'  : mean_squared_error(y_true_vol, y_pred_vol),
    'RMSE(vol %)'  : np.sqrt(mean_squared_error(y_true_vol, y_pred_vol)),
    'MAE (vol %)'  : mean_absolute_error(y_true_vol, y_pred_vol),
}

# ─────────────────────────────────────────────
# 7. TOMORROW'S FORECAST
# ─────────────────────────────────────────────
latest_betas = state_means[-1]
last         = model_df.iloc[-1]
X_tomorrow   = np.array([
    1,
    last['log_C'],
    model_df['log_C'].rolling(5).mean().iloc[-1],
    model_df['log_C'].rolling(22).mean().iloc[-1],
    last['log_J'],
    model_df['log_J'].rolling(5).mean().iloc[-1],
    model_df['log_J'].rolling(22).mean().iloc[-1],
])
forecast_log_rv   = np.dot(latest_betas, X_tomorrow)
forecast_vol_pct  = np.sqrt(np.exp(forecast_log_rv)) * 100
jump_dominant     = latest_betas[4] > latest_betas[1]

# ─────────────────────────────────────────────
# 7. TERMINAL SUMMARY
# ─────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"  7-DAY CALIBRATION TABLE  ({TICKER})")
print("=" * 60)
show_cols = ['Open', 'Close', 'Return(%)', 'YZ_24H(%)', 'GK_Intraday(%)', 'Kalman_HAR_CJ(%)']
print(train_df[show_cols].tail(7).round(4).to_string())
print("-" * 60)
print(f"\n🚀  TOMORROW FORECAST : {forecast_vol_pct:.4f} %")
print(f"\n[REGIME DIAGNOSTICS]")
print(f"  Continuous sensitivity : βC_d={latest_betas[1]:.4f}  βC_w={latest_betas[2]:.4f}")
print(f"  Jump sensitivity       : βJ_d={latest_betas[4]:.4f}  βJ_w={latest_betas[5]:.4f}")
regime_label = "⚠️  JUMP-REACTIVE  (Panic / News-Driven)" if jump_dominant else "✅  TREND-SMOOTH  (Continuous Dominates)"
print(f"  Regime status          : {regime_label}")
print(f"\n{'─'*60}")
print(f"  MODEL ERROR METRICS  (Kalman HAR-CJ)")
print(f"{'─'*60}")
print(f"  [log-RV Space — native]")
print(f"    R²   = {metrics['R²  (log-RV)']:.6f}   (1.0 = perfect)")
print(f"    MSE  = {metrics['MSE (log-RV)']:.6f}")
print(f"    RMSE = {metrics['RMSE(log-RV)']:.6f}")
print(f"    MAE  = {metrics['MAE (log-RV)']:.6f}")
print(f"  [Vol % Space — interpretable]")
print(f"    R²   = {metrics['R²  (vol %)']:.6f}   (1.0 = perfect)")
print(f"    MSE  = {metrics['MSE (vol %)']:.6f}  (%-squared)")
print(f"    RMSE = {metrics['RMSE(vol %)']:.6f}  % — avg error in vol unit")
print(f"    MAE  = {metrics['MAE (vol %)']:.6f}  % — avg absolute error")
print("=" * 60)

# ─────────────────────────────────────────────
# 8. PLOTLY DASHBOARD  (4-panel)
# ─────────────────────────────────────────────
print("\n[8] Rendering Plotly dashboard...")
LOOKBACK = 120   # days shown in charts

plot_df = train_df.tail(LOOKBACK).copy()
beta_df = betas_df.tail(LOOKBACK).copy()

fig = make_subplots(
    rows=4, cols=1,
    shared_xaxes=True,
    vertical_spacing=0.06,
    subplot_titles=[
        "① VOLATILITY FORECAST  (Kalman HAR-CJ vs Estimators vs Realized)",
        "② PRICE & DAILY RETURN",
        "③ CONTINUOUS vs JUMP COMPONENT  (Daily log-RV decomposition)",
        "④ TIME-VARYING BETAS  (Kalman adaptive coefficients)",
    ],
    row_heights=[0.30, 0.22, 0.22, 0.26],
)

# ── Panel 1 : Vol Forecast ───────────────────
fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['Actual_Vol(%)'],
    name='Realized Vol', mode='lines',
    line=dict(color=PALETTE['muted'], width=1),
    fill='tozeroy', fillcolor='rgba(139,148,158,0.07)'
), row=1, col=1)

fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['YZ_24H(%)'],
    name='Yang-Zhang (24H)', mode='lines',
    line=dict(color=PALETTE['yellow'], width=1.2, dash='dot'),
), row=1, col=1)

fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['GK_Intraday(%)'],
    name='Garman-Klass (Intraday)', mode='lines',
    line=dict(color=PALETTE['orange'], width=1.2, dash='dot'),
), row=1, col=1)

fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['Kalman_HAR_CJ(%)'],
    name='Kalman HAR-CJ (Forecast)', mode='lines',
    line=dict(color=PALETTE['blue'], width=2),
), row=1, col=1)

# Forecast point for tomorrow
tomorrow_x = plot_df.index[-1] + pd.Timedelta(days=1)
fig.add_trace(go.Scatter(
    x=[tomorrow_x], y=[forecast_vol_pct],
    name=f'Tomorrow: {forecast_vol_pct:.3f}%',
    mode='markers+text',
    marker=dict(symbol='diamond', size=12,
                color=PALETTE['green'] if not jump_dominant else PALETTE['red'],
                line=dict(color='white', width=1.5)),
    text=[f"  {forecast_vol_pct:.3f}%"],
    textposition='middle right',
    textfont=dict(color=PALETTE['green'] if not jump_dominant else PALETTE['red'], size=11),
), row=1, col=1)

# ── Panel 2 : Price + Return ─────────────────
fig.add_trace(go.Bar(
    x=plot_df.index, y=plot_df['Return(%)'],
    name='Daily Return (%)',
    marker_color=np.where(plot_df['Return(%)'] >= 0, PALETTE['green'], PALETTE['red']),
    opacity=0.7,
), row=2, col=1)

fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['Close'],
    name='Close Price', mode='lines',
    line=dict(color=PALETTE['purple'], width=1.5),
    yaxis='y5',
), row=2, col=1)

# ── Panel 3 : C + J Decomposition ────────────
fig.add_trace(go.Scatter(
    x=plot_df.index, y=plot_df['log_C'],
    name='log Continuous (C)', mode='lines',
    line=dict(color=PALETTE['blue'], width=1.5),
    fill='tozeroy', fillcolor='rgba(88,166,255,0.08)',
), row=3, col=1)

fig.add_trace(go.Bar(
    x=plot_df.index, y=plot_df['log_J'],
    name='log Jump (J)',
    marker_color=PALETTE['red'],
    opacity=0.6,
), row=3, col=1)

# ── Panel 4 : Dynamic Betas ──────────────────
beta_colors = {
    'βC_d': PALETTE['blue'],  'βC_w': '#79c0ff',  'βC_m': '#cae8ff',
    'βJ_d': PALETTE['red'],   'βJ_w': '#ff7b72',  'βJ_m': '#ffa198',
}
for col, color in beta_colors.items():
    fig.add_trace(go.Scatter(
        x=beta_df.index, y=beta_df[col],
        name=col, mode='lines',
        line=dict(color=color, width=1.4),
    ), row=4, col=1)

fig.add_hline(y=0, line=dict(color=PALETTE['border'], width=1, dash='dash'), row=4, col=1)

# ── Layout ────────────────────────────────────
fig.update_layout(
    title=dict(
        text=f"<b>KALMAN HAR-RV-CJ  ·  {TICKER}  ·  Volatility Dashboard</b>",
        font=dict(size=17, color=PALETTE['text'], family='monospace'),
        x=0.5, xanchor='center',
    ),
    paper_bgcolor=PALETTE['bg'],
    plot_bgcolor=PALETTE['panel'],
    font=dict(color=PALETTE['text'], family='monospace', size=11),
    height=1050,
    legend=dict(
        bgcolor='rgba(22,27,34,0.85)',
        bordercolor=PALETTE['border'],
        borderwidth=1,
        font=dict(size=10),
        orientation='h',
        y=-0.03,
        x=0,
    ),
    hovermode='x unified',
    margin=dict(l=60, r=40, t=80, b=60),
)

# Grid / axis styling
for row in range(1, 5):
    fig.update_xaxes(
        gridcolor=PALETTE['border'], zeroline=False,
        showspikes=True, spikecolor=PALETTE['muted'],
        spikethickness=1, spikedash='dot',
        row=row, col=1,
    )
    fig.update_yaxes(
        gridcolor=PALETTE['border'], zeroline=False,
        row=row, col=1,
    )

# Subplot title styling
for ann in fig.layout.annotations:
    ann.font.size  = 11
    ann.font.color = PALETTE['muted']
    ann.font.family = 'monospace'

# Regime annotation (top-left)
regime_color = PALETTE['red'] if jump_dominant else PALETTE['green']
fig.add_annotation(
    text=f"<b>Regime: {'JUMP-REACTIVE ⚠️' if jump_dominant else 'TREND-SMOOTH ✅'}</b>   "
         f"Tomorrow vol: <b>{forecast_vol_pct:.3f}%</b>",
    xref='paper', yref='paper', x=0.01, y=0.995,
    showarrow=False,
    font=dict(size=12, color=regime_color, family='monospace'),
    bgcolor='rgba(22,27,34,0.85)',
    bordercolor=regime_color,
    borderwidth=1, borderpad=6,
    align='left',
)

# Error metrics box (top-right)
r2_log  = metrics['R²  (log-RV)']
r2_vol  = metrics['R²  (vol %)']
rmse_vol = metrics['RMSE(vol %)']
mae_vol  = metrics['MAE (vol %)']
mse_log  = metrics['MSE (log-RV)']

r2_color = PALETTE['green'] if r2_log > 0.85 else PALETTE['yellow'] if r2_log > 0.6 else PALETTE['red']

metrics_text = (
    f"<b>MODEL FIT METRICS</b><br>"
    f"──────────────────────<br>"
    f"R²  (log-RV) : <b>{r2_log:.4f}</b><br>"
    f"MSE (log-RV) : {mse_log:.4f}<br>"
    f"──────────────────────<br>"
    f"R²  (vol %)  : <b>{r2_vol:.4f}</b><br>"
    f"RMSE(vol %)  : {rmse_vol:.4f} %<br>"
    f"MAE (vol %)  : {mae_vol:.4f} %"
)

fig.add_annotation(
    text=metrics_text,
    xref='paper', yref='paper', x=0.99, y=0.995,
    showarrow=False,
    font=dict(size=10.5, color=r2_color, family='monospace'),
    bgcolor='rgba(22,27,34,0.88)',
    bordercolor=r2_color,
    borderwidth=1, borderpad=8,
    align='left',
    xanchor='right', yanchor='top',
)

fig.show()
print("\n✅  Dashboard rendered.")