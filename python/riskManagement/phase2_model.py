"""
phase2_model.py
===============
Phase 2 — Statistical Characterization & Regime Detection

Meliputi:
    2.1  Distributional Analysis  (Normal, Student-t, NIG, Empirical)
    2.2  Volatility Regime Detection:
            • GARCH family  (GARCH, EGARCH, GJR-GARCH)
            • Hidden Markov Model (2–4 states)
    2.3  Regime Labeling & Transition Matrix

Dependencies:
    pip install arch hmmlearn scipy statsmodels pandas numpy
"""

import numpy as np
import pandas as pd
from scipy import stats
from scipy.special import kv, gamma  # for NIG
import warnings
warnings.filterwarnings("ignore")

# GARCH
from arch import arch_model

# HMM
from hmmlearn.hmm import GaussianHMM


# ═══════════════════════════════════════════════════════════════
# 2.1 — DISTRIBUTIONAL ANALYSIS
# ═══════════════════════════════════════════════════════════════

class DistributionalAnalyzer:
    """
    Fit dan bandingkan beberapa distribusi ke return series.
    Kandidat: Normal, Student-t, NIG (Normal Inverse Gaussian), Empirical.
    """

    def __init__(self, log_returns: pd.Series):
        self.returns = log_returns.dropna().values
        self.n       = len(self.returns)
        self.results: dict = {}

    # ─── Individual fits ─────────────────────────────────────

    def fit_normal(self) -> dict:
        mu, sigma = stats.norm.fit(self.returns)
        ll        = np.sum(stats.norm.logpdf(self.returns, mu, sigma))
        aic       = self._aic(ll, k=2)
        ks_stat, ks_p = stats.kstest(self.returns, "norm", args=(mu, sigma))
        jb_stat, jb_p = stats.jarque_bera(self.returns)
        
        return {
            "distribution": "Normal",
            "params": {"mu": mu, "sigma": sigma},
            "log_likelihood": ll,
            "aic": aic,
            "ks_stat": ks_stat, "ks_pvalue": ks_p,
            "jb_stat": jb_stat, "jb_pvalue": jb_p,
            "reject_normality": jb_p < 0.05,
        }

    def fit_student_t(self) -> dict:
        """
        Student-t: captures fat tails via degrees-of-freedom (df).
        Kecil df = fatter tails. df → ∞ = Normal.
        """
        df, loc, scale = stats.t.fit(self.returns)
        ll = np.sum(stats.t.logpdf(self.returns, df, loc, scale))
        aic = self._aic(ll, k=3)
        ks_stat, ks_p = stats.kstest(self.returns, "t", args=(df, loc, scale))
        
        return {
            "distribution": "Student-t",
            "params": {"df": df, "loc": loc, "scale": scale},
            "log_likelihood": ll,
            "aic": aic,
            "ks_stat": ks_stat, "ks_pvalue": ks_p,
            "tail_fatness": "heavy" if df < 10 else "moderate" if df < 30 else "near-normal",
        }

    def fit_nig(self) -> dict:
        """
        Normal Inverse Gaussian — captures asymmetry + fat tails.
        Fit via method of moments (α, β, μ, δ parameterization).
        """
        r  = self.returns
        m1 = np.mean(r)
        m2 = np.var(r)
        m3 = stats.skew(r)
        m4 = stats.kurtosis(r, fisher=True)  # excess kurtosis

        # Method of moments estimators untuk NIG
        # Reference: Barndorff-Nielsen (1997)
        kappa = m4 / (3 * m3**2) if m3 != 0 else np.inf
        
        # Fallback ke scipy.stats.norminvgauss jika tersedia
        try:
            a_hat, b_hat, loc_hat, scale_hat = stats.norminvgauss.fit(r, floc=0)
            ll = np.sum(stats.norminvgauss.logpdf(r, a_hat, b_hat, loc_hat, scale_hat))
            aic = self._aic(ll, k=4)
            ks_stat, ks_p = stats.kstest(r, "norminvgauss", args=(a_hat, b_hat, loc_hat, scale_hat))
            
            return {
                "distribution": "NIG",
                "params": {"a": a_hat, "b": b_hat, "loc": loc_hat, "scale": scale_hat},
                "log_likelihood": ll,
                "aic": aic,
                "ks_stat": ks_stat, "ks_pvalue": ks_p,
                "asymmetry": "negative skew" if b_hat < 0 else "positive skew",
            }
        except Exception as e:
            return {
                "distribution": "NIG",
                "error": f"Fit gagal: {e}. Gunakan Student-t sebagai pengganti."
            }

    def fit_empirical(self) -> dict:
        """
        Empirical distribution stats — non-parametric.
        Tidak ada parameter fit, tapi berikan descriptive stats dan percentiles.
        """
        r = self.returns
        percentiles = {f"p{p}": float(np.percentile(r, p))
                       for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]}
        
        return {
            "distribution": "Empirical",
            "params": {
                "mean":     float(np.mean(r)),
                "std":      float(np.std(r)),
                "skew":     float(stats.skew(r)),
                "kurt_excess": float(stats.kurtosis(r, fisher=True)),
                **percentiles,
            },
            "tail_risk_1pct": float(np.percentile(r, 1)),
            "tail_risk_5pct": float(np.percentile(r, 5)),
        }

    # ─── Run all fits ─────────────────────────────────────────

    def run_all(self) -> dict:
        print("[Phase2.2.1] Running distributional analysis...")
        self.results = {
            "normal":    self.fit_normal(),
            "student_t": self.fit_student_t(),
            "nig":       self.fit_nig(),
            "empirical": self.fit_empirical(),
        }
        
        # Best model by AIC (exclude empirical — no AIC)
        aic_map = {k: v["aic"] for k, v in self.results.items()
                   if "aic" in v and "error" not in v}
        if aic_map:
            best = min(aic_map, key=aic_map.get)
            self.results["best_by_aic"] = best
            print(f"    Best fit by AIC: {best.upper()} (AIC={aic_map[best]:.2f})")
        
        # Normality verdict
        norm_res = self.results["normal"]
        if norm_res.get("reject_normality"):
            print(f"    Normality REJECTED (JB p={norm_res['jb_pvalue']:.4f}) — "
                  f"fat tails present, Student-t atau NIG lebih appropriate.")
        else:
            print(f"    Normality tidak ditolak (JB p={norm_res['jb_pvalue']:.4f})")
        
        return self.results

    # ─── Helpers ─────────────────────────────────────────────

    def _aic(self, log_likelihood: float, k: int) -> float:
        return 2 * k - 2 * log_likelihood

    def summary_table(self) -> pd.DataFrame:
        rows = []
        for name, res in self.results.items():
            if name == "best_by_aic" or "error" in res:
                continue
            row = {"distribution": res.get("distribution", name)}
            if "aic" in res:       row["AIC"]      = round(res["aic"], 2)
            if "ks_stat" in res:   row["KS_stat"]  = round(res["ks_stat"], 4)
            if "ks_pvalue" in res: row["KS_pvalue"] = round(res["ks_pvalue"], 4)
            rows.append(row)
        return pd.DataFrame(rows).set_index("distribution")


