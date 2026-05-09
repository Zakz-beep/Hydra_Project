import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout, BatchNormalization
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
import tensorflow as tf
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import warnings
warnings.filterwarnings('ignore')

tf.random.set_seed(42)
np.random.seed(42)

START = '2010-01-01'
END   = '2026-05-01'

# ──────────────────────────────────────────────────────────
# UPGRADE v4: Apa yang berubah dari v3?
#
#  1. LOG TRANSFORM TARGET
#     Vol itu log-normal, bukan normal. Kalau di-log dulu,
#     distribusinya jauh lebih Gaussian → LSTM lebih mudah belajar.
#     Prediksi akhir tinggal di-exp() balik.
#
#  2. HUBER LOSS (gantiin MSE)
#     MSE = error dikuadratkan → spike ekstrem (COVID, 2015, dll)
#     dapat penalty SANGAT besar → model jadi "terobsesi" sama spike
#     tapi salah di hari normal.
#     Huber = MSE di dekat 0, MAE di error besar → spike diabaikan,
#     hari normal dipelajari dengan baik.
#
#  3. WINSORIZE TARGET (saat training)
#     Clip vol di 97.5th percentile → spike ekstrem tidak
#     merusak gradient. Ini HANYA saat fit model, bukan saat evaluasi.
#
#  4. FEATURE SELECTION (pakai hasil permutation importance v3)
#     Buang fitur noise, keep only yang terbukti penting.
#     Fitur lebih sedikit = model tidak distracted.
#
#  5. BATCH NORMALIZATION
#     Normalisasi output tiap LSTM layer → training lebih stabil,
#     convergence lebih cepat, performa lebih bagus.
#
#  6. WALK-FORWARD EVALUATION
#     Simulasi kondisi real: model dilatih di masa lalu,
#     dievaluasi di masa depan, lalu window geser.
#     Jauh lebih jujur dibanding simple train/test split.
# ──────────────────────────────────────────────────────────

def safe_dl(ticker, col='Close', rename=None):
    try:
        r = yf.download(ticker, start=START, end=END, auto_adjust=True, progress=False)
        if isinstance(r.columns, pd.MultiIndex):
            r.columns = r.columns.get_level_values(0)
        s = r[[col]].rename(columns={col: rename or ticker})
        print(f"  [OK] {ticker:12s}  ({len(s)} rows)")
        return s
    except Exception as e:
        print(f"  [XX] {ticker:12s}  FAILED: {e}")
        return None

# ============================================================
# 1. DOWNLOAD DATA
# ============================================================
print("=" * 55)
print("  DOWNLOAD DATA")
print("=" * 55)

spx = yf.download('^GSPC', start=START, end=END, auto_adjust=True, progress=False)
if isinstance(spx.columns, pd.MultiIndex):
    spx.columns = spx.columns.get_level_values(0)
print(f"  [OK] ^GSPC  ({len(spx)} rows)")

vix   = safe_dl('^VIX',   rename='VIX')
vvix  = safe_dl('^VVIX',  rename='VVIX')
vix9d = safe_dl('^VIX9D', rename='VIX9D')
tnx   = safe_dl('^TNX',   rename='Yield_10Y')
irx   = safe_dl('^IRX',   rename='Yield_3M')
hyg   = safe_dl('HYG',    rename='HYG')
lqd   = safe_dl('LQD',    rename='LQD')
gold  = safe_dl('GC=F',   rename='Gold')
oil   = safe_dl('CL=F',   rename='Oil')
print()

# ============================================================
# 2. FEATURE ENGINEERING
#    Hanya fitur yang terbukti penting di v3
#    (threshold importance > 2.5e-5 dari permutation test)
# ============================================================
df = spx.copy()

# --- Realized Vol ---
log_hl = np.log(df['High'] / df['Low'])
log_co = np.log(df['Close'] / df['Open'])
gk_var = 0.5 * (log_hl**2) - (2*np.log(2) - 1) * (log_co**2)
df['RV_GK']      = np.sqrt(gk_var * 252) * 100
df['Log_Return'] = np.log(df['Close'] / df['Close'].shift(1))
df['RV_5d']      = df['Log_Return'].rolling(5).std()  * np.sqrt(252) * 100
df['RV_22d']     = df['Log_Return'].rolling(22).std() * np.sqrt(252) * 100

