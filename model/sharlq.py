

[1]
13 d
"""
============================================================
  SPY Intraday Support & Resistance — K-Means Clustering
  Timeframe  : 5 menit
  Lookback   : 5 hari terakhir (RTH only)
  Features   : H, L, C, Volume-Weighted Price, Session Tag
============================================================
Pipeline:
  1. Fetch data 5m SPY (5 hari) via yfinance
  2. Filter sesi RTH, pre-market, AH
  3. Feature engineering: VWAP-weighted price + session encoding
  4. Elbow Method → K optimal
  5. KMeans → ekstrak S&R levels + strength
  6. Visualisasi multi-panel dark-mode
"""

import warnings
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import FancyArrowPatch
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler


# ─────────────────────────────────────────────────────────
#  KONSTANTA SESI
# ─────────────────────────────────────────────────────────

# Semua waktu dalam ET (Eastern Time)
SESSION_BOUNDS = {
    "pre_market": ("04:00", "09:30"),
    "rth":        ("09:30", "16:00"),   # Regular Trading Hours
    "after_hours":("16:00", "20:00"),
}

# Bobot tiap sesi — RTH paling penting untuk intraday S&R
SESSION_WEIGHTS = {
    "pre_market":  0.6,
    "rth":         1.0,
    "after_hours": 0.5,
}

SESSION_COLORS = {
    "pre_market":  "#6E7681",   # Abu
    "rth":         "#58A6FF",   # Biru terang
    "after_hours": "#BC8CFF",   # Ungu
}


# ─────────────────────────────────────────────────────────
#  1. FETCH DATA INTRADAY
# ─────────────────────────────────────────────────────────

def fetch_intraday(ticker: str = "SPY", interval: str = "5m", days: int = 5) -> pd.DataFrame:
    """
    Ambil data intraday 5m dari yfinance.
    yfinance limit: data 5m maksimal 60 hari ke belakang.

    Returns
    -------
    pd.DataFrame dengan kolom: Open, High, Low, Close, Volume
    Index: DatetimeTzAware (US/Eastern)
    """
    print(f"[1/6] Fetching {ticker} {interval} data ({days} hari)...")

    df = yf.download(
        ticker,
        period=f"{days}d",
        interval=interval,
        auto_adjust=True,
        progress=False
    )

    if df.empty:
        raise ValueError("Data kosong. Cek ticker / koneksi internet.")

    # Flatten MultiIndex jika ada
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    # Konversi ke Eastern Time agar bisa filter sesi dengan benar
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC").tz_convert("US/Eastern")
    else:
        df.index = df.index.tz_convert("US/Eastern")

    print(f"    → {len(df)} bars | {df.index[0]} s/d {df.index[-1]}")
    return df


# ─────────────────────────────────────────────────────────
#  2. LABELING SESI
# ─────────────────────────────────────────────────────────

def label_sessions(df: pd.DataFrame) -> pd.DataFrame:
    """
    Tambahkan kolom 'session' ke setiap bar:
      'pre_market' | 'rth' | 'after_hours' | 'closed'

    Juga tambahkan kolom 'session_weight' untuk feature engineering.
    """
    print("[2/6] Melabeli sesi trading (Pre-Market / RTH / After-Hours)...")

    times = df.index.time

    def classify(t):
        from datetime import time
        pm_start = pd.Timestamp("04:00").time()
        rth_start = pd.Timestamp("09:30").time()
        rth_end   = pd.Timestamp("16:00").time()
        ah_end    = pd.Timestamp("20:00").time()

        if   pm_start  <= t < rth_start: return "pre_market"
        elif rth_start <= t < rth_end:   return "rth"
        elif rth_end   <= t < ah_end:    return "after_hours"
        else:                            return "closed"

    df = df.copy()
    df["session"] = [classify(t) for t in times]
    df["session_weight"] = df["session"].map(SESSION_WEIGHTS).fillna(0)

    # Drop bar yang di luar semua sesi (overnight gap)
    df = df[df["session"] != "closed"].copy()

    counts = df["session"].value_counts()
    for s, c in counts.items():
        print(f"    → {s:<14}: {c} bars")

    return df


# ─────────────────────────────────────────────────────────
#  3. FEATURE ENGINEERING
# ─────────────────────────────────────────────────────────