# ═══════════════════════════════════════════════════════════════
# 2.2a — GARCH FAMILY MODELING
# ═══════════════════════════════════════════════════════════════

class GARCHModeler:
    """
    Fit GARCH family models untuk capture volatility clustering.
    
    Models:
        • GARCH(1,1)  — baseline, volatility clustering
        • EGARCH(1,1) — asymmetric, leverage effect
        • GJR-GARCH(1,1) — leverage effect via threshold
    
    Output: conditional volatility series yang bisa dipakai sebagai regime indicator.
    """

    def __init__(self, log_returns: pd.Series):
        # arch library expects returns in % scale
        self.returns     = log_returns.dropna() * 100
        self.raw_returns = log_returns.dropna()
        self.models:     dict = {}
        self.fitted:     dict = {}
        self.cond_vol:   dict = {}

    def _fit_model(self, vol_model: str, p: int = 1, q: int = 1,
                   power: float = 2.0, o: int = 0) -> dict:
        """Generic GARCH fitter."""
        try:
            model = arch_model(
                self.returns,
                mean="Constant",
                vol=vol_model,
                p=p, q=q, o=o,
                power=power,
                dist="t",       # Student-t innovations (more realistic)
                rescale=False,
            )
            res = model.fit(disp="off", show_warning=False)
            
            # Conditional volatility (back to non-% scale)
            cond_vol = pd.Series(
                res.conditional_volatility / 100,
                index=self.raw_returns.index,
                name=f"cond_vol_{vol_model.lower()}"
            )
            
            return {
                "model":      vol_model,
                "result":     res,
                "aic":        res.aic,
                "bic":        res.bic,
                "params":     res.params.to_dict(),
                "cond_vol":   cond_vol,
                "summary":    str(res.summary()),
            }
        except Exception as e:
            return {"model": vol_model, "error": str(e)}

    def fit_garch(self) -> dict:
        print("[Phase2.2a] Fitting GARCH(1,1)...")
        res = self._fit_model("GARCH", p=1, q=1)
        self.fitted["garch"] = res
        if "cond_vol" in res:
            self.cond_vol["garch"] = res["cond_vol"]
            print(f"    GARCH(1,1) AIC={res['aic']:.2f} | BIC={res['bic']:.2f}")
        return res

    def fit_egarch(self) -> dict:
        """
        EGARCH — leverage effect: volatility responds asymmetrically.
        Negative return → larger vol increase vs same-size positive return.
        """
        print("[Phase2.2a] Fitting EGARCH(1,1)...")
        res = self._fit_model("EGARCH", p=1, q=1)
        self.fitted["egarch"] = res
        if "cond_vol" in res:
            self.cond_vol["egarch"] = res["cond_vol"]
            print(f"    EGARCH(1,1) AIC={res['aic']:.2f} | BIC={res['bic']:.2f}")
        return res

    def fit_gjr_garch(self) -> dict:
        """
        GJR-GARCH — threshold asymmetry (Glosten-Jagannathan-Runkle).
        Gamma parameter: positive = negative shocks boost vol more.
        """
        print("[Phase2.2a] Fitting GJR-GARCH(1,1)...")
        res = self._fit_model("GARCH", p=1, q=1, o=1)  # o=1 = asymmetry term
        self.fitted["gjr_garch"] = res
        if "cond_vol" in res:
            self.cond_vol["gjr_garch"] = res["cond_vol"]
            print(f"    GJR-GARCH(1,1) AIC={res['aic']:.2f} | BIC={res['bic']:.2f}")
        return res

    def run_all(self) -> dict:
        self.fit_garch()
        self.fit_egarch()
        self.fit_gjr_garch()
        
        # Best model by AIC
        aic_map = {k: v["aic"] for k, v in self.fitted.items() if "aic" in v}
        if aic_map:
            best = min(aic_map, key=aic_map.get)
            print(f"    Best GARCH model by AIC: {best.upper()}")
            self.fitted["best_model"] = best
            self.fitted["best_cond_vol"] = self.cond_vol.get(best)
        
        return self.fitted

    def get_best_cond_vol(self) -> pd.Series | None:
        """Return conditional volatility dari model terbaik."""
        best = self.fitted.get("best_model")
        if best:
            return self.cond_vol.get(best)
        return None

    def vol_summary(self) -> pd.DataFrame:
        rows = []
        for name, res in self.fitted.items():
            if name in ("best_model", "best_cond_vol") or "error" in res:
                continue
            rows.append({
                "model": res.get("model", name),
                "AIC":   round(res.get("aic", np.nan), 2),
                "BIC":   round(res.get("bic", np.nan), 2),
            })
        return pd.DataFrame(rows).set_index("model")


