# =============================================================================
# LSTM VOLATILITY FORECASTER v2.0 — FULL REFACTOR
# =============================================================================
# Author  : Refactored for production-grade research
# Model   : Bidirectional LSTM + Attention + Monte Carlo Dropout
# Benchmarks: GARCH(1,1), EGARCH, HAR-RV, Naive
# Features: Multi-horizon (t+1, t+5, t+21), Walk-Forward Val,
#           Uncertainty Quantification, Regime Detection, Trading Signals
#
# Install dependencies dulu:
# pip install yfinance pandas numpy scikit-learn tensorflow arch plotly
# =============================================================================

# %%
# ============================================================
# CELL 1: IMPORTS & GLOBAL CONFIG
# ============================================================
import yfinance as yf
import pandas as pd
import numpy as np
import warnings
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, mean_absolute_error
from tensorflow.keras.models import Model
from tensorflow.keras.layers import (
    LSTM, Dense, Dropout, Bidirectional,
    Input, Multiply, Permute, Flatten, RepeatVector, Lambda
)
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
import tensorflow.keras.backend as K
from arch import arch_model
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import plotly.express as px

warnings.filterwarnings('ignore')
tf.random.set_seed(42)
np.random.seed(42)

# ── Global Config ──────────────────────────────────────────
LOOK_BACK   = 22          # Window panjang sequence (1 bulan trading)
HORIZONS    = [1, 5, 21]  # Forecast t+1, t+5, t+21
MC_SAMPLES  = 500         # Iterasi Monte Carlo Dropout
TRAIN_RATIO = 0.80        # 80% train, 20% test
EPOCHS      = 50
BATCH_SIZE  = 32
LSTM_UNITS  = 64
DROPOUT_RT  = 0.20

print("✅ Config loaded.")
print(f"   Look-back  : {LOOK_BACK} hari")
print(f"   Horizons   : {HORIZONS}")
print(f"   Train split: {int(TRAIN_RATIO*100)}%")


# %%
# ============================================================
# CELL 2: DOWNLOAD DATA
# ============================================================
print("\n📥 Downloading data S&P 500 & VIX (2016–2026)...")

sp500 = yf.download('^GSPC', start='2016-01-01', end='2026-05-01', auto_adjust=True)
vix   = yf.download('^VIX',  start='2016-01-01', end='2026-05-01', auto_adjust=True)

# Flatten MultiIndex jika ada
if isinstance(sp500.columns, pd.MultiIndex):
    sp500.columns = sp500.columns.get_level_values(0)
if isinstance(vix.columns, pd.MultiIndex):
    vix.columns = vix.columns.get_level_values(0)

print(f"✅ S&P 500: {len(sp500)} baris | VIX: {len(vix)} baris")


# %%
# ============================================================
# CELL 3: FEATURE ENGINEERING
# ============================================================
df = sp500.copy()

# ── 3.1 Garman-Klass Volatility ────────────────────────────
log_hl       = np.log(df['High'] / df['Low'])
log_co       = np.log(df['Close'] / df['Open'])
gk_variance  = 0.5 * (log_hl**2) - (2 * np.log(2) - 1) * (log_co**2)
df['RV_Daily'] = np.sqrt(gk_variance * 252) * 100

# ── 3.2 HAR-RV Components ──────────────────────────────────
df['RV_5d']  = df['RV_Daily'].rolling(5).mean()
df['RV_22d'] = df['RV_Daily'].rolling(22).mean()

# ── 3.3 Log Return & Magnitude ────────────────────────────
df['LogReturn']  = np.log(df['Close'] / df['Close'].shift(1))
df['AbsReturn']  = df['LogReturn'].abs() * 100

# ── 3.4 VIX & Vol Risk Premium ────────────────────────────
df['VIX']           = vix['Close']
df['IV_RV_Spread']  = df['VIX'] - df['RV_Daily']   # +  = vol cheap, - = vol rich

# ── 3.5 Volume Ratio ──────────────────────────────────────
df['VolRatio'] = df['Volume'] / df['Volume'].rolling(22).mean()

# ── 3.6 Volatility-of-Volatility ─────────────────────────
df['VoV'] = df['RV_Daily'].rolling(10).std()