def build_features(df: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """
    Bangun array fitur untuk KMeans clustering intraday.

    Strategi:
    ─────────
    A) Typical Price per bar = (H + L + C) / 3
    B) VWAP-weighting: tiap bar direpresentasikan sebanyak
       proportional terhadap volume-nya → bar volume tinggi
       punya pengaruh lebih besar pada cluster centroid.
    C) Session weighting: RTH bars punya bobot 1.0,
       pre-market 0.6, after-hours 0.5.

    Kombinasi B+C membuat centroid merepresentasikan zona
    harga yang benar-benar "diperdagangkan" secara aktif.

    Returns
    -------
    prices_weighted : np.ndarray (N, 1) — untuk KMeans
    prices_raw      : np.ndarray (N,)   — untuk reference
    """
    print("[3/6] Membangun fitur (Volume-Weighted + Session-Weighted)...")

    df = df.copy()

    # Typical Price per bar
    df["typical_price"] = (df["High"] + df["Low"] + df["Close"]) / 3

    # Normalisasi volume agar tidak overflow saat replikasi
    vol_norm = df["Volume"] / df["Volume"].mean()

    # Gabungkan bobot: volume × session
    df["combined_weight"] = (vol_norm * df["session_weight"]).clip(lower=0.1)

    # Replikasi tiap typical price sebanyak round(weight * 10)
    # Semakin tinggi volume & semakin penting sesinya →
    # semakin banyak "vote" harga itu ke dalam pool clustering
    replicated_prices = []
    for _, row in df.iterrows():
        repeats = max(1, int(round(row["combined_weight"] * 10)))
        replicated_prices.extend([row["typical_price"]] * repeats)

    prices = np.array(replicated_prices)
    prices_raw = df["typical_price"].values

    print(f"    → {len(df)} bars → {len(prices)} weighted price points")
    return prices.reshape(-1, 1), prices_raw


# ─────────────────────────────────────────────────────────
#  4. ELBOW METHOD
# ─────────────────────────────────────────────────────────

def find_optimal_k(
    X: np.ndarray,
    k_min: int = 6,
    k_max: int = 15,
    random_state: int = 42
) -> tuple[int, list, list]:
    """
    Cari K optimal via Elbow Method (second-derivative detection).
    Intraday butuh lebih banyak level vs daily → k_min=6, k_max=15.
    """
    print(f"[4/6] Elbow Method: menguji K={k_min}..{k_max}...")

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    inertias = []
    k_range = list(range(k_min, k_max + 1))

    for k in k_range:
        km = KMeans(n_clusters=k, random_state=random_state, n_init=15)
        km.fit(X_scaled)
        inertias.append(km.inertia_)

    # Second derivative untuk deteksi elbow
    d1 = np.diff(inertias)
    d2 = np.diff(d1)
    elbow_idx = np.argmax(np.abs(d2)) + 1
    optimal_k = k_range[elbow_idx]

    print(f"    → K optimal: {optimal_k}")
    return optimal_k, inertias, k_range


# ─────────────────────────────────────────────────────────
#  5. FIT KMEANS & KALKULASI LEVEL
# ─────────────────────────────────────────────────────────

def fit_kmeans(
    X: np.ndarray,
    df: pd.DataFrame,
    k: int,
    random_state: int = 42
) -> dict:
    """
    Fit KMeans dan ekstrak level S&R dengan metadata:
      - price    : centroid (harga S&R)
      - touches  : jumlah weighted price points di cluster
      - strength : skor 1–10
      - session  : sesi dominan di cluster ini
      - proximity: jarak ke harga close terakhir (% dari price)

    Juga hitung apakah level adalah Support atau Resistance
    berdasarkan posisi relatif ke close terakhir.
    """
    print(f"[5/6] Fitting KMeans (K={k}) & kalkulasi level...")

    km = KMeans(n_clusters=k, random_state=random_state, n_init=15)
    labels = km.fit_predict(X)

    centroids = km.cluster_centers_.flatten()
    last_close = df["Close"].iloc[-1]

    unique, counts = np.unique(labels, return_counts=True)
    cluster_sizes = dict(zip(unique, counts))

    max_touches = max(cluster_sizes.values())

    levels = []
    for i, price in enumerate(centroids):
        size = cluster_sizes.get(i, 0)
        strength = round((size / max_touches) * 10, 1)
        sr_type = "Resistance" if price > last_close else "Support"
        proximity_pct = abs(price - last_close) / last_close * 100

        levels.append({
            "price": price,
            "touches": size,
            "strength": strength,
            "type": sr_type,
            "proximity_pct": round(proximity_pct, 2),
        })

    levels.sort(key=lambda x: x["price"])

    return {
        "levels": levels,
        "labels": labels,
        "k": k,
        "last_close": last_close,
    }


# ─────────────────────────────────────────────────────────
#  6. VISUALISASI
# ─────────────────────────────────────────────────────────

def plot_results(
    df: pd.DataFrame,
    result: dict,
    inertias: list,
    k_range: list,
    optimal_k: int,
    ticker: str = "SPY"
) -> None:
    """
    3-panel dark-mode chart:
      Panel 1 (kecil)  — Elbow Method
      Panel 2 (besar)  — Harga 5m + garis S&R per sesi
      Panel 3 (kecil)  — Volume per bar + session coloring
    """
    print("[6/6] Membuat visualisasi multi-panel...")

    levels    = result["levels"]
    last_close = float(result["last_close"])

    BG        = "#0D1117"
    GRID      = "#21262D"
    BORDER    = "#30363D"
    TEXT_MUTED = "#8B949E"

    def level_color(lvl: dict) -> str:
        # Support = hijau, Resistance = merah, intensitas dari strength
        base = (0, 255, 100) if lvl["type"] == "Support" else (255, 80, 80)
        alpha_hex = hex(int(55 + lvl["strength"] / 10 * 200))[2:].zfill(2)
        r, g, b = base
        return f"#{r:02X}{g:02X}{b:02X}"

    fig = plt.figure(figsize=(18, 14), facecolor=BG)
    gs  = fig.add_gridspec(3, 1, height_ratios=[1, 4, 1.2], hspace=0.08)

    ax_elbow  = fig.add_subplot(gs[0])
    ax_price  = fig.add_subplot(gs[1])
    ax_volume = fig.add_subplot(gs[2])

    for ax in [ax_elbow, ax_price, ax_volume]:
        ax.set_facecolor(BG)
        ax.tick_params(colors=TEXT_MUTED, labelsize=8)
        ax.spines[:].set_color(BORDER)
        ax.grid(True, color=GRID, linewidth=0.5)

    # ── Panel 1: Elbow ────────────────────────────
    ax_elbow.plot(k_range, inertias, "o-", color="#58A6FF", lw=2, ms=5)
    ax_elbow.axvline(optimal_k, color="#FF4444", ls="--", lw=1.5,
                     label=f"K Optimal = {optimal_k}")
    ax_elbow.set_title(f"Elbow Method  |  K Optimal = {optimal_k}",
                       color="white", fontsize=10, pad=6, loc="left")
    ax_elbow.set_ylabel("Inertia", color=TEXT_MUTED, fontsize=8)
    ax_elbow.legend(facecolor="#161B22", edgecolor=BORDER,
                    labelcolor="white", fontsize=8)
    ax_elbow.set_xticklabels([])

    # ── Panel 2: Harga + S&R ──────────────────────

    # Plot per sesi dengan warna berbeda
    for session, color in SESSION_COLORS.items():
        mask = df["session"] == session
        seg  = df[mask]
        if seg.empty:
            continue
        ax_price.plot(seg.index, seg["Close"].values.flatten(),
                      color=color, lw=0.8, alpha=0.85, label=session.replace("_", " ").title())

    # Garis S&R horizontal
    price_min = df["Low"].min()
    price_max = df["High"].max()

    for lvl in levels:
        price    = lvl["price"]
        color    = level_color(lvl)
        lw       = 0.6 + (lvl["strength"] / 10) * 1.6
        ls       = "--" if lvl["type"] == "Support" else "-."

        ax_price.axhline(price, color=color, lw=lw, ls=ls, alpha=0.9)

        # Label di sisi kanan
        label_str = (
            f"  {'S' if lvl['type']=='Support' else 'R'}"
            f" ${price:.2f}"
            f"  ★{lvl['strength']}"
            f"  [{lvl['proximity_pct']}%]"
        )
        ax_price.text(
            df.index[-1], price, label_str,
            va="center", ha="left",
            color=color, fontsize=7.5, fontweight="bold"
        )

    # Garis harga terakhir
    ax_price.axhline(last_close, color="#FFEB3B", lw=1.2, ls=":", alpha=0.9,
                     label=f"Last Close ${last_close:.2f}")
    ax_price.text(df.index[0], last_close,
                  f"  Last ${last_close:.2f}",
                  color="#FFEB3B", fontsize=8, va="bottom")

    ax_price.set_title(
        f"{ticker} 5m Intraday  |  K-Means S&R (5 Hari Terakhir, K={optimal_k})",
        color="white", fontsize=12, pad=8, loc="left"
    )
    ax_price.set_ylabel("Harga (USD)", color=TEXT_MUTED)
    ax_price.set_xticklabels([])

    # Legend gabungan sesi + level type
    from matplotlib.lines import Line2D
    legend_els = [
        Line2D([0],[0], color=SESSION_COLORS["pre_market"], lw=1.5, label="Pre-Market"),
        Line2D([0],[0], color=SESSION_COLORS["rth"],        lw=1.5, label="RTH"),
        Line2D([0],[0], color=SESSION_COLORS["after_hours"],lw=1.5, label="After-Hours"),
        Line2D([0],[0], color="#FFEB3B",   lw=1.2, ls=":", label="Last Close"),
        Line2D([0],[0], color="#50FA7B",   lw=1.2, ls="--", label="Support"),
        Line2D([0],[0], color="#FF5555",   lw=1.2, ls="-.", label="Resistance"),
    ]
    ax_price.legend(
        handles=legend_els,
        facecolor="#161B22", edgecolor=BORDER,
        labelcolor="white", fontsize=8,
        loc="upper left", ncol=3
    )

    # ── Panel 3: Volume per sesi ───────────────────
    vol = df["Volume"].values.flatten()
    colors_vol = [SESSION_COLORS.get(s, "#8B949E") for s in df["session"]]
    ax_volume.bar(df.index, vol, color=colors_vol, width=0.003, alpha=0.85)
    ax_volume.set_ylabel("Volume", color=TEXT_MUTED, fontsize=8)

    # Format sumbu waktu
    ax_volume.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d\n%H:%M"))
    ax_volume.xaxis.set_major_locator(mdates.HourLocator(interval=4))
    plt.setp(ax_volume.xaxis.get_majorticklabels(), rotation=0, ha="center", fontsize=7)

    # Align x-axis semua panel
    for ax in [ax_price, ax_volume]:
        ax.set_xlim(df.index[0], df.index[-1])

    out_path = "/mnt/user-data/outputs/spy_intraday_sr.png"
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor=BG)
    plt.close()
    print(f"    → Chart disimpan: {out_path}")


# ─────────────────────────────────────────────────────────
#  PRINT SUMMARY
# ─────────────────────────────────────────────────────────

def print_summary(result: dict, ticker: str = "SPY") -> None:
    levels     = result["levels"]
    last_close = float(result["last_close"])

    print("\n" + "="*68)
    print(f"  {ticker} INTRADAY S&R LEVELS  |  Last Close: ${last_close:.2f}")
    print("="*68)
    print(f"  {'#':<3} {'Type':<12} {'Harga':>9}  {'Dist%':>6}  {'Touches':>7}  {'Strength'}")
    print("-"*68)

    for i, lvl in enumerate(levels, 1):
        bar = "█" * int(lvl["strength"])
        tag = "▲ SUP" if lvl["type"] == "Support" else "▼ RES"
        marker = " ◄ NEAREST" if lvl["proximity_pct"] == min(
            l["proximity_pct"] for l in levels) else ""
        print(
            f"  {i:<3} {tag:<12} ${lvl['price']:>8.2f}"
            f"  {lvl['proximity_pct']:>5.2f}%"
            f"  {lvl['touches']:>7}"
            f"  {bar:<10} ★{lvl['strength']}{marker}"
        )

    print("="*68)

    # Key levels summary
    supports    = [l for l in levels if l["type"] == "Support"]
    resistances = [l for l in levels if l["type"] == "Resistance"]

    if supports:
        nearest_sup = max(supports, key=lambda x: x["price"])
        print(f"\n  Nearest Support    : ${nearest_sup['price']:.2f}  (★{nearest_sup['strength']})")
    if resistances:
        nearest_res = min(resistances, key=lambda x: x["price"])
        print(f"  Nearest Resistance : ${nearest_res['price']:.2f}  (★{nearest_res['strength']})")

    print()


# ─────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────

def main(ticker: str = "SPY"):
    print("\n" + "━"*60)
    print(f"  INTRADAY K-MEANS S&R DETECTOR  |  {ticker}  |  5m  |  5D")
    print("━"*60 + "\n")

    df               = fetch_intraday(ticker, interval="5m", days=5)
    df               = label_sessions(df)
    X, prices_raw    = build_features(df)
    optimal_k, inertias, k_range = find_optimal_k(X, k_min=6, k_max=15)
    result           = fit_kmeans(X, df, k=optimal_k)

    print_summary(result, ticker=ticker)
    plot_results(df, result, inertias, k_range, optimal_k, ticker=ticker)

    print("✅ Done!\n")
    return result


if __name__ == "__main__":
    main(ticker="SPY")

Langkah berikutnya:

[11]
1 d
import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
import matplotlib.pyplot as plt
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

