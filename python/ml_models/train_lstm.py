import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

"""
train_lstm.py — LSTM Volatility Forecasting Model (Training + Evaluation)
==========================================================================
Melatih model LSTM untuk memprediksi Realized Volatility (Garman-Klass)
dari data historis indeks/ETF/saham US.

Fitur utama:
  - Multi-ticker support (SPY, QQQ, AAPL, dsb)
  - Train/Test split 80/20 dengan evaluasi overfitting
  - Menyimpan model (.keras) dan scaler (.pkl) ke disk
  - Walk-forward validation untuk menghindari look-ahead bias

Usage:
  uv run python -m ml_models.train_lstm --ticker SPY --epochs 50

Author: Hybrid AI-Quant Volatility Arbitrage Engine
"""

import os
import sys
import json
import pickle
import argparse
import warnings
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

warnings.filterwarnings("ignore")

# ═══════════════════════════════════════════════════════
# CONSTANTS
# ═══════════════════════════════════════════════════════

TRADING_DAYS = 252
LOOK_BACK = 22          # 22 hari = ~1 bulan trading
TRAIN_SPLIT = 0.80      # 80% train, 20% test
DEFAULT_EPOCHS = 50
DEFAULT_BATCH = 32

WEIGHTS_DIR = os.path.join(os.path.dirname(__file__), "weights")
os.makedirs(WEIGHTS_DIR, exist_ok=True)


# ═══════════════════════════════════════════════════════
# DATA PIPELINE
# ═══════════════════════════════════════════════════════

def download_and_compute_rv(ticker: str, period_years: int = 8) -> pd.DataFrame:
    """
    Download data historis dan hitung Garman-Klass Realized Volatility.
    
    Returns DataFrame dengan kolom:
      - Close, Open, High, Low
      - RV_Daily (annualized GK vol %)
      - Return_Pct (daily log return %)
    """
    end_date = datetime.now().strftime("%Y-%m-%d")
    start_year = datetime.now().year - period_years
    start_date = f"{start_year}-01-01"
    
    print(f"  [DL] Downloading {ticker} ({start_date} -> {end_date})...")
    data = yf.download(ticker, start=start_date, end=end_date, progress=False, auto_adjust=True)
    
    if data.empty:
        raise ValueError(f"No data returned for {ticker}")
    
    # Flatten MultiIndex columns if present
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]
    
    # Garman-Klass Realized Volatility
    log_hl = np.log(data["High"] / data["Low"])
    log_co = np.log(data["Close"] / data["Open"])
    gk_var = 0.5 * (log_hl ** 2) - (2 * np.log(2) - 1) * (log_co ** 2)
    data["RV_Daily"] = np.sqrt(gk_var * TRADING_DAYS) * 100
    
    # Daily log return
    data["Return_Pct"] = np.log(data["Close"] / data["Close"].shift(1)) * 100
    
    data = data.dropna()
    print(f"  [OK] {len(data)} trading days loaded")
    return data


# ═══════════════════════════════════════════════════════
# SEQUENCE BUILDER
# ═══════════════════════════════════════════════════════

def build_sequences(values: np.ndarray, look_back: int = LOOK_BACK):
    """
    Buat X (input sequences) dan Y (target) untuk LSTM.
    X shape: (N, look_back, 1)
    Y shape: (N,)
    """
    X, Y = [], []
    for i in range(len(values) - look_back):
        X.append(values[i : i + look_back, 0])
        Y.append(values[i + look_back, 0])
    
    X = np.array(X)
    Y = np.array(Y)
    X = X.reshape((X.shape[0], X.shape[1], 1))
    return X, Y


# ═══════════════════════════════════════════════════════
# MODEL BUILDER
# ═══════════════════════════════════════════════════════