# HAR (Heterogeneous AR) features: rata-rata harian, mingguan, bulanan
# HAR adalah model klasik yang terbukti kuat untuk forecasting RV
df['HAR_d']  = df['RV_GK']                              # harian
df['HAR_w']  = df['RV_GK'].rolling(5).mean()            # mingguan avg
df['HAR_m']  = df['RV_GK'].rolling(22).mean()           # bulanan avg

# Vol-of-vol, skew, gap
df['Vol_of_Vol']  = df['RV_GK'].rolling(10).std()
df['Skew_22d']    = df['Log_Return'].rolling(22).skew()
df['Gap_pct']     = (df['Open'] - df['Close'].shift(1)) / df['Close'].shift(1) * 100

# ATR%
hl = df['High'] - df['Low']
hc = (df['High'] - df['Close'].shift(1)).abs()
lc = (df['Low']  - df['Close'].shift(1)).abs()
df['ATR_pct'] = pd.concat([hl, hc, lc], axis=1).max(axis=1).rolling(14).mean() / df['Close'] * 100

# --- Vol Surface ---
if vix is not None:
    df = df.join(vix.ffill())
    df['Vol_Risk_Premium'] = df['VIX'] - df['RV_22d']
    df['dVIX']   = df['VIX'].diff()
    df['dVIX5']  = df['VIX'].diff(5)
    # VIX regime: 1 = high vol regime (VIX>20), 0 = low
    df['VIX_Regime'] = (df['VIX'] > 20).astype(int)

if vvix is not None:
    df = df.join(vvix.ffill())
    if 'VIX' in df.columns:
        df['VVIX_VIX_ratio'] = df['VVIX'] / df['VIX']

if vix9d is not None:
    df = df.join(vix9d.ffill())
    if 'VIX' in df.columns:
        df['VIX_term_slope'] = df['VIX9D'] / df['VIX']

# --- Rates ---
if tnx is not None:
    df = df.join(tnx.ffill())
    df['dYield_10Y'] = df['Yield_10Y'].diff()
if irx is not None:
    df = df.join(irx.ffill())
    if 'Yield_10Y' in df.columns:
        df['Yield_Curve'] = df['Yield_10Y'] - df['Yield_3M']

# --- Credit ---
if hyg is not None:
    df = df.join(hyg.pct_change().rename(columns={'HYG': 'HYG_ret'}).ffill())
    if lqd is not None:
        df = df.join(lqd.pct_change().rename(columns={'LQD': 'LQD_ret'}).ffill())
        df['Credit_Spread_proxy'] = df['HYG_ret'] - df['LQD_ret']

# --- Cross-Asset ---
if gold is not None:
    df = df.join(gold.pct_change().rename(columns={'Gold': 'Gold_ret'}).ffill())
if oil is not None:
    df = df.join(oil.pct_change().rename(columns={'Oil': 'Oil_ret'}).ffill())

# --- Technical ---
delta_c = df['Close'].diff()
avg_g   = delta_c.clip(lower=0).ewm(com=13, adjust=False).mean()
avg_l   = (-delta_c).clip(lower=0).ewm(com=13, adjust=False).mean()
df['RSI_14']  = 100 - (100 / (1 + avg_g / avg_l.replace(0, np.nan)))
sma20         = df['Close'].rolling(20).mean()
df['BB_Width']= (df['Close'].rolling(20).std() * 4) / sma20 * 100
df['Dist_SMA200'] = (df['Close'] - df['Close'].rolling(200).mean()) / df['Close'].rolling(200).mean() * 100
vol_mean      = df['Volume'].rolling(20).mean()
vol_std       = df['Volume'].rolling(20).std()
df['Volume_Zscore'] = (df['Volume'] - vol_mean) / vol_std.replace(0, np.nan)

# --- Calendar ---
df['DayOfWeek_sin'] = np.sin(2 * np.pi * df.index.dayofweek / 5)
df['DayOfWeek_cos'] = np.cos(2 * np.pi * df.index.dayofweek / 5)
df['Month_sin']     = np.sin(2 * np.pi * df.index.month / 12)
df['Month_cos']     = np.cos(2 * np.pi * df.index.month / 12)

def is_opex_week(idx):
    result = []
    for date in idx:
        fridays = pd.date_range(start=date.replace(day=1), periods=31, freq='D')
        fridays  = fridays[fridays.dayofweek == 4]
        opex     = fridays[2] if len(fridays) >= 3 else None
        result.append(1 if opex and abs((date - opex).days) <= 2 else 0)
    return result