class LHAR_RV_Model:
    def __init__(self, ticker, start_date, end_date, use_gk=False):
        self.ticker = ticker
        self.start_date = start_date
        self.end_date = end_date
        self.use_gk = use_gk
        self.data = None
        self.model = None
        
    def fetch_data(self):
        """Mengambil data historis dari Yahoo Finance."""
        print(f"Mengambil data {self.ticker} dari {self.start_date} hingga {self.end_date}...")
        df = yf.download(self.ticker, start=self.start_date, end=self.end_date, progress=False)
        
        # Jika yfinance mengembalikan MultiIndex columns (sering terjadi pada versi terbaru)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
            
        self.data = df
        return self.data
        
    def calculate_features(self):
        """Menghitung Realized Volatility dan komponen LHAR."""
        df = self.data.copy()
        
        # Log Returns
        df['Log_Ret'] = np.log(df['Close'] / df['Close'].shift(1))
        
        # Estimasi Realized Volatility (RV)
        if self.use_gk:
            # Garman-Klass Estimator
            log_hl = np.log(df['High'] / df['Low'])
            log_co = np.log(df['Close'] / df['Open'])
            df['RV'] = 0.5 * log_hl**2 - (2 * np.log(2) - 1) * log_co**2
        else:
            # Squared Log Returns (Proxy untuk daily variance)
            df['RV'] = df['Log_Ret']**2
            
        df = df.dropna()
        
        # Heterogeneous Components (t-1, 5-day avg, 22-day avg)
        df['RV_d'] = df['RV'].shift(1)
        df['RV_w'] = df['RV_d'].rolling(window=5).mean()
        df['RV_m'] = df['RV_d'].rolling(window=22).mean()
        
        # Leverage Effect: Negative Returns di t-1
        df['Neg_Ret_d'] = df['Log_Ret'].shift(1).apply(lambda x: min(x, 0))
        
        df = df.dropna()
        
        # Log-Transformation pada semua variabel RV
        # Ditambahkan epsilon kecil untuk mencegah log(0)
        eps = 1e-10
        df['Log_RV'] = np.log(df['RV'] + eps)
        df['Log_RV_d'] = np.log(df['RV_d'] + eps)
        df['Log_RV_w'] = np.log(df['RV_w'] + eps)
        df['Log_RV_m'] = np.log(df['RV_m'] + eps)
        
        self.data = df
        return self.data
        
    def fit_model(self, train_ratio=0.8):
        """Melakukan regresi OLS dan memisahkan data latih/uji."""
        df = self.data
        
        # Variabel Dependen (Y) dan Independen (X)
        Y = df['Log_RV']
        X = df[['Log_RV_d', 'Log_RV_w', 'Log_RV_m', 'Neg_Ret_d']]
        X = sm.add_constant(X)
        
        # Train-Test Split
        split_idx = int(len(df) * train_ratio)
        self.X_train, self.X_test = X.iloc[:split_idx], X.iloc[split_idx:]
        self.Y_train, self.Y_test = Y.iloc[:split_idx], Y.iloc[split_idx:]
        self.dates_test = df.index[split_idx:]
        self.actual_rv_test = df['RV'].iloc[split_idx:]
        
        # Estimasi OLS
        self.model = sm.OLS(self.Y_train, self.X_train).fit()
        print("\n" + "="*50)
        print("RINGKASAN STATISTIK MODEL LHAR-RV")
        print("="*50)
        print(self.model.summary())
        
    def evaluate_model(self):
        """Mengevaluasi model pada data uji (Out-of-Sample)."""
        # Prediksi dalam log-space
        log_pred = self.model.predict(self.X_test)
        
        # Transformasi balik dari log ke RV asli menggunakan eksponensial
        self.rv_pred = np.exp(log_pred)
        
        # Hitung Metrik
        mae = mean_absolute_error(self.actual_rv_test, self.rv_pred)
        rmse = np.sqrt(mean_squared_error(self.actual_rv_test, self.rv_pred))
        
        print("\n" + "="*50)
        print("METRIK EVALUASI (OUT-OF-SAMPLE)")
        print("="*50)
        print(f"MAE  : {mae:.6f}")
        print(f"RMSE : {rmse:.6f}")
        
    def plot_results(self):
        """Visualisasi Aktual vs Prediksi dan Residual Plot."""
        residuals = self.actual_rv_test - self.rv_pred
        
        fig, axes = plt.subplots(2, 1, figsize=(12, 10))
        
        # Plot 1: Actual vs Predicted RV
        axes[0].plot(self.dates_test, self.actual_rv_test, label='Actual RV', color='blue', alpha=0.6)
        axes[0].plot(self.dates_test, self.rv_pred, label='Predicted RV (LHAR)', color='red', alpha=0.8, linestyle='--')
        axes[0].set_title(f'Actual vs Predicted Realized Volatility ({self.ticker})', fontsize=14)
        axes[0].set_ylabel('Variance')
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)
        
        # Plot 2: Residual Plot
        axes[1].scatter(self.dates_test, residuals, color='purple', alpha=0.5)
        axes[1].axhline(0, color='black', linestyle='--')
        axes[1].set_title('Residual Plot (Actual - Predicted)', fontsize=14)
        axes[1].set_ylabel('Error')
        axes[1].grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.show()
        
    def forecast_tomorrow(self):
        """
        Memprediksi volatilitas besok DAN mengevaluasi akurasi prediksi kemarin.
        """
        if self.model is None:
            print("Model belum di-fit.")
            return

        # 1. AMBIL DATA UNTUK EVALUASI PREDIKSI KEMARIN (t-1)
        # Kita butuh data t-2 untuk memprediksi t-1
        row_minus_2 = self.data.iloc[-2]
        actual_rv_yesterday = self.data.iloc[-1]['RV'] # Realita kemarin
        
        # Fitur dari t-2 untuk memprediksi t-1
        eps = 1e-10
        x_yesterday = [
            1.0,
            np.log(self.data.iloc[-2]['RV'] + eps),
            np.log(self.data.iloc[-(2+5):-2]['RV'].mean() + eps),
            np.log(self.data.iloc[-(2+22):-2]['RV'].mean() + eps),
            min(self.data.iloc[-2]['Log_Ret'], 0)
        ]
        
        # Hitung apa yang model prediksi UNTUK kemarin
        pred_log_rv_yesterday = self.model.predict([x_yesterday])[0]
        pred_rv_yesterday = np.exp(pred_log_rv_yesterday)
        
        # Hitung Error (Melesatnya berapa)
        abs_error = abs(actual_rv_yesterday - pred_rv_yesterday)
        pct_error = (abs_error / actual_rv_yesterday) * 100

        # 2. HITUNG FORECAST UNTUK BESOK (t+1)
        last_row = self.data.iloc[-1]
        x_next = [
            1.0,
            np.log(last_row['RV'] + eps),
            np.log(self.data['RV'].iloc[-5:].mean() + eps),
            np.log(self.data['RV'].iloc[-22:].mean() + eps),
            min(last_row['Log_Ret'], 0)
        ]
        pred_log_rv_next = self.model.predict([x_next])[0]
        pred_rv_next = np.exp(pred_log_rv_next)
        ann_vol_next = np.sqrt(pred_rv_next * 252) * 100
        ann_vol_yesterday_actual = np.sqrt(actual_rv_yesterday * 252) * 100

        # 3. OUTPUT KOMPREHENSIF
        print("\n" + "="*65)
        print("📊 MONITORING PERFORMA MODEL LHAR-RV (BACKTEST CHECK)")
        print("="*65)
        print(f"Evaluasi Prediksi untuk Tanggal : {self.data.index[-1].strftime('%Y-%m-%d')}")
        print(f"Prediksi Kemarin (Forecast)     : {pred_rv_yesterday:.8f}")
        print(f"Realisasi Kemarin (Actual)      : {actual_rv_yesterday:.8f}")
        print(f"Selisih (Absolute Error)        : {abs_error:.8f}")
        
        # Status Akurasi
        status_error = "OVERESTIMATED 🔴" if pred_rv_yesterday > actual_rv_yesterday else "UNDERESTIMATED 🔵"
        print(f"Akurasi Melesat (Error %)       : {pct_error:.2f}% ({status_error})")
        
        print("\n" + "="*65)
        print("📈 OUT-OF-SAMPLE FORECAST UNTUK BESOK")
        print("="*65)
        print(f"Baseline Volatility (Kemarin)   : {ann_vol_yesterday_actual:.2f}%")
        print(f"Predicted Volatility (Besok)    : {ann_vol_next:.2f}%")
        
        diff = ann_vol_next - ann_vol_yesterday_actual
        arah = "NAIK (Expansion) 🔼" if diff > 0 else "TURUN (Contraction) 🔽"
        print("-" * 65)
        print(f"Ekspektasi Pergerakan Besok     : {arah} ({diff:+.2f}%)")
        print("="*65)
# ==========================================
# EKSEKUSI SCRIPT
# ==========================================
if __name__ == "__main__":
    TICKER = "SPY"
    START_DATE = "2020-01-01"
    END_DATE = "2026-04-01"
    # Inisialisasi Model (use_gk=True menggunakan estimator Garman-Klass)
    lhar = LHAR_RV_Model(ticker=TICKER, start_date=START_DATE, end_date=END_DATE, use_gk=True)
    
    # Pipeline Eksekusi
    lhar.fetch_data()
    lhar.calculate_features()
    lhar.fit_model(train_ratio=0.8)
    lhar.evaluate_model()
    lhar.plot_results()
    lhar.forecast_tomorrow()


[5]
9 d
!pip install plotly datashader  # Datashader opsional tapi bagus untuk performa plot data besar
Requirement already satisfied: plotly in /usr/local/lib/python3.12/dist-packages (5.24.1)
Collecting datashader
  Downloading datashader-0.19.0-py3-none-any.whl.metadata (8.0 kB)
Requirement already satisfied: tenacity>=6.2.0 in /usr/local/lib/python3.12/dist-packages (from plotly) (9.1.4)
Requirement already satisfied: packaging in /usr/local/lib/python3.12/dist-packages (from plotly) (26.1)
Requirement already satisfied: colorcet in /usr/local/lib/python3.12/dist-packages (from datashader) (3.1.0)
Requirement already satisfied: multipledispatch in /usr/local/lib/python3.12/dist-packages (from datashader) (1.0.0)
Requirement already satisfied: numba in /usr/local/lib/python3.12/dist-packages (from datashader) (0.60.0)
Requirement already satisfied: numpy in /usr/local/lib/python3.12/dist-packages (from datashader) (2.0.2)
Requirement already satisfied: pandas in /usr/local/lib/python3.12/dist-packages (from datashader) (2.2.2)
Requirement already satisfied: param in /usr/local/lib/python3.12/dist-packages (from datashader) (2.3.3)
Collecting pyct (from datashader)
  Downloading pyct-0.6.0-py3-none-any.whl.metadata (7.2 kB)
