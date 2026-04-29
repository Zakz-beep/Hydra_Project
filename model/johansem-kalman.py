# ============================================================
# Kalman Filter Dynamic Hedge Ratio
# + DCC-GARCH Process Noise Adaptation
# + Johansen Pre-screening
# ============================================================

import subprocess, sys
for pkg in ["hmmlearn","yfinance","matplotlib","seaborn",
            "statsmodels","scipy","arch","pandas","numpy"]:
    subprocess.run([sys.executable,"-m","pip","install",pkg,"-q"])

import yfinance as yf
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from statsmodels.tsa.vector_ar.vecm import coint_johansen
from statsmodels.tsa.stattools import adfuller
from arch import arch_model
from scipy.linalg import inv
import warnings
warnings.filterwarnings("ignore")
pd.set_option("display.float_format", "{:.6f}".format)

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
TICKER_X      = "SPY"       # asset X (dependent)
TICKER_Y      = "QQQ"       # asset Y (hedge instrument)
PERIOD        = "3y"
INTERVAL      = "1d"
START         = None
END           = None

# Kalman Filter params
KF_OBS_NOISE  = 1e-3        # R  — observation noise variance
KF_BASE_NOISE = 1e-5        # Q base — process noise (akan di-scale sama DCC-GARCH)
KF_INIT_VAR   = 1.0         # P0 — initial state covariance

# DCC-GARCH params
GARCH_P       = 1
GARCH_Q       = 1
GARCH_RESCALE = 1e4          # scale buat numerical stability

# Z-Score
ZSCORE_WINDOW = 60           # rolling window buat mean/std normalisasi
ENTRY_Z       = 2.0
EXIT_Z        = 0.5

# Johansen
DET_ORDER     = 0
K_AR_DIFF     = 2
# ─────────────────────────────────────────


# ══════════════════════════════════════════════════════════════
# STEP 0 — FETCH DATA
# ══════════════════════════════════════════════════════════════
print("═"*62)
print("  STEP 0 — FETCH DATA")
print("═"*62)

def fetch(ticker):
    if START and END:
        d = yf.download(ticker, start=START, end=END,
                        interval=INTERVAL, progress=False, auto_adjust=True)
    else:
        d = yf.download(ticker, period=PERIOD,
                        interval=INTERVAL, progress=False, auto_adjust=True)
    return d["Close"].squeeze().rename(ticker)

px = pd.concat([fetch(TICKER_X), fetch(TICKER_Y)], axis=1).dropna()
log_px = np.log(px)
rets   = log_px.diff().dropna()
print(f"  {TICKER_X} & {TICKER_Y} | {len(px)} candles | {INTERVAL}\n")


# ══════════════════════════════════════════════════════════════
# STEP 1 — JOHANSEN COINTEGRATION TEST
# ══════════════════════════════════════════════════════════════
print("═"*62)
print("  STEP 1 — JOHANSEN COINTEGRATION TEST")
print("═"*62)

joh = coint_johansen(log_px, det_order=DET_ORDER, k_ar_diff=K_AR_DIFF)

print(f"\n  {'H0':<8} {'Trace':<12} {'CV95%':<12} {'Result'}")
n_coint = 0
for i in range(2):
    ts  = joh.lr1[i]
    cv  = joh.cvt[i][1]
    rej = ts > cv
    if rej: n_coint = i + 1
    print(f"  r≤{i:<6} {ts:<12.4f} {cv:<12.4f} {'✅ Reject H0' if rej else '❌ Fail'}")

adf_x = adfuller(log_px[TICKER_X], autolag="AIC")
adf_y = adfuller(log_px[TICKER_Y], autolag="AIC")
print(f"\n  ADF {TICKER_X}: p={adf_x[1]:.4f} {'⚠️ Non-stat (OK)' if adf_x[1]>0.05 else '✅ Stat'}")
print(f"  ADF {TICKER_Y}: p={adf_y[1]:.4f} {'⚠️ Non-stat (OK)' if adf_y[1]>0.05 else '✅ Stat'}")

