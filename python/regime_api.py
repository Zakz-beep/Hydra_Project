"""
GRU Regime API — FastAPI wrapper for GRURegimeEngine
=====================================================
Endpoints:
    GET  /                     → Health check
    GET  /api/regime/predict   → Latest regime prediction
    POST /api/regime/train     → Trigger model training

Run:
    uvicorn regime_api:app --host 0.0.0.0 --port 8007 --reload
"""

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import traceback

from ml_models.gru_regim import GRURegimeEngine

# ═══════════════════════════════════════════════
# APP
# ═══════════════════════════════════════════════

app = FastAPI(
    title="GRU Market Regime API",
    description="AI-powered market regime detection & volatility forecasting using GRU neural network",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════
# ENGINE CACHE — lazy init per ticker
# ═══════════════════════════════════════════════

_engines: dict[str, GRURegimeEngine] = {}

def _get_engine(ticker: str) -> GRURegimeEngine:
    if ticker not in _engines:
        _engines[ticker] = GRURegimeEngine(ticker=ticker)
    return _engines[ticker]

# ═══════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════

@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "GRU Market Regime API",
        "version": "1.0.0",
        "docs": "/docs",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/regime/predict")
def predict_regime(ticker: str = Query(default="SPY", description="Ticker symbol")):
    """
    Predict the current market regime and forward volatility.
    Returns regime (Sideways/Bullish/Bearish), confidence, and vol forecast.
    """
    engine = _get_engine(ticker)

    if engine.model is None:
        raise HTTPException(
            status_code=503,
            detail=f"Model for {ticker} not trained yet. POST /api/regime/train first.",
        )

    try:
        result = engine.predict_latest()
        result["ticker"] = ticker
        result["timestamp"] = datetime.now().isoformat()
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/regime/train")
def train_model(
    ticker: str = Query(default="SPY"),
    epochs: int = Query(default=200, ge=1, le=500),
):
    """
    Train (or retrain) the GRU regime model for a ticker.
    This downloads data, builds features, and trains — may take several minutes.
    """
    engine = _get_engine(ticker)

    try:
        engine.train(epochs=epochs)
        # After training, try a prediction to verify
        result = engine.predict_latest()
        return {
            "status": "ok",
            "message": f"Model trained for {ticker} ({epochs} epochs)",
            "model_path": engine.model_path,
            "sample_prediction": result,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/regime/status")
def model_status(ticker: str = Query(default="SPY")):
    """Check if model artifacts exist for a ticker."""
    engine = _get_engine(ticker)
    import os
    return {
        "ticker": ticker,
        "model_loaded": engine.model is not None,
        "scaler_loaded": engine.scaler is not None,
        "model_path": engine.model_path,
        "model_exists": os.path.exists(engine.model_path),
        "scaler_exists": os.path.exists(engine.scaler_path),
        "feature_count": len(engine.feature_cols),
        "metrics": engine.metrics,
    }


@app.get("/api/market/ohlcv")
def get_ohlcv(ticker: str = Query(default="SPY"), period: str = Query(default="2y")):
    """Fetch OHLCV data for Lightweight Charts"""
    import yfinance as yf
    import pandas as pd
    try:
        df = yf.download(ticker, period=period, progress=False)
        if df.empty:
            raise HTTPException(status_code=404, detail=f"No data found for {ticker}")
        
        # yf might return multiindex columns if multiple tickers are requested, but here we expect one
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
            
        df.dropna(inplace=True)
        data = []
        for date, row in df.iterrows():
            data.append({
                "time": date.strftime('%Y-%m-%d'),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "value": float(row["Volume"]) # Add volume as 'value' for histogram
            })
        return data
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))



# ═══════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("regime_api:app", host="0.0.0.0", port=8007, reload=True)