Requirement already satisfied: requests in /usr/local/lib/python3.12/dist-packages (from datashader) (2.32.4)
Requirement already satisfied: scipy in /usr/local/lib/python3.12/dist-packages (from datashader) (1.16.3)
Requirement already satisfied: toolz in /usr/local/lib/python3.12/dist-packages (from datashader) (0.12.1)
Requirement already satisfied: xarray in /usr/local/lib/python3.12/dist-packages (from datashader) (2025.12.0)
Requirement already satisfied: llvmlite<0.44,>=0.43.0dev0 in /usr/local/lib/python3.12/dist-packages (from numba->datashader) (0.43.0)
Requirement already satisfied: python-dateutil>=2.8.2 in /usr/local/lib/python3.12/dist-packages (from pandas->datashader) (2.9.0.post0)
Requirement already satisfied: pytz>=2020.1 in /usr/local/lib/python3.12/dist-packages (from pandas->datashader) (2025.2)
Requirement already satisfied: tzdata>=2022.7 in /usr/local/lib/python3.12/dist-packages (from pandas->datashader) (2026.1)
Requirement already satisfied: charset_normalizer<4,>=2 in /usr/local/lib/python3.12/dist-packages (from requests->datashader) (3.4.7)
Requirement already satisfied: idna<4,>=2.5 in /usr/local/lib/python3.12/dist-packages (from requests->datashader) (3.13)
Requirement already satisfied: urllib3<3,>=1.21.1 in /usr/local/lib/python3.12/dist-packages (from requests->datashader) (2.5.0)
Requirement already satisfied: certifi>=2017.4.17 in /usr/local/lib/python3.12/dist-packages (from requests->datashader) (2026.4.22)
Requirement already satisfied: six>=1.5 in /usr/local/lib/python3.12/dist-packages (from python-dateutil>=2.8.2->pandas->datashader) (1.17.0)
Downloading datashader-0.19.0-py3-none-any.whl (10.7 MB)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 10.7/10.7 MB 53.8 MB/s eta 0:00:00
Downloading pyct-0.6.0-py3-none-any.whl (16 kB)
Installing collected packages: pyct, datashader
Successfully installed datashader-0.19.0 pyct-0.6.0

[ ]

Mulai coding atau buat kode dengan AI.

[18]
0 d
import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
import matplotlib.pyplot as plt
from sklearn.metrics import mean_absolute_error, mean_squared_error
import warnings
warnings.filterwarnings('ignore')

class LHAR_RV_Model:
    def __init__(self, ticker, start_date, end_date, use_gk=False):
        self.ticker = ticker
        self.start_date = start_date
        self.end_date = end_date
        self.use_gk = use_gk
        self.data = None
        self.model = None
        
    def fetch_data(self):
        """Mengambil data historis dari Yahoo Finance."""
        print(f"Mengambil data {self.ticker} dari {self.start_date} hingga {self.end_date}...")
        df = yf.download(self.ticker, start=self.start_date, end=self.end_date, progress=False)
        
        # Jika yfinance mengembalikan MultiIndex columns (sering terjadi pada versi terbaru)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
            
        self.data = df
        return self.data
        
    def calculate_features(self):
        """Menghitung Realized Volatility, Continuous, Jump, dan komponen LHAR-CJ."""
        df = self.data.copy()
        
        # 1. Log Returns & Realized Volatility (RV)
        df['Log_Ret'] = np.log(df['Close']).diff()
        
        if self.use_gk:
            log_hl = np.log(df['High'] / df['Low'])
            log_co = np.log(df['Close'] / df['Open'])
            df['RV'] = 0.5 * log_hl**2 - (2 * np.log(2) - 1) * log_co**2
        else:
            df['RV'] = df['Log_Ret']**2
            
        df = df.dropna()
        
        # Fitur Baseline Harian (t-1)
        df['RV_d'] = df['RV'].shift(1)
        
        # ==========================================
        # 🟢 NEW: KOMPONEN CONTINUOUS & JUMP (PROXY)
        # ==========================================
        # Hitung rata-rata dan deviasi standar 22 hari terakhir (sebagai baseline kewajaran)
        roll_mean = df['RV_d'].rolling(window=22).mean()
        roll_std = df['RV_d'].rolling(window=22).std()
        
        # Jump: Volatilitas yang menembus batas "wajar" (Mean + 2 StdDev)
        # Jika tidak ada lonjakan, nilai Jump = 0
        df['Jump_d'] = np.maximum(df['RV_d'] - (roll_mean + 2 * roll_std), 0)
        
        # Continuous: Volatilitas harian dikurangi efek Jump
        df['Cont_d'] = df['RV_d'] - df['Jump_d']
        
        # ==========================================
        # Heterogeneous Components (w & m) untuk Cont & Jump
        # ==========================================
        df['Cont_w'] = df['Cont_d'].rolling(window=5).mean()
        df['Cont_m'] = df['Cont_d'].rolling(window=22).mean()
        
        df['Jump_w'] = df['Jump_d'].rolling(window=5).mean()
        df['Jump_m'] = df['Jump_d'].rolling(window=22).mean()
        
        # Leverage Effect
        df['Neg_Ret_d'] = df['Log_Ret'].shift(1).apply(lambda x: min(x, 0))
        
        df = df.dropna()
        
        # ==========================================
        # MATHEMATICAL OPTIMIZATION (LOG & LINEAR)
        # ==========================================
        eps = 1e-12
        df['Log_RV'] = np.log(df['RV'] + eps)
        
        # Komponen Continuous di-log karena sifatnya stabil dan selalu positif
        df['Log_Cont_d'] = np.log(df['Cont_d'] + eps)
        df['Log_Cont_w'] = np.log(df['Cont_w'] + eps)
        df['Log_Cont_m'] = np.log(df['Cont_m'] + eps)
        
        # *TRICK QUANT*: Komponen Jump DIBIARKAN LINEAR (tidak di-log).
        # Mengapa? Karena nilai Jump mayoritas adalah 0. Melogaritmakannya akan 
        # menghasilkan nilai negatif ekstrim log(0+eps) yang merusak regresi OLS.
        df['Jump_d_lin'] = df['Jump_d']
        df['Jump_w_lin'] = df['Jump_w']
        df['Jump_m_lin'] = df['Jump_m']
        
        self.data = df
        return self.data


    def fit_model(self, train_ratio=0.8):
        """Melakukan regresi OLS dengan komponen Continuous dan Jump."""
        df = self.data
        
        # Variabel Dependen: Log(RV)
        Y = df['Log_RV']
        
        # Variabel Independen Baru: Log_Cont + Linear_Jump + Leverage
        X = df[['Log_Cont_d', 'Log_Cont_w', 'Log_Cont_m', 
                'Jump_d_lin', 'Jump_w_lin', 'Jump_m_lin', 
                'Neg_Ret_d']]
        X = sm.add_constant(X)
        
        split_idx = int(len(df) * train_ratio)
        self.X_train, self.X_test = X.iloc[:split_idx], X.iloc[split_idx:]
        self.Y_train, self.Y_test = Y.iloc[:split_idx], Y.iloc[split_idx:]
        
        self.dates_test = df.index[split_idx:]
        self.actual_rv_test = df['RV'].iloc[split_idx:]
        
        self.model = sm.OLS(self.Y_train, self.X_train).fit()
        print("\n" + "="*75)
        print(f"RINGKASAN STATISTIK MODEL LHAR-CJ (Continuous & Jump) - {self.ticker}")
        print("="*75)
        print(self.model.summary())
    def evaluate_model(self):
        """Mengevaluasi model pada data uji (Out-of-Sample)."""
        # Prediksi dalam log-space
        log_pred = self.model.predict(self.X_test)
        
        # Transformasi balik dari log ke RV asli menggunakan eksponensial
        self.rv_pred = np.exp(log_pred)
        
        # Hitung Metrik
        mae = mean_absolute_error(self.actual_rv_test, self.rv_pred)
        rmse = np.sqrt(mean_squared_error(self.actual_rv_test, self.rv_pred))
        
        print("\n" + "="*50)
        print("METRIK EVALUASI (OUT-OF-SAMPLE)")
        print("="*50)
        print(f"MAE  : {mae:.6f}")
        print(f"RMSE : {rmse:.6f}")
        
    def plot_results(self):
        """Visualisasi Aktual vs Prediksi dan Residual Plot."""
        residuals = self.actual_rv_test - self.rv_pred
        
        fig, axes = plt.subplots(2, 1, figsize=(12, 10))
        
        # Plot 1: Actual vs Predicted RV
        axes[0].plot(self.dates_test, self.actual_rv_test, label='Actual RV', color='blue', alpha=0.6)
        axes[0].plot(self.dates_test, self.rv_pred, label='Predicted RV (LHAR)', color='red', alpha=0.8, linestyle='--')
        axes[0].set_title(f'Actual vs Predicted Realized Volatility ({self.ticker})', fontsize=14)
        axes[0].set_ylabel('Variance')
        axes[0].legend()
        axes[0].grid(True, alpha=0.3)
        
        # Plot 2: Residual Plot
        axes[1].scatter(self.dates_test, residuals, color='purple', alpha=0.5)
        axes[1].axhline(0, color='black', linestyle='--')
        axes[1].set_title('Residual Plot (Actual - Predicted)', fontsize=14)
        axes[1].set_ylabel('Error')
        axes[1].grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.show()
    def forecast_tomorrow(self):
        """Memprediksi volatilitas besok DAN mengevaluasi akurasi prediksi kemarin dengan LHAR-CJ."""
        if self.model is None:
            print("Model belum di-fit.")
            return

        # 1. EVALUASI PREDIKSI KEMARIN (t-1)
        actual_rv_yesterday = self.data.iloc[-1]['RV']
        
        # Ambil input fitur tepat sebelum hari terakhir (t-2)
        idx_t2 = self.data.index[-2]
        row_t2 = self.data.loc[idx_t2]
        
        eps = 1e-12
        x_yesterday = [
            1.0, # Intercept
            np.log(row_t2['Cont_d'] + eps),
            np.log(row_t2['Cont_w'] + eps),
            np.log(row_t2['Cont_m'] + eps),
            row_t2['Jump_d_lin'],
            row_t2['Jump_w_lin'],
            row_t2['Jump_m_lin'],
            row_t2['Neg_Ret_d']
        ]
        
        pred_log_rv_yesterday = self.model.predict([x_yesterday])[0]
        pred_rv_yesterday = np.exp(pred_log_rv_yesterday)
        
        abs_error = abs(actual_rv_yesterday - pred_rv_yesterday)
        pct_error = (abs_error / actual_rv_yesterday) * 100

        # 2. HITUNG FORECAST UNTUK BESOK (t+1)
        last_row = self.data.iloc[-1]
        
        x_next = [
            1.0, # Intercept
            np.log(last_row['Cont_d'] + eps),
            np.log(last_row['Cont_w'] + eps),
            np.log(last_row['Cont_m'] + eps),
            last_row['Jump_d_lin'],
            last_row['Jump_w_lin'],
            last_row['Jump_m_lin'],
            last_row['Neg_Ret_d']
        ]
        
        pred_log_rv_next = self.model.predict([x_next])[0]
        pred_rv_next = np.exp(pred_log_rv_next)
        
        ann_vol_next = np.sqrt(pred_rv_next * 252) * 100
        ann_vol_yesterday_actual = np.sqrt(actual_rv_yesterday * 252) * 100

        # 3. OUTPUT
        print("\n" + "="*65)
        print("⚡ MONITORING LHAR-CJ: CONTINUOUS & JUMP BACKTEST")
        print("="*65)
        print(f"Evaluasi Prediksi untuk : {self.data.index[-1].strftime('%Y-%m-%d')}")
        print(f"Prediksi Kemarin        : {pred_rv_yesterday:.8f}")
        print(f"Realisasi Kemarin       : {actual_rv_yesterday:.8f}")
        
        status_error = "OVERESTIMATED 🔴" if pred_rv_yesterday > actual_rv_yesterday else "UNDERESTIMATED 🔵"
        print(f"Error Melesat           : {pct_error:.2f}% ({status_error})")
        
        # Deteksi apakah kemarin terjadi Jump
        if last_row['Jump_d_lin'] > 0:
            print(f"⚠️ DETEKSI JUMP         : TERJADI SHOCK! (Nilai Jump: {last_row['Jump_d_lin']:.8f})")
        else:
            print(f"✅ DETEKSI JUMP         : Pasar Organik (Tidak ada shock ekstrim)")
            
        print("\n" + "="*65)
        print("📈 OUT-OF-SAMPLE FORECAST UNTUK BESOK")
        print("="*65)
        print(f"Baseline Volatility (Kemarin): {ann_vol_yesterday_actual:.2f}%")
        print(f"Predicted Volatility (Besok) : {ann_vol_next:.2f}%")
        
        diff = ann_vol_next - ann_vol_yesterday_actual
        arah = "NAIK (Expansion) 🔼" if diff > 0 else "TURUN (Contraction) 🔽"
        print("-" * 65)
        print(f"Ekspektasi Pergerakan Besok  : {arah} ({diff:+.2f}%)")
        print("="*65)
        
        return ann_vol_next
