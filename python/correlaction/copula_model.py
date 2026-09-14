import yfinance as yf
import pandas as pd
import numpy as np
from arch import arch_model
from scipy.stats import rankdata
from datetime import datetime, timedelta

from research import fit_dcc, pair_research, simulate_exposure

def run_copula_model_api(tickers: list, mode: str = '4', window: int = 20, threshold: float = .65, defensive: float = .1, cost_bps: float = 5):
    """
    Run DCC-GARCH + Copula model for API consumption.
    Returns summary metrics and timeseries DataFrame.
    """
    now = datetime.now()
    
    if mode == '1':
        timeframe = '5m'
        start_date = now - timedelta(days=7)
        history_str = '7d'
    elif mode == '2':
        timeframe = '15m'
        start_date = now - timedelta(days=14)
        history_str = '14d'
    elif mode == '3':
        timeframe = '1h'
        start_date = now - timedelta(days=30)
        history_str = '30d'
    else:
        timeframe = '1d'
        start_date = now - timedelta(days=3*365)
        history_str = '3y'
        
    try:
        data = yf.download(
            tickers, 
            start=start_date.strftime('%Y-%m-%d'), 
            end=now.strftime('%Y-%m-%d'), 
            interval=timeframe, 
            auto_adjust=True,
            progress=False
        )['Close']
    except Exception as e:
        raise ValueError(f"Error mendownload data: {str(e)}")

    downloaded_at = datetime.now().astimezone().isoformat()
    if isinstance(data, pd.Series):
        data = data.to_frame(name=tickers[0])
        
    if len(tickers) < 2:
        raise ValueError("Model DCC membutuhkan minimal 2 ticker untuk menghitung korelasi.")

    data = data.reindex(columns=tickers).sort_index()
    data = data.loc[~data.index.duplicated(keep='last')].replace([np.inf, -np.inf], np.nan)
    missing = [t for t in tickers if data[t].dropna().empty]
    if missing:
        raise ValueError('No prices for: ' + ', '.join(missing))
    data = data.where(data > 0)
    df_prices = data.dropna()
    
    if len(df_prices) < max(101, window + 2):
        raise ValueError(f"Data tidak cukup untuk dianalisa! Total baris hanya {len(df_prices)}.")

    returns = 100 * np.log(df_prices / df_prices.shift(1)).dropna()

    std_residuals = []
    valid_tickers = []
    std_resid_df = pd.DataFrame(index=returns.index)
    
    for asset in tickers:
        if asset not in returns.columns:
            continue
        try:
            res = arch_model(returns[asset], vol='Garch', p=1, q=1, dist='normal').fit(disp='off')
            if res.convergence_flag != 0:
                raise ValueError('GARCH optimizer did not converge')
            resid = res.resid / res.conditional_volatility
            if not np.isfinite(resid).all() or returns[asset].std() < 1e-8:
                raise ValueError('Non-finite residuals or constant prices')
            std_residuals.append(resid)
            std_resid_df[asset] = resid
            valid_tickers.append(asset)
        except Exception as exc:
            raise ValueError(f'GARCH failed for {asset}: {exc}') from exc

    if len(valid_tickers) < 2:
         raise ValueError("Tidak cukup asset valid untuk tahap DCC.")

    Z = np.column_stack(std_residuals)
    T, N = Z.shape
    matrices, fit = fit_dcc(Z)
    avg_corrs = matrices[:, np.triu_indices(N, k=1)[0], np.triu_indices(N, k=1)[1]].mean(axis=1)
    asset_corrs_list = [{name: float((matrix[i].sum()-1)/(N-1)) for i, name in enumerate(valid_tickers)} for matrix in matrices]
    pairs, paths = pair_research(returns[valid_tickers], Z, matrices, window)

    # COPULA TAIL DEPENDENCE
    u_space = pd.DataFrame({col: rankdata(std_resid_df[col])/(T+1) for col in std_resid_df.columns})
    tail_threshold = 0.1
    tail_dep_series = []

    for i in range(T):
        row = u_space.iloc[i]
        extreme_count = np.sum(row <= tail_threshold)
        tail_dep_series.append(extreme_count / N)

    # COPULA DASHBOARD METRICS
    t1 = valid_tickers[0]
    t2 = valid_tickers[1] if len(valid_tickers) > 1 else valid_tickers[0]
    
    u1 = u_space[t1]
    u2 = u_space[t2]
    
    q_low = 0.1
    q_high = 0.9
    
    count_u2_low = np.sum(u2 <= q_low)
    count_both_low = np.sum((u1 <= q_low) & (u2 <= q_low))
    lambda_L = count_both_low / count_u2_low if count_u2_low > 0 else 0.0
    
    count_u2_high = np.sum(u2 >= q_high)
    count_both_high = np.sum((u1 >= q_high) & (u2 >= q_high))
    lambda_U = count_both_high / count_u2_high if count_u2_high > 0 else 0.0
    
    sample_size = min(500, len(u1))
    u_space_sample = pd.DataFrame({'u1': u1, 'u2': u2}).tail(sample_size)
    u_space_points = u_space_sample.to_dict(orient='records')
    
    # JOINT RETURN SPACE — map back from u-space to actual log returns (%)
    r1 = returns[t1] / 100  # convert from 100*log-return to fraction
    r2 = returns[t2] / 100
    ret_sample = min(500, len(r1))
    r1_s = r1.tail(ret_sample)
    r2_s = r2.tail(ret_sample)
    
    # Compute density grid for contour (20x20 bins)
    BINS = 20
    r1_arr = r1.values
    r2_arr = r2.values
    r1_min, r1_max = float(np.percentile(r1_arr, 1)), float(np.percentile(r1_arr, 99))
    r2_min, r2_max = float(np.percentile(r2_arr, 1)), float(np.percentile(r2_arr, 99))
    
    r1_edges = np.linspace(r1_min, r1_max, BINS + 1)
    r2_edges = np.linspace(r2_min, r2_max, BINS + 1)
    
    density_grid = []
    for i in range(BINS):
        for j in range(BINS):
            count = int(np.sum(
                (r1_arr >= r1_edges[i]) & (r1_arr < r1_edges[i+1]) &
                (r2_arr >= r2_edges[j]) & (r2_arr < r2_edges[j+1])
            ))
            if count > 0:
                density_grid.append({
                    'x': float((r1_edges[i] + r1_edges[i+1]) / 2),
                    'y': float((r2_edges[j] + r2_edges[j+1]) / 2),
                    'count': count
                })
    
    returns_points = [
        {'r1': float(r1_s.iloc[i]), 'r2': float(r2_s.iloc[i])}
        for i in range(len(r1_s))
    ]
    
    # LOWER TAIL RETURN EVENTS — where BOTH assets are in bottom 10% u-space
    lower_mask = (u1.values <= 0.1) & (u2.values <= 0.1)
    r1_full = r1.values
    r2_full = r2.values
    lower_tail_returns = [
        {'r1': float(r1_full[i]), 'r2': float(r2_full[i])}
        for i in range(len(lower_mask)) if lower_mask[i]
    ]
    
    # PERCENTILE ANNOTATION LINES — p1 and p5 for each asset (in return space)
    percentiles = {
        'r1_p1':  float(np.percentile(r1_full, 1)),
        'r1_p5':  float(np.percentile(r1_full, 5)),
        'r2_p1':  float(np.percentile(r2_full, 1)),
        'r2_p5':  float(np.percentile(r2_full, 5)),
    }
    
    # TAIL DEP SERIES — last 200 points with ISO timestamps for bar chart
    tail_dep_full = pd.Series(tail_dep_series, index=returns.index)
    tail_recent = tail_dep_full.tail(200)
    tail_dep_series_recent = [
        {'timestamp': idx.isoformat(), 'tail_dep': float(v)}
        for idx, v in tail_recent.items()
    ]
    
    copula_details = {
        'pair': [t1, t2],
        'lambda_L': float(lambda_L),
        'lambda_U': float(lambda_U),
        'best_fit': None,
        'method': 'Empirical conditional co-exceedance at 10%; no parametric copula fitted',
        'u_space_points': u_space_points,
        'returns_points': returns_points,
        'density_grid': density_grid,
        'returns_range': {
            'r1_min': r1_min, 'r1_max': r1_max,
            'r2_min': r2_min, 'r2_max': r2_max
        },
        'lower_tail_returns': lower_tail_returns,
        'percentiles': percentiles,
        'tail_dep_series_recent': tail_dep_series_recent,
    }

    # Simple equal-weight returns for compounding; no FX conversion.
    simple_returns = df_prices[valid_tickers].pct_change(fill_method=None).dropna().mean(axis=1)
    # Past-only empirical residual quantiles for the exposure signal, warm-up 60 bars.
    past_low = std_resid_df.expanding(min_periods=60).quantile(.1).shift(1)
    signal_tail = std_resid_df.le(past_low).mean(axis=1)
    df_bt = simulate_exposure(simple_returns, pd.Series(avg_corrs, index=returns.index), signal_tail,
                              threshold, defensive, cost_bps)
    df_bt['Avg_Corr'] = avg_corrs
    df_bt['Tail_Dep'] = tail_dep_series
    df_bt['Asset_Corrs'] = asset_corrs_list
    df_bt['Pair_Corrs'] = [{key: float(path['dcc'][i]) for key, path in paths.items()} for i in range(T)]
    df_bt['Rolling_Corrs'] = [{key: (float(path['rolling'][i]) if pd.notna(path['rolling'][i]) else None) for key, path in paths.items()} for i in range(T)]
    df_bt.attrs['research'] = {
        'version': 2, 'source': 'Yahoo Finance adjusted close', 'fetched_at': downloaded_at,
        'first_bar': df_prices.index[0].isoformat(), 'last_bar': df_prices.index[-1].isoformat(),
        'price_rows': len(data), 'aligned_prices': len(df_prices), 'dropped_rows': len(data)-len(df_prices),
        'observations': T, 'window': window, 'matrix': matrices[-1].tolist(), 'pairs': pairs, 'fit': fit,
        'settings': {'threshold': threshold, 'defensive': defensive, 'cost_bps': cost_bps},
        'warnings': [
            'Full-sample GARCH/DCC parameters and HMM smoothing use future sample information. This is descriptive in-sample research, not a walk-forward backtest.',
            'Adjusted prices aligned on common timestamps without forward filling. Daily cross-market closes are not simultaneous; mixed currencies are local-return baskets, not USD portfolio valuations.',
            'Exposure signals lag one bar. Cash earns zero; costs cover initial entry and aggregate exposure turnover only. Internal rebalancing, slippage, tax and financing are excluded.',
            'Tail estimates use full-sample residual ranks at the 10% threshold, not asymptotic tail dependence or crash probabilities. Beta(1,1) intervals assume independent events; clustering can understate uncertainty.',
            'Latest bar is the last downloaded observation. Intraday timestamps mark bar starts; there is no exchange-calendar or completed-bar guarantee.'
        ]}

    summary_metrics = {
        'final_passive_equity': float(df_bt['Passive_Equity'].iloc[-1]),
        'final_adaptive_equity': float(df_bt['Adaptive_Equity'].iloc[-1]),
        'max_passive_dd': float(df_bt['Passive_DD'].min()),
        'max_adaptive_dd': float(df_bt['Adaptive_DD'].min())
    }

    return valid_tickers, timeframe, history_str, summary_metrics, copula_details, df_bt