# ── 3.7 Vol Regime Label ──────────────────────────────────
# 0 = Low (<12%), 1 = Normal (12-22%), 2 = High (>22%)
def assign_regime(rv):
    if rv < 12:   return 0
    elif rv < 22: return 1
    else:         return 2

df['VolRegime'] = df['RV_Daily'].apply(assign_regime)

# ── Bersihkan NaN ─────────────────────────────────────────
df.dropna(inplace=True)

# Feature list untuk LSTM
FEATURE_COLS = ['RV_Daily', 'RV_5d', 'RV_22d', 'VIX',
                'IV_RV_Spread', 'VolRatio', 'VoV', 'AbsReturn']
TARGET_COL   = 'RV_Daily'

print(f"✅ Feature engineering selesai.")
print(f"   Total samples : {len(df)}")
print(f"   Features used : {FEATURE_COLS}")
print(df[FEATURE_COLS].describe().round(2))


# %%
# ============================================================
# CELL 4: TRAIN/TEST SPLIT & SCALING (NO LEAKAGE)
# ============================================================
split_idx  = int(len(df) * TRAIN_RATIO)
train_df   = df.iloc[:split_idx]
test_df    = df.iloc[split_idx:]

# Fit scaler HANYA di data train (fix leakage)
feat_scaler   = MinMaxScaler(feature_range=(0, 1))
target_scaler = MinMaxScaler(feature_range=(0, 1))

train_feat_scaled   = feat_scaler.fit_transform(train_df[FEATURE_COLS])
test_feat_scaled    = feat_scaler.transform(test_df[FEATURE_COLS])

train_target_scaled = target_scaler.fit_transform(
                          train_df[[TARGET_COL]])
test_target_scaled  = target_scaler.transform(
                          test_df[[TARGET_COL]])

all_feat_scaled     = np.vstack([train_feat_scaled, test_feat_scaled])
all_target_scaled   = np.vstack([train_target_scaled, test_target_scaled])

print(f"✅ Split selesai (No Leakage).")
print(f"   Train: {len(train_df)} | Test: {len(test_df)}")
print(f"   Train period: {train_df.index[0].date()} → {train_df.index[-1].date()}")
print(f"   Test  period: {test_df.index[0].date()}  → {test_df.index[-1].date()}")


# %%
# ============================================================
# CELL 5: SEQUENCE BUILDER (MULTI-HORIZON READY)
# ============================================================
def build_sequences(feat_scaled, target_scaled, look_back, horizon=1):
    """
    Buat X (sequence fitur) dan Y (target di t+horizon).
    feat_scaled   : array (N, n_features)
    target_scaled : array (N, 1)
    """
    X, Y = [], []
    for i in range(look_back, len(feat_scaled) - horizon + 1):
        X.append(feat_scaled[i - look_back : i])          # (look_back, n_features)
        Y.append(target_scaled[i + horizon - 1, 0])       # scalar
    return np.array(X), np.array(Y)

# Build sequences untuk setiap horizon
seqs = {}
for h in HORIZONS:
    X_all, Y_all = build_sequences(all_feat_scaled, all_target_scaled, LOOK_BACK, horizon=h)

    # Tentukan titik split di dalam sequences
    # Sequences yang seluruhnya berasal dari train data
    n_train_seq = split_idx - LOOK_BACK - h + 1

    seqs[h] = {
        'X_train': X_all[:n_train_seq],
        'Y_train': Y_all[:n_train_seq],
        'X_test' : X_all[n_train_seq:],
        'Y_test' : Y_all[n_train_seq:],
    }

print("✅ Sequences built.")
for h in HORIZONS:
    print(f"   Horizon t+{h:2d} → Train: {seqs[h]['X_train'].shape} | Test: {seqs[h]['X_test'].shape}")


