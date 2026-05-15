import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import statsmodels.api as sm
plt.style.use('dark_background') # Style ala terminal pro

# ==========================================
# 1. GENERATE SYNTHETIC RV DATA (SIMULASI)
# ==========================================
# Membuat data Realized Volatility dengan efek "Clustering" (market memory)
np.random.seed(42)
n_days = 250
rv_base = np.zeros(n_days)
rv_base[0] = 0.01

# Bikin data volatilitas yang realistis (kadang meledak, lalu turun pelan-pelan)
for t in range(1, n_days):
    shock = np.random.normal(0, 0.005)
    rv_base[t] = 0.002 + 0.8 * rv_base[t-1] + shock
    if rv_base[t] < 0.001: rv_base[t] = 0.001 # RV gak boleh negatif

df = pd.DataFrame({'RV': rv_base}, index=pd.date_range(start='2025-01-01', periods=n_days))

# ==========================================
# 2. HAR-RV LOGIC (ENGINE)
# ==========================================
# RV Harian (Daily) = RV kemarin
df['RV_Daily'] = df['RV'].shift(1)

# RV Mingguan (Weekly) = Rata-rata 5 hari terakhir (dari kemarin)
df['RV_Weekly'] = df['RV_Daily'].rolling(window=5).mean()

# RV Bulanan (Monthly) = Rata-rata 22 hari terakhir (dari kemarin)
df['RV_Monthly'] = df['RV_Daily'].rolling(window=22).mean()

# Drop NaN karena proses rolling window
df_clean = df.dropna()

# ==========================================
# 3. OLS REGRESSION (TRAINING MODEL)
# ==========================================
# Variabel X (Daily, Weekly, Monthly) dan Y (RV Hari Ini)
X = df_clean[['RV_Daily', 'RV_Weekly', 'RV_Monthly']]
X = sm.add_constant(X)
y = df_clean['RV']

# Fit Model
har_model = sm.OLS(y, X).fit()
df_clean.loc[:, 'HAR_Predict'] = har_model.predict(X)

# Prediksi Besok
last_row = df_clean.iloc[-1]
next_forecast = har_model.params['const'] + \
                har_model.params['RV_Daily'] * last_row['RV'] + \
                har_model.params['RV_Weekly'] * df_clean['RV'].iloc[-5:].mean() + \
                har_model.params['RV_Monthly'] * df_clean['RV'].iloc[-22:].mean()

# ==========================================
# 4. DASHBOARD VISUALIZATION
# ==========================================
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={'height_ratios': [2, 1]})
fig.suptitle('HAR-RV VOLATILITY ENGINE', fontsize=20, fontweight='bold', color='cyan')

# PANEL 1: Actual vs Predicted & Forecast
ax1.plot(df_clean.index, df_clean['RV'], label='Actual Realized Volatility (RV)', color='#ff3366', linewidth=2, alpha=0.8)
ax1.plot(df_clean.index, df_clean['HAR_Predict'], label='HAR-RV Model Fit', color='#00ffcc', linewidth=2, linestyle='--')
ax1.axhline(y=next_forecast, color='#ffff00', linestyle=':', linewidth=2, label=f'Tomorrow Forecast: {next_forecast:.4f}')

ax1.set_title('Volatility Forecasting & Mean Reversion Tracking', fontsize=14)
ax1.set_ylabel('Volatility Limit')
ax1.legend(loc='upper right', facecolor='black', edgecolor='white')
ax1.grid(color='gray', linestyle='-.', linewidth=0.3)

# PANEL 2: The "Memory" Components (Heterogeneous Layers)
ax2.plot(df_clean.index, df_clean['RV_Daily'], label='Daily (Scalpers)', color='grey', linewidth=1, alpha=0.5)
ax2.plot(df_clean.index, df_clean['RV_Weekly'], label='Weekly (Swing Traders)', color='#ff9900', linewidth=2)
ax2.plot(df_clean.index, df_clean['RV_Monthly'], label='Monthly (Institutions)', color='#cc00ff', linewidth=3)

ax2.set_title('Market Memory Components (The Heterogeneous Players)', fontsize=14)
ax2.set_ylabel('Component RV')
ax2.legend(loc='upper right', facecolor='black', edgecolor='white')
ax2.grid(color='gray', linestyle='-.', linewidth=0.3)

plt.tight_layout()
plt.show()

# Print Rangkuman Statistik ala Quant
print("\n" + "="*50)
print(" HAR-RV MODEL PARAMETERS (THE WEIGHTS)")
print("="*50)
print(har_model.summary().tables[1])
print(f"\n=> TOMORROW'S VOLATILITY FORECAST: {next_forecast:.5f}")
print("="*50)