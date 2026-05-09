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