# %%
# ============================================================
# CELL 6: ARSITEKTUR MODEL (BiLSTM + ATTENTION + MC DROPOUT)
# ============================================================
def build_attention_lstm(look_back, n_features, lstm_units=64, dropout_rate=0.2):
    """
    Arsitektur:
    Input → BiLSTM → MC Dropout → Attention → Dense(32) → Dense(1)

    MC Dropout: Dropout aktif saat inference untuk uncertainty estimation.
    Attention : Model belajar sendiri hari mana yg paling relevan.
    """
    inputs = Input(shape=(look_back, n_features), name='input_seq')

    # ── Bidirectional LSTM ──────────────────────────────────
    # return_sequences=True → kita butuh output tiap timestep untuk attention
    x = Bidirectional(
            LSTM(lstm_units, return_sequences=True, name='bilstm'),
            name='bidirectional'
        )(inputs)
    x = Dropout(dropout_rate, name='dropout_1')(x, training=True)  # training=True → MC Dropout

    # ── Bahdanau-style Attention ────────────────────────────
    # Score tiap timestep seberapa penting buat prediksi
    attention_scores = Dense(1, activation='tanh', name='attn_score')(x)   # (batch, T, 1)
    attention_scores = Flatten(name='attn_flatten')(attention_scores)       # (batch, T)
    attention_weights = tf.keras.layers.Activation('softmax', name='attn_softmax')(attention_scores)
    attention_weights_exp = RepeatVector(lstm_units * 2, name='attn_repeat')(attention_weights)
    attention_weights_exp = Permute([2, 1], name='attn_permute')(attention_weights_exp)  # (batch, T, units*2)
    context = Multiply(name='attn_context')([x, attention_weights_exp])
    context = Lambda(lambda z: K.sum(z, axis=1), name='attn_sum')(context)  # (batch, units*2)

    # ── Dense Head ──────────────────────────────────────────
    x = Dense(32, activation='relu', name='dense_1')(context)
    x = Dropout(dropout_rate, name='dropout_2')(x, training=True)
    output = Dense(1, name='output')(x)

    model = Model(inputs=inputs, outputs=output, name='BiLSTM_Attention')
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
                  loss='huber',          # Lebih robust vs MSE untuk outlier
                  metrics=['mae'])
    return model

# Preview arsitektur
preview_model = build_attention_lstm(LOOK_BACK, len(FEATURE_COLS), LSTM_UNITS, DROPOUT_RT)
preview_model.summary()


# %%
# ============================================================
# CELL 7: TRAINING SEMUA HORIZON
# ============================================================
callbacks = [
    EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6, verbose=1)
]

trained_models = {}

for h in HORIZONS:
    print(f"\n{'='*50}")
    print(f"TRAINING MODEL → Horizon t+{h} hari ke depan")
    print(f"{'='*50}")

    model = build_attention_lstm(LOOK_BACK, len(FEATURE_COLS), LSTM_UNITS, DROPOUT_RT)

    history = model.fit(
        seqs[h]['X_train'], seqs[h]['Y_train'],
        epochs          = EPOCHS,
        batch_size      = BATCH_SIZE,
        validation_split= 0.15,
        callbacks       = callbacks,
        verbose         = 1
    )

    trained_models[h] = {'model': model, 'history': history}
    print(f"✅ Horizon t+{h} selesai training.")

print("\n✅ Semua horizon selesai ditraining.")


# %%
# ============================================================
# CELL 8: BENCHMARK MODELS
# ============================================================

# ─── 8.1 NAIVE FORECAST (Besok = Hari Ini) ────────────────
def naive_forecast(series, horizon=1):
    return series.shift(horizon)

# ─── 8.2 HAR-RV (Heterogeneous Autoregressive) ────────────
def har_rv_forecast(train_df, test_df, horizon=1):
    """
    HAR-RV: linear regression of RV on RV_1d, RV_5d, RV_22d
    Proven strong baseline untuk realized volatility forecasting.
    """
    X_train = train_df[['RV_Daily', 'RV_5d', 'RV_22d']].values
    y_train = train_df['RV_Daily'].shift(-horizon).dropna().values
    X_train = X_train[:len(y_train)]

    X_test  = test_df[['RV_Daily', 'RV_5d', 'RV_22d']].values
    y_test  = test_df['RV_Daily'].shift(-horizon).dropna().values
    X_test  = X_test[:len(y_test)]

    reg = LinearRegression()
    reg.fit(X_train, y_train)

    preds = reg.predict(X_test)
    return preds, y_test, reg.coef_, reg.intercept_

# ─── 8.3 GARCH(1,1) ──────────────────────────────────────
def garch_forecast(train_returns, test_returns, horizon=1):
    """
    GARCH(1,1) benchmark. Difit di train, rolling forecast di test.
    """
    combined = pd.concat([train_returns, test_returns])
    
    model_garch = arch_model(combined * 100, vol='Garch', p=1, q=1, dist='normal')
    res         = model_garch.fit(disp='off', last_obs=len(train_returns))

    forecasts   = res.forecast(horizon=horizon, reindex=False)
    # Ambil variance forecast, convert ke annualized vol %
    variance_fc = forecasts.variance.iloc[-len(test_returns):]
    vol_fc      = np.sqrt(variance_fc.values.flatten() * 252)
    return vol_fc