if n_coint == 0:
    print("\n  ⚠️  WARNING: No cointegration detected at 95%.")
    print("  Proceeding anyway — hedge ratio may be unstable.\n")
else:
    print(f"\n  ✅ Cointegrating vectors found: {n_coint}\n")


# ══════════════════════════════════════════════════════════════
# STEP 2 — DCC-GARCH → Process Noise Scaling
# ══════════════════════════════════════════════════════════════
print("═"*62)
print("  STEP 2 — DCC-GARCH (Univariate GARCH + DCC)")
print("═"*62)

r_x = rets[TICKER_X].values * GARCH_RESCALE
r_y = rets[TICKER_Y].values * GARCH_RESCALE

def fit_garch(r, name):
    print(f"  Fitting GARCH({GARCH_P},{GARCH_Q}) on {name}...")
    m = arch_model(r, vol="Garch", p=GARCH_P, q=GARCH_Q, dist="normal", rescale=False)
    res = m.fit(disp="off", show_warning=False)
    h   = res.conditional_volatility / GARCH_RESCALE
    print(f"    AIC={res.aic:.2f} | BIC={res.bic:.2f}")
    return h, res

h_x, res_x = fit_garch(r_x, TICKER_X)
h_y, res_y = fit_garch(r_y, TICKER_Y)

# DCC correlation (simplified Engle 2002)
e_x = (r_x / GARCH_RESCALE) / (h_x + 1e-12)
e_y = (r_y / GARCH_RESCALE) / (h_y + 1e-12)

alpha_dcc, beta_dcc = 0.05, 0.90
q_bar = np.mean(e_x * e_y)
Q11, Q22, Q12 = 1.0, 1.0, q_bar
dcc_rho = np.zeros(len(e_x))
for t in range(1, len(e_x)):
    Q11 = (1 - alpha_dcc - beta_dcc) * 1.0   + alpha_dcc*e_x[t-1]**2    + beta_dcc*Q11
    Q22 = (1 - alpha_dcc - beta_dcc) * 1.0   + alpha_dcc*e_y[t-1]**2    + beta_dcc*Q22
    Q12 = (1 - alpha_dcc - beta_dcc)*q_bar   + alpha_dcc*e_x[t-1]*e_y[t-1] + beta_dcc*Q12
    dcc_rho[t] = Q12 / (np.sqrt(Q11 * Q22) + 1e-12)
    dcc_rho[t] = np.clip(dcc_rho[t], -0.9999, 0.9999)

# DCC covariance → process noise scaling
dcc_cov    = dcc_rho * h_x * h_y
dcc_scale  = np.abs(dcc_cov)
dcc_norm   = dcc_scale / (dcc_scale.mean() + 1e-12)   # normalized multiplier

# align ke rets index
dcc_idx    = rets.index
h_x_s      = pd.Series(h_x, index=dcc_idx)
h_y_s      = pd.Series(h_y, index=dcc_idx)
dcc_rho_s  = pd.Series(dcc_rho, index=dcc_idx)
dcc_norm_s = pd.Series(dcc_norm, index=dcc_idx)

print(f"\n  DCC-GARCH done. Mean |ρ|={np.abs(dcc_rho).mean():.4f} | "
      f"Max scale={dcc_norm.max():.4f}\n")


# ══════════════════════════════════════════════════════════════
# STEP 3 — KALMAN FILTER (State Space: hedge ratio β)
#
#   Observation :  y_t = x_t * β_t + α_t + ε_t   (ε ~ N(0,R))
#   State trans  :  β_t = β_{t-1} + η_t           (η ~ N(0,Q_t))
#   Q_t = KF_BASE_NOISE * dcc_norm_t  ← adaptive!
# ══════════════════════════════════════════════════════════════
print("═"*62)
print("  STEP 3 — ADAPTIVE KALMAN FILTER")
print("═"*62)

