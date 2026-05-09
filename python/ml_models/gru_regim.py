"""
GRU Market Regime Predictor v5 — Engine Class
==============================================
Encapsulates all logic: feature engineering, macro data,
model build, training, and inference.

Usage:
    from ml_models.gru_regim import GRURegimeEngine
    engine = GRURegimeEngine(ticker="SPY")
    result = engine.predict_latest()
"""

import warnings, os, json, pickle
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import yfinance as yf
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_class_weight
import tensorflow as tf
from tensorflow.keras.models import Model, load_model
from tensorflow.keras.layers import (Input, GRU, Dense, Dropout,
                                      BatchNormalization,
                                      GlobalAveragePooling1D,
                                      Concatenate)
from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau, ModelCheckpoint
from tensorflow.keras.utils import to_categorical
from tensorflow.keras.optimizers import Adam
from tensorflow.keras import regularizers

MACRO_TICKERS = {
    "vix": "^VIX", "vix9d": "^VIX9D", "vxmt": "^VXMT",
    "tnx": "^TNX", "irx": "^IRX", "hyg": "HYG",
    "lqd": "LQD", "dxy": "DX-Y.NYB", "skew": "^SKEW",
}


def _make_weighted_cce(class_weights: dict, label_smoothing: float = 0.05):
    wt = tf.constant([class_weights[i] for i in range(len(class_weights))], dtype=tf.float32)
    n_classes = len(class_weights)
    def loss_fn(y_true, y_pred):
        y_smooth = y_true * (1.0 - label_smoothing) + label_smoothing / n_classes
        cce = tf.keras.losses.categorical_crossentropy(y_smooth, y_pred)
        class_idx = tf.argmax(y_true, axis=1)
        per_sample_wt = tf.gather(wt, class_idx)
        return tf.reduce_mean(cce * per_sample_wt)
    loss_fn.__name__ = "weighted_cce_smooth"
    return loss_fn