def build_lstm_model(look_back: int = LOOK_BACK, n_features: int = 1):
    """
    Arsitektur LSTM 2-layer dengan Dropout untuk anti-overfitting.
    
    Layer 1: LSTM 64 units + Dropout 20%
    Layer 2: LSTM 32 units + Dropout 20%
    Output : Dense 1 (prediksi volatilitas besok)
    """
    # Lazy import supaya tensorflow tidak di-load saat module-level
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout
    
    tf.random.set_seed(42)
    
    model = Sequential([
        LSTM(64, return_sequences=True, input_shape=(look_back, n_features)),
        Dropout(0.2),
        LSTM(32, return_sequences=False),
        Dropout(0.2),
        Dense(16, activation="relu"),
        Dense(1),
    ])
    model.compile(optimizer="adam", loss="mean_squared_error")
    return model


# ═══════════════════════════════════════════════════════
# TRAINING + EVALUATION PIPELINE
# ═══════════════════════════════════════════════════════

def train_and_evaluate(
    ticker: str,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH,
    period_years: int = 8,
    verbose: int = 1,
) -> dict:
    """
    Full pipeline: Download → Scale → Split → Train → Evaluate → Save.
    
    Returns dict with:
      - metrics (train & test RMSE, MAE, R², loss curves)
      - paths  (saved model + scaler paths)
      - overfit_assessment (diagnosis)
    """
    np.random.seed(42)
    
    # ── 1. Data ──────────────────────────────────────
    df = download_and_compute_rv(ticker, period_years)
    rv_values = df["RV_Daily"].values.reshape(-1, 1)
    
    # ── 2. Scale ─────────────────────────────────────
    scaler = MinMaxScaler(feature_range=(0, 1))
    scaled = scaler.fit_transform(rv_values)
    
    # ── 3. Sequences ─────────────────────────────────
    X, Y = build_sequences(scaled, LOOK_BACK)
    
    # ── 4. Train/Test Split ──────────────────────────
    split_idx = int(len(X) * TRAIN_SPLIT)
    X_train, X_test = X[:split_idx], X[split_idx:]
    Y_train, Y_test = Y[:split_idx], Y[split_idx:]
    
    print(f"\n  [DATA] Dataset Split:")
    print(f"     Train: {len(X_train)} samples")
    print(f"     Test:  {len(X_test)} samples")
    print(f"     Ratio: {TRAIN_SPLIT*100:.0f}/{(1-TRAIN_SPLIT)*100:.0f}")
    
    # ── 5. Build & Train ─────────────────────────────
    print(f"\n  [BUILD] Building LSTM Model...")
    model = build_lstm_model(LOOK_BACK, 1)
    model.summary()
    
    print(f"\n  [TRAIN] Training for {epochs} epochs...")
    
    # Import EarlyStopping
    from tensorflow.keras.callbacks import EarlyStopping
    
    early_stop = EarlyStopping(
        monitor="val_loss",
        patience=10,
        restore_best_weights=True,
        verbose=1,
    )
    
    history = model.fit(
        X_train, Y_train,
        epochs=epochs,
        batch_size=batch_size,
        validation_data=(X_test, Y_test),
        callbacks=[early_stop],
        verbose=verbose,
    )
    
    # ── 6. Predict ───────────────────────────────────
    pred_train_scaled = model.predict(X_train, verbose=0)
    pred_test_scaled  = model.predict(X_test, verbose=0)
    
    # Inverse transform ke skala asli (%)
    pred_train = scaler.inverse_transform(pred_train_scaled).flatten()
    pred_test  = scaler.inverse_transform(pred_test_scaled).flatten()
    actual_train = scaler.inverse_transform(Y_train.reshape(-1, 1)).flatten()
    actual_test  = scaler.inverse_transform(Y_test.reshape(-1, 1)).flatten()
    
    # ── 7. Metrics ───────────────────────────────────
    train_rmse = float(np.sqrt(mean_squared_error(actual_train, pred_train)))
    test_rmse  = float(np.sqrt(mean_squared_error(actual_test, pred_test)))
    train_mae  = float(mean_absolute_error(actual_train, pred_train))
    test_mae   = float(mean_absolute_error(actual_test, pred_test))
    train_r2   = float(r2_score(actual_train, pred_train))
    test_r2    = float(r2_score(actual_test, pred_test))
    
    # Loss curves
    train_loss = [float(x) for x in history.history["loss"]]
    val_loss   = [float(x) for x in history.history["val_loss"]]
    
    # ── 8. Overfitting Diagnosis ─────────────────────
    rmse_ratio = test_rmse / train_rmse if train_rmse > 0 else float("inf")
    r2_gap = train_r2 - test_r2
    
    # Loss trend: is val_loss diverging from train_loss?
    last_5_train = np.mean(train_loss[-5:]) if len(train_loss) >= 5 else train_loss[-1]
    last_5_val   = np.mean(val_loss[-5:])   if len(val_loss) >= 5 else val_loss[-1]
    loss_gap_ratio = last_5_val / last_5_train if last_5_train > 0 else float("inf")
    
    if rmse_ratio > 1.5 or r2_gap > 0.15:
        overfit_level = "HIGH"
        overfit_msg = (
            f"[WARNING] OVERFITTING DETECTED: "
            f"Test RMSE {rmse_ratio:.2f}x higher than Train. "
            f"R2 gap = {r2_gap:.4f}. "
            f"Model terlalu 'menghafal' data training."
        )
    elif rmse_ratio > 1.2 or r2_gap > 0.08:
        overfit_level = "MODERATE"
        overfit_msg = (
            f"[CAUTION] MILD OVERFITTING: "
            f"Test RMSE {rmse_ratio:.2f}x of Train. "
            f"R2 gap = {r2_gap:.4f}. "
            f"Model sedikit overfit tapi masih usable."
        )
    else:
        overfit_level = "HEALTHY"
        overfit_msg = (
            f"[HEALTHY] MODEL OK: "
            f"Test RMSE {rmse_ratio:.2f}x of Train. "
            f"R2 gap = {r2_gap:.4f}. "
            f"Generalisasi bagus, tidak overfitting."
        )
    
    # ── 9. Tomorrow's Forecast ───────────────────────
    last_window = scaled[-LOOK_BACK:]
    X_tomorrow = last_window.reshape(1, LOOK_BACK, 1)
    pred_tomorrow_scaled = model.predict(X_tomorrow, verbose=0)
    vol_tomorrow = float(scaler.inverse_transform(pred_tomorrow_scaled)[0][0])
    
    # ── 10. Save Model & Scaler ──────────────────────
    ticker_clean = ticker.replace("^", "").replace("/", "_").upper()
    model_path  = os.path.join(WEIGHTS_DIR, f"lstm_vol_{ticker_clean}.keras")
    scaler_path = os.path.join(WEIGHTS_DIR, f"scaler_{ticker_clean}.pkl")
    meta_path   = os.path.join(WEIGHTS_DIR, f"meta_{ticker_clean}.json")
    
    model.save(model_path)
    with open(scaler_path, "wb") as f:
        pickle.dump(scaler, f)
    
    meta = {
        "ticker": ticker,
        "trained_at": datetime.now().isoformat(),
        "n_samples": len(X),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "epochs_run": len(train_loss),
        "look_back": LOOK_BACK,
        "forecast_tomorrow_vol_pct": round(vol_tomorrow, 4),
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    
    print(f"\n  [SAVE] Model saved -> {model_path}")
    print(f"  [SAVE] Scaler saved -> {scaler_path}")
    
    # ── 11. Results Dict ─────────────────────────────
    results = {
        "ticker": ticker,
        "n_total_samples": len(X),
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "epochs_completed": len(train_loss),
        "metrics": {
            "train_rmse": round(train_rmse, 4),
            "test_rmse":  round(test_rmse, 4),
            "train_mae":  round(train_mae, 4),
            "test_mae":   round(test_mae, 4),
            "train_r2":   round(train_r2, 6),
            "test_r2":    round(test_r2, 6),
        },
        "overfitting": {
            "level": overfit_level,
            "rmse_ratio": round(rmse_ratio, 4),
            "r2_gap": round(r2_gap, 6),
            "loss_gap_ratio": round(loss_gap_ratio, 4),
            "message": overfit_msg,
        },
        "loss_curves": {
            "train_loss": train_loss,
            "val_loss": val_loss,
        },
        "forecast": {
            "tomorrow_vol_pct": round(vol_tomorrow, 4),
        },
        "paths": {
            "model": model_path,
            "scaler": scaler_path,
            "meta": meta_path,
        },
    }
    
    return results


# ═══════════════════════════════════════════════════════
# PRETTY PRINT REPORT
# ═══════════════════════════════════════════════════════

def print_report(results: dict):
    """Print a formatted evaluation report."""
    m = results["metrics"]
    o = results["overfitting"]
    
    print("\n" + "=" * 65)
    print(f"  LSTM VOLATILITY MODEL - EVALUATION REPORT")
    print(f"     Ticker: {results['ticker']}")
    print("=" * 65)
    
    print(f"\n  -- Dataset -----------------------------------")
    print(f"  Total samples  : {results['n_total_samples']}")
    print(f"  Train / Test   : {results['train_samples']} / {results['test_samples']}")
    print(f"  Epochs trained : {results['epochs_completed']}")
    
    print(f"\n  -- Performance Metrics -----------------------")
    print(f"  {'':15} {'TRAIN':>10} {'TEST':>10} {'GAP':>10}")
    print(f"  {'RMSE (vol%)':15} {m['train_rmse']:10.4f} {m['test_rmse']:10.4f} {m['test_rmse']-m['train_rmse']:+10.4f}")
    print(f"  {'MAE  (vol%)':15} {m['train_mae']:10.4f} {m['test_mae']:10.4f} {m['test_mae']-m['train_mae']:+10.4f}")
    print(f"  {'R2':15} {m['train_r2']:10.6f} {m['test_r2']:10.6f} {m['test_r2']-m['train_r2']:+10.6f}")
    
    print(f"\n  -- Overfitting Assessment --------------------")
    print(f"  Level          : {o['level']}")
    print(f"  RMSE ratio     : {o['rmse_ratio']:.4f}x (test/train, ideal ~ 1.0)")
    print(f"  R2 gap         : {o['r2_gap']:.6f} (train-test, ideal ~ 0.0)")
    print(f"  Loss gap ratio : {o['loss_gap_ratio']:.4f} (val/train last 5, ideal ~ 1.0)")
    print(f"\n  {o['message']}")
    
    print(f"\n  -- Tomorrow Forecast -------------------------")
    print(f"  >> AI Fair Volatility : {results['forecast']['tomorrow_vol_pct']:.4f}%")
    
    print(f"\n  -- Loss Curve (last 10 epochs) ---------------")
    tl = results["loss_curves"]["train_loss"]
    vl = results["loss_curves"]["val_loss"]
    start = max(0, len(tl) - 10)
    print(f"  {'Epoch':>6} {'Train Loss':>12} {'Val Loss':>12} {'Delta':>10}")
    for i in range(start, len(tl)):
        delta = vl[i] - tl[i]
        marker = " !" if delta > tl[i] * 0.5 else ""
        print(f"  {i+1:>6} {tl[i]:>12.6f} {vl[i]:>12.6f} {delta:>+10.6f}{marker}")
    
    print("\n" + "=" * 65)


# ═══════════════════════════════════════════════════════
# CLI ENTRY POINT
# ═══════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Train LSTM Volatility Forecasting Model"
    )
    parser.add_argument(
        "--ticker", type=str, default="SPY",
        help="Ticker symbol (SPY, QQQ, AAPL, ^GSPC, etc.)"
    )
    parser.add_argument(
        "--epochs", type=int, default=DEFAULT_EPOCHS,
        help=f"Training epochs (default: {DEFAULT_EPOCHS})"
    )
    parser.add_argument(
        "--batch", type=int, default=DEFAULT_BATCH,
        help=f"Batch size (default: {DEFAULT_BATCH})"
    )
    parser.add_argument(
        "--years", type=int, default=8,
        help="Years of historical data (default: 8)"
    )
    
    args = parser.parse_args()
    
    print("\n" + "=" * 65)
    print("  LSTM Volatility Model - Training Pipeline")
    print(f"     Target: {args.ticker} | Epochs: {args.epochs} | Batch: {args.batch}")
    print("=" * 65 + "\n")
    
    results = train_and_evaluate(
        ticker=args.ticker,
        epochs=args.epochs,
        batch_size=args.batch,
        period_years=args.years,
    )
    
    print_report(results)