Y = log_px[TICKER_X].values          # observed series
X = log_px[TICKER_Y].values          # regressor

n   = len(Y)
# State vector = [β, α]  (hedge ratio + intercept)
n_s = 2

beta_kf    = np.zeros((n, n_s))       # filtered state
P_kf       = np.zeros((n, n_s, n_s)) # state covariance
innov      = np.zeros(n)              # innovation (prediction error)
innov_var  = np.zeros(n)              # innovation variance
Q_t_arr    = np.zeros(n)             # process noise per timestep

# Init
beta_kf[0]    = [1.0, 0.0]
P_kf[0]       = np.eye(n_s) * KF_INIT_VAR
R             = KF_OBS_NOISE           # observation noise (scalar)
F             = np.eye(n_s)            # state transition (random walk)

print("  Running filter...")
for t in range(1, n):
    # ── Adaptive Q from DCC-GARCH
    q_scale    = dcc_norm_s.iloc[t] if t < len(dcc_norm_s) else 1.0
    Q          = np.eye(n_s) * KF_BASE_NOISE * (1 + q_scale)
    Q_t_arr[t] = KF_BASE_NOISE * (1 + q_scale)

    # ── Predict
    beta_pred  = F @ beta_kf[t-1]
    P_pred     = F @ P_kf[t-1] @ F.T + Q

    # ── Observation matrix H_t = [X_t, 1]
    H          = np.array([[X[t], 1.0]])

    # ── Innovation
    y_hat      = H @ beta_pred
    innov[t]   = Y[t] - y_hat[0]
    S          = (H @ P_pred @ H.T + R)[0, 0]
    innov_var[t] = S

    # ── Kalman Gain
    K          = (P_pred @ H.T) / S     # (2,1)

    # ── Update
    beta_kf[t]  = beta_pred + K[:, 0] * innov[t]
    P_kf[t]     = (np.eye(n_s) - K @ H) @ P_pred

hedge_ratio = beta_kf[:, 0]
intercept   = beta_kf[:, 1]

print(f"  Final β  : {hedge_ratio[-1]:.6f}")
print(f"  Final α  : {intercept[-1]:.6f}")
print(f"  Mean Q_t : {Q_t_arr[1:].mean():.2e}")
print()


# ══════════════════════════════════════════════════════════════
# STEP 4 — DYNAMIC SPREAD & Z-SCORE
# ══════════════════════════════════════════════════════════════
print("═"*62)
print("  STEP 4 — DYNAMIC SPREAD & Z-SCORE")
print("═"*62)

spread_dyn  = Y - (hedge_ratio * X + intercept)
spread_s    = pd.Series(spread_dyn, index=log_px.index)

roll_mean   = spread_s.rolling(ZSCORE_WINDOW).mean()
roll_std    = spread_s.rolling(ZSCORE_WINDOW).std()
zscore      = (spread_s - roll_mean) / (roll_std + 1e-12)

# ADF on dynamic spread
sp_adf = adfuller(spread_s.dropna(), autolag="AIC")
print(f"  ADF Dynamic Spread : stat={sp_adf[0]:.4f} | p={sp_adf[1]:.4f} "
      f"| {'✅ Stationary' if sp_adf[1]<0.05 else '⚠️ Non-stationary'}")
print(f"  Spread mean  : {spread_s.mean():.6f}")
print(f"  Spread std   : {spread_s.std():.6f}")
print(f"  Z-Score now  : {zscore.dropna().iloc[-1]:.4f}")

# Trading signals
signal = pd.Series(0, index=zscore.index)
signal[zscore >  ENTRY_Z] = -1   # short spread
signal[zscore < -ENTRY_Z] =  1   # long spread
signal[np.abs(zscore) < EXIT_Z] = 0

long_entries  = (signal == 1).sum()
short_entries = (signal == -1).sum()
print(f"  Long signals : {long_entries} | Short signals : {short_entries}\n")