# ==========================================
# EKSEKUSI SCRIPT
# ==========================================
if __name__ == "__main__":
    TICKER = "SPY"
    START_DATE = "2010-01-01"
    END_DATE = "2026-04-01"
    # Inisialisasi Model (use_gk=True menggunakan estimator Garman-Klass)
    lhar = LHAR_RV_Model(ticker=TICKER, start_date=START_DATE, end_date=END_DATE, use_gk=True)
    
    # Pipeline Eksekusi
    lhar.fetch_data()
    lhar.calculate_features()
    lhar.fit_model(train_ratio=0.8)
    lhar.evaluate_model()
    lhar.plot_results()
    lhar.forecast_tomorrow()


[21]
1 d
    lhar.plot_results()
    lhar.forecast_tomorrow()


[ ]

Mulai coding atau buat kode dengan AI.

[26]
import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
# AFTER (plotly)
import plotly.graph_objects as go
from plotly.subplots import make_subplots
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
        """Backtest kemarin + forecast besok dengan model yang sudah di-diet."""
        if self.model is None:
            print("Model belum di-fit.")
            return

        eps = 1e-12

        # Fungsi pembantu internal - Pastiin ini menjorok ke dalam
        def _build_x(row: pd.Series) -> list:
            """Susun feature vector sesuai urutan (Hanya variabel yang signifikan)."""
            x = [
                1.0,                                  # const
                np.log(row['Cont_d'] + eps),          # Log_Cont_d
                np.log(row['Cont_w'] + eps),          # Log_Cont_w
                row['Neg_Ret_d'],                     # Neg_Ret_d
                row['Neg_Sq_d'],                      # Neg_Sq_d
            ]
            if self.use_vix and 'Log_VIX_lag' in self.data.columns:
                x.append(row['Log_VIX_lag'])          # Log_VIX_lag
            return x

        # --- Evaluasi prediksi kemarin (t-1) ---
        # Baris di bawah ini harus sejajar dengan blok 'if' di atas
        actual_rv_yesterday = self.data.iloc[-1]['RV']
        row_t2 = self.data.iloc[-2]  # input data t-2 untuk prediksi t-1

        pred_rv_yesterday = np.exp(self.model.predict([_build_x(row_t2)])[0])
        abs_error = abs(actual_rv_yesterday - pred_rv_yesterday)
        pct_error = (abs_error / actual_rv_yesterday) * 100

        # --- Forecast besok (t+1) ---
        last_row = self.data.iloc[-1]
        pred_rv_next = np.exp(self.model.predict([_build_x(last_row)])[0])

        ann_vol_actual = np.sqrt(actual_rv_yesterday * 252) * 100
        ann_vol_next = np.sqrt(pred_rv_next * 252) * 100
        diff = ann_vol_next - ann_vol_actual

        # --- Output ---
        print("\n" + "=" * 65)
        print("⚡ MONITORING LHAR-CJ v2 — BACKTEST (DIET VERSION)")
        print("=" * 65)
        print(f"Evaluasi Prediksi untuk : {self.data.index[-1].strftime('%Y-%m-%d')}")
        print(f"Prediksi Kemarin        : {pred_rv_yesterday:.8f}")
        print(f"Realisasi Kemarin       : {actual_rv_yesterday:.8f}")

        status = "OVERESTIMATED 🔴" if pred_rv_yesterday > actual_rv_yesterday else "UNDERESTIMATED 🔵"
        target = "✅ DALAM TARGET (<20%)" if pct_error < 20 else "⚠️ MELEBIHI TARGET (>20%)"
        print(f"Error Melesat           : {pct_error:.2f}% {target}  ({status})")

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



