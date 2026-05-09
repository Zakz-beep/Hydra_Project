"""
har_cj_model.py — HAR-CJ Volatility Forecasting Engine
========================================================
Clean, API-ready class for:
  - Garman-Klass / Parkinson / Naive RV estimation
  - Bipower Variation & Jump/Continuous decomposition
  - HAR-CJ OLS forecasting (daily/weekly/monthly lags)
  - Cross-asset feature engineering (VIX, VRP, TLT, HYG, DXY)
  - ElasticNet walk-forward (optional, heavy computation)

Designed for < 1 second response when used in API mode (OLS path).

Dependencies: numpy, pandas, yfinance, scikit-learn, scipy, statsmodels
"""

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.linear_model import LinearRegression, ElasticNetCV
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
from scipy import stats
import statsmodels.api as sm
from typing import Optional

TRADING_DAYS = 252


# ─── RV Estimators ────────────────────────────────────────────────────────────

def garman_klass_rv(open_: pd.Series, high: pd.Series,
                    low: pd.Series, close: pd.Series) -> pd.Series:
    """Garman-Klass (1980) OHLC-based RV estimator. Annualized."""
    log_hl = np.log(high / low)
    log_co = np.log(close / open_)
    return (0.5 * log_hl**2 - (2 * np.log(2) - 1) * log_co**2) * TRADING_DAYS


def parkinson_rv(high: pd.Series, low: pd.Series) -> pd.Series:
    """Parkinson (1980) high-low range RV estimator. Annualized."""
    log_hl = np.log(high / low)
    return (log_hl ** 2 / (4 * np.log(2))) * TRADING_DAYS


def naive_rv(close: pd.Series) -> pd.Series:
    """Naive close-to-close squared log-return RV. Annualized."""
    log_ret = np.log(close / close.shift(1))
    return (log_ret ** 2) * TRADING_DAYS


def bipower_variation(close: pd.Series) -> pd.Series:
    """BPV (Barndorff-Nielsen & Shephard 2004). Jump-robust. Annualized."""
    log_ret = np.log(close / close.shift(1)).abs()
    bpv = (np.pi / 2) * log_ret * log_ret.shift(1)
    return bpv * TRADING_DAYS


def jump_component(rv: pd.Series, bpv: pd.Series) -> pd.Series:
    """J = max(RV - BPV, 0)"""
    return np.maximum(rv - bpv, 0.0)


def continuous_component(rv: pd.Series, jump: pd.Series) -> pd.Series:
    """C = RV - J"""
    return rv - jump


# ─── HAR Lag Builder ──────────────────────────────────────────────────────────

def har_lags(series: pd.Series, prefix: str) -> pd.DataFrame:
    """Build daily / 5-day / 22-day HAR lags."""
    d = series.rename(f"{prefix}_d")
    w = series.rolling(5).mean().rename(f"{prefix}_w")
    m = series.rolling(22).mean().rename(f"{prefix}_m")
    return pd.concat([d, w, m], axis=1)


# ─── Main Model Class ────────────────────────────────────────────────────────