# ══════════════════════════════════════════════════════════════
# STEP 5 — VISUALISASI
# ══════════════════════════════════════════════════════════════
DARK  = "#0a0a0a"
PANEL = "#111111"
GRID  = "#1f1f1f"
C0    = "#38bdf8"
C1    = "#f472b6"
C2    = "#4ade80"
C3    = "#fb923c"
C4    = "#a78bfa"
RED   = "#ef4444"
GREEN = "#22c55e"
AMBER = "#f59e0b"
MUTED = "#475569"

fig = plt.figure(figsize=(20, 26), facecolor=DARK)
gs  = gridspec.GridSpec(6, 2, figure=fig, hspace=0.55, wspace=0.28)

def ax_style(ax, title="", ylabel="", xlabel=""):
    ax.set_facecolor(PANEL)
    ax.tick_params(colors="#555", labelsize=8)
    for s in ax.spines.values(): s.set_edgecolor(GRID)
    ax.grid(color=GRID, linewidth=0.4, linestyle="--", alpha=0.8)
    if title:  ax.set_title(title, color="#94a3b8", fontsize=9.5,
                             pad=8, fontweight="bold")
    if ylabel: ax.set_ylabel(ylabel, color="#555", fontsize=8)
    if xlabel: ax.set_xlabel(xlabel, color="#555", fontsize=8)

idx = log_px.index

# ── [0,:] Log Price
ax = fig.add_subplot(gs[0, :])
ax.plot(idx, log_px[TICKER_X], color=C0, lw=1.2, label=TICKER_X)
ax.plot(idx, log_px[TICKER_Y], color=C1, lw=1.2, label=TICKER_Y)
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=9)
ax_style(ax, title="Log Price", ylabel="ln(Price)")

# ── [1,0] Dynamic Hedge Ratio β
ax = fig.add_subplot(gs[1, 0])
ax.plot(idx, hedge_ratio, color=C2, lw=1, label="β (hedge ratio)")
ax.axhline(hedge_ratio.mean(), color=AMBER, lw=0.8, linestyle="--", label=f"Mean={hedge_ratio.mean():.4f}")
ax.fill_between(idx, hedge_ratio, hedge_ratio.mean(),
                where=hedge_ratio > hedge_ratio.mean(), alpha=0.15, color=C2)
ax.fill_between(idx, hedge_ratio, hedge_ratio.mean(),
                where=hedge_ratio < hedge_ratio.mean(), alpha=0.15, color=RED)
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=8)
ax_style(ax, title="Kalman — Dynamic Hedge Ratio (β)", ylabel="β")

# ── [1,1] Adaptive Process Noise Q_t
ax = fig.add_subplot(gs[1, 1])
ax.plot(idx, Q_t_arr, color=C3, lw=0.8, alpha=0.8)
ax.fill_between(idx, Q_t_arr, alpha=0.2, color=C3)
ax_style(ax, title="Adaptive Process Noise Q_t (DCC-GARCH scaled)", ylabel="Q_t")

# ── [2,:] Dynamic Spread
ax = fig.add_subplot(gs[2, :])
ax.plot(idx, spread_s, color=MUTED, lw=0.7, alpha=0.6, label="Spread")
ax.plot(idx, roll_mean, color=AMBER, lw=1.2, label=f"Rolling Mean ({ZSCORE_WINDOW})")
ax.fill_between(idx, roll_mean + roll_std, roll_mean - roll_std,
                alpha=0.1, color=AMBER)
ax.fill_between(idx, roll_mean + 2*roll_std, roll_mean - 2*roll_std,
                alpha=0.06, color=AMBER)
ax.axhline(spread_s.mean(), color="#334155", lw=0.5, linestyle=":")
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=8)
ax_style(ax, title="Dynamic Spread  (Kalman β · Y - X)", ylabel="Spread")

# ── [3,:] Z-Score + Signals
ax = fig.add_subplot(gs[3, :])
ax.plot(idx, zscore, color="#94a3b8", lw=0.7, alpha=0.5)

