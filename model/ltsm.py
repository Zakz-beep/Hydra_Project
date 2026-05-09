import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import tensorflow as tf
import warnings
warnings.filterwarnings('ignore')

tf.random.set_seed(42)
np.random.seed(42)

# ============================================================
# 1. DOWNLOAD DATA (S&P 500 + VIX)
# ============================================================
print("Mengunduh data S&P 500 & VIX (2010–2026)...")
spx = yf.download('^GSPC', start='2010-01-01', end='2026-05-01', auto_adjust=True)
vix_raw = yf.download('^VIX',  start='2010-01-01', end='2026-05-01', auto_adjust=True)

# Flatten MultiIndex kalau ada
if isinstance(spx.columns, pd.MultiIndex):
    spx.columns = spx.columns.get_level_values(0)
if isinstance(vix_raw.columns, pd.MultiIndex):
    vix_raw.columns = vix_raw.columns.get_level_values(0)

vix = vix_raw[['Close']].rename(columns={'Close': 'VIX'})

# ============================================================
# 2. FEATURE ENGINEERING (6 Fitur — dari 1 jadi Multivariate)
# ============================================================
df = spx.copy()

# --- [1] Garman-Klass Realized Volatility (target utama) ---
log_hl = np.log(df['High'] / df['Low'])
log_co = np.log(df['Close'] / df['Open'])
gk_var  = 0.5 * (log_hl**2) - (2 * np.log(2) - 1) * (log_co**2)
df['RV_GK'] = np.sqrt(gk_var * 252) * 100

# --- [2] Log Return harian ---
df['Log_Return'] = np.log(df['Close'] / df['Close'].shift(1))

# --- [3] ATR% — ukuran range intraday relatif terhadap harga ---
hl   = df['High'] - df['Low']
hc   = (df['High'] - df['Close'].shift(1)).abs()
lc   = (df['Low']  - df['Close'].shift(1)).abs()
atr  = pd.concat([hl, hc, lc], axis=1).max(axis=1).rolling(14).mean()
df['ATR_pct'] = (atr / df['Close']) * 100

# --- [4] Rolling Realized Vol 5 hari (short-term momentum vol) ---
df['RV_5d']  = df['Log_Return'].rolling(5).std()  * np.sqrt(252) * 100

# --- [5] Rolling Realized Vol 22 hari (baseline vol level) ---
df['RV_22d'] = df['Log_Return'].rolling(22).std() * np.sqrt(252) * 100

# --- [6] VIX (implied vol dari opsi — forward-looking signal) ---
df = df.join(vix, how='left')
df['VIX'] = df['VIX'].ffill()

df.dropna(inplace=True)

FEATURES = ['RV_GK', 'Log_Return', 'ATR_pct', 'RV_5d', 'RV_22d', 'VIX']
TARGET    = 'RV_GK'

print(f"Total data: {len(df)} hari trading")
print(f"Fitur ({len(FEATURES)}): {FEATURES}\n")

# ============================================================
# 3. TRAIN / TEST SPLIT (80/20 — ZERO DATA LEAKAGE)
# ============================================================
LOOK_BACK   = 22       # ~1 bulan trading
TRAIN_RATIO = 0.80

split_idx = int(len(df) * TRAIN_RATIO)
train_df  = df.iloc[:split_idx]
test_df   = df.iloc[split_idx:]

print(f"Train : {train_df.index[0].date()}  →  {train_df.index[-1].date()}  ({len(train_df)} hari)")
print(f"Test  : {test_df.index[0].date()}   →  {test_df.index[-1].date()}   ({len(test_df)} hari)\n")

# ============================================================
# 4. SCALING
#    PENTING: scaler di-fit HANYA di train data.
#    Test data di-transform pakai scaler yang sama → no leakage.
# ============================================================
feature_scaler = MinMaxScaler(feature_range=(0, 1))
target_scaler  = MinMaxScaler(feature_range=(0, 1))

train_features_scaled = feature_scaler.fit_transform(train_df[FEATURES])
train_target_scaled   = target_scaler.fit_transform(train_df[[TARGET]])