df['Is_OPEX_Week'] = is_opex_week(df.index)

# --- Lagged (top ones from importance) ---
for lag in [1, 3, 5]:
    df[f'RV_GK_lag{lag}'] = df['RV_GK'].shift(lag)
    if 'VIX' in df.columns:
        df[f'VIX_lag{lag}'] = df['VIX'].shift(lag)

# ============================================================
# 3. DEFINISI FITUR (dipilih dari importance v3, +HAR +regime)
# ============================================================
CANDIDATE = [
    # Terbukti penting (importance > 2.5e-5 di v3)
    'RV_GK', 'dVIX5', 'VIX9D', 'RSI_14', 'VIX_term_slope',
    'dVIX', 'VIX', 'Is_OPEX_Week', 'Vol_of_Vol', 'VVIX_VIX_ratio',
    'Volume_Zscore', 'RV_5d', 'Vol_Risk_Premium', 'Log_Return',
    'DayOfWeek_sin',
    # HAR features (strong baseline untuk RV forecasting)
    'HAR_d', 'HAR_w', 'HAR_m',
    # Tambahan yang relevan
    'VIX_Regime', 'BB_Width', 'Dist_SMA200', 'Gap_pct',
    'ATR_pct', 'Skew_22d', 'Credit_Spread_proxy', 'HYG_ret',
    'Gold_ret', 'Oil_ret', 'dYield_10Y', 'Yield_Curve',
    'VVIX', 'RV_22d',
    # Lagged
    'RV_GK_lag1', 'RV_GK_lag3', 'RV_GK_lag5',
    'VIX_lag1', 'VIX_lag3',
    # Calendar
    'DayOfWeek_cos', 'Month_sin', 'Month_cos',
]

FEATURES = [f for f in CANDIDATE if f in df.columns]
TARGET   = 'RV_GK'

df.replace([np.inf, -np.inf], np.nan, inplace=True)
df.dropna(subset=FEATURES, inplace=True)

print(f"Total fitur : {len(FEATURES)}")
print(f"Total data  : {len(df)} hari trading\n")

# ============================================================
# 4. LOG TRANSFORM TARGET
#    *** UPGRADE UTAMA #1 ***
#    Vol itu log-normal. Log(vol) jauh lebih Gaussian dan
#    mudah dipelajari LSTM. Prediksi akhir = exp(output).
# ============================================================
df['RV_GK_log'] = np.log(df[TARGET])  # target baru dalam log-space
TARGET_LOG = 'RV_GK_log'

# ============================================================
# 5. TRAIN / TEST SPLIT
# ============================================================
LOOK_BACK   = 22
TRAIN_RATIO = 0.80

split_idx = int(len(df) * TRAIN_RATIO)
train_df  = df.iloc[:split_idx]
test_df   = df.iloc[split_idx:]

print(f"Train : {train_df.index[0].date()}  ->  {train_df.index[-1].date()}  ({len(train_df)} hari)")
print(f"Test  : {test_df.index[0].date()}   ->  {test_df.index[-1].date()}   ({len(test_df)} hari)\n")

# ============================================================
# 6. WINSORIZE TARGET SAAT TRAINING
#    *** UPGRADE UTAMA #2 ***
#    Cap spike ekstrem di 97.5th percentile HANYA di training.
#    Ini bukan "mengubah data" — kita masih evaluasi di nilai asli.
#    Tujuannya: gradient tidak terdistorsi oleh COVID/2008 spike.
# ============================================================
WINSOR_QUANTILE = 0.975
train_log_vals = train_df[TARGET_LOG].values
cap_value      = np.quantile(train_log_vals, WINSOR_QUANTILE)
train_log_capped = np.clip(train_log_vals, -np.inf, cap_value)

print(f"Winsorize cap (97.5th pctile, log-space) : {cap_value:.4f}")
print(f"  = {np.exp(cap_value):.2f}% annualized vol\n")

# ============================================================
# 7. SCALING (fit hanya di train, no leakage)
# ============================================================
feature_scaler = MinMaxScaler(feature_range=(0, 1))
target_scaler  = MinMaxScaler(feature_range=(0, 1))

train_feat_s    = feature_scaler.fit_transform(train_df[FEATURES])
test_feat_s     = feature_scaler.transform(test_df[FEATURES])