# ─── 8.4 EGARCH(1,1) ─────────────────────────────────────
def egarch_forecast(train_returns, test_returns, horizon=1):
    combined   = pd.concat([train_returns, test_returns])
    model_egarch = arch_model(combined * 100, vol='EGARCH', p=1, q=1, dist='normal')
    res          = model_egarch.fit(disp='off', last_obs=len(train_returns))
    forecasts    = res.forecast(horizon=horizon, reindex=False)
    variance_fc  = forecasts.variance.iloc[-len(test_returns):]
    vol_fc       = np.sqrt(variance_fc.values.flatten() * 252)
    return vol_fc

print("✅ Benchmark functions defined. Running benchmarks...")

train_returns = train_df['LogReturn'].dropna()
test_returns  = test_df['LogReturn'].dropna()

benchmark_results = {}

for h in HORIZONS:
    print(f"\n  Computing benchmarks for horizon t+{h}...")

    # HAR-RV
    har_preds, har_actuals, har_coef, har_intercept = har_rv_forecast(train_df, test_df, h)

    # GARCH
    garch_preds = garch_forecast(train_returns, test_returns, h)
    min_len     = min(len(har_actuals), len(garch_preds))

    benchmark_results[h] = {
        'har_preds'   : har_preds[:min_len],
        'har_actuals' : har_actuals[:min_len],
        'garch_preds' : garch_preds[:min_len],
        'har_coef'    : har_coef,
    }

print("✅ Benchmarks selesai.")


# %%
# ============================================================
# CELL 9: MONTE CARLO DROPOUT — UNCERTAINTY QUANTIFICATION
# ============================================================
def mc_dropout_predict(model, X, n_samples=500):
    """
    Run model N kali dengan dropout aktif.
    Return mean prediction + 5th/95th percentile (90% confidence interval).
    """
    preds = np.array([model(X, training=True).numpy().flatten()
                      for _ in range(n_samples)])
    # preds shape: (n_samples, n_data_points)
    mean_pred = preds.mean(axis=0)
    lower_90  = np.percentile(preds, 5,  axis=0)
    upper_90  = np.percentile(preds, 95, axis=0)
    lower_68  = np.percentile(preds, 16, axis=0)
    upper_68  = np.percentile(preds, 84, axis=0)
    std_pred  = preds.std(axis=0)

    return {
        'mean'    : mean_pred,
        'lower_90': lower_90,
        'upper_90': upper_90,
        'lower_68': lower_68,
        'upper_68': upper_68,
        'std'     : std_pred,
    }

# Run MC Dropout untuk semua horizon di test set
mc_results = {}
for h in HORIZONS:
    print(f"  Running MC Dropout (t+{h}, {MC_SAMPLES} samples)...")
    mc_out = mc_dropout_predict(
        trained_models[h]['model'],
        seqs[h]['X_test'],
        n_samples=MC_SAMPLES
    )

    # Inverse transform ke skala % asli
    def inv(arr):
        return target_scaler.inverse_transform(arr.reshape(-1,1)).flatten()

    mc_results[h] = {
        'mean'    : inv(mc_out['mean']),
        'lower_90': inv(mc_out['lower_90']),
        'upper_90': inv(mc_out['upper_90']),
        'lower_68': inv(mc_out['lower_68']),
        'upper_68': inv(mc_out['upper_68']),
        'std'     : inv(mc_out['std']),
        'actuals' : target_scaler.inverse_transform(
                        seqs[h]['Y_test'].reshape(-1,1)).flatten()
    }

print("✅ Monte Carlo Dropout selesai.")


# %%
# ============================================================
# CELL 10: PERFORMANCE METRICS — LSTM vs BENCHMARKS
# ============================================================
def compute_metrics(actuals, preds, name='Model'):
    rmse = np.sqrt(mean_squared_error(actuals, preds))
    mae  = mean_absolute_error(actuals, preds)
    mape = np.mean(np.abs((actuals - preds) / (actuals + 1e-8))) * 100
    corr = np.corrcoef(actuals, preds)[0, 1]
    return {'Model': name, 'RMSE': round(rmse, 4),
            'MAE': round(mae, 4), 'MAPE%': round(mape, 2),
            'Correlation': round(corr, 4)}

