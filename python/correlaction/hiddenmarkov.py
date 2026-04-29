# ============================================================
# Hidden Markov Model — Market Regime Detection (No Chart)
# ============================================================

import subprocess, sys
for pkg in ["hmmlearn", "yfinance"]:
    subprocess.run([sys.executable, "-m", "pip", "install", pkg, "-q"])

import yfinance as yf
import numpy as np
from hmmlearn.hmm import GaussianHMM
import warnings
warnings.filterwarnings("ignore")

# ─────────────────────────────────────────
# CONFIG — edit sesuai kebutuhan lu
# ─────────────────────────────────────────
TICKER    = "SPY"       # contoh: "NQ=F", "QQQ", "BBCA.JK", "BTC-USD"
INTERVAL  = "1d"        # "1m","2m","5m","15m","30m","60m","90m","1h","1d","5d","1wk","1mo","3mo"
PERIOD    = "2y"        # "1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"
           #   ^ pakai PERIOD   ATAU   pakai START+END di bawah (pilih salah satu)
START     = None        # "2022-01-01"  → isi kalau mau range spesifik, kalau pakai PERIOD set None
END       = None        # "2024-12-31"  → sama
N_STATES  = 3           # jumlah hidden regime (2–4 recommended)
SEED      = 42
# ─────────────────────────────────────────

# 1. FETCH
print(f"📥 Fetching {TICKER} | interval={INTERVAL} | ", end="")
if START and END:
    print(f"range={START} → {END}")
    df = yf.download(TICKER, start=START, end=END, interval=INTERVAL, progress=False, auto_adjust=True)
else:
    print(f"period={PERIOD}")
    df = yf.download(TICKER, period=PERIOD, interval=INTERVAL, progress=False, auto_adjust=True)

df = df[["Close", "Volume"]].dropna()
print(f"   → {len(df)} candles loaded\n")

# 2. FEATURES
returns     = np.log(df["Close"] / df["Close"].shift(1)).dropna()
vol_rolling = returns.rolling(5).std().dropna()
idx         = returns.index.intersection(vol_rolling.index)
X           = np.column_stack([returns.loc[idx], vol_rolling.loc[idx]])
dates       = idx

# 3. FIT HMM
print(f"🔧 Fitting HMM — {N_STATES} states, {len(X)} samples...")
model = GaussianHMM(n_components=N_STATES, covariance_type="full", n_iter=200, random_state=SEED)
model.fit(X)
hidden_states  = model.predict(X)
print(f"✅ Log-likelihood : {model.score(X):.4f}\n")

# 4. SORT STATES by mean return (bearish → bullish)
state_means   = {s: X[hidden_states == s, 0].mean() for s in range(N_STATES)}
rank          = sorted(state_means, key=state_means.get)
label_map     = {rank[i]: i for i in range(N_STATES)}
states_labeled = np.array([label_map[s] for s in hidden_states])

STATE_NAMES = {0: "Bearish / High-Vol", 1: "Sideways / Neutral", 2: "Bullish / Low-Vol"} \
              if N_STATES == 3 else {i: f"State {i}" for i in range(N_STATES)}

# 5. REGIME SUMMARY
print("═"*58)
print(f"  REGIME SUMMARY  |  {TICKER}  |  {INTERVAL}")
print("═"*58)
for i in range(N_STATES):
    mask = states_labeled == i
    r    = X[mask, 0]
    v    = X[mask, 1]
    pct  = mask.sum() / len(states_labeled) * 100
    sharpe = f"{r.mean()/r.std():.4f}" if r.std() > 0 else "N/A"
    print(f"\n  [{STATE_NAMES.get(i, f'State {i}')}]")
    print(f"    Candles      : {mask.sum()} ({pct:.1f}% of history)")
    print(f"    Mean return  : {r.mean()*100:.4f}%")
    print(f"    Mean vol     : {v.mean()*100:.4f}%")
    print(f"    Max return   : {r.max()*100:.4f}%")
    print(f"    Min return   : {r.min()*100:.4f}%")
    print(f"    Sharpe proxy : {sharpe}")

# 6. TRANSITION MATRIX
print(f"\n{'═'*58}")
print("  TRANSITION MATRIX  (row = from state, col = to state)")
print(f"{'─'*58}")
short = [STATE_NAMES.get(i,"S{i}")[:12].ljust(14) for i in range(N_STATES)]
print("  " + " ".join([f"{n[:10].ljust(12)}" for n in short]))
tm = model.transmat_
for i in range(N_STATES):
    row_vals = "  ".join([f"{tm[rank[i], rank[j]]:.6f}  " for j in range(N_STATES)])
    print(f"  {short[i]}  {row_vals}")

# 7. CURRENT STATE
print(f"\n{'═'*58}")
current_state   = states_labeled[-1]
current_raw     = hidden_states[-1]
current_ts      = dates[-1].strftime("%Y-%m-%d %H:%M") if hasattr(dates[-1], 'strftime') else str(dates[-1])
stay_prob       = tm[rank[current_state], rank[current_state]]
print(f"  CURRENT REGIME   : {STATE_NAMES.get(current_state, f'State {current_state}')}")
print(f"  Last candle      : {current_ts}")
print(f"  Stay probability : {stay_prob*100:.2f}%")
print(f"  Transition probs :")
for j in range(N_STATES):
    p = tm[rank[current_state], rank[j]]
    print(f"    → {STATE_NAMES.get(j, f'State {j}'):<22}: {p*100:.2f}%")
print("═"*58)