[33]
1 d
import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
import plotly.graph_objects as go
from plotly.subplots import make_subplots
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
        """Visualisasi Actual vs Predicted + Residual Plot dengan Plotly (Interactive)."""
        residuals = self.actual_rv_test - self.rv_pred

        # Create 2-row subplots
        fig = make_subplots(
            rows=2, cols=1,
            subplot_titles=(
                f'Actual vs Predicted Realized Volatility — {self.ticker}',
                'Residual Plot (Actual − Predicted)'
            ),
            vertical_spacing=0.12,
            specs=[[{"secondary_y": False}], [{"secondary_y": False}]]
        )

        # ===== Plot 1: Actual vs Predicted RV =====
        fig.add_trace(
            go.Scatter(
                x=self.dates_test,
                y=self.actual_rv_test,
                mode='lines',
                name='Actual RV',
                line=dict(color='#4682B4', width=2.5),
                opacity=0.8,
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Actual RV:</b> %{y:.8f}<extra></extra>'
            ),
            row=1, col=1
        )

        fig.add_trace(
            go.Scatter(
                x=self.dates_test,
                y=self.rv_pred,
                mode='lines',
                name='Predicted RV (LHAR-CJ v2)',
                line=dict(color='#FF6347', width=2.5, dash='dash'),
                opacity=0.9,
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Predicted RV:</b> %{y:.8f}<extra></extra>'
            ),
            row=1, col=1
        )

        # ===== Plot 2: Residuals Scatter =====
        fig.add_trace(
            go.Scatter(
                x=self.dates_test,
                y=residuals,
                mode='markers',
                name='Residuals',
                marker=dict(
                    color='#9370DB',
                    size=5,
                    opacity=0.6,
                    line=dict(width=0)
                ),
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Error:</b> %{y:.8f}<extra></extra>'
            ),
            row=2, col=1
        )

        # Add zero reference line to residuals
        fig.add_hline(
            y=0,
            line_dash='dash',
            line_color='rgba(0, 0, 0, 0.6)',
            row=2, col=1,
            annotation_text='Zero Error',
            annotation_position='right'
        )

        # Update axes
        fig.update_yaxes(title_text='Variance', row=1, col=1, gridcolor='rgba(200,200,200,0.3)')
        fig.update_yaxes(title_text='Error', row=2, col=1, gridcolor='rgba(200,200,200,0.3)')
        fig.update_xaxes(title_text='Date', row=2, col=1, gridcolor='rgba(200,200,200,0.3)')

        # Update overall layout
        fig.update_layout(
            height=1000,
            width=1400,
            hovermode='x unified',
            template='plotly_white',
            showlegend=True,
            legend=dict(
                x=0.01,
                y=0.99,
                bgcolor='rgba(255, 255, 255, 0.8)',
                bordercolor='rgba(0, 0, 0, 0.2)',
                borderwidth=1
            ),
            font=dict(family='Arial, sans-serif', size=12),
            margin=dict(l=80, r=40, t=80, b=60),
            title=dict(
                text=f"<b>LHAR-CJ v2 Model Performance — {self.ticker}</b>",
                x=0.5,
                xanchor='center',
                font=dict(size=16)
            )
        )

        fig.show()

    # -------------------------------------------------------------------------
    def plot_forecast_trend(self, window_days: int = 60):
        """Visualisasi trend forecast volatility dalam N hari terakhir (Interactive)."""
        if self.model is None:
            print("Model belum di-fit.")
            return

        # Ambil N hari terakhir dari data
        df_recent = self.data.iloc[-window_days:].copy()
        eps = 1e-12

        forecasts = []
        for idx in df_recent.index:
            row = self.data.loc[idx]
            x = [
                1.0,
                np.log(row['Cont_d'] + eps),
                np.log(row['Cont_w'] + eps),
                np.log(row['Cont_m'] + eps),
                row['Jump_d'] * 1e4,
                row['Jump_w'] * 1e4,
                row['Neg_Ret_d'],
                row['Neg_Sq_d'],
            ]
            if self.use_vix and 'Log_VIX_lag' in self.data.columns:
                x.append(row['Log_VIX_lag'])

            pred_rv = np.exp(self.model.predict([x])[0])
            ann_vol = np.sqrt(pred_rv * 252) * 100
            forecasts.append(ann_vol)

        df_recent['Forecast_Vol'] = forecasts
        df_recent['Actual_Vol'] = np.sqrt(df_recent['RV'] * 252) * 100

        # Create figure
        fig = go.Figure()

        fig.add_trace(
            go.Scatter(
                x=df_recent.index,
                y=df_recent['Actual_Vol'],
                mode='lines+markers',
                name='Actual Vol',
                line=dict(color='#4682B4', width=2.5),
                marker=dict(size=6),
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Actual Vol:</b> %{y:.2f}%<extra></extra>'
            )
        )

        fig.add_trace(
            go.Scatter(
                x=df_recent.index,
                y=df_recent['Forecast_Vol'],
                mode='lines+markers',
                name='Forecast Vol',
                line=dict(color='#FF6347', width=2.5, dash='dash'),
                marker=dict(size=6, symbol='diamond'),
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Forecast Vol:</b> %{y:.2f}%<extra></extra>'
            )
        )

        fig.update_layout(
            title=f"<b>Volatility Forecast Trend (Last {window_days} Days) — {self.ticker}</b>",
            xaxis_title="Date",
            yaxis_title="Annualized Volatility (%)",
            height=600,
            width=1400,
            hovermode='x unified',
            template='plotly_white',
            legend=dict(x=0.01, y=0.99),
            font=dict(family='Arial, sans-serif', size=12),
            margin=dict(l=80, r=40, t=80, b=60)
        )

        fig.show()

    # -------------------------------------------------------------------------
    def plot_diagnostics(self):
        """Visualisasi diagnostics model: error distribution, Q-Q plot, error over time."""
        if self.model is None:
            print("Model belum di-fit.")
            return

        residuals_log = self.Y_test.values - self.model.predict(self.X_test).values
        errors_pct = (np.abs(self.actual_rv_test.values - self.rv_pred.values) /
                      self.actual_rv_test.values * 100)

        # Create subplots: 3 diagnostics
        fig = make_subplots(
            rows=1, cols=3,
            subplot_titles=(
                'Error Distribution (%)',
                'Log-Residuals Histogram',
                'Prediction Error over Time'
            ),
            specs=[[{"type": "histogram"}, {"type": "histogram"}, {"type": "scatter"}]]
        )

        # --- Plot 1: Error Distribution ---
        fig.add_trace(
            go.Histogram(
                x=errors_pct,
                nbinsx=40,
                name='Error %',
                marker_color='#4682B4',
                opacity=0.7,
                hovertemplate='<b>Error Range:</b> %{x:.2f}%<br><b>Count:</b> %{y}<extra></extra>'
            ),
            row=1, col=1
        )

        # --- Plot 2: Log-Residuals (Normality check) ---
        fig.add_trace(
            go.Histogram(
                x=residuals_log,
                nbinsx=40,
                name='Log-Residuals',
                marker_color='#FF6347',
                opacity=0.7,
                hovertemplate='<b>Residual:</b> %{x:.4f}<br><b>Count:</b> %{y}<extra></extra>'
            ),
            row=1, col=2
        )

        # --- Plot 3: Error over Time ---
        fig.add_trace(
            go.Scatter(
                x=self.dates_test,
                y=errors_pct,
                mode='markers',
                name='Error %',
                marker=dict(
                    color=errors_pct,
                    colorscale='RdYlGn_r',
                    size=6,
                    showscale=True,
                    colorbar=dict(x=1.15, len=0.6),
                    line=dict(width=0)
                ),
                hovertemplate='<b>Date:</b> %{x|%Y-%m-%d}<br><b>Error:</b> %{y:.2f}%<extra></extra>'
            ),
            row=1, col=3
        )

        # Add target line (20% error)
        fig.add_hline(
            y=20,
            line_dash='dash',
            line_color='orange',
            row=1, col=3,
            annotation_text='Target (20%)',
            annotation_position='right'
        )

        # Update axes
        fig.update_xaxes(title_text='Error (%)', row=1, col=1)
        fig.update_xaxes(title_text='Log-Residuals', row=1, col=2)
        fig.update_xaxes(title_text='Date', row=1, col=3)
        fig.update_yaxes(title_text='Frequency', row=1, col=1)
        fig.update_yaxes(title_text='Frequency', row=1, col=2)
        fig.update_yaxes(title_text='Error (%)', row=1, col=3)

        # Update layout
        fig.update_layout(
            height=600,
            width=1600,
            showlegend=False,
            template='plotly_white',
            font=dict(family='Arial, sans-serif', size=11),
            margin=dict(l=70, r=150, t=70, b=50),
            title=dict(
                text=f"<b>Model Diagnostics — {self.ticker}</b>",
                x=0.5,
                xanchor='center',
                font=dict(size=16)
            )
        )

        fig.show()

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
                np.log(row['Cont_w'] + eps),
                np.log(row['Cont_m'] + eps),
                row['Jump_d'] * 1e4,
                row['Jump_w'] * 1e4,
                row['Neg_Ret_d'],
                row['Neg_Sq_d'],
            ]
            if self.use_vix and 'Log_VIX_lag' in self.data.columns:
                x.append(row['Log_VIX_lag'])
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

    print("\n" + "="*75)
    print("PIPELINE EKSEKUSI LHAR-CJ v2 (dengan Plotly Interactive Visualization)")
    print("="*75)

    # Step 1: Fetch & Process
    print("\n[1/5] Fetching data...")
    lhar.fetch_data()

    print("[2/5] Calculating features...")
    lhar.calculate_features()

    # Step 2: Fit Model
    print("[3/5] Fitting OLS model...")
    lhar.fit_model(train_ratio=0.8)

    # Step 3: Evaluate
    print("\n[4/5] Evaluating model (out-of-sample)...")
    lhar.evaluate_model()

    # Step 4: Visualisasi (3 interactive charts)
    print("\n[5/5] Generating interactive visualizations...")
    print("  → Opening: plot_results() [Actual vs Predicted + Residuals]")
    lhar.plot_results()

    print("  → Opening: plot_diagnostics() [Error Distribution + Residual Analysis]")
    lhar.plot_diagnostics()

    print("  → Opening: plot_forecast_trend() [Volatility Trend - Last 60 Days]")
    lhar.plot_forecast_trend(window_days=60)

    # Step 5: Forecast Tomorrow
    print("\n" + "="*75)
    print("FORECAST BESOK")
    print("="*75)
    lhar.forecast_tomorrow()



[36]
0 d
# ============================================================
#  HAR-Q MODEL — Bollerslev, Patton & Quaedvlieg (2016)
#  ✏️  GANTI PARAMETER DI BAWAH INI, LALU RUN CELL
# ============================================================

TICKER   = "SPY"    # contoh: "BBCA.JK", "BTC-USD", "AAPL"
INTERVAL = "5m"     # '1m' (max 7d) | '5m' (max 60d) ← recommended
PERIOD   = "60d"    # max '60d' untuk interval 5m
CENTER_INTERACTION = False  # set True jika VIF interaction > 10

# ============================================================
import warnings
import numpy as np
import pandas as pd
import yfinance as yf
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
warnings.filterwarnings("ignore")

LAGS_W = 5   # weekly component
LAGS_M = 22  # monthly component
MIN_BARS_PER_DAY = 10

# ── 1. FETCH DATA ────────────────────────────────────────────
print(f"[1/6] Fetching {TICKER} | {INTERVAL} | {PERIOD} ...")
raw = yf.download(TICKER, interval=INTERVAL, period=PERIOD,
                  progress=False, auto_adjust=True, prepost=False)

if isinstance(raw.columns, pd.MultiIndex):
    raw.columns = raw.columns.get_level_values(0)