long_idx  = zscore.index[zscore < -ENTRY_Z]
short_idx = zscore.index[zscore >  ENTRY_Z]
ax.scatter(long_idx,  zscore[long_idx],  color=GREEN, s=8, zorder=4, label="Long Signal")
ax.scatter(short_idx, zscore[short_idx], color=RED,   s=8, zorder=4, label="Short Signal")

for lvl, col, ls in [(ENTRY_Z, RED, "--"), (-ENTRY_Z, GREEN, "--"),
                      (EXIT_Z, AMBER, ":"), (-EXIT_Z, AMBER, ":")]:
    ax.axhline(lvl, color=col, lw=0.8, linestyle=ls, alpha=0.8)
ax.axhline(0, color="#334155", lw=0.6)
ax.fill_between(idx, ENTRY_Z, zscore, where=zscore > ENTRY_Z,
                alpha=0.15, color=RED)
ax.fill_between(idx, -ENTRY_Z, zscore, where=zscore < -ENTRY_Z,
                alpha=0.15, color=GREEN)
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=8)
ax_style(ax, title=f"Z-Score  (window={ZSCORE_WINDOW})  |  Entry ±{ENTRY_Z}σ  |  Exit ±{EXIT_Z}σ",
         ylabel="Z-Score")

# ── [4,0] Conditional Volatility
ax = fig.add_subplot(gs[4, 0])
ax.plot(idx, h_x_s * 100, color=C0, lw=0.9, label=f"{TICKER_X} σ")
ax.plot(idx, h_y_s * 100, color=C1, lw=0.9, label=f"{TICKER_Y} σ")
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=8)
ax_style(ax, title="GARCH Conditional Volatility (%)", ylabel="σ (%)")

# ── [4,1] DCC Correlation
ax = fig.add_subplot(gs[4, 1])
ax.plot(idx, dcc_rho_s, color=C4, lw=0.9)
ax.fill_between(idx, dcc_rho_s, dcc_rho_s.mean(), alpha=0.15, color=C4)
ax.axhline(dcc_rho_s.mean(), color=AMBER, lw=0.8, linestyle="--",
           label=f"Mean ρ={dcc_rho_s.mean():.4f}")
ax.legend(facecolor="#1a1a1a", edgecolor=GRID, labelcolor="#ccc", fontsize=8)
ax_style(ax, title="DCC Dynamic Correlation (ρ)", ylabel="ρ")

# ── [5,0] Kalman Innovation
ax = fig.add_subplot(gs[5, 0])
ax.plot(idx, innov, color=MUTED, lw=0.6, alpha=0.6)
ax.fill_between(idx, innov, 0,
                where=np.array(innov) > 0, alpha=0.2, color=GREEN)
ax.fill_between(idx, innov, 0,
                where=np.array(innov) < 0, alpha=0.2, color=RED)
ax.axhline(0, color="#334155", lw=0.6)
ax_style(ax, title="Kalman Innovation (Prediction Error)", ylabel="ε_t")

# ── [5,1] State Covariance P_t (β diagonal)
ax = fig.add_subplot(gs[5, 1])
p_diag = P_kf[:, 0, 0]
ax.plot(idx, p_diag, color=C3, lw=0.9)
ax.fill_between(idx, p_diag, alpha=0.2, color=C3)
ax_style(ax, title="Kalman State Covariance P_t (β uncertainty)", ylabel="P[β,β]")

fig.suptitle(
    f"Adaptive Kalman Filter  ·  DCC-GARCH Process Noise  ·  {TICKER_X} / {TICKER_Y}  ·  {INTERVAL}",
    color="#e2e8f0", fontsize=13, fontweight="bold", y=1.002
)

plt.savefig("kalman_dcc_garch.png", dpi=150, bbox_inches="tight", facecolor=DARK)
plt.show()
print("📊 Saved → kalman_dcc_garch.png")
print("\n✅ Pipeline complete.")