"""
ENet+MZ-Calibration Prop Firm Risk Engine
==========================================
- Supports any ticker (equity, ETF, futures proxy)
- Volatility forecast using ElasticNetCV + Mincer-Zarnowitz calibration
- Returns 30-day rolling history of predicted vs actual vol + residuals
- All inputs are nominal USD (no percentage confusion)
"""

import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
from scipy.stats import norm
from sklearn.linear_model import ElasticNetCV
from sklearn.preprocessing import StandardScaler
import warnings
warnings.filterwarnings('ignore')


class EnetMZPropFirmEngine:
    FEATURES = ['vol_d', 'vol_w', 'vol_m', 'lev_d', 'lev_w', 'lev_m', 'vix_d', 'vix_spread']
    ROLL_WINDOW = 252

    def __init__(self):
        self.alphas = np.logspace(-3, 2, 20)
        self.l1_ratios = [0.1, 0.3, 0.5, 0.7, 0.9]

    # ── Data Layer ─────────────────────────────────────────────────────────────

    def _fetch_data(self, ticker: str) -> pd.DataFrame:
        ticker = ticker.upper().strip()
        df = yf.Ticker(ticker).history(start="2020-01-01")
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        if df.empty:
            raise ValueError(f"No price data found for ticker '{ticker}'")

        for tk, col in [('^VIX', 'VIX'), ('^VIX9D', 'VIX9D'), ('^VIX3M', 'VIX3M')]:
            tmp = yf.Ticker(tk).history(start="2020-01-01")['Close'].rename(col)
            if tmp.index.tz is not None:
                tmp.index = tmp.index.tz_localize(None)
            df = df.join(tmp, how='inner')

        return df.dropna().copy()

    def _build_features(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        log_hl = np.log(df['High'] / df['Low'])
        log_co = np.log(df['Close'] / df['Open'])
        # Garman-Klass volatility (% daily)
        df['vol_d'] = np.sqrt(np.maximum(0.5 * log_hl**2 - (2 * np.log(2) - 1) * log_co**2, 1e-8)) * 100
        df['ret'] = np.log(df['Close'] / df['Close'].shift(1))
        df['ret_minus'] = np.minimum(df['ret'], 0.0)
        df['vol_w'] = df['vol_d'].ewm(span=5, adjust=False).mean()
        df['vol_m'] = df['vol_d'].ewm(span=22, adjust=False).mean()
        df['lev_d'] = df['ret_minus']
        df['lev_w'] = df['ret_minus'].ewm(span=5, adjust=False).mean()
        df['lev_m'] = df['ret_minus'].ewm(span=22, adjust=False).mean()
        df['vix_d'] = df['VIX'] / np.sqrt(252)
        df['vix_spread'] = df['VIX9D'] - df['VIX3M']
        # Target: NEXT day's vol
        df['target_vol'] = df['vol_d'].shift(-1)
        return df.dropna().copy()

    # ── Model Layer ────────────────────────────────────────────────────────────

    def _train(self, df: pd.DataFrame):
        """Train ENet on full rolling window, calibrate with MZ on last 63 days."""
        train = df.iloc[-self.ROLL_WINDOW:]
        Y = train['target_vol'].values
        X = train[self.FEATURES].values

        scaler = StandardScaler()
        X_s = scaler.fit_transform(X)
        enet = ElasticNetCV(alphas=self.alphas, l1_ratio=self.l1_ratios, cv=5, max_iter=5000, n_jobs=-1)
        enet.fit(X_s, Y)

        # MZ calibration on last 63-day window
        cal = df.iloc[-63:]
        preds_raw = np.maximum(enet.predict(scaler.transform(cal[self.FEATURES].values)), 0.01)
        X_mz = sm.add_constant(preds_raw)
        mz = sm.OLS(cal['target_vol'].values, X_mz).fit()
        mz_a = float(mz.params[0])
        mz_b = float(mz.params[1])

        return scaler, enet, mz_a, mz_b

    def _predict_today(self, df: pd.DataFrame, scaler, enet, mz_a: float, mz_b: float) -> float:
        """Predict tomorrow's vol using the last row's features."""
        last_feat = df[self.FEATURES].iloc[-1].values.reshape(1, -1)
        raw = float(enet.predict(scaler.transform(last_feat))[0])
        return max(mz_a + mz_b * max(raw, 0.01), 0.01)

    def _build_history(self, df: pd.DataFrame, scaler, enet, mz_a: float, mz_b: float, lookback: int = 30) -> list:
        """
        Reconstruct rolling 1-step-ahead vol predictions for the last `lookback` days.
        Uses the already-fitted model (fast path — avoids re-training per step).
        'actual' = vol_d on that date (same-day GK vol)
        'predicted' = MZ-calibrated ENet prediction made the DAY BEFORE for this day
        """
        n = len(df)
        # We predict vol for rows [1..n-1] using features from rows [0..n-2]
        # Then align: predicted[i] is for date[i+1], actual[i+1] is vol_d[i+1]
        start_idx = max(self.ROLL_WINDOW, n - lookback - 1)
        
        # Feature rows used to predict the NEXT day
        X_hist = df[self.FEATURES].iloc[start_idx : n - 1].values
        preds_raw = np.maximum(enet.predict(scaler.transform(X_hist)), 0.01)
        preds_cal = np.maximum(mz_a + mz_b * preds_raw, 0.01)
        
        # Actuals are the NEXT day's vol_d values
        actuals = df['vol_d'].iloc[start_idx + 1 : n].values
        dates = df.index[start_idx + 1 : n]
        
        rows = []
        for i in range(len(preds_cal)):
            pred = round(float(preds_cal[i]), 4)
            actual = round(float(actuals[i]), 4)
            rows.append({
                'date': dates[i].strftime('%Y-%m-%d'),
                'predicted': pred,
                'actual': actual,
                'residual': round(actual - pred, 4),
            })
        return rows[-lookback:]

    # ── Public Interface ────────────────────────────────────────────────────────

    def run(self, ticker: str = 'SPY', equity: float = 50000.0,
            daily_loss: float = 2500.0, total_loss: float = 5000.0,
            tp_target: float = 3000.0) -> dict:
        """
        Full pipeline. All monetary inputs are NOMINAL USD.
        Returns structured dict ready for API serialization.
        """
        # Validate
        if equity <= 0:
            raise ValueError('equity must be > 0')
        if not (0 < daily_loss <= equity):
            raise ValueError('daily_loss must be > 0 and <= equity')
        if not (0 < total_loss <= equity):
            raise ValueError('total_loss must be > 0 and <= equity')
        if tp_target <= 0:
            raise ValueError('tp_target must be > 0')

        df_raw = self._fetch_data(ticker)
        df = self._build_features(df_raw)

        if len(df) < self.ROLL_WINDOW + 65:
            raise ValueError(f"Not enough data for '{ticker}'. Need at least {self.ROLL_WINDOW + 65} trading days since 2020.")

        scaler, enet, mz_a, mz_b = self._train(df)
        pred_vol = self._predict_today(df, scaler, enet, mz_a, mz_b)
        history = self._build_history(df, scaler, enet, mz_a, mz_b, lookback=30)

        last = df.iloc[-1]
        close_now = float(last['Close'])
        vix_now = float(last.get('VIX', 0.0))

        # ── Regime classification ──
        if pred_vol < 0.70:
            regime, risk_factor, budget_factor, confidence = 'CALM',    0.10, 0.80, 0.990
        elif pred_vol <= 1.30:
            regime, risk_factor, budget_factor, confidence = 'NORMAL',  0.08, 0.60, 0.995
        elif pred_vol <= 2.00:
            regime, risk_factor, budget_factor, confidence = 'ELEVATED', 0.06, 0.40, 0.997
        else:
            regime, risk_factor, budget_factor, confidence = 'CRISIS',  0.04, 0.20, 0.999

        z = norm.ppf(confidence)

        # ── Risk calculations (all in USD) ──
        rec_daily_budget = round(daily_loss * budget_factor, 2)
        risk_per_trade   = round(daily_loss * risk_factor, 2)
        max_trades_today = int(rec_daily_budget // risk_per_trade) if risk_per_trade > 0 else 0
        hard_stop        = round(daily_loss * 0.80, 2)
        max_exposure     = round(daily_loss / ((pred_vol / 100.0) * z), 2)

        # ── Execution math ──
        needed_r      = round(tp_target / risk_per_trade, 1) if risk_per_trade > 0 else 0
        net_wins      = round(needed_r / 2.0, 1)
        win_pnl       = round(risk_per_trade * 2, 2)

        # ── Capital math ──
        if equity <= 25000:   eval_fee = 125.0
        elif equity <= 50000: eval_fee = 200.0
        elif equity <= 100000: eval_fee = 300.0
        else:                 eval_fee = 400.0
        attempts       = 3
        capital_budget = round(eval_fee * attempts, 2)
        ruin_prob      = round((0.30 ** attempts) * 100, 2)

        return {
            'ticker': ticker.upper(),
            'market': {
                'close':       close_now,
                'vix':         vix_now,
                'pred_vol':    round(pred_vol, 4),
                'regime':      regime,
                'confidence':  round(confidence * 100, 1),
            },
            'prop_firm': {
                'equity':     equity,
                'daily_loss': daily_loss,
                'total_loss': total_loss,
                'tp_target':  tp_target,
            },
            'risk': {
                'budget_factor_pct':    int(budget_factor * 100),
                'rec_daily_budget':     rec_daily_budget,
                'risk_per_trade':       risk_per_trade,
                'max_trades_today':     max_trades_today,
                'hard_stop':            hard_stop,
                'max_safe_exposure':    max_exposure,
                'z_score':              round(z, 3),
            },
            'execution': {
                'needed_r':   needed_r,
                'net_wins':   net_wins,
                'win_pnl':    win_pnl,
                'loss_pnl':   risk_per_trade,
            },
            'capital': {
                'eval_fee':      eval_fee,
                'attempts':      attempts,
                'capital_budget': capital_budget,
                'ruin_prob_pct': ruin_prob,
            },
            'history': history,
        }


if __name__ == '__main__':
    import json
    engine = EnetMZPropFirmEngine()
    result = engine.run(ticker='SPY', equity=50000, daily_loss=2500, total_loss=5000, tp_target=3000)
    print(json.dumps(result, indent=2))
