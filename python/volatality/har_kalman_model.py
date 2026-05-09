"""
har_kalman_model.py — Kalman HAR-RV-CJ Volatility Engine
==========================================================
API-ready class for:
  - Intraday RV decomposition  (Continuous + Jump via BPV)
  - Range-based estimators     (Yang-Zhang, Garman-Klass)
  - HAR feature engineering    (daily / weekly / monthly lags)
  - Kalman Filter state-space  (time-varying betas)
  - Tomorrow's volatility forecast
  - Full error metrics         (R², MSE, RMSE, MAE in log-RV & vol% space)

Dependencies: numpy, pandas, yfinance, pykalman, scikit-learn
"""

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import yfinance as yf
from pykalman import KalmanFilter
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from typing import Optional


# ─── Constants ────────────────────────────────────────────────────────────────

WINDOW_VOL  = 20
OBS_NOISE   = 0.01
TRANS_NOISE = 1e-4
X_COLS      = ["log_C_d", "log_C_w", "log_C_m", "log_J_d", "log_J_w", "log_J_m"]
N_STATES    = 7   # intercept + 6 HAR features


# ─── Helper: RV decomposition from intraday data ─────────────────────────────

def _calc_rv_components(x: pd.Series) -> pd.Series:
    """Compute Realized Variance (RV) and Bipower Variation (BPV) from
    intraday log-returns for a single day."""
    r = x.values
    if len(r) < 2:
        return pd.Series({"RV": np.nan, "BPV": np.nan})
    rv  = np.sum(r ** 2)
    bpv = (np.pi / 2) * np.sum(np.abs(r[1:]) * np.abs(r[:-1]))
    return pd.Series({"RV": rv, "BPV": bpv})


# ─── Main Model Class ────────────────────────────────────────────────────────