class GRURegimeEngine:
    """Reusable GRU regime detection engine — no side effects on import."""

    REGIME_NAMES = {0: "Sideways", 1: "Bullish", 2: "Bearish"}

    BASE_FEATURE_COLS = [
        "ret_1","ret_3","ret_5","ret_10","ret_20",
        "vol_5","vol_10","vol_20","vol_60",
        "vol_ratio_5_20","vol_ratio_10_60",
        "parkinson_vol","vol_of_vol","vol_trend_pct",
        "log_vol_5","log_vol_20","rv_daily",
        "pr_sma10","pr_sma20","pr_sma50","sma10_sma50",
        "macd","macd_sig","macd_hist",
        "rsi","bb_pct","bb_width",
        "atr_norm",
        "vol_chg","vol_rel","obv_ret5","hl_spread",
    ]

    def __init__(self, ticker="SPY", seq_len=20, model_dir=None):
        self.ticker = ticker
        self.seq_len = seq_len

        if model_dir is None:
            model_dir = os.path.dirname(os.path.abspath(__file__))
        self.model_dir = model_dir

        self.model_path = os.path.join(model_dir, f"{ticker}_gru_regime_v5.keras")
        self.scaler_path = os.path.join(model_dir, f"{ticker}_scaler_v5.pkl")
        self.feature_cols_path = os.path.join(model_dir, f"{ticker}_feature_cols_v5.json")
        self.metrics_path = os.path.join(model_dir, f"{ticker}_gru_metrics_v5.json")

        self.feature_cols = self.BASE_FEATURE_COLS.copy()
        self.model = None
        self.scaler = None
        self.metrics = None
        self._load_artifacts()

    # ── Artifact management ──────────────────────────────────────────────

    def _load_artifacts(self):
        if os.path.exists(self.scaler_path):
            with open(self.scaler_path, "rb") as f:
                self.scaler = pickle.load(f)
        if os.path.exists(self.feature_cols_path):
            with open(self.feature_cols_path, "r") as f:
                self.feature_cols = json.load(f)
        if os.path.exists(self.model_path):
            try:
                self.model = load_model(self.model_path, compile=False)
            except Exception as e:
                print(f"[GRURegimeEngine] Warning: could not load model: {e}")
        if os.path.exists(self.metrics_path):
            try:
                with open(self.metrics_path, "r") as f:
                    self.metrics = json.load(f)
            except Exception as e:
                print(f"[GRURegimeEngine] Warning: could not load metrics: {e}")

    # ── Data download ────────────────────────────────────────────────────

    def download_data(self, period="5y"):
        raw = yf.download(self.ticker, period=period, auto_adjust=True, progress=False)
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = raw.columns.droplevel(1)
        raw.dropna(inplace=True)
        return raw

    def download_macro(self, base_index, period="5y"):
        macro = {}
        for key, tk in MACRO_TICKERS.items():
            try:
                tmp = yf.download(tk, period=period, auto_adjust=True, progress=False)
                if isinstance(tmp.columns, pd.MultiIndex):
                    tmp.columns = tmp.columns.droplevel(1)
                series = tmp["Close"].dropna()
                if len(series) > 50:
                    macro[key] = series.reindex(base_index, method="ffill").ffill().bfill()
            except Exception:
                pass
        return macro

    # ── Feature engineering ──────────────────────────────────────────────

    @staticmethod
    def build_features(df: pd.DataFrame) -> pd.DataFrame:
        d = df.copy()
        for n in [1, 3, 5, 10, 20]:
            d[f"ret_{n}"] = d["Close"].pct_change(n)
        for n in [5, 10, 20, 60]:
            d[f"vol_{n}"] = d["ret_1"].rolling(n).std()
        d["vol_ratio_5_20"]  = d["vol_5"]  / (d["vol_20"]  + 1e-9)
        d["vol_ratio_10_60"] = d["vol_10"] / (d["vol_60"]  + 1e-9)
        log_hl = np.log(d["High"] / (d["Low"] + 1e-9))
        d["parkinson_vol"] = np.sqrt((log_hl**2 / (4.0 * np.log(2))).rolling(20).mean())
        d["vol_of_vol"]     = d["vol_20"].rolling(20).std()
        d["vol_trend_pct"]  = d["vol_20"].pct_change(5).clip(-5, 5)
        d["log_vol_5"]      = np.log(d["vol_5"].clip(lower=1e-8))
        d["log_vol_20"]     = np.log(d["vol_20"].clip(lower=1e-8))
        d["rv_daily"]       = d["ret_1"] ** 2
        for n in [10, 20, 50]:
            d[f"sma_{n}"] = d["Close"].rolling(n).mean()
        d["ema_12"] = d["Close"].ewm(span=12, adjust=False).mean()
        d["ema_26"] = d["Close"].ewm(span=26, adjust=False).mean()
        d["pr_sma10"]    = d["Close"] / (d["sma_10"] + 1e-9)
        d["pr_sma20"]    = d["Close"] / (d["sma_20"] + 1e-9)
        d["pr_sma50"]    = d["Close"] / (d["sma_50"] + 1e-9)
        d["sma10_sma50"] = d["sma_10"] / (d["sma_50"] + 1e-9)
        d["macd"]      = d["ema_12"] - d["ema_26"]
        d["macd_sig"]  = d["macd"].ewm(span=9, adjust=False).mean()
        d["macd_hist"] = d["macd"] - d["macd_sig"]
        delta = d["Close"].diff()
        gain  = delta.clip(lower=0).rolling(14).mean()
        loss  = (-delta.clip(upper=0)).rolling(14).mean()
        d["rsi"] = 100 - (100 / (1 + gain / (loss + 1e-9)))
        bb_mid = d["Close"].rolling(20).mean()
        bb_std = d["Close"].rolling(20).std()
        d["bb_upper"] = bb_mid + 2 * bb_std
        d["bb_lower"] = bb_mid - 2 * bb_std
        d["bb_pct"]   = (d["Close"] - d["bb_lower"]) / (d["bb_upper"] - d["bb_lower"] + 1e-9)
        d["bb_width"] = (d["bb_upper"] - d["bb_lower"]) / (bb_mid + 1e-9)
        hl  = d["High"] - d["Low"]
        hpc = (d["High"] - d["Close"].shift()).abs()
        lpc = (d["Low"]  - d["Close"].shift()).abs()
        d["atr_14"]   = pd.concat([hl, hpc, lpc], axis=1).max(axis=1).rolling(14).mean()
        d["atr_norm"] = d["atr_14"] / (d["Close"] + 1e-9)
        d["vol_chg"]   = d["Volume"].pct_change()
        d["vol_ma20"]  = d["Volume"].rolling(20).mean()
        d["vol_rel"]   = d["Volume"] / (d["vol_ma20"] + 1e-9)
        d["obv"]       = (np.sign(d["ret_1"]) * d["Volume"]).cumsum()
        d["obv_ret5"]  = d["obv"].pct_change(5)
        d["hl_spread"] = (d["High"] - d["Low"]) / (d["Close"] + 1e-9)
        fwd_5d_rvol = d["ret_1"].rolling(5).std().shift(-5)
        d["target_vol_raw"] = fwd_5d_rvol
        d["target_vol"]     = np.log(fwd_5d_rvol.clip(lower=1e-8))
        return d

    @staticmethod
    def attach_macro_features(df, macro):
        d = df.copy()
        added = []
        def _add(name, series):
            s = series.reindex(d.index).ffill().bfill().replace([np.inf, -np.inf], np.nan)
            d[name] = s
            added.append(name)
        if "vix" in macro:
            vix = macro["vix"]; vix_norm = vix / 100.0
            _add("vix_level", vix_norm)
            _add("vix_ret_1", vix.pct_change(1))
            _add("vix_zscore_20", (vix - vix.rolling(20).mean()) / (vix.rolling(20).std() + 1e-9))
            _add("vix_rv_ratio", vix / (d["vol_20"] * np.sqrt(252) * 100 + 1e-9))
            _add("vrp", vix_norm**2 - (d["vol_20"] * np.sqrt(252))**2)
        if "vix9d" in macro and "vxmt" in macro and "vix" in macro:
            vix, vix9d, vxmt = macro["vix"], macro["vix9d"], macro["vxmt"]
            _add("vix_ts_slope", (vxmt - vix9d) / (vix + 1e-9))
            _add("vix_ts_curv",  (vxmt - 2*vix + vix9d) / (vix + 1e-9))
        if "tnx" in macro:
            _add("yield_10y_chg", macro["tnx"].diff(1))
            if "irx" in macro:
                curve = (macro["tnx"] - macro["irx"]) / 100.0
                _add("yield_curve", curve)
                _add("yield_curve_chg", curve.diff(1))
        if "hyg" in macro and "lqd" in macro:
            _add("credit_stress", macro["lqd"].pct_change(1) - macro["hyg"].pct_change(1))
            _add("hyg_trend", macro["hyg"] / (macro["hyg"].rolling(20).mean() + 1e-9) - 1)
        if "dxy" in macro:
            _add("dxy_ret_1", macro["dxy"].pct_change(1))
            _add("dxy_zscore_60", (macro["dxy"] - macro["dxy"].rolling(60).mean()) / (macro["dxy"].rolling(60).std() + 1e-9))
        if "skew" in macro:
            _add("skew_zscore_60", (macro["skew"] - macro["skew"].rolling(60).mean()) / (macro["skew"].rolling(60).std() + 1e-9))
            _add("skew_ret_5", macro["skew"].pct_change(5))
        return d, added

    # ── Model architecture ───────────────────────────────────────────────

    def _build_model(self, n_feat, class_weights=None):
        l2 = 1e-4; dropout = 0.50; lr = 5e-4
        reg = regularizers.l2(l2)
        inp = Input(shape=(self.seq_len, n_feat), name="input")
        x = GRU(64, return_sequences=True, recurrent_dropout=0.20,
                kernel_regularizer=reg, recurrent_regularizer=reg, name="gru_1")(inp)
        x = BatchNormalization()(x)
        x = Dropout(dropout)(x)
        last = GRU(32, return_sequences=False, recurrent_dropout=0.20,
                   kernel_regularizer=reg, recurrent_regularizer=reg, name="gru_2")(x)
        avg = GlobalAveragePooling1D(name="gap")(x)
        x = Concatenate()([last, avg])
        x = BatchNormalization()(x)
        x = Dropout(dropout)(x)
        shared = Dense(32, activation="relu", kernel_regularizer=reg, name="shared")(x)
        x = Dropout(dropout/2)(shared)
        r = Dense(16, activation="relu", kernel_regularizer=reg, name="reg_h")(x)
        reg_out = Dense(3, activation="softmax", name="regime")(r)
        v1 = Dense(32, activation="relu", kernel_regularizer=reg, name="vol_h1")(x)
        v1 = Dropout(dropout/2)(v1)
        v2 = Dense(16, activation="relu", kernel_regularizer=reg, name="vol_h2")(v1)
        vol_out = Dense(1, activation="linear", name="volatility")(v2)
        model = Model(inputs=inp, outputs=[reg_out, vol_out])
        regime_loss = _make_weighted_cce(class_weights) if class_weights else "categorical_crossentropy"
        model.compile(
            optimizer=Adam(lr, clipnorm=1.0),
            loss={"regime": regime_loss, "volatility": "huber"},
            loss_weights={"regime": 1.0, "volatility": 0.4},
            metrics={"regime": ["accuracy"], "volatility": ["mae", "mse"]},
        )
        return model

    # ── Sequence helper ──────────────────────────────────────────────────

    @staticmethod
    def _make_sequences(X, yr=None, yv=None, seq_len=20):
        Xs = []
        Yr = [] if yr is not None else None
        Yv = [] if yv is not None else None
        for i in range(seq_len, len(X)):
            Xs.append(X[i - seq_len : i])
            if yr is not None:
                Yr.append(yr[i])
            if yv is not None:
                Yv.append(yv[i])
        if yr is not None and yv is not None:
            return np.array(Xs), np.array(Yr), np.array(Yv)
        return np.array(Xs)

    # ── Full data pipeline ───────────────────────────────────────────────

    def _prepare_data(self, df_raw, is_training=False):
        df = self.build_features(df_raw)
        macro = self.download_macro(df.index)
        df, macro_cols = self.attach_macro_features(df, macro)

        if is_training:
            fwd_ret = df["Close"].pct_change(5).shift(-5)
            df["regime"] = np.where(fwd_ret > 0.003, 1, np.where(fwd_ret < -0.003, 2, 0))
            df.dropna(inplace=True)
            self.feature_cols = self.BASE_FEATURE_COLS + [c for c in macro_cols if c in df.columns]
            with open(self.feature_cols_path, "w") as f:
                json.dump(self.feature_cols, f)
        else:
            for c in self.feature_cols:
                if c not in df.columns:
                    df[c] = 0.0
            df.ffill(inplace=True)
            df.fillna(0, inplace=True)

        X_raw = df[self.feature_cols].values.astype(np.float32)

        if is_training:
            y_reg = df["regime"].values.astype(np.int32)
            y_vol = df["target_vol"].values.astype(np.float32)
            self.scaler = StandardScaler()
            X_sc = self.scaler.fit_transform(X_raw)
            with open(self.scaler_path, "wb") as f:
                pickle.dump(self.scaler, f)
            return X_sc, y_reg, y_vol, df
        else:
            if self.scaler is None:
                raise ValueError("Scaler not loaded — train or provide artifacts first.")
            X_sc = self.scaler.transform(X_raw)
            return X_sc, df

    # ── Public API ───────────────────────────────────────────────────────

    def train(self, epochs=200, batch_size=64):
        """Train model from scratch using downloaded data."""
        df_raw = self.download_data(period="5y")
        X_sc, y_reg, y_vol, df = self._prepare_data(df_raw, is_training=True)

        n = len(X_sc)
        n_test = int(n * 0.15)
        n_val  = int(n * 0.15)
        n_train = n - n_val - n_test

        X_tr, y_tr_r, y_tr_v = self._make_sequences(X_sc[:n_train], y_reg[:n_train], y_vol[:n_train], self.seq_len)
        X_vl, y_vl_r, y_vl_v = self._make_sequences(X_sc[n_train:n_train+n_val], y_reg[n_train:n_train+n_val], y_vol[n_train:n_train+n_val], self.seq_len)

        y_tr_oh = to_categorical(y_tr_r, 3)
        y_vl_oh = to_categorical(y_vl_r, 3)

        cw_arr = compute_class_weight("balanced", classes=np.unique(y_tr_r), y=y_tr_r)
        cw = {i: float(cw_arr[i]) for i in range(3)}

        self.model = self._build_model(len(self.feature_cols), class_weights=cw)

        callbacks = [
            EarlyStopping(monitor="val_regime_accuracy", patience=20, restore_best_weights=True, mode="max", verbose=1),
            ReduceLROnPlateau(monitor="val_loss", factor=0.5, patience=8, min_lr=1e-6, verbose=1),
            ModelCheckpoint(self.model_path, save_best_only=True, monitor="val_regime_accuracy", mode="max", verbose=0),
        ]
        history = self.model.fit(
            X_tr, {"regime": y_tr_oh, "volatility": y_tr_v},
            validation_data=(X_vl, {"regime": y_vl_oh, "volatility": y_vl_v}),
            epochs=epochs, batch_size=batch_size, callbacks=callbacks, verbose=1,
        )
        
        try:
            val_loss = history.history['val_loss'][-1]
            train_loss = history.history['loss'][-1]
            is_overfitting = val_loss > train_loss * 1.2
            
            val_mse = history.history.get('val_volatility_mse', history.history.get('val_volatility_mae'))[-1]
            val_rmse = float(np.sqrt(val_mse)) if 'val_volatility_mse' in history.history else 0.0
            
            self.metrics = {
                "train_loss": float(train_loss),
                "val_loss": float(val_loss),
                "val_mse": float(val_mse),
                "val_rmse": float(val_rmse),
                "val_mae": float(history.history['val_volatility_mae'][-1]),
                "train_accuracy": float(history.history['regime_accuracy'][-1]),
                "val_accuracy": float(history.history['val_regime_accuracy'][-1]),
                "is_overfitting": bool(is_overfitting),
                "overfitting_status": "Overfitting" if is_overfitting else "Good Fit"
            }
            with open(self.metrics_path, "w") as f:
                json.dump(self.metrics, f)
        except Exception as e:
            print(f"[GRURegimeEngine] Warning: Could not save metrics: {e}")

        print(f"Training complete. Model saved to {self.model_path}")

    def predict_latest(self, df_raw=None):
        """Predict regime & volatility for the latest available date."""
        if self.model is None or self.scaler is None:
            self._load_artifacts()
            if self.model is None:
                raise ValueError("Model not trained or artifacts missing.")

        if df_raw is None:
            df_raw = self.download_data(period="6mo")

        X_sc, df = self._prepare_data(df_raw, is_training=False)
        last_seq = X_sc[-self.seq_len:].reshape(1, self.seq_len, len(self.feature_cols))

        p_proba, p_vol_log = self.model.predict(last_seq, verbose=0)
        p_cls = int(np.argmax(p_proba[0]))
        p_vol_val = float(np.exp(p_vol_log[0][0]))

        return {
            "date":                   str(df.index[-1].date()),
            "regime":                 self.REGIME_NAMES[p_cls],
            "regime_idx":             p_cls,
            "confidence_pct":         float(p_proba[0][p_cls]) * 100,
            "volatility_daily_pct":   p_vol_val * 100,
            "volatility_annualized_pct": p_vol_val * np.sqrt(252) * 100,
            "probabilities": {
                "Sideways": float(p_proba[0][0]),
                "Bullish":  float(p_proba[0][1]),
                "Bearish":  float(p_proba[0][2]),
            },
        }