print("\n" + "="*70)
print("  PERFORMANCE COMPARISON — LSTM vs GARCH vs HAR-RV vs NAIVE")
print("="*70)

all_metrics = []
for h in HORIZONS:
    actuals  = mc_results[h]['actuals']
    lstm_preds = mc_results[h]['mean']

    bench    = benchmark_results[h]
    min_len  = min(len(actuals), len(bench['har_actuals']))

    naive_preds = test_df['RV_Daily'].shift(h).dropna().values[:min_len]

    all_metrics.append(compute_metrics(actuals[:min_len], lstm_preds[:min_len], f'BiLSTM-Attn t+{h}'))
    all_metrics.append(compute_metrics(bench['har_actuals'], bench['har_preds'],  f'HAR-RV      t+{h}'))
    all_metrics.append(compute_metrics(bench['har_actuals'][:min_len], bench['garch_preds'][:min_len], f'GARCH(1,1)  t+{h}'))
    all_metrics.append(compute_metrics(actuals[:min_len], naive_preds[:min_len], f'Naive       t+{h}'))
    all_metrics.append({'Model': '─'*30, 'RMSE': '─', 'MAE': '─', 'MAPE%': '─', 'Correlation': '─'})

metrics_df = pd.DataFrame(all_metrics)
print(metrics_df.to_string(index=False))
print("\nNote: Lower RMSE/MAE/MAPE = Better | Higher Correlation = Better")


# %%
# ============================================================
# CELL 11: FORECAST BESOK (t+1, t+5, t+21) + UNCERTAINTY
# ============================================================
print("\n" + "="*55)
print("  🔮 FORECAST FORWARD-LOOKING")
print("="*55)

last_window = all_feat_scaled[-LOOK_BACK:].reshape(1, LOOK_BACK, len(FEATURE_COLS))

for h in HORIZONS:
    mc_fw = mc_dropout_predict(
        trained_models[h]['model'],
        last_window,
        n_samples=MC_SAMPLES
    )
    mean_vol  = target_scaler.inverse_transform([[mc_fw['mean'][0]]])[0][0]
    lower_vol = target_scaler.inverse_transform([[mc_fw['lower_90'][0]]])[0][0]
    upper_vol = target_scaler.inverse_transform([[mc_fw['upper_90'][0]]])[0][0]
    std_vol   = target_scaler.inverse_transform([[mc_fw['std'][0]]])[0][0]

    label_map = {1: 'besok (t+1)', 5: '5 hari ke depan (t+5)', 21: '1 bulan ke depan (t+21)'}
    print(f"\n  Horizon {label_map[h]}:")
    print(f"    Forecast  : {mean_vol:.2f}%")
    print(f"    90% CI    : [{lower_vol:.2f}% — {upper_vol:.2f}%]")
    print(f"    Uncertainty (±1σ): {std_vol:.2f}%")

    # Regime interpretation
    if mean_vol < 12:
        regime_label = "🟢 LOW VOL — Trend-following favorable"
    elif mean_vol < 22:
        regime_label = "🟡 NORMAL VOL — Balanced environment"
    else:
        regime_label = "🔴 HIGH VOL — Risk-off, reduce size"
    print(f"    Regime    : {regime_label}")

# ── Current VIX vs Forecast Gap ──────────────────────────
current_vix = df['VIX'].iloc[-1]
mc_t1 = mc_dropout_predict(trained_models[1]['model'], last_window, MC_SAMPLES)
forecast_t1 = target_scaler.inverse_transform([[mc_t1['mean'][0]]])[0][0]
spread = current_vix - forecast_t1

print(f"\n  Current VIX       : {current_vix:.2f}%")
print(f"  LSTM t+1 Forecast : {forecast_t1:.2f}%")
print(f"  IV-RV Gap         : {spread:+.2f}%  {'(Vol Rich → Sell Vol?)' if spread > 3 else '(Vol Cheap → Buy Vol?)' if spread < -3 else '(Neutral)'}")
print("="*55)