class HARCJModel:
    """
    HAR-CJ Volatility Forecasting Model.

    Usage:
        model = HARCJModel()
        result = model.run(ticker="SPY", period="2y")
    """

    def __init__(self):
        self.rv_gk = None
        self.rv_naive = None
        self.rv_park = None
        self.bpv = None
        self.jump = None
        self.continuous = None
        self.feature_df = None

    def _fetch_ohlcv(self, ticker: str, period: str) -> pd.DataFrame:
        """Download OHLCV data for a single ticker."""
        df = yf.download(ticker, period=period, auto_adjust=True, progress=False)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        df.index = pd.to_datetime(df.index)
        if df.empty:
            raise ValueError(f"No data returned for {ticker}")
        return df

    def _fetch_aux(self, tickers: dict, period: str) -> dict:
        """Download auxiliary tickers (VIX, TLT, etc.)."""
        result = {}
        for name, symbol in tickers.items():
            try:
                df = yf.download(symbol, period=period, auto_adjust=True, progress=False)
                df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
                df.index = pd.to_datetime(df.index)
                if not df.empty:
                    result[name] = df
            except Exception:
                pass
        return result

    def _compute_rv_measures(self, ohlcv: pd.DataFrame) -> None:
        """Compute all RV estimators + Jump/Continuous decomposition."""
        self.rv_gk = garman_klass_rv(ohlcv["Open"], ohlcv["High"],
                                     ohlcv["Low"], ohlcv["Close"])
        self.rv_naive = naive_rv(ohlcv["Close"])
        self.rv_park = parkinson_rv(ohlcv["High"], ohlcv["Low"])
        self.bpv = bipower_variation(ohlcv["Close"])
        self.jump = jump_component(self.rv_gk, self.bpv)
        self.continuous = continuous_component(self.rv_gk, self.jump)

    def _build_features(self, ohlcv: pd.DataFrame,
                        aux: dict) -> tuple[pd.DataFrame, list[str]]:
        """
        Build the full HAR-CJ + cross-asset feature matrix.
        All features lagged 1 day to prevent look-ahead bias.
        """
        # Core HAR lags on C and J
        C_lags = har_lags(self.continuous, "C")
        J_lags = har_lags(self.jump, "J")

        # Log returns
        spy_ret = np.log(ohlcv["Close"] / ohlcv["Close"].shift(1))

        # VIX layer (if available)
        vix_features = []
        if "VIX" in aux:
            vix = aux["VIX"]["Close"].reindex(ohlcv.index).ffill()
            vix_lags = har_lags(vix, "VIX")
            vix_features.append(vix_lags)

            # VRP = (VIX^2 / 252) - GK_RV
            vix_implied_var = (vix ** 2) / TRADING_DAYS
            vrp = (vix_implied_var - self.rv_gk).rename("VRP")
            vrp_w = vrp.rolling(5).mean().rename("VRP_w")
            vix_features.append(vrp.to_frame())
            vix_features.append(vrp_w.to_frame())

            if "VIX3M" in aux:
                vix3m = aux["VIX3M"]["Close"].reindex(ohlcv.index).ffill()
                vix_slope = (vix3m - vix).rename("VIX_slope")
                vix_features.append(vix_slope.to_frame())

        # Leverage effect
        r_neg_d = spy_ret.apply(lambda x: min(x, 0)).rename("r_neg_d")
        r_neg_w = r_neg_d.rolling(5).mean().rename("r_neg_w")

        # Cross-asset returns
        cross_features = []
        for name, etf_name in [("TLT", "TLT"), ("HYG", "HYG"), ("UUP", "UUP")]:
            if name in aux:
                ret = np.log(aux[name]["Close"] / aux[name]["Close"].shift(1))
                ret = ret.reindex(ohlcv.index).ffill()
                cross_features.append(ret.rename(f"{name}_ret"))
                vol_22 = ret.rolling(22).std() * np.sqrt(TRADING_DAYS)
                cross_features.append(vol_22.rename(f"{name}_vol22"))

        # Equity-bond correlation
        if "TLT" in aux:
            tlt_ret = np.log(aux["TLT"]["Close"] / aux["TLT"]["Close"].shift(1))
            tlt_ret = tlt_ret.reindex(ohlcv.index).ffill()
            eq_bond_corr = spy_ret.rolling(22).corr(tlt_ret).rename("eq_bond_corr")
            cross_features.append(eq_bond_corr)

        # Microstructure
        dollar_vol = ohlcv["Close"] * ohlcv["Volume"]
        amihud_d = (spy_ret.abs() / (dollar_vol + 1e-10) * 1e9).rename("Amihud_d")
        volume_ratio = (ohlcv["Volume"] / ohlcv["Volume"].rolling(22).mean()).rename("volume_ratio")

        # Assemble
        parts = [C_lags, J_lags, r_neg_d.to_frame(), r_neg_w.to_frame(),
                 amihud_d.to_frame(), volume_ratio.to_frame()]
        parts.extend(vix_features)
        parts.extend([f.to_frame() if isinstance(f, pd.Series) else f for f in cross_features])

        feat = pd.concat(parts, axis=1)
        feature_cols = list(feat.columns)

        # Target: next-day GK RV
        target = self.rv_gk.shift(-1).rename("RV_target")

        df = pd.concat([feat, target,
                        self.rv_gk.rename("GK_RV"),
                        self.rv_naive.rename("Naive_RV"),
                        self.rv_park.rename("Park_RV"),
                        self.jump.rename("J_raw"),
                        self.continuous.rename("C_raw"),
                        spy_ret.rename("SPY_ret")], axis=1)

        # Add VIX/VRP raw for response
        if "VIX" in aux:
            vix_raw = aux["VIX"]["Close"].reindex(ohlcv.index).ffill().rename("VIX_raw")
            vrp_raw = ((vix_raw ** 2) / TRADING_DAYS - self.rv_gk).rename("VRP_raw")
            df = pd.concat([df, vix_raw, vrp_raw], axis=1)

        # Lag features by 1 day (no look-ahead)
        df[feature_cols] = df[feature_cols].shift(1)

        # Clean
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df.dropna(inplace=True)

        self.feature_df = df
        return df, feature_cols

    def _fit_har_cj_ols(self, df: pd.DataFrame) -> dict:
        """
        Fit HAR-CJ OLS model on C and J lags.
        Returns coefficients, R², and next-day forecast.
        """
        cj_cols = [c for c in ["C_d", "C_w", "C_m", "J_d", "J_w", "J_m"]
                   if c in df.columns]
        X = df[cj_cols].values
        y = df["RV_target"].values

        # Leave last row for pure out-of-sample forecast
        X_train, y_train = X[:-1], y[:-1]
        X_last = X[-1:].reshape(1, -1)

        reg = LinearRegression()
        reg.fit(X_train, y_train)

        fitted = reg.predict(X)
        fitted = np.maximum(fitted, 0)
        next_forecast = float(np.maximum(reg.predict(X_last), 0)[0])

        # R^2
        ss_res = np.sum((y_train - reg.predict(X_train)) ** 2)
        ss_tot = np.sum((y_train - np.mean(y_train)) ** 2)
        r2 = 1 - ss_res / (ss_tot + 1e-12)

        coefs = dict(zip(cj_cols, [float(c) for c in reg.coef_]))
        coefs["const"] = float(reg.intercept_)

        return {
            "model": "HAR-CJ (OLS)",
            "coefficients": coefs,
            "r_squared": float(r2),
            "next_forecast": next_forecast,
            "fitted_values": fitted.tolist(),
        }

    def run(self, ticker: str = "SPY", period: str = "2y",
            include_cross_asset: bool = True) -> dict:
        """
        Full HAR-CJ analysis pipeline.

        Returns a JSON-serializable dict with:
        - rv_decomposition: time series of GK_RV, Jump, Continuous
        - har_cj_model: OLS coefficients, R², forecast
        - cross_asset: VRP, VIX raw values
        """
        # 1. Fetch main ticker
        ohlcv = self._fetch_ohlcv(ticker, period)

        # 2. Compute RV measures
        self._compute_rv_measures(ohlcv)

        # 3. Fetch auxiliary data (VIX, TLT, HYG, UUP)
        aux = {}
        if include_cross_asset:
            aux_tickers = {
                "VIX": "^VIX",
                "VIX3M": "^VIX3M",
                "TLT": "TLT",
                "UUP": "UUP",
                "HYG": "HYG",
            }
            aux = self._fetch_aux(aux_tickers, period)

        # 4. Build features
        df, feature_cols = self._build_features(ohlcv, aux)

        # 5. Fit HAR-CJ OLS
        har_cj_result = self._fit_har_cj_ols(df)

        # 6. Build response
        # Time series (last 500 bars max)
        n = min(len(df), 500)
        ts_slice = df.iloc[-n:]

        # RV decomposition time series
        rv_decomposition = []
        for idx, row in ts_slice.iterrows():
            entry = {
                "date": idx.strftime("%Y-%m-%d"),
                "gk_rv": float(row["GK_RV"]),
                "naive_rv": float(row["Naive_RV"]),
                "park_rv": float(row["Park_RV"]),
                "jump": float(row["J_raw"]),
                "continuous": float(row["C_raw"]),
                "gk_vol_ann_pct": float(np.sqrt(max(row["GK_RV"], 0)) * 100),
            }
            if "VIX_raw" in row:
                entry["vix"] = float(row["VIX_raw"]) if not pd.isna(row["VIX_raw"]) else None
            if "VRP_raw" in row:
                entry["vrp"] = float(row["VRP_raw"]) if not pd.isna(row["VRP_raw"]) else None
            rv_decomposition.append(entry)

        # Fitted vs actual
        fitted_series = []
        fitted_vals = har_cj_result["fitted_values"][-n:]
        actual_vals = ts_slice["RV_target"].values
        for i, (idx, row) in enumerate(ts_slice.iterrows()):
            fitted_series.append({
                "date": idx.strftime("%Y-%m-%d"),
                "actual_rv": float(actual_vals[i]) if not np.isnan(actual_vals[i]) else None,
                "predicted_rv": float(fitted_vals[i]),
            })

        # Current state summary
        last = df.iloc[-1]
        current_state = {
            "date": df.index[-1].strftime("%Y-%m-%d"),
            "gk_rv": float(last["GK_RV"]),
            "gk_vol_ann_pct": float(np.sqrt(max(last["GK_RV"], 0)) * 100),
            "jump": float(last["J_raw"]),
            "continuous": float(last["C_raw"]),
            "jump_pct_of_rv": float(last["J_raw"] / (last["GK_RV"] + 1e-12) * 100),
            "next_rv_forecast": har_cj_result["next_forecast"],
            "next_vol_forecast_ann_pct": float(np.sqrt(max(har_cj_result["next_forecast"], 0)) * 100),
        }
        if "VIX_raw" in last:
            current_state["vix"] = float(last["VIX_raw"]) if not pd.isna(last["VIX_raw"]) else None
        if "VRP_raw" in last:
            current_state["vrp"] = float(last["VRP_raw"]) if not pd.isna(last["VRP_raw"]) else None

        # Feature importances (from OLS coefficients)
        coefs = har_cj_result["coefficients"].copy()
        const = coefs.pop("const", 0)
        feat_importance = sorted(
            [{"feature": k, "coefficient": v, "abs_coef": abs(v)} for k, v in coefs.items()],
            key=lambda x: x["abs_coef"], reverse=True,
        )

        return {
            "model_spec": {
                "type": "HAR-CJ (OLS)",
                "features": list(coefs.keys()),
                "n_observations": len(df),
                "date_range": f"{df.index[0].strftime('%Y-%m-%d')} to {df.index[-1].strftime('%Y-%m-%d')}",
            },
            "current_state": current_state,
            "har_cj": {
                "coefficients": har_cj_result["coefficients"],
                "r_squared": har_cj_result["r_squared"],
                "next_forecast": har_cj_result["next_forecast"],
            },
            "feature_importance": feat_importance,
            "rv_decomposition": rv_decomposition,
            "fitted_vs_actual": fitted_series,
        }


# ─── Convenience wrapper ─────────────────────────────────────────────────────

def run_har_cj_model(ticker: str = "SPY", period: str = "2y",
                     include_cross_asset: bool = True) -> dict:
    """One-liner to run HAR-CJ and get JSON-ready output."""
    model = HARCJModel()
    return model.run(ticker=ticker, period=period,
                     include_cross_asset=include_cross_asset)