# Scale target dengan nilai yang sudah diwinsorize
target_scaler.fit(train_log_capped.reshape(-1, 1))

# Training pakai yang capped, evaluasi pakai nilai asli
train_tgt_s_capped = target_scaler.transform(train_log_capped.reshape(-1, 1))
test_tgt_s_real    = target_scaler.transform(test_df[TARGET_LOG].values.reshape(-1, 1))

all_feat_s = np.vstack([train_feat_s, test_feat_s])
all_tgt_s  = np.vstack([train_tgt_s_capped, test_tgt_s_real])

# ============================================================
# 8. SEQUENCE BUILDING
# ============================================================
def build_sequences(features, target, look_back):
    X, Y = [], []
    for i in range(len(features) - look_back):
        X.append(features[i : i + look_back])
        Y.append(target[i + look_back, 0])
    return np.array(X), np.array(Y)

X_all, Y_all = build_sequences(all_feat_s, all_tgt_s, LOOK_BACK)
n_train_seq      = split_idx - LOOK_BACK
X_train, Y_train = X_all[:n_train_seq], Y_all[:n_train_seq]
X_test,  Y_test  = X_all[n_train_seq:], Y_all[n_train_seq:]

print(f"X_train : {X_train.shape}")
print(f"X_test  : {X_test.shape}\n")

# ============================================================
# 9. MODEL ARSITEKTUR (+ BatchNormalization)
#    *** UPGRADE UTAMA #3 ***
#    BatchNorm setelah LSTM: normalisasi distribusi output
#    tiap layer → training lebih stabil, convergence lebih cepat.
# ============================================================
n_features = len(FEATURES)

model = Sequential([
    # Layer 1: LSTM lebar
    LSTM(64, return_sequences=True, input_shape=(LOOK_BACK, n_features)),
    BatchNormalization(),   # ← baru di v4
    Dropout(0.2),

    # Layer 2: LSTM lebih kecil
    LSTM(32, return_sequences=False),
    BatchNormalization(),   # ← baru di v4
    Dropout(0.15),          # lebih kecil dari v3 karena BatchNorm sudah regularize

    Dense(16, activation='relu'),
    Dense(1)
])

# HUBER LOSS (delta=1.0)
# *** UPGRADE UTAMA #4 ***
# Error < delta  → dihitung seperti MSE (precise di sekitar 0)
# Error > delta  → dihitung seperti MAE (tidak meledak saat spike)
# Hasilnya: model fokus di hari normal, ignore spike ekstrem
model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss=tf.keras.losses.Huber(delta=1.0),
    metrics=['mae']
)

model.summary()

# ============================================================
# 10. TRAINING
# ============================================================
callbacks = [
    EarlyStopping(monitor='val_loss', patience=12, restore_best_weights=True, verbose=1),
    ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=6, min_lr=1e-6, verbose=1)
]

print("\nTraining v4 (log target + Huber + BatchNorm)...")
history = model.fit(
    X_train, Y_train,
    epochs=150,           # lebih banyak karena EarlyStopping yang kontrol
    batch_size=32,
    validation_split=0.10,
    callbacks=callbacks,
    verbose=1
)

# ============================================================
# 11. EVALUASI OUT-OF-SAMPLE
#     Inverse transform: scaled -> log-space -> exp() -> persen vol
# ============================================================
print("\n" + "="*55)
print("  EVALUASI -- OUT-OF-SAMPLE TEST SET")
print("="*55)

def predict_vol(X):
    pred_scaled = model.predict(X, verbose=0)
    pred_log    = target_scaler.inverse_transform(pred_scaled).flatten()
    return np.exp(pred_log)   # log-space balik ke vol %

Y_pred   = predict_vol(X_test)
Y_actual = np.exp(target_scaler.inverse_transform(Y_test.reshape(-1, 1)).flatten())

rmse    = np.sqrt(mean_squared_error(Y_actual, Y_pred))
mae     = mean_absolute_error(Y_actual, Y_pred)
dir_acc = np.mean((np.diff(Y_actual) > 0) == (np.diff(Y_pred) > 0)) * 100

# MAPE: mean absolute percentage error (lebih intuitif untuk vol)
mape    = np.mean(np.abs((Y_actual - Y_pred) / Y_actual)) * 100