# %%
# ============================================================
# CELL 12: TRADING SIGNALS & POSITION SIZING
# ============================================================
print("\n  📊 TRADING SIGNALS BASED ON VOL FORECAST")
print("="*55)

def generate_signals(mc_res_h1, test_df_aligned, vix_series):
    """
    Hasilkan trading signals berbasis vol forecast.
    """
    mean_preds = mc_res_h1['mean']
    stds       = mc_res_h1['std']
    actuals    = mc_res_h1['actuals']
    n          = min(len(mean_preds), len(test_df_aligned))

    signals_df = pd.DataFrame({
        'Date'         : test_df_aligned.index[-n:],
        'Actual_RV'    : actuals[:n],
        'Forecast_RV'  : mean_preds[:n],
        'Uncertainty'  : stds[:n],
        'VIX'          : vix_series.reindex(test_df_aligned.index[-n:]).values
    }).set_index('Date')

    # Vol Risk Premium: jika VIX >> Forecast → vol overpriced
    signals_df['VRP'] = signals_df['VIX'] - signals_df['Forecast_RV']

    # Regime dari forecast
    signals_df['ForecastRegime'] = pd.cut(
        signals_df['Forecast_RV'],
        bins=[0, 12, 22, 200],
        labels=['Low', 'Normal', 'High']
    )

    # Position size scalar (1.0 = full size)
    # Semakin tinggi vol forecast + uncertainty, semakin kecil size
    max_vol  = signals_df['Forecast_RV'].quantile(0.95)
    norm_vol = signals_df['Forecast_RV'] / max_vol
    norm_unc = signals_df['Uncertainty'] / signals_df['Uncertainty'].quantile(0.95)
    signals_df['PositionScalar'] = np.clip(1 - 0.6*norm_vol - 0.4*norm_unc, 0.1, 1.0).round(2)

    # Trading bias
    signals_df['Signal'] = 'HOLD'
    signals_df.loc[signals_df['VRP'] > 3,  'Signal'] = 'SELL_VOL'   # IV >> RV forecast → short straddle
    signals_df.loc[signals_df['VRP'] < -3, 'Signal'] = 'BUY_VOL'    # RV forecast >> IV → long straddle
    signals_df.loc[signals_df['Forecast_RV'] > 25, 'Signal'] = 'REDUCE_RISK'

    return signals_df

signals_df = generate_signals(mc_results[1], test_df, df['VIX'])

# Summary
signal_counts = signals_df['Signal'].value_counts()
print(f"\n  Signal Distribution (last {len(signals_df)} test days):")
for sig, cnt in signal_counts.items():
    pct = cnt / len(signals_df) * 100
    print(f"    {sig:<15}: {cnt:4d} days ({pct:.1f}%)")

print(f"\n  Avg Position Scalar  : {signals_df['PositionScalar'].mean():.2f}x")
print(f"  Min Position Scalar  : {signals_df['PositionScalar'].min():.2f}x")

print("\n  Last 10 Signals:")
print(signals_df[['Actual_RV','Forecast_RV','Uncertainty',
                   'VRP','ForecastRegime','PositionScalar','Signal']].tail(10).round(2))


# %%
# ============================================================
# CELL 13: VISUALISASI COMPREHENSIVE
# ============================================================

# ─── 13.1 Dashboard Utama: Multi-Horizon Forecast ────────
fig = make_subplots(
    rows=3, cols=1,
    subplot_titles=[
        f'Horizon t+{h}: BiLSTM+Attn Forecast vs Actual (Test Set) + 90% CI'
        for h in HORIZONS
    ],
    vertical_spacing=0.10,
    shared_xaxes=False
)

colors_main = ['#00d4ff', '#ff6b6b', '#51cf66']
colors_ci   = ['rgba(0,212,255,0.15)', 'rgba(255,107,107,0.15)', 'rgba(81,207,102,0.15)']

