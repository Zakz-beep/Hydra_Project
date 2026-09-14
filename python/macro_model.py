"""One-period Bayesian AR forecasts. Latest-vintage research, never a real-time backtest."""
from __future__ import annotations
import io
import numpy as np
import pandas as pd
from scipy.stats import t as student_t

SERIES = {
    'cpi': ('CPIAUCSL', 'CPI · headline', 'm/m %', 'M', 'pct'),
    'core_cpi': ('CPILFESL', 'CPI · core', 'm/m %', 'M', 'pct'),
    'payrolls': ('PAYEMS', 'Nonfarm payrolls', 'change, thousands', 'M', 'diff'),
    'unemployment': ('UNRATE', 'Unemployment rate', '%', 'M', 'level'),
    'core_pce': ('PCEPILFE', 'PCE · core prices', 'm/m %', 'M', 'pct'),
    'pce': ('PCEPI', 'PCE · headline prices', 'm/m %', 'M', 'pct'),
    'retail': ('RSAFS', 'Retail sales', 'm/m %', 'M', 'pct'),
    'gdp': ('GDPC1', 'Real GDP', 'q/q annualized %', 'Q', 'annual'),
    'claims': ('ICSA', 'Initial jobless claims', 'thousands', 'W-SAT', 'thousands'),
}


def observations(csv: str, key: str):
    series_id, _, _, freq, transform = SERIES[key]
    frame = pd.read_csv(io.StringIO(csv))
    if series_id not in frame or len(frame.columns) != 2:
        raise ValueError('Unexpected FRED CSV schema')
    dates = pd.to_datetime(frame.iloc[:, 0], errors='coerce')
    values = pd.to_numeric(frame[series_id], errors='coerce')
    s = pd.Series(values.to_numpy(), index=dates).loc[dates.notna().to_numpy()]
    s = s[~s.index.duplicated(keep='last')].sort_index()
    s.index = s.index.to_period(freq)
    s = s[~s.index.duplicated(keep='last')]
    if s.empty:
        raise ValueError('No economic observations returned')
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq=freq))
    if transform == 'pct': s = (s / s.shift(1) - 1) * 100
    elif transform == 'annual': s = ((s / s.shift(1)) ** 4 - 1) * 100
    elif transform == 'diff': s = s.diff()
    elif transform == 'thousands': s = s / 1000
    return s.replace([np.inf, -np.inf], np.nan).iloc[-600:]


def posterior(values, window=120, strength=4.0):
    """Normal/inverse-gamma prior; standardized AR(2)+3-period mean, persistence prior."""
    y = np.asarray(values, dtype=float)[-(window + 3):]
    if len(y) < 27 or not np.isfinite(y[-3:]).all():
        raise ValueError('Need 24 training pairs and three consecutive latest observations')
    center = float(np.nanmean(y)); scale = max(float(np.nanstd(y)), .01)
    z = (y - center) / scale
    X, Y = [], []
    for i in range(3, len(z)):
        if np.isfinite(z[i-3:i+1]).all():
            X.append([1, z[i-1], z[i-2], np.mean(z[i-3:i])]); Y.append(z[i])
    if len(Y) < 24: raise ValueError('Insufficient consecutive training pairs')
    X, Y = np.array(X), np.array(Y)
    prior = np.array([0., 1., 0., 0.])
    precision = np.diag([.1, strength, strength, strength])
    cov = np.linalg.inv(precision + X.T @ X)
    mean = cov @ (precision @ prior + X.T @ Y)
    a = 3. + len(Y) / 2
    residual = Y - X @ mean; shift = mean - prior
    b = 1. + .5 * (residual @ residual + shift @ precision @ shift)
    x = np.array([1, z[-1], z[-2], np.mean(z[-3:])])
    location = float(center + scale * (x @ mean))
    predictive_scale = float(scale * np.sqrt(b / a * (1 + x @ cov @ x)))
    df = float(2 * a)
    radius = float(student_t.ppf(.9, df) * predictive_scale)
    return dict(mean=location, lower=location-radius, upper=location+radius,
                scale=predictive_scale, df=df, training_pairs=len(Y))


def forecast(s, window=120, strength=4.0, threshold=None):
    pred = posterior(s.to_numpy(), window, strength)
    rows = []
    # Each origin is fit independently on its prefix. No held-out outcomes in parameters.
    for i in range(max(27, len(s)-48), len(s)):
        if not np.isfinite(s.iloc[i]) or not np.isfinite(s.iloc[i-1]): continue
        try: p = posterior(s.iloc[:i].to_numpy(), window, strength)
        except ValueError: continue
        predictive_sd=p['scale'] * np.sqrt(p['df']/(p['df']-2))
        difference=float(s.iloc[i])-p['mean']
        rows.append(dict(period=str(s.index[i]), actual=float(s.iloc[i]), model=p['mean'],
                         surprise=difference, predictive_sd=float(predictive_sd), model_z=float(difference/predictive_sd),
                         lower=p['lower'], upper=p['upper'], naive=float(s.iloc[i-1])))
    metrics = None
    if rows:
        errors = np.array([r['actual']-r['model'] for r in rows])
        naive = np.array([r['actual']-r['naive'] for r in rows])
        mae = float(np.mean(np.abs(errors))); baseline = float(np.mean(np.abs(naive)))
        metrics = dict(n=len(rows), mae=mae, rmse=float(np.sqrt(np.mean(errors**2))), naive_mae=baseline,
                       skill=1-mae/baseline if baseline > 0 else None,
                       coverage=float(np.mean([r['lower'] <= r['actual'] <= r['upper'] for r in rows])))
    latest = float(s.iloc[-1]); boundary = latest if threshold is None else threshold
    probability = float(student_t.sf((boundary-pred['mean'])/pred['scale'], pred['df']))
    return dict(prediction=pred, latest=latest, latest_period=str(s.index[-1]),
                target_period=str(s.index[-1]+1), threshold=boundary, probability_above=probability,
                metrics=metrics, evaluation=rows,
                history=[dict(period=str(i), value=float(v) if np.isfinite(v) else None) for i,v in s.iloc[-240:].items()])