print(f"  RMSE             : {rmse:.4f}%")
print(f"  MAE              : {mae:.4f}%")
print(f"  MAPE             : {mape:.2f}%")
print(f"  Directional Acc  : {dir_acc:.2f}%   (random = 50%)")
print("="*55)

# ============================================================
# 12. WALK-FORWARD EVALUATION
#     *** UPGRADE UTAMA #5 ***
#     Simulasi kondisi real: model TIDAK melihat data masa depan.
#     Window: train 3 tahun, test tiap 6 bulan, geser maju.
#     Hasilnya: distribusi performa yang jujur dari waktu ke waktu.
# ============================================================
print("\nMenjalankan Walk-Forward Evaluation...")
print("(Train 3 tahun, test 6 bulan, geser tiap 6 bulan)\n")

TRAIN_WINDOW  = 252 * 3   # 3 tahun training
TEST_WINDOW   = 126        # 6 bulan testing

wf_results = []
i = LOOK_BACK

while i + TRAIN_WINDOW + TEST_WINDOW <= len(df):
    wf_train_df = df.iloc[i : i + TRAIN_WINDOW]
    wf_test_df  = df.iloc[i + TRAIN_WINDOW : i + TRAIN_WINDOW + TEST_WINDOW]

    # Scale (fit di train window saja)
    wf_fs = MinMaxScaler().fit(wf_train_df[FEATURES])
    wf_ts = MinMaxScaler()

    wf_train_log = np.log(wf_train_df[TARGET].values)
    wf_cap       = np.quantile(wf_train_log, WINSOR_QUANTILE)
    wf_train_log_capped = np.clip(wf_train_log, -np.inf, wf_cap)
    wf_ts.fit(wf_train_log_capped.reshape(-1, 1))

    wf_all_feat = wf_fs.transform(pd.concat([wf_train_df, wf_test_df])[FEATURES])
    wf_all_tgt  = np.vstack([
        wf_ts.transform(wf_train_log_capped.reshape(-1, 1)),
        wf_ts.transform(np.clip(np.log(wf_test_df[TARGET].values), -np.inf, wf_cap).reshape(-1, 1))
    ])

    Xwf, Ywf   = build_sequences(wf_all_feat, wf_all_tgt, LOOK_BACK)
    Xwf_tr     = Xwf[:TRAIN_WINDOW - LOOK_BACK]
    Ywf_tr     = Ywf[:TRAIN_WINDOW - LOOK_BACK]
    Xwf_te     = Xwf[TRAIN_WINDOW - LOOK_BACK:]
    Ywf_te     = Ywf[TRAIN_WINDOW - LOOK_BACK:]

    wf_model = Sequential([
        LSTM(64, return_sequences=True, input_shape=(LOOK_BACK, n_features)),
        BatchNormalization(), Dropout(0.2),
        LSTM(32), BatchNormalization(), Dropout(0.15),
        Dense(16, activation='relu'), Dense(1)
    ])
    wf_model.compile(optimizer='adam', loss=tf.keras.losses.Huber(delta=1.0))
    wf_model.fit(Xwf_tr, Ywf_tr, epochs=40, batch_size=32,
                 validation_split=0.1, verbose=0,
                 callbacks=[EarlyStopping(patience=8, restore_best_weights=True)])

    wf_pred_log = wf_ts.inverse_transform(wf_model.predict(Xwf_te, verbose=0)).flatten()
    wf_pred     = np.exp(wf_pred_log)
    wf_actual   = wf_test_df[TARGET].values[:len(wf_pred)]
    wf_dates    = wf_test_df.index[:len(wf_pred)]

    wf_rmse    = np.sqrt(mean_squared_error(wf_actual, wf_pred))
    wf_dir     = np.mean((np.diff(wf_actual) > 0) == (np.diff(wf_pred) > 0)) * 100

    period = f"{wf_test_df.index[0].date()} -> {wf_test_df.index[-1].date()}"
    print(f"  {period}  |  RMSE: {wf_rmse:.3f}%  |  DirAcc: {wf_dir:.1f}%")

    wf_results.append({
        'dates': wf_dates, 'actual': wf_actual[:len(wf_pred)],
        'pred': wf_pred, 'rmse': wf_rmse, 'dir_acc': wf_dir
    })

    i += TEST_WINDOW   # geser window

