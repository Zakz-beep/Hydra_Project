"""
rv_engine.py — Realtime RV Engine (Modular)
============================================
Modul standalone untuk menghitung Realized Volatility (RV) secara
"realtime" saat market buka, menggunakan dua approach:

  Approach 2 — Blended Partial Intraday + Yesterday RV
      Makin siang → makin dominan RV intraday hari ini
      Makin pagi  → di-anchor ke RV kemarin

  Approach 3 — HAR-RV Forecast + Intraday Update
      HAR forecast dari daily history (OLS-fitted coefficients)
      Di-update secara inkremental dengan accumulated intraday RV

Timeframe:
  - 5m  candles → untuk kalkulasi RV (akurasi lebih tinggi)
  - 15m candles → untuk display / charting di frontend

Cara pakai di vrp_api.py:
  from rv_engine import RVEngine
  engine = RVEngine(ticker="^GSPC")
  result = engine.compute()
  # result["rv_blended"], result["rv_har_updated"], dll

Author: generated for FLOW's VRP Signal Engine
"""

import time
import warnings
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, date, timezone
from dataclasses import dataclass, field
from typing import Optional
from sklearn.linear_model import LinearRegression

warnings.filterwarnings("ignore")


# ════════════════════════════════════════════════════════
# CONSTANTS
# ════════════════════════════════════════════════════════

NY_OPEN_HOUR   = 9
NY_OPEN_MIN    = 30
NY_CLOSE_HOUR  = 16
NY_CLOSE_MIN   = 0
NY_SESSION_MIN = 390          # total menit sesi NY
TRADING_DAYS   = 252
CANDLES_5M     = NY_SESSION_MIN // 5    # 78 candle per hari
CANDLES_15M    = NY_SESSION_MIN // 15   # 26 candle per hari


# ════════════════════════════════════════════════════════
# DATA STRUCTURES
# ════════════════════════════════════════════════════════

@dataclass
class RVSnapshot:
    """Satu snapshot hasil RV computation."""
    timestamp:       str
    ticker:          str
    spot:            float

    # Intraday state
    session_elapsed_pct: float    # 0.0 – 1.0, seberapa jauh sesi berjalan
    n_candles_5m:        int      # jumlah candle 5m yang sudah terbentuk
    n_candles_15m:       int      # jumlah candle 15m untuk display

    # RV metrics (dalam desimal, bukan persen)
    rv_intraday_raw:  float       # RV murni dari candle 5m hari ini
    rv_yesterday:     float       # RV hari kemarin (close-to-close 1 hari)
    hv20:             float       # HV20 sebagai baseline jangka panjang

    # Approach 2: Blended
    blend_weight:    float        # w = elapsed / full_session
    rv_blended:      float        # w*rv_intraday + (1-w)*rv_yesterday

    # Approach 3: HAR + intraday update
    rv_har_base:     float        # HAR forecast murni (dari daily history)
    rv_har_updated:  float        # HAR di-update dengan intraday accumulated
    har_coefficients: dict        # {'c': ..., 'beta_d': ..., 'beta_w': ..., 'beta_m': ...}

    # Display (15m candles, untuk chart)
    rv_display_15m:  float        # RV dari candle 15m hari ini (lebih smooth)

    # Metadata
    data_source:     str          # "live" or "synthetic"
    is_market_open:  bool


@dataclass
class RVEngineState:
    """State internal engine yang persist selama object hidup."""
    daily_rv_history:   np.ndarray = field(default_factory=lambda: np.array([]))
    har_model:          Optional[LinearRegression] = None
    har_fitted:         bool = False
    last_daily_fetch:   float = 0.0       # unix timestamp
    df_daily_cache:     Optional[pd.DataFrame] = None
    cache_ttl_sec:      int = 300         # re-fetch daily data tiap 5 menit


# ════════════════════════════════════════════════════════
# HELPERS: TIME
# ════════════════════════════════════════════════════════

def _ny_now() -> datetime:
    """Waktu sekarang di timezone New York (naive, untuk kalkulasi sesi)."""
    import zoneinfo
    tz_ny = zoneinfo.ZoneInfo("America/New_York")
    return datetime.now(tz_ny).replace(tzinfo=None)