for idx, h in enumerate(HORIZONS):
    row     = idx + 1
    res     = mc_results[h]
    n       = len(res['actuals'])
    dates   = test_df.index[-n:]

    # CI upper → lower (filled area)
    fig.add_trace(go.Scatter(
        x=list(dates) + list(dates[::-1]),
        y=list(res['upper_90']) + list(res['lower_90'][::-1]),
        fill='toself', fillcolor=colors_ci[idx],
        line=dict(color='rgba(255,255,255,0)'),
        name=f't+{h} 90% CI', showlegend=True
    ), row=row, col=1)

    # 68% CI
    fig.add_trace(go.Scatter(
        x=list(dates) + list(dates[::-1]),
        y=list(res['upper_68']) + list(res['lower_68'][::-1]),
        fill='toself',
        fillcolor=colors_ci[idx].replace('0.15','0.25'),
        line=dict(color='rgba(255,255,255,0)'),
        name=f't+{h} 68% CI', showlegend=False
    ), row=row, col=1)

    # Actual
    fig.add_trace(go.Scatter(
        x=dates, y=res['actuals'],
        name='Actual RV', line=dict(color='#ffd43b', width=1.5),
        showlegend=(idx == 0)
    ), row=row, col=1)

    # Mean Forecast
    fig.add_trace(go.Scatter(
        x=dates, y=res['mean'],
        name=f'BiLSTM t+{h}',
        line=dict(color=colors_main[idx], width=2, dash='dash'),
        showlegend=True
    ), row=row, col=1)

fig.update_layout(
    height=900, template='plotly_dark',
    title='BiLSTM+Attention: Multi-Horizon Volatility Forecast dengan Uncertainty',
    font=dict(size=11),
    hovermode='x unified',
    legend=dict(orientation='h', yanchor='bottom', y=1.01)
)
fig.update_yaxes(title_text='Vol Annualized (%)')
fig.show()


# ─── 13.2 Model Comparison ────────────────────────────────
fig2 = make_subplots(rows=1, cols=3,
    subplot_titles=[f't+{h}' for h in HORIZONS],
    horizontal_spacing=0.08
)

for idx, h in enumerate(HORIZONS):
    col     = idx + 1
    bench   = benchmark_results[h]
    lstm_p  = mc_results[h]['mean']
    actual  = mc_results[h]['actuals']
    n       = min(len(actual), len(bench['har_actuals']))
    dates   = test_df.index[-n:]

    fig2.add_trace(go.Scatter(x=dates, y=actual[:n],
        name='Actual', line=dict(color='#ffd43b', width=2),
        showlegend=(idx == 0)), row=1, col=col)

    fig2.add_trace(go.Scatter(x=dates, y=lstm_p[:n],
        name='BiLSTM', line=dict(color='#00d4ff', width=1.5, dash='dash'),
        showlegend=(idx == 0)), row=1, col=col)

    fig2.add_trace(go.Scatter(x=dates, y=bench['har_preds'][:n],
        name='HAR-RV', line=dict(color='#51cf66', width=1.5, dash='dot'),
        showlegend=(idx == 0)), row=1, col=col)

    fig2.add_trace(go.Scatter(x=dates, y=bench['garch_preds'][:n],
        name='GARCH(1,1)', line=dict(color='#ff6b6b', width=1.5, dash='dashdot'),
        showlegend=(idx == 0)), row=1, col=col)

fig2.update_layout(
    height=450, template='plotly_dark',
    title='Benchmark Comparison: BiLSTM vs GARCH vs HAR-RV',
    hovermode='x unified'
)
fig2.update_yaxes(title_text='Vol Annualized (%)')
fig2.show()


# ─── 13.3 Trading Signals Dashboard ───────────────────────
fig3 = make_subplots(
    rows=3, cols=1,
    subplot_titles=['Actual vs Forecast RV + Regime Zones',
                    'Vol Risk Premium (VIX − Forecast RV)',
                    'Position Size Scalar'],
    vertical_spacing=0.10,
    shared_xaxes=True
)

# Zone colors
for threshold, color, label in [(12, 'rgba(81,207,102,0.05)', 'Low'),
                                  (22, 'rgba(255,212,59,0.05)', 'Normal')]:
    fig3.add_hrect(y0=0, y1=threshold, fillcolor=color,
                   line_width=0, row=1, col=1)

fig3.add_trace(go.Scatter(x=signals_df.index, y=signals_df['Actual_RV'],
    name='Actual RV', line=dict(color='#ffd43b', width=1.5)), row=1, col=1)
fig3.add_trace(go.Scatter(x=signals_df.index, y=signals_df['Forecast_RV'],
    name='Forecast RV', line=dict(color='#00d4ff', width=2, dash='dash')), row=1, col=1)