class KalmanHARCJModel:
    """
    Kalman HAR-RV-CJ Volatility Forecasting Model.

    Fits a state-space model where HAR-CJ coefficients (betas) evolve
    over time via a Kalman Filter, allowing adaptive tracking of regime
    shifts between continuous-dominated and jump-dominated volatility.

    Usage:
        model = KalmanHARCJModel()
        result = model.run(ticker="SPY")
    """

    def __init__(self, window_vol: int = WINDOW_VOL,
                 obs_noise: float = OBS_NOISE,
                 trans_noise: float = TRANS_NOISE):
        self.window_vol  = window_vol
        self.obs_noise   = obs_noise
        self.trans_noise = trans_noise

        # Populated during run()
        self.state_means = None
        self.betas_df    = None
        self.train_df    = None
        self.model_df    = None

    # ── Step 1: Fetch data ────────────────────────────────────────────────

    def _fetch_data(self, ticker: str, period: str = "730d"):
        """Download intraday (1h) and daily data from yfinance."""
        df_intraday = yf.download(ticker, period=period, interval="1h", progress=False)
        df_daily    = yf.download(ticker, period=period, interval="1d", progress=False)

        for df in [df_intraday, df_daily]:
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

        if df_intraday.empty:
            raise ValueError(f"No intraday data for {ticker}")
        if df_daily.empty:
            raise ValueError(f"No daily data for {ticker}")

        df_daily["Return(%)"] = df_daily["Close"].pct_change() * 100
        return df_intraday, df_daily

    # ── Step 2: Intraday RV decomposition (C + J) ────────────────────────

    def _decompose_rv(self, df_intraday: pd.DataFrame) -> pd.DataFrame:
        """Decompose realized variance into Continuous (C) and Jump (J)."""
        df_intraday = df_intraday.copy()
        df_intraday["log_ret"] = np.log(
            df_intraday["Close"] / df_intraday["Close"].shift(1)
        )
        df_intraday.dropna(inplace=True)

        daily_data = (
            df_intraday.groupby(df_intraday.index.date)["log_ret"]
            .apply(_calc_rv_components)
            .unstack()
        )
        daily_data["C"] = daily_data["BPV"]
        daily_data["J"] = np.maximum(daily_data["RV"] - daily_data["BPV"], 0)
        return daily_data

    # ── Step 3: Range-based estimators (Yang-Zhang, Garman-Klass) ────────

    def _range_estimators(self, df_daily: pd.DataFrame) -> pd.DataFrame:
        """Add Yang-Zhang and Garman-Klass columns to daily DataFrame."""
        df = df_daily.copy()
        w = self.window_vol

        log_ho     = np.log(df["High"]  / df["Open"])
        log_lo     = np.log(df["Low"]   / df["Open"])
        log_co     = np.log(df["Close"] / df["Open"])
        log_oc_lag = np.log(df["Open"]  / df["Close"].shift(1))
        log_hl_sq  = np.log(df["High"]  / df["Low"]) ** 2

        V_rs = (log_ho * (log_ho - log_co) + log_lo * (log_lo - log_co)).rolling(w).mean()
        V_o  = log_oc_lag.rolling(w).var(ddof=1)
        V_c  = log_co.rolling(w).var(ddof=1)
        k    = 0.34 / (1.34 + (w + 1) / (w - 1))

        df["Yang_Zhang"]   = V_o + k * V_c + (1 - k) * V_rs
        df["Garman_Klass"] = (0.5 * log_hl_sq - (2 * np.log(2) - 1) * log_co**2).rolling(w).mean()
        return df

    # ── Step 4: HAR feature engineering ───────────────────────────────────

    def _build_features(self, daily_data: pd.DataFrame,
                        df_daily: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Build HAR feature matrix (d/w/m lags on C and J)."""
        daily_data = daily_data.copy()
        daily_data.index = pd.to_datetime(daily_data.index)

        model_df = daily_data.join(
            df_daily[["Open", "Close", "Return(%)", "Yang_Zhang", "Garman_Klass"]],
            how="inner",
        ).dropna()

        for col in ["RV", "C", "J"]:
            model_df[f"log_{col}"] = np.log(model_df[col] + 1e-8)

        for comp in ["C", "J"]:
            lag = model_df[f"log_{comp}"].shift(1)
            model_df[f"log_{comp}_d"] = lag
            model_df[f"log_{comp}_w"] = lag.rolling(5).mean()
            model_df[f"log_{comp}_m"] = lag.rolling(22).mean()

        train_df = model_df.dropna().copy()
        return model_df, train_df

    # ── Step 5: Kalman Filter (time-varying betas) ────────────────────────

    def _fit_kalman(self, train_df: pd.DataFrame):
        """Run Kalman Filter on HAR feature matrix."""
        X_feat   = train_df[X_COLS].values
        obs_mat  = np.hstack([np.ones((len(X_feat), 1)), X_feat])
        obs_mat_kf = obs_mat[:, np.newaxis, :]
        y = train_df["log_RV"].values

        kf = KalmanFilter(
            n_dim_obs=1, n_dim_state=N_STATES,
            initial_state_mean=np.zeros(N_STATES),
            initial_state_covariance=np.ones((N_STATES, N_STATES)),
            transition_matrices=np.eye(N_STATES),
            observation_matrices=obs_mat_kf,
            observation_covariance=self.obs_noise,
            transition_covariance=np.eye(N_STATES) * self.trans_noise,
        )
        state_means, _ = kf.filter(y)

        # Store derived columns
        train_df["Forecast_log_RV"]   = np.sum(state_means * obs_mat, axis=1)
        train_df["Kalman_HAR_CJ(%)"]  = np.sqrt(np.exp(train_df["Forecast_log_RV"])) * 100
        train_df["YZ_24H(%)"]         = np.sqrt(train_df["Yang_Zhang"]) * 100
        train_df["GK_Intraday(%)"]    = np.sqrt(train_df["Garman_Klass"]) * 100
        train_df["Actual_Vol(%)"]     = np.sqrt(train_df["RV"]) * 100

        betas_df = pd.DataFrame(
            state_means,
            index=train_df.index,
            columns=["β0_intercept", "βC_d", "βC_w", "βC_m", "βJ_d", "βJ_w", "βJ_m"],
        )

        self.state_means = state_means
        self.betas_df    = betas_df
        self.train_df    = train_df
        return state_means, betas_df

    # ── Step 6: Error metrics ─────────────────────────────────────────────

    def _compute_metrics(self, train_df: pd.DataFrame) -> dict:
        """Compute R², MSE, RMSE, MAE in both log-RV and vol% space."""
        y_true_log = train_df["log_RV"].values
        y_pred_log = train_df["Forecast_log_RV"].values

        y_true_vol = np.sqrt(np.exp(y_true_log)) * 100
        y_pred_vol = np.sqrt(np.exp(y_pred_log)) * 100

        return {
            "r2_log_rv":   float(r2_score(y_true_log, y_pred_log)),
            "mse_log_rv":  float(mean_squared_error(y_true_log, y_pred_log)),
            "rmse_log_rv": float(np.sqrt(mean_squared_error(y_true_log, y_pred_log))),
            "mae_log_rv":  float(mean_absolute_error(y_true_log, y_pred_log)),
            "r2_vol_pct":   float(r2_score(y_true_vol, y_pred_vol)),
            "mse_vol_pct":  float(mean_squared_error(y_true_vol, y_pred_vol)),
            "rmse_vol_pct": float(np.sqrt(mean_squared_error(y_true_vol, y_pred_vol))),
            "mae_vol_pct":  float(mean_absolute_error(y_true_vol, y_pred_vol)),
        }

    # ── Step 7: Tomorrow forecast ─────────────────────────────────────────

    def _forecast_tomorrow(self, model_df: pd.DataFrame,
                           state_means: np.ndarray) -> dict:
        """Compute next-day volatility forecast from latest Kalman betas."""
        latest_betas = state_means[-1]
        last = model_df.iloc[-1]

        X_tomorrow = np.array([
            1,
            last["log_C"],
            model_df["log_C"].rolling(5).mean().iloc[-1],
            model_df["log_C"].rolling(22).mean().iloc[-1],
            last["log_J"],
            model_df["log_J"].rolling(5).mean().iloc[-1],
            model_df["log_J"].rolling(22).mean().iloc[-1],
        ])

        forecast_log_rv  = float(np.dot(latest_betas, X_tomorrow))
        forecast_vol_pct = float(np.sqrt(np.exp(forecast_log_rv)) * 100)
        jump_dominant    = bool(latest_betas[4] > latest_betas[1])

        return {
            "forecast_log_rv":  forecast_log_rv,
            "forecast_vol_pct": forecast_vol_pct,
            "jump_dominant":    jump_dominant,
            "regime": "JUMP-REACTIVE" if jump_dominant else "TREND-SMOOTH",
            "betas": {
                "intercept": float(latest_betas[0]),
                "C_d": float(latest_betas[1]),
                "C_w": float(latest_betas[2]),
                "C_m": float(latest_betas[3]),
                "J_d": float(latest_betas[4]),
                "J_w": float(latest_betas[5]),
                "J_m": float(latest_betas[6]),
            },
        }

    # ── Public: full pipeline ─────────────────────────────────────────────

    def run(self, ticker: str = "SPY", period: str = "730d",
            lookback: int = 120) -> dict:
        """
        Execute the full Kalman HAR-RV-CJ pipeline.

        Args:
            ticker:   Equity ticker symbol.
            period:   yfinance period string (default 730d = ~2 years).
            lookback: Number of recent days to include in time-series output.

        Returns:
            JSON-serializable dict with forecast, metrics, time-series, betas.
        """
        # 1. Fetch data
        df_intraday, df_daily = self._fetch_data(ticker, period)

        # 2. Intraday RV decomposition
        daily_data = self._decompose_rv(df_intraday)

        # 3. Range-based estimators
        df_daily = self._range_estimators(df_daily)

        # 4. HAR feature engineering
        model_df, train_df = self._build_features(daily_data, df_daily)
        self.model_df = model_df

        if len(train_df) < 30:
            raise ValueError(
                f"Not enough aligned data for Kalman HAR-CJ "
                f"(got {len(train_df)}, need >= 30 bars)."
            )

        # 5. Kalman filter
        state_means, betas_df = self._fit_kalman(train_df)

        # 6. Error metrics
        metrics = self._compute_metrics(train_df)

        # 7. Tomorrow forecast
        forecast = self._forecast_tomorrow(model_df, state_means)

        # ── Build JSON response ───────────────────────────────────────────
        n = min(len(train_df), lookback)
        ts_slice  = train_df.tail(n)
        beta_slice = betas_df.tail(n)

        # Volatility time series
        vol_series = []
        for idx, row in ts_slice.iterrows():
            vol_series.append({
                "date":              idx.strftime("%Y-%m-%d"),
                "actual_vol_pct":    round(float(row["Actual_Vol(%)"]), 6),
                "kalman_har_cj_pct": round(float(row["Kalman_HAR_CJ(%)"]), 6),
                "yz_24h_pct":        round(float(row["YZ_24H(%)"]), 6),
                "gk_intraday_pct":   round(float(row["GK_Intraday(%)"]), 6),
                "return_pct":        round(float(row["Return(%)"]), 6),
                "close":             round(float(row["Close"]), 4),
                "log_c":             round(float(row["log_C"]), 6),
                "log_j":             round(float(row["log_J"]), 6),
            })

        # Time-varying betas series
        betas_series = []
        for idx, row in beta_slice.iterrows():
            betas_series.append({
                "date":         idx.strftime("%Y-%m-%d"),
                "intercept":    round(float(row["β0_intercept"]), 6),
                "beta_C_d":     round(float(row["βC_d"]), 6),
                "beta_C_w":     round(float(row["βC_w"]), 6),
                "beta_C_m":     round(float(row["βC_m"]), 6),
                "beta_J_d":     round(float(row["βJ_d"]), 6),
                "beta_J_w":     round(float(row["βJ_w"]), 6),
                "beta_J_m":     round(float(row["βJ_m"]), 6),
            })

        # Calibration table (last 7 days)
        cal_slice = train_df.tail(7)
        calibration_table = []
        for idx, row in cal_slice.iterrows():
            calibration_table.append({
                "date":              idx.strftime("%Y-%m-%d"),
                "open":              round(float(row["Open"]), 4),
                "close":             round(float(row["Close"]), 4),
                "return_pct":        round(float(row["Return(%)"]), 4),
                "yz_24h_pct":        round(float(row["YZ_24H(%)"]), 4),
                "gk_intraday_pct":   round(float(row["GK_Intraday(%)"]), 4),
                "kalman_har_cj_pct": round(float(row["Kalman_HAR_CJ(%)"]), 4),
            })

        # Current state
        last_row = train_df.iloc[-1]
        current_state = {
            "date":              train_df.index[-1].strftime("%Y-%m-%d"),
            "actual_vol_pct":    round(float(last_row["Actual_Vol(%)"]), 4),
            "kalman_har_cj_pct": round(float(last_row["Kalman_HAR_CJ(%)"]), 4),
            "yz_24h_pct":        round(float(last_row["YZ_24H(%)"]), 4),
            "gk_intraday_pct":   round(float(last_row["GK_Intraday(%)"]), 4),
        }

        return {
            "model_spec": {
                "type": "Kalman HAR-RV-CJ",
                "n_states": N_STATES,
                "obs_noise": self.obs_noise,
                "trans_noise": self.trans_noise,
                "window_vol": self.window_vol,
                "n_observations": len(train_df),
                "date_range": (
                    f"{train_df.index[0].strftime('%Y-%m-%d')} to "
                    f"{train_df.index[-1].strftime('%Y-%m-%d')}"
                ),
            },
            "current_state": current_state,
            "forecast": forecast,
            "metrics": metrics,
            "calibration_table": calibration_table,
            "vol_series": vol_series,
            "betas_series": betas_series,
        }


# ─── Convenience wrapper ─────────────────────────────────────────────────────

def run_kalman_har_cj(ticker: str = "SPY", period: str = "730d",
                      lookback: int = 120,
                      obs_noise: float = OBS_NOISE,
                      trans_noise: float = TRANS_NOISE) -> dict:
    """One-liner to run Kalman HAR-CJ and get JSON-ready output."""
    model = KalmanHARCJModel(obs_noise=obs_noise, trans_noise=trans_noise)
    return model.run(ticker=ticker, period=period, lookback=lookback)