def _session_elapsed_minutes(now: Optional[datetime] = None) -> float:
    """
    Berapa menit sesi NY sudah berjalan dari open (9:30).
    Return 0 kalau sebelum open, NY_SESSION_MIN kalau sesudah close.
    """
    if now is None:
        now = _ny_now()
    open_dt  = now.replace(hour=NY_OPEN_HOUR,  minute=NY_OPEN_MIN,  second=0, microsecond=0)
    close_dt = now.replace(hour=NY_CLOSE_HOUR, minute=NY_CLOSE_MIN, second=0, microsecond=0)
    if now <= open_dt:
        return 0.0
    if now >= close_dt:
        return float(NY_SESSION_MIN)
    return (now - open_dt).total_seconds() / 60.0


def _is_market_open(now: Optional[datetime] = None) -> bool:
    elapsed = _session_elapsed_minutes(now)
    return 0.0 < elapsed < NY_SESSION_MIN


# ════════════════════════════════════════════════════════
# HELPERS: DATA FETCH
# ════════════════════════════════════════════════════════

def _fetch_daily(ticker: str) -> tuple[pd.DataFrame, bool]:
    """Fetch OHLC daily 6 bulan. Return (df, is_live)."""
    try:
        df = yf.download(ticker, period="6mo", interval="1d",
                         progress=False, auto_adjust=True)
        df.dropna(inplace=True)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        if len(df) < 25:
            raise ValueError("Too few rows")
        return df, True
    except Exception:
        return _gen_synthetic_daily(), False


def _fetch_intraday(ticker: str, interval: str = "5m") -> pd.DataFrame:
    """
    Fetch candle intraday hari ini saja.
    interval: "5m" untuk RV calculation, "15m" untuk display.
    """
    try:
        df = yf.download(ticker, period="5d", interval=interval,
                         progress=False, auto_adjust=True)
        df.dropna(inplace=True)
        df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
        if df.empty:
            raise ValueError("Empty")
        # Filter hari ini saja (NY date)
        today_ny = _ny_now().date()
        # index bisa timezone-aware, normalize
        if df.index.tz is not None:
            import zoneinfo
            df.index = df.index.tz_convert("America/New_York").tz_localize(None)
        df = df[df.index.date == today_ny]
        if df.empty:
            raise ValueError("No today data")
        return df
    except Exception:
        # Synthetic intraday fallback
        spot = 5200.0
        return _gen_synthetic_intraday(spot, interval)


def _fetch_spot(ticker: str, df_daily: pd.DataFrame) -> tuple[float, str]:
    """Ambil harga spot terkini. Fallback ke last close."""
    try:
        spot = float(yf.Ticker(ticker).fast_info["last_price"])
        return spot, "realtime"
    except Exception:
        return float(df_daily["Close"].iloc[-1]), "last_close"


# ════════════════════════════════════════════════════════
# HELPERS: SYNTHETIC DATA (FALLBACK)
# ════════════════════════════════════════════════════════

def _gen_synthetic_daily(n: int = 130) -> pd.DataFrame:
    rng   = np.random.default_rng(42)
    spot0 = 5200.0
    mu    = 0.08 / TRADING_DAYS
    sigma = 0.18 / np.sqrt(TRADING_DAYS)
    dates = pd.bdate_range(end=pd.Timestamp.today(), periods=n)
    closes = [spot0]
    for _ in range(n - 1):
        closes.append(closes[-1] * np.exp(rng.normal(mu, sigma)))
    opens = [closes[0]] + [closes[i] * np.exp(rng.normal(0, sigma * 0.3)) for i in range(n - 1)]
    highs = [max(o, c) * (1 + abs(rng.normal(0, sigma * 0.5))) for o, c in zip(opens, closes)]
    lows  = [min(o, c) * (1 - abs(rng.normal(0, sigma * 0.5))) for o, c in zip(opens, closes)]
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes}, index=dates)


def _gen_synthetic_intraday(spot: float, interval: str = "5m") -> pd.DataFrame:
    rng      = np.random.default_rng(int(time.time()) % 9999)
    mins     = int(interval.replace("m", ""))
    n        = NY_SESSION_MIN // mins
    sigma_1m = 0.18 / np.sqrt(TRADING_DAYS * NY_SESSION_MIN)
    sigma    = sigma_1m * np.sqrt(mins)
    now_ny   = _ny_now()
    open_dt  = now_ny.replace(hour=NY_OPEN_HOUR, minute=NY_OPEN_MIN, second=0, microsecond=0)
    times    = [open_dt + pd.Timedelta(minutes=mins * i) for i in range(n)]
    closes   = [spot]
    for _ in range(n - 1):
        closes.append(closes[-1] * np.exp(rng.normal(0, sigma)))
    opens  = [closes[0]] + closes[:-1]
    highs  = [max(o, c) * (1 + abs(rng.normal(0, sigma * 0.4))) for o, c in zip(opens, closes)]
    lows   = [min(o, c) * (1 - abs(rng.normal(0, sigma * 0.4))) for o, c in zip(opens, closes)]
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes}, index=times)


