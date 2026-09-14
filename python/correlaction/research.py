"""DCC research math. Full-sample estimation; never an out-of-sample backtest."""
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.stats import beta, rankdata


def correlation_path(z, a, b, qbar=None):
    """R[t] conditions on z[:t], NOT z[t]. Parameters remain full-sample fits."""
    qbar = np.cov(z.T) if qbar is None else qbar
    qbar = (qbar + qbar.T) / 2 + np.eye(z.shape[1]) * 1e-8
    q = qbar.copy()
    result = []
    for t in range(len(z)):
        if t:
            q = (1-a-b)*qbar + a*np.outer(z[t-1], z[t-1]) + b*q
        scale = np.sqrt(np.diag(q))
        result.append(q / np.outer(scale, scale))
    return np.asarray(result)


def fit_dcc(z):
    qbar = np.cov(z.T)
    def objective(params):
        a, b = params
        if a < 0 or b < 0 or a+b >= .999:
            return 1e12
        matrices = correlation_path(z, a, b, qbar)
        sign, logdet = np.linalg.slogdet(matrices)
        if np.any(sign <= 0):
            return 1e12
        try:
            solved = np.linalg.solve(matrices, z[..., None])[..., 0]
            return float(np.sum(logdet + np.einsum('ti,ti->t', z, solved)))
        except np.linalg.LinAlgError:
            return 1e12
    opt = minimize(objective, [.03, .94], method='SLSQP',
                   bounds=[(0, .998), (0, .998)],
                   constraints=[{'type': 'ineq', 'fun': lambda p: .998-p.sum()}],
                   options={'maxiter': 150, 'ftol': 1e-7})
    if not opt.success or not np.isfinite(opt.fun) or opt.fun >= 1e11:
        raise ValueError('DCC optimizer did not converge: ' + str(opt.message))
    a, b = map(float, opt.x)
    return correlation_path(z, a, b, qbar), {'a': a, 'b': b, 'persistence': a+b,
        'converged': True, 'objective': float(opt.fun)}


def simulate_exposure(simple_returns, avg_corr, tail_share, threshold=.65, defensive=.1, cost_bps=5):
    """Lag the complete signal one bar. Charge one-way turnover incl initial entry.
    Cost model covers aggregate exposure changes only, not internal equal-weight rebalancing.
    """
    target = pd.Series(np.where((avg_corr > threshold) | (tail_share > .5), defensive, 1.), index=simple_returns.index)
    weight = target.shift(1).fillna(1.)
    turnover = weight.diff().abs()
    turnover.iloc[0] = abs(weight.iloc[0])
    passive_cost = pd.Series(0., index=weight.index)
    passive_cost.iloc[0] = cost_bps / 10000
    passive = simple_returns - passive_cost
    adaptive = weight * simple_returns - turnover * cost_bps / 10000
    df = pd.DataFrame({'Market_Ret': simple_returns, 'Weight': weight,
                       'Passive_Ret': passive, 'Adaptive_Ret': adaptive})
    for name in ['Passive', 'Adaptive']:
        equity = 10000 * (1 + df[name+'_Ret']).cumprod()
        df[name+'_Equity'] = equity
        df[name+'_DD'] = (equity / equity.cummax().clip(lower=10000) - 1) * 100
    return df


def pair_research(returns, z, matrices, window=20):
    names = list(returns.columns)
    ranks = np.column_stack([rankdata(z[:, i])/(len(z)+1) for i in range(len(names))])
    pairs = []
    paths = {}
    for i, left in enumerate(names):
        for j in range(i+1, len(names)):
            right = names[j]
            key = f'{left}|{right}'
            values = matrices[:, i, j]
            rolling = returns[left].rolling(window).corr(returns[right]).replace([np.inf, -np.inf], np.nan)
            lower = ranks[:, j] <= .1
            n = int(lower.sum())
            k = int(np.sum(lower & (ranks[:, i] <= .1)))
            upper = ranks[:, j] >= .9
            upper_n = int(upper.sum())
            upper_k = int(np.sum(upper & (ranks[:, i] >= .9)))
            interval = beta.ppf([.1, .9], k+1, n-k+1)
            pairs.append({'key': key, 'left': left, 'right': right,
                'dcc': float(values[-1]), 'change': float(values[-1]-values[-1-window]) if len(values)>window else None,
                'rolling': float(rolling.iloc[-1]) if pd.notna(rolling.iloc[-1]) else None,
                'historical': float(returns[left].corr(returns[right])),
                'lower': k/n if n else None, 'lower_count': k, 'lower_total': n,
                'upper': upper_k/upper_n if upper_n else None,
                'posterior_mean': (k+1)/(n+2), 'posterior_interval': interval.tolist(),
                'sample_size': len(returns)})
            paths[key] = {'dcc': values, 'rolling': rolling.tolist()}
    return pairs, paths