test_features_scaled  = feature_scaler.transform(test_df[FEATURES])
test_target_scaled    = target_scaler.transform(test_df[[TARGET]])

all_features_scaled = np.vstack([train_features_scaled, test_features_scaled])
all_target_scaled   = np.vstack([train_target_scaled,   test_target_scaled])

# ============================================================
# 5. SEQUENCE BUILDING (Sliding Window — Multivariate 3D)
# ============================================================
def build_sequences(features, target, look_back):
    """
    Output X shape: (samples, look_back, n_features)
    Output Y shape: (samples,)
    """
    X, Y = [], []
    for i in range(len(features) - look_back):
        X.append(features[i : i + look_back])
        Y.append(target[i + look_back, 0])
    return np.array(X), np.array(Y)

X_all, Y_all = build_sequences(all_features_scaled, all_target_scaled, LOOK_BACK)

n_train_seq        = split_idx - LOOK_BACK
X_train, Y_train   = X_all[:n_train_seq], Y_all[:n_train_seq]
X_test,  Y_test    = X_all[n_train_seq:], Y_all[n_train_seq:]

print(f"X_train : {X_train.shape}   →  (samples, timesteps, n_features)")
print(f"X_test  : {X_test.shape}\n")

# ============================================================
# 6. ARSITEKTUR — Stacked LSTM + Dropout
#
#   Versi lama : 1 LSTM(50) + Dense(1)
#   Versi baru : LSTM(64) → Dropout → LSTM(32) → Dropout → Dense(16) → Dense(1)
#   Keuntungan : layer 2 bisa menangkap pola yang lebih abstrak dari layer 1
# ============================================================
print("Membangun Stacked LSTM Architecture...")

n_features = len(FEATURES)

model = Sequential([
    # Layer 1: LSTM lebar — menangkap pola temporal mentah
    LSTM(units=64, return_sequences=True, input_shape=(LOOK_BACK, n_features)),
    Dropout(0.2),   # matikan 20% neuron saat training → anti-overfit

    # Layer 2: LSTM lebih kecil — squeeze ke representasi lebih abstrak
    LSTM(units=32, return_sequences=False),
    Dropout(0.2),

    # Dense kecil sebagai transisi ke output
    Dense(units=16, activation='relu'),

    # Output: 1 angka = prediksi vol besok
    Dense(units=1)
])

model.compile(optimizer='adam', loss='mean_squared_error', metrics=['mae'])
model.summary()

# ============================================================
# 7. CALLBACKS (Early Stopping + Learning Rate Scheduler)
# ============================================================
callbacks = [
    # Hentikan training kalau val_loss tidak turun 10 epoch berturut-turut
    # restore_best_weights=True → kembalikan bobot terbaik sebelum overfit
    EarlyStopping(
        monitor='val_loss',
        patience=10,
        restore_best_weights=True,
        verbose=1
    ),

    # Kurangi learning rate 50% kalau val_loss stuck 5 epoch
    # Mencegah model "mandek" di local minimum
    ReduceLROnPlateau(
        monitor='val_loss',
        factor=0.5,
        patience=5,
        min_lr=1e-6,
        verbose=1
    )
]

# ============================================================
# 8. TRAINING
# ============================================================
print("\nMemulai Training dengan Early Stopping (max 100 epochs)...")
history = model.fit(
    X_train, Y_train,
    epochs=100,
    batch_size=32,
    validation_split=0.10,  # 10% dari train jadi validasi internal
    callbacks=callbacks,
    verbose=1
)

# ============================================================
# 9. EVALUASI OUT-OF-SAMPLE
# ============================================================
print("\n" + "="*55)
print("  EVALUASI MODEL — DATA TEST (BELUM PERNAH DILIHAT AI)")
print("="*55)

Y_pred_scaled = model.predict(X_test)
Y_pred  = target_scaler.inverse_transform(Y_pred_scaled).flatten()
Y_actual = target_scaler.inverse_transform(Y_test.reshape(-1, 1)).flatten()