# ════════════════════════════════════════════════════════
# MODULE A: RV CALCULATORS
# ════════════════════════════════════════════════════════

def rv_from_returns(log_returns: np.ndarray, annualize_factor: float) -> float:
    """
    RV = sqrt( Σ r²_i × annualize_factor )
    annualize_factor = TRADING_DAYS × (candles_per_day)  untuk interval apapun
    """
    if len(log_returns) < 2:
        return 0.0
    return float(np.sqrt(np.sum(log_returns ** 2) * annualize_factor))


def rv_intraday_partial(df_intraday: pd.DataFrame, interval_min: int = 5) -> float:
    """
    Hitung RV dari candle intraday yang sudah terbentuk hari ini.
    Accumulated squared returns, di-annualize dengan asumsi full day.

    Formula:
        RV = sqrt( Σ r²_i × 252 × (390/interval_min) )

    Notes:
        - Ini adalah RV "as if" full day berdasarkan pace saat ini
        - Di pagi hari (sedikit candle) → noisy, makanya di-blend
    """
    closes = df_intraday["Close"].values
    if len(closes) < 2:
        return 0.0
    log_rets = np.diff(np.log(closes))
    candles_full_day = NY_SESSION_MIN / interval_min
    annualize_factor = TRADING_DAYS * candles_full_day
    return rv_from_returns(log_rets, annualize_factor)


def hv20_from_daily(df_daily: pd.DataFrame) -> float:
    """HV20: std(daily log returns, 20 hari) × √252."""
    closes  = df_daily["Close"].values[-21:]
    returns = np.diff(np.log(closes))
    return float(np.std(returns, ddof=1) * np.sqrt(TRADING_DAYS))


def rv_yesterday(df_daily: pd.DataFrame) -> float:
    """
    RV hari kemarin: pakai squared daily return satu hari
    (proxy karena kita tidak punya intraday kemarin).
    Lebih akurat daripada |return| × √252.
    """
    closes = df_daily["Close"].values
    if len(closes) < 2:
        return hv20_from_daily(df_daily)
    r_yesterday = np.log(closes[-1] / closes[-2])
    # Annualize: r² × 252
    return float(np.sqrt(r_yesterday ** 2 * TRADING_DAYS))


def build_daily_rv_series(df_daily: pd.DataFrame) -> np.ndarray:
    """
    Build array RV harian dari daily OHLC.
    Pakai squared log returns (bukan absolute) — benar secara teoritis.

    RV_t = sqrt( r²_t × 252 )   ← proxy RV harian dari single return
    """
    closes  = df_daily["Close"].values
    returns = np.diff(np.log(closes))
    return np.sqrt(returns ** 2 * TRADING_DAYS)


# ════════════════════════════════════════════════════════
# MODULE B: APPROACH 2 — BLENDED RV
# ════════════════════════════════════════════════════════

def compute_rv_blended(
    rv_intraday:   float,
    rv_prev:       float,
    elapsed_min:   float,
    session_min:   float = NY_SESSION_MIN,
) -> tuple[float, float]:
    """
    Blend RV intraday (partial) dengan RV kemarin.

    Formula:
        w = elapsed_min / session_min    (0.0 pagi → 1.0 sore)
        RV_blend = w × RV_intraday + (1−w) × RV_prev

    Return:
        (rv_blended, blend_weight)
    """
    w = min(elapsed_min / session_min, 1.0)
    w = max(w, 0.0)
    rv_blend = w * rv_intraday + (1.0 - w) * rv_prev
    return float(rv_blend), float(w)


# ════════════════════════════════════════════════════════
# MODULE C: APPROACH 3 — HAR-RV + INTRADAY UPDATE
# ════════════════════════════════════════════════════════