raw.index = pd.to_datetime(raw.index)
raw = raw.dropna(subset=["Close"])
print(f"       ✅ {len(raw):,} bars  ({raw.index[0].date()} → {raw.index[-1].date()})")

# ── 2. LOG RETURNS (strip overnight gap) ─────────────────────
print("[2/6] Computing intraday log returns ...")
df = raw.copy()
df["trade_date"] = df.index.normalize()
df["log_ret"]    = np.log(df["Close"] / df["Close"].shift(1))
overnight_mask   = df["trade_date"] != df["trade_date"].shift(1)
df = df[~overnight_mask].dropna(subset=["log_ret"])

# ── 3. DAILY RV & RQ ─────────────────────────────────────────
print("[3/6] Aggregating to daily RV & RQ ...")
records = []
for date, grp in df.groupby("trade_date"):
    r = grp["log_ret"].values
    if len(r) < MIN_BARS_PER_DAY:
        continue
    M = len(r)
    records.append({
        "date"      : date,
        "RV"        : float(np.sum(r**2)),
        "RQ"        : float((M / 3.0) * np.sum(r**4)),   # BPQ (2016) eq.
        "daily_ret" : float(np.sum(r)),
        "M"         : M,
    })

daily = pd.DataFrame(records).set_index("date")
print(f"       ✅ {len(daily)} daily obs  |  "
      f"RV mean={daily['RV'].mean():.6f}  RQ mean={daily['RQ'].mean():.6f}")

# ── 4. HAR-Q FEATURES ────────────────────────────────────────
print("[4/6] Building HAR-Q features ...")
f = daily.copy()

f["Log_RV"]     = np.log(f["RV"])                                    # target
f["RV_d"]       = f["RV"].shift(1)                                   # daily lag
f["RV_w"]       = f["RV"].shift(1).rolling(LAGS_W).mean()            # weekly lag
f["RV_m"]       = f["RV"].shift(1).rolling(LAGS_M).mean()            # monthly lag
f["RQ_sqrt"]    = np.sqrt(f["RQ"].shift(1))                           # √RQ lagged
f["interaction"]= f["RV_d"] * f["RQ_sqrt"]                           # Q-component
lag_ret         = f["daily_ret"].shift(1)
f["leverage"]   = lag_ret * (lag_ret < 0).astype(float)              # LHAR leverage

if CENTER_INTERACTION:
    f["interaction"] = f["interaction"] - f["interaction"].mean()
    print("       ℹ️  Interaction term centered (VIF reduction mode)")

feat_cols = ["Log_RV", "RV_d", "RV_w", "RV_m", "interaction", "leverage"]
f = f.dropna(subset=feat_cols)
print(f"       ✅ {len(f)} obs after warmup drop")

# ── 5. OLS ESTIMATION ────────────────────────────────────────
print("[5/6] Estimating OLS (HC3 robust SE) ...")
y = f["Log_RV"]
X = sm.add_constant(f[["RV_d", "RV_w", "RV_m", "interaction", "leverage"]])
model = sm.OLS(y, X).fit(cov_type="HC3")

# ── 6. VIF ───────────────────────────────────────────────────
print("[6/6] Computing VIF ...\n")
vif_rows = []
for i, col in enumerate(X.columns):
    if col == "const":
        continue
    v = variance_inflation_factor(X.values, i)
    vif_rows.append({
        "Feature": col,
        "VIF"    : round(v, 3),
        "Status" : "⚠️ HIGH"     if v > 10 else
                   "⚡ MODERATE" if v > 5  else "✅ OK",
    })
vif_df = pd.DataFrame(vif_rows)

# ── RESULTS ──────────────────────────────────────────────────
SEP = "=" * 65

print(f"\n{SEP}")
print(f"  HAR-Q MODEL — OLS RESULTS  |  {TICKER}")
print(SEP)
print(model.summary())

print(f"\n{SEP}")
print("  VIF DIAGNOSTICS")
print(SEP)
print(vif_df.to_string(index=False))
if (vif_df["VIF"] > 10).any():
    print("\n  ⚠️  VIF > 10 detected → rerun with CENTER_INTERACTION = True")
else:
    print("\n  ✅ Semua VIF dalam batas aman")

print(f"\n{SEP}")
print("  Q-COMPONENT  β4  (interaction: RV_d × √RQ_d)")
print(SEP)
b4   = model.params["interaction"]
pval = model.pvalues["interaction"]
tval = model.tvalues["interaction"]
ci   = model.conf_int().loc["interaction"]
print(f"  Coefficient  : {b4:+.8f}")
print(f"  t-stat       : {tval:+.4f}")
print(f"  p-value      : {pval:.4f}  →  "
      f"{'✅ Signifikan (p<0.05)' if pval < 0.05 else '⚠️ Tidak signifikan'}")
print(f"  95% CI       : [{ci.iloc[0]:+.8f},  {ci.iloc[1]:+.8f}]")

print(f"\n{SEP}")
print("  MODEL FIT")
print(SEP)
print(f"  R²       : {model.rsquared:.4f}")
print(f"  Adj. R²  : {model.rsquared_adj:.4f}")
print(f"  AIC      : {model.aic:.2f}")
print(f"  BIC      : {model.bic:.2f}")
print(f"  N obs    : {int(model.nobs)}")
print(SEP)
[1/6] Fetching SPY | 5m | 60d ...
       ✅ 4,680 bars  (2026-02-04 → 2026-04-30)
[2/6] Computing intraday log returns ...
[3/6] Aggregating to daily RV & RQ ...
       ✅ 60 daily obs  |  RV mean=0.000053  RQ mean=0.000000
[4/6] Building HAR-Q features ...
       ✅ 38 obs after warmup drop
[5/6] Estimating OLS (HC3 robust SE) ...
[6/6] Computing VIF ...


=================================================================
  HAR-Q MODEL — OLS RESULTS  |  SPY
=================================================================
                            OLS Regression Results                            
==============================================================================
Dep. Variable:                 Log_RV   R-squared:                       0.447
Model:                            OLS   Adj. R-squared:                  0.360
Method:                 Least Squares   F-statistic:                     5.170
Date:                Fri, 01 May 2026   Prob (F-statistic):            0.00138
Time:                        04:24:35   Log-Likelihood:                -28.010
No. Observations:                  38   AIC:                             68.02
Df Residuals:                      32   BIC:                             77.84
Df Model:                           5                                         
Covariance Type:                  HC3                                         
===============================================================================
                  coef    std err          z      P>|z|      [0.025      0.975]
-------------------------------------------------------------------------------
const         -11.9710      0.766    -15.637      0.000     -13.472     -10.471
RV_d         1.386e+04   9119.726      1.520      0.128   -4010.210    3.17e+04
RV_w         7358.8995   7357.076      1.000      0.317   -7060.705    2.18e+04
RV_m         1.647e+04   1.55e+04      1.063      0.288   -1.39e+04    4.68e+04
interaction -6.182e+07   4.42e+07     -1.400      0.162   -1.48e+08    2.48e+07
leverage      -20.4760     28.922     -0.708      0.479     -77.162      36.210
==============================================================================
Omnibus:                        0.048   Durbin-Watson:                   2.208
Prob(Omnibus):                  0.976   Jarque-Bera (JB):                0.247
Skew:                           0.027   Prob(JB):                        0.884
Kurtosis:                       2.609   Cond. No.                     4.64e+08
==============================================================================

Notes:
[1] Standard Errors are heteroscedasticity robust (HC3)
[2] The smallest eigenvalue is 1.77e-16. This might indicate that there are
strong multicollinearity problems or that the design matrix is singular.

=================================================================
  VIF DIAGNOSTICS
=================================================================
    Feature   VIF     Status
       RV_d 9.681 ⚡ MODERATE
       RV_w 3.887       ✅ OK
       RV_m 2.514       ✅ OK
interaction 7.140 ⚡ MODERATE
   leverage 1.283       ✅ OK

  ✅ Semua VIF dalam batas aman

=================================================================
  Q-COMPONENT  β4  (interaction: RV_d × √RQ_d)
=================================================================
  Coefficient  : -61819503.52447110
  t-stat       : -1.3996
  p-value      : 0.1616  →  ⚠️ Tidak signifikan
  95% CI       : [-148392181.47436780,  +24753174.42542557]

=================================================================
  MODEL FIT
=================================================================
  R²       : 0.4468
  Adj. R²  : 0.3604
  AIC      : 68.02
  BIC      : 77.84
  N obs    : 38
=================================================================

[47]
7 d
# ============================================================
#  HAR-Q MODEL — Bollerslev, Patton & Quaedvlieg (2016)
#  REVISED BY SENIOR QUANT: Parkinson Estimator & Log-Scaling
# ============================================================

TICKER      = "SPY"         
START_DATE  = "2015-01-01"  
N_FORECAST  = 10            
CENTER_INT  = True          # Default ke True untuk OLS Stability

…print("\n[VIZ] Semua chart selesai dibuat. ✅")


[45]

Mulai coding atau buat kode dengan AI.

[48]
1 d
fig5.update_xaxes(range=[all_fc_x[0], all_fc_x[-1] + pd.tseries.offsets.BDay(1)])

fig5.write_html("chart5_harq_forecast.html")
# fig5.write_image("chart5_harq_forecast.png", width=1400, height=500, scale=2)
fig5.show()
print("   ✅ Chart 5 saved → chart5_harq_forecast.html")

print("\n[VIZ] Semua chart interaktif berhasil dibuat (HTML). ✅")

Langkah berikutnya:

[50]
0 d
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0)
)
fig5.update_xaxes(range=[all_fc_x[0], all_fc_x[-1] + pd.tseries.offsets.BDay(1)])

