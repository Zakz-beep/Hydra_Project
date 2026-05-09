import yfinance as yf
import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import LSTM, Dense, Dropout
import plotly.graph_objects as go
import tensorflow as tf
import warnings
warnings.filterwarnings('ignore')

# Biar hasilnya nggak berubah-ubah setiap di-run (Reproducible)
tf.random.set_seed(42)
np.random.seed(42)

# ==========================================
# 1. UNDUH DATA & HITUNG VOLATILITAS (GK)
# ==========================================
print("Mengunduh data 8 tahun S&P 500...")
data = yf.download('^GSPC', start='2010-05-01', end='2026-05-01')

log_hl = np.log(data['High'] / data['Low'])
log_co = np.log(data['Close'] / data['Open'])
gk_variance = 0.5 * (log_hl**2) - (2 * np.log(2) - 1) * (log_co**2)
data['RV_Daily'] = np.sqrt(gk_variance * 252) * 100

# Ambil datanya saja (buang NaN)
df = data.dropna()
rv_values = df['RV_Daily'].values.reshape(-1, 1)

# ==========================================
# 2. SCALING DATA (Wajib Buat AI)
# ==========================================
# Kecilkan angka ke rentang 0 sampai 1
scaler = MinMaxScaler(feature_range=(0, 1))
scaled_data = scaler.fit_transform(rv_values)

# ==========================================
# 3. MEMBUAT SEQUENCE (Data 3D)
# ==========================================
look_back = 22  # AI disuruh melihat 22 hari ke belakang untuk nebak besok

X, Y = [], []
for i in range(len(scaled_data) - look_back):
    X.append(scaled_data[i:(i + look_back), 0])
    Y.append(scaled_data[i + look_back, 0])

X, Y = np.array(X), np.array(Y)

# Reshape X menjadi bentuk 3D: [Jumlah Sampel, Time Steps, Jumlah Fitur]
X = np.reshape(X, (X.shape[0], X.shape[1], 1))

# ==========================================
# 4. MEMBANGUN ARSITEKTUR OTAK AI (LSTM)
# ==========================================
print("\nMembangun Arsitektur LSTM...")
model = Sequential()

# Layer Otak Utama (LSTM dengan 50 neuron)
model.add(LSTM(units=50, return_sequences=False, input_shape=(X.shape[1], 1)))

# Layer Output (Menebak 1 angka untuk besok)
model.add(Dense(units=1))

# Kompilasi otak (optimizer Adam, ukur kesalahan pakai Mean Squared Error)
model.compile(optimizer='adam', loss='mean_squared_error')

# ==========================================
# 5. TRAINING (Proses Belajar AI)
# ==========================================
print("Memulai proses belajar (Training). Harap tunggu...")
# Epochs = AI akan mengulang pelajaran sebanyak 30 kali
model.fit(X, Y, epochs=30, batch_size=32, verbose=1)

# ==========================================
# 6. PREDIKSI (FORECAST BESOK)
# ==========================================
# Ambil 22 hari terakhir dari data asli untuk bahan tebakan besok
last_22_days = scaled_data[-look_back:]
X_besok = np.array([last_22_days])
X_besok = np.reshape(X_besok, (X_besok.shape[0], X_besok.shape[1], 1))

# AI menebak dalam skala 0-1
prediksi_scaled = model.predict(X_besok)

# Balikin tebakan ke skala volatilitas persen (%) aslinya
vol_besok = scaler.inverse_transform(prediksi_scaled)[0][0]

print("\n" + "="*40)
print(f">> PREDIKSI AI (LSTM) UNTUK BESOK: {vol_besok:.2f}% <<")
print("="*40 + "\n")

# ==========================================
# 7. VISUALISASI KERJA AI 1 TAHUN TERAKHIR
# ==========================================
# AI menebak seluruh histori untuk dilihat grafiknya
semua_prediksi_scaled = model.predict(X)
semua_prediksi_asli = scaler.inverse_transform(semua_prediksi_scaled)

# Buat DataFrame untuk Plotting (1 tahun terakhir = 252 hari)
df_plot = df.iloc[look_back:].copy()
df_plot['Prediksi_LSTM'] = semua_prediksi_asli

data_plot = df_plot.tail(252)

fig = go.Figure()
fig.add_trace(go.Scatter(x=data_plot.index, y=data_plot['RV_Daily'], 
                         name='Aktual', line=dict(color='orange', width=2)))

fig.add_trace(go.Scatter(x=data_plot.index, y=data_plot['Prediksi_LSTM'], 
                         name='Prediksi LSTM', line=dict(color='magenta', width=2, dash='dash')))

fig.update_layout(
    title='AI in Action: LSTM Model Tracking (1 Tahun Terakhir)',
    xaxis_title='Tanggal',
    yaxis_title='Volatilitas Tahunan (%)',
    template='plotly_dark', hovermode='x unified'
)

fig.show()