def fit_har_model(rv_series: np.ndarray) -> tuple[LinearRegression, dict]:
    """
    Fit HAR-RV model via OLS dari historical daily RV series.

    Model:
        RV_{t+1} = c + β_d×RV_d + β_w×RV̄_w + β_m×RV̄_m + ε

    RV_d = RV kemarin
    RV_w = mean(RV 5 hari terakhir)
    RV_m = mean(RV 22 hari terakhir)

    Butuh minimal 25 observasi.
    """
    n = len(rv_series)
    if n < 25:
        # Default coefficients kalau data kurang (Corsi 2009 estimates)
        return None, {"c": 0.0001, "beta_d": 0.35, "beta_w": 0.25, "beta_m": 0.30}

    X_rows = []
    y_rows = []

    for i in range(22, n - 1):
        rv_d = rv_series[i]
        rv_w = np.mean(rv_series[i-4 : i+1])     # mean 5 hari
        rv_m = np.mean(rv_series[i-21: i+1])     # mean 22 hari
        X_rows.append([rv_d, rv_w, rv_m])
        y_rows.append(rv_series[i + 1])           # next-day RV sebagai target

    X = np.array(X_rows)
    y = np.array(y_rows)

    model = LinearRegression(fit_intercept=True)
    model.fit(X, y)

    coefs = {
        "c":      float(model.intercept_),
        "beta_d": float(model.coef_[0]),
        "beta_w": float(model.coef_[1]),
        "beta_m": float(model.coef_[2]),
        "r2":     float(model.score(X, y)),
    }
    return model, coefs


def har_forecast(rv_series: np.ndarray, model: Optional[LinearRegression], coefs: dict) -> float:
    """
    Forecast RV hari ini (sebelum market buka) pakai HAR.
    Kalau model fitted, pakai sklearn predict.
    Kalau tidak, pakai manual formula.
    """
    n = len(rv_series)
    if n < 22:
        return float(rv_series[-1]) if n > 0 else 0.15

    rv_d = rv_series[-1]
    rv_w = np.mean(rv_series[-5:])
    rv_m = np.mean(rv_series[-22:])

    if model is not None:
        pred = model.predict([[rv_d, rv_w, rv_m]])[0]
    else:
        pred = coefs["c"] + coefs["beta_d"] * rv_d + coefs["beta_w"] * rv_w + coefs["beta_m"] * rv_m

    return float(max(pred, 0.001))   # clamp, RV tidak boleh negatif


def har_intraday_update(
    rv_har_base:   float,
    rv_intraday:   float,
    elapsed_min:   float,
    session_min:   float = NY_SESSION_MIN,
    alpha:         float = 0.6,
) -> float:
    """
    Update HAR forecast dengan informasi intraday yang sudah terakumulasi.

    Formula (exponential blending):
        w = sigmoid-like weight berdasarkan seberapa jauh sesi berjalan
        w = elapsed / session × alpha   (alpha = max trust ke intraday)

        RV_har_updated = (1−w) × rv_har_base + w × rv_intraday

    alpha mengontrol seberapa agresif intraday menggantikan HAR forecast:
        alpha=0.6 → maks 60% dari intraday saat EOD
        alpha=1.0 → full trust ke intraday saat EOD

    Kenapa tidak langsung replace?
    Karena intraday 5m masih noise di pagi hari.
    HAR forecast lebih stable sebagai prior.
    """
    w = min(elapsed_min / session_min * alpha, alpha)
    w = max(w, 0.0)
    return float((1.0 - w) * rv_har_base + w * rv_intraday)


# ════════════════════════════════════════════════════════
# MAIN ENGINE CLASS
# ════════════════════════════════════════════════════════

