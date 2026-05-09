import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
import matplotlib.pyplot as plt
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

# =============================================================================
# LHAR-CJ v2  —  Yang-Zhang + Parkinson Jump + VIX
# =============================================================================
# CHANGELOG vs v1:
#   [1] RV Estimator : GK  →  Yang-Zhang (handle overnight gap / price jump)
#   [2] Jump Proxy   : rolling mean+2σ threshold  →  YZ - Parkinson
#                      Parkinson hanya capture intraday range (continuous),
#                      sedangkan YZ juga capture overnight gap (jump component).
#                      Decomposition ini punya dasar teoritis yang jelas.
#   [3] +log(VIX_lag): external regressor terkuat untuk next-day RV pada SPY.
#                      Literatur menunjukkan VIX sendiri bisa boost R² ~0.10-0.15.
#   [4] Drop Jump_m  : p-value = 0.821 di v1 → pure noise, removed.
#   [5] Jump scaling : *1e4 agar kondisi numerik OLS lebih sehat (fix cond.no 1.3e6)
#   [6] +Leverage²   : nonlinear asymmetric vol effect (quadratic negative return)
#   [7] +MAPE        : evaluate_model() sekarang print MAPE untuk benchmark intuitif
# =============================================================================

class LHAR_RV_Model:
    def __init__(self, ticker: str, start_date: str, end_date: str, use_vix: bool = True):
        self.ticker     = ticker
        self.start_date = start_date
        self.end_date   = end_date
        self.use_vix    = use_vix
        self.data       = None
        self.model      = None

    # -------------------------------------------------------------------------
    def fetch_data(self) -> pd.DataFrame:
        """Ambil OHLCV dari yfinance + VIX sebagai external regressor."""
        print(f"Mengambil data {self.ticker} dari {self.start_date} hingga {self.end_date}...")
        df = yf.download(self.ticker, start=self.start_date, end=self.end_date, progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)

        if self.use_vix:
            print("Mengambil data ^VIX sebagai external regressor...")
            vix = yf.download("^VIX", start=self.start_date, end=self.end_date, progress=False)
            if isinstance(vix.columns, pd.MultiIndex):
                vix.columns = vix.columns.droplevel(1)
            df['VIX'] = vix['Close']

        self.data = df
        return self.data

    # -------------------------------------------------------------------------
    @staticmethod
    def _yang_zhang_rv(df: pd.DataFrame) -> pd.Series:
        """
        Yang-Zhang (2000) estimator.

        Kelebihan vs Garman-Klass:
          - Handle overnight gap (Open ≠ Close_prev) yang sering terjadi karena
            earnings, news after-hours, atau macro event.
          - Unbiased, minimum-variance estimator untuk OHLC data.

        Formula:
          σ²_YZ = σ²_overnight  +  k * σ²_daytime  +  (1-k) * σ²_RS
          k ≈ 0.34/1.34 ≈ 0.254  (Hansen & Lunde, 2005)
        """
        k        = 0.34 / 1.34  # optimal weight, literature standard

        log_oc   = np.log(df['Open'] / df['Close'].shift(1))  # overnight return
        log_co   = np.log(df['Close'] / df['Open'])           # daytime return

        # Rogers-Satchell: handles drift, unbiased intraday component
        log_ho   = np.log(df['High'] / df['Open'])
        log_lo   = np.log(df['Low']  / df['Open'])
        rs       = (log_ho * (log_ho - log_co) + log_lo * (log_lo - log_co)).clip(lower=0)

        yz = log_oc**2 + k * log_co**2 + (1 - k) * rs
        return yz.clip(lower=1e-12)

    @staticmethod
    def _parkinson_rv(df: pd.DataFrame) -> pd.Series:
        """
        Parkinson (1980) estimator — pure range-based.

        Hanya menggunakan H-L range sehingga:
          - Tidak terpengaruh overnight gap  →  proxy 'continuous' component
          - Lebih efisien dari squared-return untuk estimasi intraday variance

        Formula: σ²_P = (1 / 4·ln2) · (ln H/L)²
        """
        return ((1 / (4 * np.log(2))) * np.log(df['High'] / df['Low'])**2).clip(lower=1e-12)

    # -------------------------------------------------------------------------
    def calculate_features(self) -> pd.DataFrame:
        """Hitung semua fitur model: RV, Continuous, Jump, Leverage, VIX."""
        df = self.data.copy()

        df['Log_Ret'] = np.log(df['Close']).diff()

        # ==================================================================
        # [1] RV ESTIMATORS
        # ==================================================================
        df['RV_yz']   = self._yang_zhang_rv(df)   # total realized variance
        df['RV_park'] = self._parkinson_rv(df)     # intraday continuous proxy
        df['RV']      = df['RV_yz']                # dependent variable target

        df = df.dropna()

        # Lag 1 hari (t-1)
        df['RV_d']   = df['RV'].shift(1)
        df['Park_d'] = df['RV_park'].shift(1)

        # ==================================================================
        # [2] JUMP DECOMPOSITION: YZ vs Parkinson
        # ------------------------------------------------------------------
        # Intuisi:
        #   Parkinson  = variance dari intraday range → pure continuous move
        #   YZ         = total variance termasuk overnight → continuous + jump
        #   Jump       = YZ_lag - Parkinson_lag  (clipped ke 0 jika negatif)
        #
        # Ini secara teoritis lebih solid dari threshold rolling-window karena
        # based on structural difference antar dua estimator, bukan heuristic.
        # ==================================================================
        df['Jump_d']  = (df['RV_d'] - df['Park_d']).clip(lower=0)
        df['Cont_d']  = df['RV_d'] - df['Jump_d']  # ≈ Park_d

        # Heterogeneous components (weekly & monthly)
        df['Cont_w']  = df['Cont_d'].rolling(5).mean()
        df['Cont_m']  = df['Cont_d'].rolling(22).mean()
        df['Jump_w']  = df['Jump_d'].rolling(5).mean()
        # Jump_m DIHAPUS — di v1 p-value = 0.821, kontribusinya pure noise

        # ==================================================================
        # [3] LEVERAGE EFFECT (Asymmetric)
        # ------------------------------------------------------------------
        # Neg_Ret_d  : linear negative return (standard leverage term)
        # Neg_Sq_d   : quadratic — capture nonlinear vol response terhadap
        #              crash besar. Empiris: return -3% bukan cuma 3x lebih
        #              volatile dari -1%, tapi jauh lebih.
        # ==================================================================
        ret_lag          = df['Log_Ret'].shift(1)
        df['Neg_Ret_d']  = ret_lag.clip(upper=0)
        df['Neg_Sq_d']   = df['Neg_Ret_d'] ** 2

        # ==================================================================
        # [4] EXTERNAL REGRESSOR: VIX
        # ------------------------------------------------------------------
        # VIX = market's implied vol → forward-looking, encode ekspektasi
        # pelaku pasar tentang vol ke depan. Dilog karena distribusinya
        # log-normal (sama seperti RV).
        # Literatur (Bekaert & Hoerova, 2014): VIX² = RV + variance risk premium
        # ==================================================================
        if self.use_vix and 'VIX' in df.columns:
            df['Log_VIX_lag'] = np.log(df['VIX'] / 100).shift(1)  # lag 1, normalized

        df = df.dropna()

        # ==================================================================
        # [5] LOG TRANSFORM & SCALING
        # ------------------------------------------------------------------
        # Continuous  : di-log (always positive, log-normal distributed)
        # Jump        : tetap LINEAR (mayoritas = 0, log(0+eps) = -27 → merusak OLS)
        #               tapi di-SCALE *1e4 untuk fix condition number 1.3e6
        # ==================================================================
        eps = 1e-12
        df['Log_RV']      = np.log(df['RV']     + eps)
        df['Log_Cont_d']  = np.log(df['Cont_d'] + eps)
        df['Log_Cont_w']  = np.log(df['Cont_w'] + eps)
        df['Log_Cont_m']  = np.log(df['Cont_m'] + eps)

        df['Jump_d_sc']   = df['Jump_d'] * 1e4   # scaled linear jump daily
        df['Jump_w_sc']   = df['Jump_w'] * 1e4   # scaled linear jump weekly

        self.data = df
        return self.data

    # -------------------------------------------------------------------------
    def fit_model(self, train_ratio: float = 0.8):
        """OLS regression dengan 8-9 features yang semuanya diharapkan signifikan."""
        df = self.data
        Y  = df['Log_RV']

        feature_cols = [
            # Continuous components (log-scale)
            'Log_Cont_d', 'Log_Cont_w', 'Log_Cont_m',
            # Jump components (linear, scaled)
            'Jump_d_sc', 'Jump_w_sc',
            # Leverage (linear + quadratic)
            'Neg_Ret_d', 'Neg_Sq_d',
        ]
        if self.use_vix and 'Log_VIX_lag' in df.columns:
            feature_cols.append('Log_VIX_lag')

        X = sm.add_constant(df[feature_cols])

        split_idx           = int(len(df) * train_ratio)
        self.X_train        = X.iloc[:split_idx]
        self.X_test         = X.iloc[split_idx:]
        self.Y_train        = Y.iloc[:split_idx]
        self.Y_test         = Y.iloc[split_idx:]
        self.dates_test     = df.index[split_idx:]
        self.actual_rv_test = df['RV'].iloc[split_idx:]

        self.model = sm.OLS(self.Y_train, self.X_train).fit()

        print("\n" + "=" * 75)
        print(f"RINGKASAN STATISTIK MODEL LHAR-CJ v2 (YZ + Parkinson + VIX) — {self.ticker}")
        print("=" * 75)
        print(self.model.summary())

    # -------------------------------------------------------------------------
    def evaluate_model(self):
        """Out-of-sample evaluation: MAE, RMSE, dan MAPE."""
        log_pred     = self.model.predict(self.X_test)
        self.rv_pred = np.exp(log_pred)

        mae  = mean_absolute_error(self.actual_rv_test, self.rv_pred)
        rmse = np.sqrt(mean_squared_error(self.actual_rv_test, self.rv_pred))
        mape = np.mean(np.abs((self.actual_rv_test - self.rv_pred) / self.actual_rv_test)) * 100

        print("\n" + "=" * 55)
        print("METRIK EVALUASI (OUT-OF-SAMPLE)")
        print("=" * 55)
        print(f"MAE  : {mae:.6f}")
        print(f"RMSE : {rmse:.6f}")
        print(f"MAPE : {mape:.2f}%  ← benchmark error rata-rata")

    # -------------------------------------------------------------------------
    def plot_results(self):
        """Visualisasi Actual vs Predicted + Residual Plot."""
        residuals = self.actual_rv_test - self.rv_pred

        fig, axes = plt.subplots(2, 1, figsize=(12, 10))

        axes[0].plot(self.dates_test, self.actual_rv_test,
                     label='Actual RV', color='steelblue', alpha=0.7)
        axes[0].plot(self.dates_test, self.rv_pred,
                     label='Predicted RV (LHAR-CJ v2)', color='tomato',
                     alpha=0.85, linestyle='--')
        axes[0].set_title(f'Actual vs Predicted Realized Volatility — {self.ticker}', fontsize=14)
        axes[0].set_ylabel('Variance')
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)

        axes[1].scatter(self.dates_test, residuals, color='mediumpurple', alpha=0.5, s=8)
        axes[1].axhline(0, color='black', linestyle='--')
        axes[1].set_title('Residual Plot (Actual − Predicted)', fontsize=14)
        axes[1].set_ylabel('Error')
        axes[1].grid(True, alpha=0.3)

        plt.tight_layout()
        plt.show()

    # -------------------------------------------------------------------------
    def forecast_tomorrow(self):
        """Backtest kemarin + forecast besok dalam annualized volatility."""
        if self.model is None:
            print("Model belum di-fit.")
            return

        eps = 1e-12

        def _build_x(row: pd.Series) -> list:
            """Susun feature vector sesuai urutan yang dipakai saat fit."""
            x = [
                1.0,                                  # const
                np.log(row['Cont_d'] + eps),          # Log_Cont_d
                np.log(row['Cont_w'] + eps),          # Log_Cont_w
                np.log(row['Cont_m'] + eps),          # Log_Cont_m
                row['Jump_d'] * 1e4,                  # Jump_d_sc
                row['Jump_w'] * 1e4,                  # Jump_w_sc
                row['Neg_Ret_d'],                     # Neg_Ret_d
                row['Neg_Sq_d'],                      # Neg_Sq_d
            ]
            if self.use_vix and 'Log_VIX_lag' in self.data.columns:
                x.append(row['Log_VIX_lag'])          # Log_VIX_lag
            return x

        # --- Evaluasi prediksi kemarin (t-1) ---
        actual_rv_yesterday = self.data.iloc[-1]['RV']
        row_t2              = self.data.iloc[-2]      # input untuk prediksi t-1

        pred_rv_yesterday   = np.exp(self.model.predict([_build_x(row_t2)])[0])
        abs_error           = abs(actual_rv_yesterday - pred_rv_yesterday)
        pct_error           = (abs_error / actual_rv_yesterday) * 100

        # --- Forecast besok (t+1) ---
        last_row            = self.data.iloc[-1]
        pred_rv_next        = np.exp(self.model.predict([_build_x(last_row)])[0])

        ann_vol_actual      = np.sqrt(actual_rv_yesterday * 252) * 100
        ann_vol_next        = np.sqrt(pred_rv_next        * 252) * 100
        diff                = ann_vol_next - ann_vol_actual

        # --- Output ---
        print("\n" + "=" * 65)
        print("⚡ MONITORING LHAR-CJ v2 — BACKTEST")
        print("=" * 65)
        print(f"Evaluasi Prediksi untuk : {self.data.index[-1].strftime('%Y-%m-%d')}")
        print(f"Prediksi Kemarin        : {pred_rv_yesterday:.8f}")
        print(f"Realisasi Kemarin       : {actual_rv_yesterday:.8f}")

        status = "OVERESTIMATED 🔴" if pred_rv_yesterday > actual_rv_yesterday else "UNDERESTIMATED 🔵"
        target = "✅ DALAM TARGET (<20%)" if pct_error < 20 else "⚠️ MELEBIHI TARGET (>20%)"
        print(f"Error Melesat           : {pct_error:.2f}% {target}  ({status})")

        if last_row['Jump_d'] > 0:
            print(f"⚠️  DETEKSI JUMP        : TERJADI SHOCK! (Jump: {last_row['Jump_d']:.8f})")
        else:
            print(f"✅  DETEKSI JUMP        : Pasar Organik (tidak ada shock ekstrim)")

        print("\n" + "=" * 65)
        print("📈 OUT-OF-SAMPLE FORECAST UNTUK BESOK")
        print("=" * 65)
        print(f"Baseline Volatility (Kemarin): {ann_vol_actual:.2f}%")
        print(f"Predicted Volatility (Besok) : {ann_vol_next:.2f}%")
        print("-" * 65)
        arah = "NAIK (Expansion) 🔼" if diff > 0 else "TURUN (Contraction) 🔽"
        print(f"Ekspektasi Pergerakan Besok  : {arah} ({diff:+.2f}%)")
        print("=" * 65)

        return ann_vol_next


# =============================================================================
# EKSEKUSI
# =============================================================================
if __name__ == "__main__":
    TICKER     = "SPY"
    START_DATE = "2010-01-01"
    END_DATE   = "2026-04-01"

    lhar = LHAR_RV_Model(ticker=TICKER, start_date=START_DATE, end_date=END_DATE, use_vix=True)

    lhar.fetch_data()
    lhar.calculate_features()
    lhar.fit_model(train_ratio=0.8)
    lhar.evaluate_model()
    lhar.plot_results()
    lhar.forecast_tomorrow()