# ═══════════════════════════════════════════════════════════════
# 2.2b — HIDDEN MARKOV MODEL
# ═══════════════════════════════════════════════════════════════

class HMMRegimeDetector:
    """
    Detect latent market regimes menggunakan Gaussian HMM.
    
    Features yang dipakai sebagai observation:
        • log_return
        • conditional volatility (dari GARCH)
        • rolling realized volatility
    
    n_states: 2 (bull/bear) hingga 4 (granular regimes).
    Recommended: 3 states — low-vol trend, high-vol trend, choppy.
    """

    REGIME_LABELS = {
        2: ["Low-Vol",   "High-Vol"],
        3: ["Low-Vol Trend", "High-Vol Trend", "Choppy/Mean-Rev"],
        4: ["Bull Quiet", "Bull Volatile", "Bear Quiet", "Bear Volatile"],
    }

    def __init__(
        self,
        log_returns:   pd.Series,
        cond_vol:      pd.Series | None = None,
        n_states:      int = 3,
        n_iter:        int = 1000,
        random_state:  int = 42,
    ):
        self.log_returns  = log_returns.dropna()
        self.cond_vol     = cond_vol
        self.n_states     = n_states
        self.n_iter       = n_iter
        self.random_state = random_state
        self.model        = None
        self.hidden_states: pd.Series | None = None
        self.regime_stats: dict = {}

    # ─── Build observation matrix ─────────────────────────────

    def _build_observations(self) -> np.ndarray:
        """
        Stack features menjadi observation matrix (T × D).
        Semakin kaya features → HMM lebih informatif.
        """
        idx = self.log_returns.index
        features = [self.log_returns.values.reshape(-1, 1)]
        
        # Rolling realized vol (20d)
        rvol = self.log_returns.rolling(20).std().reindex(idx).fillna(
            self.log_returns.std()
        )
        features.append(rvol.values.reshape(-1, 1))
        
        # GARCH conditional vol jika tersedia
        if self.cond_vol is not None:
            cv = self.cond_vol.reindex(idx).ffill().fillna(
                self.cond_vol.mean()
            )
            features.append(cv.values.reshape(-1, 1))
        
        obs = np.hstack(features)
        
        # Standardize setiap feature
        means = obs.mean(axis=0)
        stds  = obs.std(axis=0)
        stds[stds == 0] = 1
        obs   = (obs - means) / stds
        
        return obs

    # ─── Fit HMM ─────────────────────────────────────────────

    def fit(self) -> "HMMRegimeDetector":
        print(f"[Phase2.2b] Fitting Gaussian HMM with {self.n_states} states...")
        
        obs = self._build_observations()
        
        self.model = GaussianHMM(
            n_components  = self.n_states,
            covariance_type = "full",
            n_iter        = self.n_iter,
            random_state  = self.random_state,
            tol           = 1e-4,
        )
        self.model.fit(obs)
        
        # Decode hidden states
        hidden = self.model.predict(obs)
        self.hidden_states = pd.Series(
            hidden,
            index  = self.log_returns.index,
            name   = "regime",
            dtype  = int,
        )
        
        # Remap states ke interpretable labels (sort by mean return)
        self._remap_states()
        
        print(f"    HMM fitted. Log-likelihood: {self.model.score(obs):.2f}")
        print(f"    Regime distribution: {self.hidden_states.value_counts().to_dict()}")
        
        return self

    def _remap_states(self):
        """
        Sort HMM states berdasarkan mean return per state
        supaya state 0 = lowest return/highest vol, state N-1 = best.
        """
        if self.hidden_states is None:
            return
        
        means = {}
        for s in range(self.n_states):
            mask     = self.hidden_states == s
            ret_vals = self.log_returns[mask]
            means[s] = ret_vals.mean() if len(ret_vals) > 0 else 0
        
        # Sort states by mean return (ascending)
        sorted_states = sorted(means, key=means.get)
        remap         = {old: new for new, old in enumerate(sorted_states)}
        
        self.hidden_states = self.hidden_states.map(remap)

    # ─── Regime statistics ────────────────────────────────────

    def compute_regime_stats(self) -> dict:
        """
        Per-regime: mean return, volatility, skew, kurtosis, duration, frequency.
        Ini yang menjadi basis conditional simulation di Phase 3.
        """
        if self.hidden_states is None:
            raise RuntimeError("Run .fit() dulu.")
        
        labels = self.REGIME_LABELS.get(self.n_states,
                 [f"Regime_{i}" for i in range(self.n_states)])
        
        stats_dict = {}
        for state in range(self.n_states):
            mask  = self.hidden_states == state
            rets  = self.log_returns[mask]
            label = labels[state] if state < len(labels) else f"Regime_{state}"
            
            # Duration: consecutive days in regime
            runs   = []
            count  = 0
            for val in mask:
                if val:
                    count += 1
                else:
                    if count > 0:
                        runs.append(count)
                        count = 0
            if count > 0:
                runs.append(count)
            
            stats_dict[state] = {
                "label":          label,
                "n_observations": int(mask.sum()),
                "frequency_pct":  round(float(mask.mean() * 100), 2),
                "mean_return_annualized":  round(float(rets.mean() * 252), 4),
                "vol_annualized": round(float(rets.std() * np.sqrt(252)), 4),
                "sharpe_approx":  round(
                    float(rets.mean() / rets.std() * np.sqrt(252))
                    if rets.std() > 0 else 0.0, 3
                ),
                "skewness":       round(float(rets.skew()), 4),
                "excess_kurtosis": round(float(rets.kurtosis()), 4),
                "avg_duration_days": round(float(np.mean(runs)) if runs else 0, 1),
                "max_duration_days": int(max(runs)) if runs else 0,
            }
        
        self.regime_stats = stats_dict
        return stats_dict

    # ─── Transition matrix ────────────────────────────────────

    def compute_transition_matrix(self) -> pd.DataFrame:
        """
        Hitung empirical transition probability matrix dari hidden state sequence.
        transition_matrix[i][j] = P(regime_t+1 = j | regime_t = i)
        
        Note: HMM juga punya internal transmat_ — ini empirical version dari data.
        """
        if self.hidden_states is None:
            raise RuntimeError("Run .fit() dulu.")
        
        labels = self.REGIME_LABELS.get(self.n_states,
                 [f"R{i}" for i in range(self.n_states)])
        labels = labels[:self.n_states]
        
        # Count transitions
        mat = np.zeros((self.n_states, self.n_states))
        seq = self.hidden_states.values
        for t in range(len(seq) - 1):
            i, j = seq[t], seq[t + 1]
            mat[i, j] += 1
        
        # Normalize to probabilities
        row_sums = mat.sum(axis=1, keepdims=True)
        row_sums[row_sums == 0] = 1
        mat = mat / row_sums
        
        df_trans = pd.DataFrame(
            mat,
            index   = [f"From: {l}" for l in labels],
            columns = [f"To: {l}"   for l in labels],
        )
        
        # Also store HMM internal transition matrix
        self.hmm_transmat = pd.DataFrame(
            self.model.transmat_,
            index   = [f"From: {l}" for l in labels],
            columns = [f"To: {l}"   for l in labels],
        ).round(4)
        
        self.empirical_transmat = df_trans.round(4)
        return df_trans

    # ─── Current regime probability ──────────────────────────

    def current_regime_probability(self) -> dict:
        """
        Probabilitas regime saat ini (bar terakhir) — useful untuk Phase 6 regime monitor.
        Returns: dict {regime_label: probability}
        """
        if self.hidden_states is None:
            raise RuntimeError("Run .fit() dulu.")
        
        obs = self._build_observations()
        # Posterior probabilities dari forward-backward algorithm
        posteriors = self.model.predict_proba(obs)
        last_probs = posteriors[-1]
        
        labels = self.REGIME_LABELS.get(self.n_states,
                 [f"Regime_{i}" for i in range(self.n_states)])
        labels = labels[:self.n_states]
        
        return {labels[i]: round(float(last_probs[i]), 4) for i in range(self.n_states)}

    # ─── Summary ─────────────────────────────────────────────

    def regime_summary_table(self) -> pd.DataFrame:
        if not self.regime_stats:
            self.compute_regime_stats()
        
        rows = []
        for state, s in self.regime_stats.items():
            rows.append({
                "Regime":          s["label"],
                "Freq %":          s["frequency_pct"],
                "Ann Return":      s["mean_return_annualized"],
                "Ann Vol":         s["vol_annualized"],
                "Sharpe (approx)": s["sharpe_approx"],
                "Skew":            s["skewness"],
                "Excess Kurt":     s["excess_kurtosis"],
                "Avg Duration (d)": s["avg_duration_days"],
            })
        
        return pd.DataFrame(rows).set_index("Regime")