class RVEngine:
    """
    Engine utama untuk menghitung RV realtime saat market buka.

    Usage:
        engine = RVEngine(ticker="^GSPC")
        snapshot = engine.compute()

        # Akses hasil:
        snapshot.rv_blended      # Approach 2
        snapshot.rv_har_updated  # Approach 3
        snapshot.rv_display_15m  # untuk chart di frontend

    Bisa di-call berulang (polling), state daily data di-cache otomatis.
    """

    def __init__(
        self,
        ticker:    str   = "^GSPC",
        har_alpha: float = 0.6,   # agresivitas intraday update ke HAR
    ):
        self.ticker    = ticker
        self.har_alpha = har_alpha
        self._state    = RVEngineState()

    # ─────────────────────────────────────────
    # INTERNAL: Cache Management
    # ─────────────────────────────────────────

    def _get_daily_data(self) -> tuple[pd.DataFrame, bool]:
        """Return cached daily data, re-fetch kalau sudah expired."""
        now = time.time()
        if (
            self._state.df_daily_cache is not None
            and (now - self._state.last_daily_fetch) < self._state.cache_ttl_sec
        ):
            return self._state.df_daily_cache, True   # dari cache

        df, is_live = _fetch_daily(self.ticker)
        self._state.df_daily_cache  = df
        self._state.last_daily_fetch = now

        # Refit HAR model setiap kali data harian di-refresh
        rv_series = build_daily_rv_series(df)
        self._state.daily_rv_history = rv_series
        model, coefs = fit_har_model(rv_series)
        self._state.har_model      = model
        self._state.har_coefs      = coefs
        self._state.har_fitted     = model is not None

        return df, is_live

    # ─────────────────────────────────────────
    # MAIN COMPUTE
    # ─────────────────────────────────────────

    def compute(self) -> RVSnapshot:
        """
        Hitung semua RV metrics terkini.
        Aman dipanggil berulang (polling tiap N detik).
        """
        now_ny      = _ny_now()
        market_open = _is_market_open(now_ny)
        elapsed_min = _session_elapsed_minutes(now_ny)

        # ── Daily data (cached) ───────────────────────────
        df_daily, is_live = self._get_daily_data()
        spot, spot_src    = _fetch_spot(self.ticker, df_daily)

        # ── Baseline metrics ─────────────────────────────
        hv20      = hv20_from_daily(df_daily)
        rv_prev   = rv_yesterday(df_daily)
        rv_series = self._state.daily_rv_history

        # ── HAR base forecast ─────────────────────────────
        coefs        = getattr(self._state, "har_coefs", {"c": 0.0001, "beta_d": 0.35, "beta_w": 0.25, "beta_m": 0.30})
        rv_har_base  = har_forecast(rv_series, self._state.har_model, coefs)

        # ── Intraday 5m (untuk RV calculation) ───────────
        df_5m       = _fetch_intraday(self.ticker, interval="5m")
        n_5m        = len(df_5m)
        rv_intraday = rv_intraday_partial(df_5m, interval_min=5) if n_5m >= 2 else rv_prev

        # ── Intraday 15m (untuk display/chart) ────────────
        df_15m      = _fetch_intraday(self.ticker, interval="15m")
        n_15m       = len(df_15m)
        rv_15m      = rv_intraday_partial(df_15m, interval_min=15) if n_15m >= 2 else rv_prev

        # ── Approach 2: Blended ───────────────────────────
        if market_open:
            rv_blend, blend_w = compute_rv_blended(rv_intraday, rv_prev, elapsed_min)
        else:
            # Market tutup → pakai HV20 sebagai best estimate
            rv_blend  = hv20
            blend_w   = 0.0

        # ── Approach 3: HAR + intraday update ─────────────
        if market_open and n_5m >= 2:
            rv_har_updated = har_intraday_update(
                rv_har_base, rv_intraday, elapsed_min, alpha=self.har_alpha
            )
        else:
            # Market belum/sudah tutup → HAR base forecast saja
            rv_har_updated = rv_har_base

        # ── Build snapshot ────────────────────────────────
        snapshot = RVSnapshot(
            timestamp            = datetime.now().isoformat(),
            ticker               = self.ticker,
            spot                 = round(spot, 2),

            session_elapsed_pct  = round(elapsed_min / NY_SESSION_MIN, 4),
            n_candles_5m         = n_5m,
            n_candles_15m        = n_15m,

            rv_intraday_raw      = round(rv_intraday, 6),
            rv_yesterday         = round(rv_prev,     6),
            hv20                 = round(hv20,        6),

            blend_weight         = round(blend_w,     4),
            rv_blended           = round(rv_blend,    6),

            rv_har_base          = round(rv_har_base,    6),
            rv_har_updated       = round(rv_har_updated, 6),
            har_coefficients     = {k: round(v, 6) for k, v in coefs.items()},

            rv_display_15m       = round(rv_15m, 6),

            data_source          = "live" if is_live else "synthetic",
            is_market_open       = market_open,
        )

        return snapshot

    def compute_dict(self) -> dict:
        """Versi dict dari compute(), untuk langsung di-return di FastAPI endpoint."""
        s = self.compute()
        return {
            "timestamp":           s.timestamp,
            "ticker":              s.ticker,
            "spot":                s.spot,
            "is_market_open":      s.is_market_open,
            "session_elapsed_pct": s.session_elapsed_pct,
            "data_source":         s.data_source,

            # Candle counts
            "n_candles_5m":        s.n_candles_5m,
            "n_candles_15m":       s.n_candles_15m,

            # Raw components
            "rv_intraday_raw":     s.rv_intraday_raw,
            "rv_intraday_raw_pct": round(s.rv_intraday_raw * 100, 2),
            "rv_yesterday":        s.rv_yesterday,
            "rv_yesterday_pct":    round(s.rv_yesterday * 100, 2),
            "hv20":                s.hv20,
            "hv20_pct":            round(s.hv20 * 100, 2),

            # Approach 2
            "blend_weight":        s.blend_weight,
            "rv_blended":          s.rv_blended,
            "rv_blended_pct":      round(s.rv_blended * 100, 2),

            # Approach 3
            "rv_har_base":         s.rv_har_base,
            "rv_har_base_pct":     round(s.rv_har_base * 100, 2),
            "rv_har_updated":      s.rv_har_updated,
            "rv_har_updated_pct":  round(s.rv_har_updated * 100, 2),
            "har_coefficients":    s.har_coefficients,

            # Display (15m)
            "rv_display_15m":      s.rv_display_15m,
            "rv_display_15m_pct":  round(s.rv_display_15m * 100, 2),
        }