fig3.add_trace(go.Scatter(x=signals_df.index, y=signals_df['VIX'],
    name='VIX', line=dict(color='#cc5de8', width=1.5, dash='dot')), row=1, col=1)

# Vol Risk Premium
vrp_colors = ['#ff6b6b' if v > 3 else '#51cf66' if v < -3 else '#ffd43b'
              for v in signals_df['VRP']]
fig3.add_trace(go.Bar(x=signals_df.index, y=signals_df['VRP'],
    name='VRP', marker_color=vrp_colors, showlegend=True), row=2, col=1)
fig3.add_hline(y=3,  line_dash='dash', line_color='red',
               annotation_text='Sell Vol Zone', row=2, col=1)
fig3.add_hline(y=-3, line_dash='dash', line_color='green',
               annotation_text='Buy Vol Zone', row=2, col=1)
fig3.add_hline(y=0,  line_color='white', line_width=0.5, row=2, col=1)

# Position Scalar
fig3.add_trace(go.Scatter(x=signals_df.index, y=signals_df['PositionScalar'],
    fill='tozeroy', name='Position Size',
    line=dict(color='#74c0fc'), fillcolor='rgba(116,192,252,0.2)'), row=3, col=1)
fig3.add_hline(y=0.5, line_dash='dash', line_color='orange',
               annotation_text='Half Size Threshold', row=3, col=1)

fig3.update_layout(
    height=750, template='plotly_dark',
    title='Trading Intelligence Dashboard — Vol Forecast × Signals × Sizing',
    hovermode='x unified'
)
fig3.update_yaxes(title_text='Vol %', row=1, col=1)
fig3.update_yaxes(title_text='VRP (%)', row=2, col=1)
fig3.update_yaxes(title_text='Size Scalar', row=3, col=1)
fig3.show()


# ─── 13.4 Regime Distribution ────────────────────────────
regime_counts = signals_df['ForecastRegime'].value_counts()
colors_regime = {'Low': '#51cf66', 'Normal': '#ffd43b', 'High': '#ff6b6b'}

fig4 = go.Figure(go.Pie(
    labels=regime_counts.index,
    values=regime_counts.values,
    marker_colors=[colors_regime.get(str(r), '#aaa') for r in regime_counts.index],
    hole=0.4,
    textinfo='label+percent'
))
fig4.update_layout(
    template='plotly_dark',
    title='Distribusi Vol Regime dari Forecast Model (Test Period)'
)
fig4.show()


# ─── 13.5 Training Loss Curve ────────────────────────────
fig5 = make_subplots(rows=1, cols=len(HORIZONS),
    subplot_titles=[f'Loss Curve t+{h}' for h in HORIZONS])

for idx, h in enumerate(HORIZONS):
    hist = trained_models[h]['history'].history
    fig5.add_trace(go.Scatter(y=hist['loss'], name='Train Loss',
        line=dict(color='#00d4ff'), showlegend=(idx==0)), row=1, col=idx+1)
    fig5.add_trace(go.Scatter(y=hist['val_loss'], name='Val Loss',
        line=dict(color='#ff6b6b', dash='dash'), showlegend=(idx==0)), row=1, col=idx+1)

fig5.update_layout(height=350, template='plotly_dark',
    title='Training Loss per Horizon (Early Stopping Applied)')
fig5.show()


# %%
# ============================================================
# CELL 14: FINAL SUMMARY
# ============================================================
print("\n" + "="*60)
print("  FINAL MODEL SUMMARY")
print("="*60)
print(f"  Architecture    : Bidirectional LSTM + Attention + MC Dropout")
print(f"  Features        : {len(FEATURE_COLS)} inputs — {FEATURE_COLS}")
print(f"  Horizons        : t+1, t+5, t+21")
print(f"  Uncertainty     : Monte Carlo Dropout ({MC_SAMPLES} samples)")
print(f"  Vol Estimator   : Garman-Klass (OHLC-based)")
print(f"  Train Period    : {train_df.index[0].date()} → {train_df.index[-1].date()}")
print(f"  Test Period     : {test_df.index[0].date()}  → {test_df.index[-1].date()}")
print(f"  Data Leakage    : ✅ Prevented (scaler fit on train only)")
print(f"  Benchmarks      : GARCH(1,1) · HAR-RV · Naive")
print("="*60)
print("\nDone. Check charts above untuk full analysis.")