# ═══════════════════════════════════════════════════════════════
# 2.3 — REGIME LABELER (wrapper)
# ═══════════════════════════════════════════════════════════════

class RegimeLabeler:
    """
    Attach regime labels ke original DataFrame.
    Output: DataFrame dengan kolom 'regime' dan 'regime_label' yang bisa dipakai
    sebagai input untuk Phase 3 simulation engine.
    """

    def __init__(self, hmm_detector: HMMRegimeDetector):
        self.hmm = hmm_detector

    def label_dataframe(self, raw_df: pd.DataFrame) -> pd.DataFrame:
        """
        Merge regime labels ke raw OHLCV DataFrame.
        """
        if self.hmm.hidden_states is None:
            raise RuntimeError("HMM belum di-fit.")
        
        labels_map = self.hmm.REGIME_LABELS.get(self.hmm.n_states,
                     [f"Regime_{i}" for i in range(self.hmm.n_states)])
        
        df = raw_df.copy()
        df["regime"] = self.hmm.hidden_states.reindex(df.index)
        df["regime_label"] = df["regime"].apply(
            lambda x: labels_map[int(x)] if pd.notna(x) and int(x) < len(labels_map) else "Unknown"
        )
        df["log_return"] = self.hmm.log_returns.reindex(df.index)
        
        return df