fig5.write_html("chart5_harq_cj_forecast.html")
fig5.show()
print("   ✅ Chart 5 saved → chart5_harq_cj_forecast.html")

print("\n[VIZ] All interactive charts for LHAR-CJ-Q model generated successfully. ✅")

Langkah berikutnya:

[52]
1 d
    lhar.plot_results()
    lhar.forecast_tomorrow()


[55]
20 d


# =============================================================================
# MAIN PIPELINE ORCHESTRATOR
# =============================================================================

def run_pipeline():
    """
    Orchestrator utama: jalankan seluruh pipeline secara berurutan.
    """


Produk berbayar Colab - Batalkan kontrak di sini

Jelaskan error ini:

The IndentationError in the forecast_tomorrow method is due to incorrect indentation. The _build_x function, and the code that follows it, are not properly aligned with the method's scope. I will fix the indentation by moving the _build_x function and its content to be correctly nested within forecast_tomorrow, and then ensuring the remaining code within forecast_tomorrow is also at the correct level.

The LHAR-CJ v2 model for SPY volatility forecasting has executed successfully. Here's a summary of the results:

Model Statistics (LHAR-CJ v2 — YZ + Parkinson + VIX):

R-squared: 0.567, indicating that approximately 56.7% of the variance in Log_RV can be explained by the model's features.
Most of the coefficients (Log_Cont_d, Log_Cont_w, Neg_Ret_d, Neg_Sq_d, Log_VIX_lag) are statistically significant (P>|t| values are very low), suggesting they are important predictors of volatility.
The Log_Cont_m, Jump_d_sc, and Jump_w_sc coefficients have higher p-values (0.736, 0.596, 0.800 respectively), indicating they are not statistically significant in this model. This suggests they might not be contributing meaningfully to the prediction.
The condition number is large (1.22e+05), which might indicate multicollinearity or other numerical problems, even though the specific Jump_d_sc and Jump_w_sc coefficients are insignificant.
Out-of-Sample Evaluation Metrics:

MAE (Mean Absolute Error): 0.000057
RMSE (Root Mean Squared Error): 0.000182
MAPE (Mean Absolute Percentage Error): 78.62%. This high MAPE suggests that while the model captures a good portion of the variance (high R-squared), the average percentage error in predicting the actual volatility values is quite large.
Monitoring and Forecast:

Evaluation for 2026-03-31: The model's prediction for yesterday was 0.00020071, while the actual realized volatility was 0.00024806. The error was 19.09%, which is within the target of <20%. The model underestimated the volatility.
Jump Detection: A shock (Jump: 0.00007909) was detected for yesterday.
Forecast for Tomorrow:
Baseline Volatility (Yesterday): 25.00%
Predicted Volatility (Tomorrow): 20.70%
Expectation: A decrease in volatility (Contraction) by 4.30%.
In summary, the model provides valuable insights into volatility components and a forecast for tomorrow, though the high MAPE suggests there's still room for improvement in accurately predicting the magnitude of volatility changes.


Jelaskan error ini:

The error AttributeError: 'LHAR_RV_Model' object has no attribute 'forecast_tomorrow' means that the forecast_tomorrow method is not properly defined within your LHAR_RV_Model class. This is because the line def forecast_tomorrow(self): is missing, and the code block meant for this method is incorrectly indented. I will fix this by adding the method definition at the correct indentation level.

The LHAR-CJ v2 model has executed successfully! 🎉

Here's a summary of the results:

Model Performance (Out-of-Sample):

MAE: 0.000057
RMSE: 0.000182
MAPE: 78.62% (This is the average percentage error in volatility prediction)
Key Observations from OLS Regression Results:

R-squared: 0.567 (meaning the model explains about 56.7% of the variance in realized volatility).
Significant Predictors (p < 0.05): const, Log_Cont_d, Log_Cont_w, Neg_Ret_d, Neg_Sq_d, and Log_VIX_lag. These variables are strong indicators of future volatility.
Insignificant Predictors (p > 0.05): Log_Cont_m (0.736), Jump_d_sc (0.596), and Jump_w_sc (0.800). These components do not appear to be statistically significant in predicting realized volatility in this model setup.
Forecast for Tomorrow:

Evaluated Prediction for 2026-03-31: Predicted 0.00020071 vs Actual 0.00024806. The model underestimated yesterday's volatility by 19.09%, which is within the target (<20%).
Jump Detection: A jump (shock) was detected for yesterday (Jump: 0.00007909).
Predicted Volatility for Tomorrow (Annualized): 20.70%
Expectation: A TURUN (Contraction) 🔽 of volatility by 4.30% compared to baseline.
Interactive Visualizations: I have generated three interactive Plotly charts for you:

Actual vs Predicted RV + Residuals: To visually inspect the model's fit and errors over time.
Model Diagnostics: Showing error distribution, log-residuals histogram, and error over time to assess model assumptions.
Volatility Forecast Trend (Last 60 Days): To see the historical trend of actual vs forecasted volatility.
Since Log_Cont_m, Jump_d_sc, and Jump_w_sc are not statistically significant, the model could be simplified by removing these features. This might improve its generalization capabilities and make it more parsimonious without sacrificing much predictive power. Would you like me to try to refactor the fit_model and _build_x functions to exclude these insignificant features?


Jelaskan error ini:

Error ValueError: r_matrix performs f_test... ini muncul karena model OLS gagal menghitung statistik ringkasan akibat nilai koefisien yang tidak valid (inf atau -inf).

Berdasarkan data di memori, variabel b0 bernilai -inf. Ini terjadi karena ada nilai Realized Volatility (RV) yang sangat mendekati nol, sehingga saat dilakukan np.log(f['RV']), hasilnya menjadi tak hingga negatif. Selain itu, catatan matriks desain menunjukkan masalah multikolinearitas yang ekstrem.

Saya akan memperbaiki kode dengan menambahkan epsilon kecil pada fungsi logaritma untuk mencegah nilai tak hingga dan memastikan perhitungan model lebih stabil.

Model HAR-Q telah berhasil diestimasi menggunakan data harian SPY sejak 2015. Berikut adalah ringkasan hasilnya:

Statistik Model:

R² (0.0636): Menunjukkan bahwa model ini menjelaskan sekitar 6,4% variansi dari log-volatilitas. Angka ini cukup umum untuk model volatilitas berbasis data harian murni tanpa fitur frekuensi tinggi.
Signifikansi β4 (Interaction): Koefisien komponen-Q (interaction) tidak signifikan secara statistik ($p=0.376$$p=0.376$). Ini menunjukkan bahwa untuk data harian SPY, koreksi kesalahan pengukuran melalui Realized Quarticity (RQ) tidak memberikan dampak yang kuat dibanding komponen HAR standar.
Leverage Effect: Komponen leverage sangat signifikan ($p=0.000$$p=0.000$), mengonfirmasi bahwa imbal hasil negatif di hari sebelumnya memiliki korelasi kuat dengan kenaikan volatilitas.
Forecast 10 Hari:

Prediksi volatilitas tahunan (Annualized Volatility) untuk SPY berada di kisaran 5,32% - 5,62%.
Model memprediksi sedikit penurunan volatilitas (contraction) dalam beberapa hari ke depan.
Apakah Anda ingin mencoba membandingkan model ini dengan model LHAR-CJ sebelumnya menggunakan metrik evaluasi formal?


Jelaskan error ini:

Tidak ada error yang terdeteksi pada cell yang Anda pilih. Kode tersebut baru saja dijalankan dengan sukses dan berhasil menghasilkan 5 chart interaktif berbasis Plotly untuk visualisasi model HAR-Q.

Jika Anda sebelumnya melihat error 'NameError' atau 'FileNotFoundError', hal itu biasanya terjadi jika cell pendukung (seperti cell [wBTUd7JQzu6t] yang mendefinisikan model) belum dijalankan, atau jika ada folder path yang tidak sesuai. Namun, berdasarkan status kernel saat ini, semua variabel (seperti daily, model, fc_df) sudah tersedia dan visualisasi berhasil dibuat serta disimpan ke dalam file HTML.


Jelaskan error ini:

Error tersebut terjadi karena library hmmlearn belum terinstal di lingkungan Colab Anda. Kode Anda mencoba mengimpor GaussianHMM, tetapi sistem tidak menemukan modulnya. Saya akan menambahkan perintah instalasi di bagian atas kode untuk memperbaikinya.

The Super-HAR (LHAR-Q-S) pipeline has completed successfully.

Key Findings:
Regime Detection: The HMM model identified two distinct market states.
Regime 0 (Low Vol): High frequency of days with stable price action.
Regime 1 (High Vol/Panic): Periods of elevated volatility, where the model automatically adjusts its coefficients to account for increased tail risk.
Feature Selection: Using LassoCV, the model selected the most significant predictors for each regime. Notice in the generated plots how the impact of the 'Q-Penalty' (Quarticity) becomes more pronounced during panic regimes.
Performance: The Overall QLIKE Score is provided in the output. This asymetric loss function confirms that the model is well-tuned to avoid underestimating volatility, which is crucial for risk management.
Visualizations: I have generated a multi-panel chart (super_har_pipeline.png) showing the regime transitions, standardized coefficients, and the final forecast vs. actual log-volatility on the test set.
Apa yang bisa saya bantu buatkan untuk Anda?
 
Gemini 3 Flash
Gemini dapat membuat kesalahan, jadi sebaiknya periksa kembali dan gunakan kode dengan hati-hati. Pelajari lebih lanjut
'Log_Cont_d', 'Log_Cont_w', 'Log_Cont_m',