rmse    = np.sqrt(mean_squared_error(Y_actual, Y_pred))
mae     = mean_absolute_error(Y_actual, Y_pred)

# Directional Accuracy: apakah arah vol besok benar? (naik/turun)
dir_actual = np.diff(Y_actual) > 0
dir_pred   = np.diff(Y_pred)   > 0
dir_acc    = np.mean(dir_actual == dir_pred) * 100

print(f"  RMSE             : {rmse:.4f}%")
print(f"  MAE              : {mae:.4f}%")
print(f"  Directional Acc  : {dir_acc:.2f}%   (baseline random = 50%)")
print("="*55)

# ============================================================
# 10. PREDIKSI BESOK
# ============================================================
X_besok  = all_features_scaled[-LOOK_BACK:].reshape(1, LOOK_BACK, n_features)
vol_besok = target_scaler.inverse_transform(model.predict(X_besok))[0][0]
vol_today = df['RV_GK'].iloc[-1]
delta     = vol_besok - vol_today
arah      = "↑ NAIK" if delta > 0 else "↓ TURUN"

print(f"\n{'='*55}")
print(f"  PREDIKSI VOL BESOK  : {vol_besok:.2f}%")
print(f"  VOL AKTUAL HARI INI : {vol_today:.2f}%")
print(f"  DELTA               : {delta:+.2f}%  {arah}")
print(f"{'='*55}\n")

# ============================================================
# 11. VISUALISASI — 3 Panel
# ============================================================
test_dates = df.index[split_idx + LOOK_BACK:]

fig = make_subplots(
    rows=3, cols=1,
    subplot_titles=(
        f'Prediksi vs Aktual — Test Set ({test_dates[0].date()} → {test_dates[-1].date()})',
        'Training & Validation Loss',
        'Error per Hari (Prediksi − Aktual)'
    ),
    row_heights=[0.55, 0.25, 0.20],
    vertical_spacing=0.10
)

# --- Panel 1: Aktual vs Prediksi ---
fig.add_trace(go.Scatter(
    x=test_dates, y=Y_actual,
    name='Aktual (GK Vol)',
    line=dict(color='#FF8C00', width=2)
), row=1, col=1)

fig.add_trace(go.Scatter(
    x=test_dates, y=Y_pred,
    name='Prediksi LSTM',
    line=dict(color='#FF00FF', width=1.5, dash='dash')
), row=1, col=1)

# --- Panel 2: Loss Curve ---
epochs_range = list(range(1, len(history.history['loss']) + 1))
fig.add_trace(go.Scatter(
    x=epochs_range, y=history.history['loss'],
    name='Train Loss',
    line=dict(color='#00FFFF', width=1.5)
), row=2, col=1)

fig.add_trace(go.Scatter(
    x=epochs_range, y=history.history['val_loss'],
    name='Val Loss',
    line=dict(color='#FF4444', width=1.5)
), row=2, col=1)

# --- Panel 3: Daily Error ---
error = Y_pred - Y_actual
fig.add_trace(go.Bar(
    x=test_dates, y=error,
    name='Error',
    marker_color=np.where(error > 0, '#FF4444', '#44FF88')
), row=3, col=1)

fig.add_hline(y=0, line_dash='dash', line_color='white', opacity=0.4, row=3, col=1)

fig.update_layout(
    title=dict(
        text=f'LSTM Vol Forecaster v2  |  RMSE: {rmse:.3f}%  |  MAE: {mae:.3f}%  |  Dir Acc: {dir_acc:.1f}%',
        font=dict(size=14)
    ),
    template='plotly_dark',
    hovermode='x unified',
    height=800,
    legend=dict(orientation='h', y=1.02)
)
fig.update_yaxes(title_text='Vol (%)',   row=1, col=1)
fig.update_yaxes(title_text='MSE Loss', row=2, col=1)
fig.update_yaxes(title_text='Error (%)', row=3, col=1)
fig.update_xaxes(title_text='Epoch',    row=2, col=1)

fig.show()