# ═══════════════════════════════════════════════════════════════
# MASTER PHASE 2 RUNNER
# ═══════════════════════════════════════════════════════════════

class Phase2Runner:
    """
    Orchestrate seluruh Phase 2 dari satu interface.
    
    Usage:
        runner = Phase2Runner(dataset, n_states=3)
        results = runner.run()
    """

    def __init__(
        self,
        dataset:     dict,      # output dari data_layer.build_dataset()
        n_states:    int = 3,   # jumlah HMM states
        n_iter:      int = 1000,
    ):
        self.dataset   = dataset
        self.n_states  = n_states
        self.n_iter    = n_iter
        self.results   = {}

    def run(self) -> dict:
        log_returns = self.dataset["log_returns"]
        raw_df      = self.dataset["raw_df"]
        ticker      = self.dataset["ticker"]
        
        print(f"\n{'='*60}")
        print(f"  PHASE 2 — Regime Detection | {ticker} | {self.n_states} states")
        print(f"{'='*60}\n")

        # ── 2.1 Distributional Analysis ──────────────────────
        print("── [2.1] Distributional Analysis ──")
        dist_analyzer = DistributionalAnalyzer(log_returns)
        dist_results  = dist_analyzer.run_all()
        
        # ── 2.2a GARCH ───────────────────────────────────────
        print("\n── [2.2a] GARCH Modeling ──")
        garch_modeler = GARCHModeler(log_returns)
        garch_results = garch_modeler.run_all()
        cond_vol      = garch_modeler.get_best_cond_vol()
        
        # ── 2.2b HMM ─────────────────────────────────────────
        print("\n── [2.2b] HMM Regime Detection ──")
        hmm_detector = HMMRegimeDetector(
            log_returns  = log_returns,
            cond_vol     = cond_vol,
            n_states     = self.n_states,
            n_iter       = self.n_iter,
        )
        hmm_detector.fit()
        regime_stats  = hmm_detector.compute_regime_stats()
        trans_matrix  = hmm_detector.compute_transition_matrix()
        current_probs = hmm_detector.current_regime_probability()
        
        # ── 2.3 Regime Labeling ───────────────────────────────
        print("\n── [2.3] Regime Labeling ──")
        labeler    = RegimeLabeler(hmm_detector)
        labeled_df = labeler.label_dataframe(raw_df)
        
        # ── Assemble results ──────────────────────────────────
        self.results = {
            "ticker":                ticker,
            "n_states":              self.n_states,

            # 2.1
            "dist_analyzer":         dist_analyzer,
            "dist_results":          dist_results,
            "dist_summary_table":    dist_analyzer.summary_table(),

            # 2.2a
            "garch_modeler":         garch_modeler,
            "garch_results":         garch_results,
            "garch_summary_table":   garch_modeler.vol_summary(),
            "cond_vol":              cond_vol,

            # 2.2b
            "hmm_detector":          hmm_detector,
            "regime_stats":          regime_stats,
            "empirical_transmat":    trans_matrix,
            "hmm_transmat":          hmm_detector.hmm_transmat,
            "current_regime_probs":  current_probs,
            "regime_summary_table":  hmm_detector.regime_summary_table(),

            # 2.3
            "labeled_df":            labeled_df,
        }
        
        # ── Print Summary ─────────────────────────────────────
        self._print_summary()
        
        return self.results

    def _print_summary(self):
        r = self.results
        print(f"\n{'='*60}")
        print(f"  PHASE 2 COMPLETE — {r['ticker']}")
        print(f"{'='*60}")
        
        print(f"\n[Distributional Analysis]")
        print(r["dist_summary_table"].to_string())
        if "best_by_aic" in r["dist_results"]:
            print(f"→ Best fit: {r['dist_results']['best_by_aic'].upper()}")
        
        print(f"\n[GARCH Models]")
        print(r["garch_summary_table"].to_string())
        best_garch = r["garch_results"].get("best_model", "N/A")
        print(f"→ Best GARCH: {best_garch.upper()}")
        
        print(f"\n[HMM Regime Summary]")
        print(r["regime_summary_table"].to_string())
        
        print(f"\n[Empirical Transition Matrix]")
        print(r["empirical_transmat"].to_string())
        
        print(f"\n[Current Regime Probability (last bar)]")
        for label, prob in r["current_regime_probs"].items():
            bar = "█" * int(prob * 40)
            print(f"  {label:<25} {prob:.1%}  {bar}")
        
        print()
