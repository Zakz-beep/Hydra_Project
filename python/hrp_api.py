"""
HRP API — Hierarchical Risk Parity Portfolio Optimizer
Port: 8010

Endpoints:
  POST /api/hrp/optimize  — Run HRP on a list of tickers
  GET  /api/hrp/health    — Health check
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import numpy as np
import pandas as pd
import yfinance as yf
from scipy.cluster.hierarchy import linkage
from scipy.spatial.distance import squareform

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(title="HRP API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────── Models ───────────────────────────

class HRPRequest(BaseModel):
    tickers: List[str]
    balance: Optional[float] = 10000.0
    lookback_days: Optional[int] = 60   # rolling window for correlation


# ─────────────────────────── Core HRP Logic ───────────────────────────

def fetch_returns(tickers: List[str], lookback_days: int) -> pd.DataFrame:
    """Download adjusted close prices and compute daily log-returns."""
    period = f"{lookback_days + 5}d"  # buffer for non-trading days
    try:
        data = yf.download(tickers, period=period, auto_adjust=True, progress=False)["Close"]
        if isinstance(data, pd.Series):  # single ticker
            data = data.to_frame(name=tickers[0])
        data = data.dropna(how="all")
        returns = np.log(data / data.shift(1)).dropna()
        return returns
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"yfinance error: {e}")


def corr_to_dist(corr: pd.DataFrame) -> pd.DataFrame:
    """Convert correlation matrix to distance matrix (López de Prado, 2018)."""
    dist = np.sqrt(np.clip(0.5 * (1.0 - corr), 0, 1))
    return pd.DataFrame(dist, index=corr.index, columns=corr.columns)


def get_quasi_diag(link: np.ndarray) -> List[int]:
    """Sort clustered items by distance via recursive traversal of linkage matrix."""
    link = link.astype(int)
    sort_ix = pd.Series([link[-1, 0], link[-1, 1]])
    num_items = link[-1, 3]  # total leaves

    while sort_ix.max() >= num_items:
        sort_ix.index = range(0, sort_ix.shape[0] * 2, 2)  # make space
        df0 = sort_ix[sort_ix >= num_items]   # find clusters, not leaves

        i = df0.index
        j = df0.values - num_items
        sort_ix[i] = link[j, 0]  # item 1

        df0 = pd.Series(link[j, 1], index=i + 1)
        sort_ix = pd.concat([sort_ix, df0])
        sort_ix = sort_ix.sort_index()
        sort_ix.index = range(sort_ix.shape[0])

    return sort_ix.tolist()


def get_cluster_var(cov: pd.DataFrame, c_items: list) -> float:
    """Compute variance of a cluster portfolio (inverse-variance weighted)."""
    cov_ = cov.loc[c_items, c_items]
    ivp = 1.0 / np.diag(cov_.values)
    ivp /= ivp.sum()
    w = pd.Series(ivp, index=c_items)
    c_var = np.dot(w, np.dot(cov_, w))
    return float(c_var)


def get_rec_bipart(cov: pd.DataFrame, sort_ix: list) -> pd.Series:
    """Recursive bisection to allocate weights top-down on the dendrogram."""
    w = pd.Series(1.0, index=sort_ix)
    c_items = [sort_ix]  # initialize with all items

    while len(c_items) > 0:
        # bisect each cluster
        c_items = [i[j:k] for i in c_items
                   for j, k in ((0, len(i) // 2), (len(i) // 2, len(i)))
                   if len(i) > 1]

        for i in range(0, len(c_items), 2):
            c_items_0 = c_items[i]
            c_items_1 = c_items[i + 1]
            c_var_0 = get_cluster_var(cov, c_items_0)
            c_var_1 = get_cluster_var(cov, c_items_1)
            alpha = 1.0 - c_var_0 / (c_var_0 + c_var_1)
            w[c_items_0] *= alpha
            w[c_items_1] *= 1.0 - alpha

    return w


def build_mst(dist: pd.DataFrame) -> List[dict]:
    """
    Prim's algorithm to build Minimum Spanning Tree (MST) from distance matrix.
    Returns list of edges: { source, target, distance }
    """
    tickers = list(dist.index)
    n = len(tickers)
    in_tree = [False] * n
    min_dist = [float("inf")] * n
    parent = [-1] * n
    min_dist[0] = 0.0
    in_tree_count = 0
    edges = []

    while in_tree_count < n:
        # Pick minimum distance vertex not yet in tree
        u = -1
        for v in range(n):
            if not in_tree[v] and (u == -1 or min_dist[v] < min_dist[u]):
                u = v

        in_tree[u] = True
        in_tree_count += 1

        if parent[u] != -1:
            edges.append({
                "source": tickers[parent[u]],
                "target": tickers[u],
                "distance": round(float(dist.iloc[parent[u], u]), 6)
            })

        for v in range(n):
            if not in_tree[v] and dist.iloc[u, v] < min_dist[v]:
                min_dist[v] = float(dist.iloc[u, v])
                parent[v] = u

    return edges


def assign_clusters(link: np.ndarray, tickers: List[str], n_clusters: int = 3) -> dict:
    """
    Walk the linkage tree top-down to assign each ticker to a cluster id.
    n_clusters: how many clusters to cut at (approx).
    """
    from scipy.cluster.hierarchy import fcluster
    labels = fcluster(link, t=n_clusters, criterion="maxclust")
    return {ticker: int(label) for ticker, label in zip(tickers, labels)}


# ─────────────────────────── Endpoints ────────────────────────────

@app.get("/api/hrp/health")
def health():
    return {"status": "ok", "service": "hrp_api", "port": 8010}


@app.post("/api/hrp/optimize")
def optimize_hrp(req: HRPRequest):
    tickers = [t.upper().strip() for t in req.tickers if t.strip()]

    if len(tickers) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 tickers.")
    if len(tickers) > 20:
        raise HTTPException(status_code=400, detail="Max 20 tickers supported.")

    # 1. Fetch returns
    returns = fetch_returns(tickers, req.lookback_days)

    # Handle tickers with missing data — drop them
    valid_tickers = [t for t in tickers if t in returns.columns and returns[t].notna().sum() > 10]
    if len(valid_tickers) < 2:
        raise HTTPException(status_code=400, detail="Not enough valid price data for tickers.")

    returns = returns[valid_tickers].dropna()
    tickers = valid_tickers

    # 2. Correlation + Covariance
    corr = returns.corr()
    cov = returns.cov() * 252  # annualized

    # 3. Distance matrix
    dist = corr_to_dist(corr)

    # 4. Hierarchical clustering (single-linkage = MST equivalent)
    condensed = squareform(dist.values, checks=False)
    link = linkage(condensed, method="single")

    # 5. Quasi-diagonalization
    sort_ix = get_quasi_diag(link)
    sorted_tickers = [tickers[i] for i in sort_ix]

    # 6. Recursive bisection (HRP weights)
    cov_sorted = cov.loc[sorted_tickers, sorted_tickers]
    weights_series = get_rec_bipart(cov_sorted, sorted_tickers)

    # Sort back to original order for clean output
    weights = {t: round(float(weights_series[t]), 6) for t in tickers}
    total_w = sum(weights.values())
    weights = {t: round(w / total_w, 6) for t, w in weights.items()}  # normalize

    # 7. Dollar allocations
    allocations = {t: round(weights[t] * req.balance, 2) for t in tickers}

    # 8. MST edges for visualization
    mst_edges = build_mst(dist)

    # 9. Cluster assignments (3 clusters)
    n_clust = min(3, len(tickers))
    clusters = assign_clusters(link, tickers, n_clusters=n_clust)

    # 10. Correlation matrix as nested dict
    corr_dict = {}
    for t1 in tickers:
        corr_dict[t1] = {}
        for t2 in tickers:
            corr_dict[t1][t2] = round(float(corr.loc[t1, t2]), 4)

    # 11. Per-asset risk metrics
    vols = {t: round(float(returns[t].std() * np.sqrt(252)) * 100, 2) for t in tickers}
    var95 = {t: round(float(np.percentile(returns[t], 5)) * 100, 3) for t in tickers}

    return {
        "tickers": tickers,
        "weights": weights,
        "allocations": allocations,
        "sorted_order": sorted_tickers,
        "mst_edges": mst_edges,
        "clusters": clusters,
        "correlation": corr_dict,
        "annual_vol_pct": vols,
        "var95_daily_pct": var95,
        "lookback_days": req.lookback_days,
        "total_balance": req.balance
    }