# ════════════════════════════════════════════════════════
# INTEGRASI KE vrp_api.py
# ════════════════════════════════════════════════════════
#
# Di vrp_api.py, replace MODULE 2 & 3 dengan:
#
#   from rv_engine import RVEngine
#
#   # Inisialisasi sekali (global / per-ticker)
#   _rv_engine = RVEngine(ticker="^GSPC")
#
#   # Di dalam compute_vrp_result():
#   rv_data = _rv_engine.compute_dict()
#   rv      = rv_data["rv_blended"]      # Approach 2 — untuk VRP calculation
#   rv_har  = rv_data["rv_har_updated"]  # Approach 3 — HAR realtime
#
#   # Tambahkan rv_data ke response dict kalau mau expose semua metrics:
#   result["rv_engine"] = rv_data
#
# ════════════════════════════════════════════════════════


# ════════════════════════════════════════════════════════
# STANDALONE TEST
# ════════════════════════════════════════════════════════

if __name__ == "__main__":
    import json

    print("=" * 60)
    print("RV Engine — Standalone Test")
    print("=" * 60)

    ticker = "^GSPC"
    engine = RVEngine(ticker=ticker, har_alpha=0.6)

    print(f"\nFetching data untuk {ticker}...")
    result = engine.compute_dict()

    print(f"\n{'─'*40}")
    print(f"Ticker        : {result['ticker']}")
    print(f"Spot          : {result['spot']}")
    print(f"Market Open   : {result['is_market_open']}")
    print(f"Elapsed       : {result['session_elapsed_pct']*100:.1f}% of session")
    print(f"Data Source   : {result['data_source']}")
    print(f"\n── Candle Counts ──")
    print(f"5m candles    : {result['n_candles_5m']}")
    print(f"15m candles   : {result['n_candles_15m']}")
    print(f"\n── RV Components ──")
    print(f"RV Intraday   : {result['rv_intraday_raw_pct']:.2f}%  (5m, accumulated)")
    print(f"RV Yesterday  : {result['rv_yesterday_pct']:.2f}%")
    print(f"HV20          : {result['hv20_pct']:.2f}%")
    print(f"\n── Approach 2: Blended ──")
    print(f"Blend Weight  : {result['blend_weight']:.2f}  (intraday weight)")
    print(f"RV Blended    : {result['rv_blended_pct']:.2f}%")
    print(f"\n── Approach 3: HAR + Intraday ──")
    print(f"HAR Base      : {result['rv_har_base_pct']:.2f}%  (forecast sebelum market buka)")
    print(f"HAR Updated   : {result['rv_har_updated_pct']:.2f}%  (di-update dengan intraday)")
    print(f"HAR Coefs     : {result['har_coefficients']}")
    print(f"\n── Display (15m) ──")
    print(f"RV 15m        : {result['rv_display_15m_pct']:.2f}%")
    print(f"{'─'*40}\n")