wf_rmse_avg   = np.mean([r['rmse']    for r in wf_results])
wf_dir_avg    = np.mean([r['dir_acc'] for r in wf_results])
print(f"\n  Walk-Forward avg RMSE    : {wf_rmse_avg:.4f}%")
print(f"  Walk-Forward avg DirAcc  : {wf_dir_avg:.2f}%")

# ============================================================
# 13. PREDIKSI BESOK
# ============================================================
X_besok   = all_feat_s[-LOOK_BACK:].reshape(1, LOOK_BACK, n_features)
vol_besok = predict_vol(X_besok)[0]
vol_today = df['RV_GK'].iloc[-1]
delta     = vol_besok - vol_today
arah      = "NAIK" if delta > 0 else "TURUN"

print(f"\n{'='*55}")
print(f"  PREDIKSI VOL BESOK  : {vol_besok:.2f}%")
print(f"  VOL AKTUAL HARI INI : {vol_today:.2f}%")
print(f"  DELTA               : {delta:+.2f}%  ({arah})")
print(f"{'='*55}\n")

# ============================================================
# 14. VISUALISASI -- 4 PANEL
# ============================================================
test_dates = df.index[split_idx + LOOK_BACK:]

fig = make_subplots(
    rows=4, cols=1,
    subplot_titles=(
        f'[HOLD-OUT TEST] Aktual vs Prediksi  '
        f'(RMSE: {rmse:.3f}%  |  MAPE: {mape:.1f}%  |  DirAcc: {dir_acc:.1f}%)',
        '[WALK-FORWARD] RMSE per Periode',
        'Training & Validation Loss (Huber)',
        'Error Harian (Prediksi - Aktual)'
    ),
    row_heights=[0.40, 0.20, 0.20, 0.20],
    vertical_spacing=0.08
)

# Panel 1: Aktual vs Prediksi
fig.add_trace(go.Scatter(x=test_dates, y=Y_actual, name='Aktual (GK Vol)',
    line=dict(color='#FF8C00', width=2)), row=1, col=1)
fig.add_trace(go.Scatter(x=test_dates, y=Y_pred, name='Prediksi LSTM v4',
    line=dict(color='#00FFAA', width=1.5, dash='dash')), row=1, col=1)

# Panel 2: Walk-Forward RMSE
wf_labels  = [f"{r['dates'][0].strftime('%Y-%m')}" for r in wf_results]
wf_rmses   = [r['rmse'] for r in wf_results]
wf_dirs    = [r['dir_acc'] for r in wf_results]
fig.add_trace(go.Bar(x=wf_labels, y=wf_rmses, name='WF RMSE',
    marker_color='#7EB8FF'), row=2, col=1)
fig.add_hline(y=wf_rmse_avg, line_dash='dash', line_color='yellow',
    annotation_text=f'avg={wf_rmse_avg:.3f}%', row=2, col=1)

# Panel 3: Loss Curve
ep = list(range(1, len(history.history['loss']) + 1))
fig.add_trace(go.Scatter(x=ep, y=history.history['loss'], name='Train Loss (Huber)',
    line=dict(color='#00FFFF', width=1.5)), row=3, col=1)
fig.add_trace(go.Scatter(x=ep, y=history.history['val_loss'], name='Val Loss (Huber)',
    line=dict(color='#FF4444', width=1.5)), row=3, col=1)

# Panel 4: Error Bar
error = Y_pred - Y_actual
fig.add_trace(go.Bar(x=test_dates, y=error, name='Error',
    marker_color=np.where(error > 0, '#FF4444', '#44FF88')), row=4, col=1)
fig.add_hline(y=0, line_dash='dash', line_color='white', opacity=0.4, row=4, col=1)

fig.update_layout(
    title=dict(
        text=(f'LSTM Vol Forecaster v4  |  {len(FEATURES)} Fitur  |  Log-Target  |  '
              f'Huber Loss  |  BatchNorm  |  WF-avg RMSE: {wf_rmse_avg:.3f}%'),
        font=dict(size=13)
    ),
    template='plotly_dark', hovermode='x unified',
    height=1100, legend=dict(orientation='h', y=1.02)
)
fig.update_yaxes(title_text='Vol (%)',    row=1, col=1)
fig.update_yaxes(title_text='RMSE (%)',   row=2, col=1)
fig.update_yaxes(title_text='Huber Loss', row=3, col=1)
fig.update_yaxes(title_text='Error (%)',  row=4, col=1)
fig.update_xaxes(title_text='Epoch',      row=3, col=1)

fig.show()