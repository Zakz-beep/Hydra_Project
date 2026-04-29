import yfinance as yf
import pandas as pd
import numpy as np
from arch import arch_model
from scipy.optimize import minimize
from scipy.stats import rankdata
from datetime import datetime, timedelta
import warnings

warnings.filterwarnings('ignore')

def run_copula_model_api(tickers: list, mode: str = '4'):
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

    if isinstance(data, pd.Series):
        data = data.to_frame(name=tickers[0])
        
    if len(tickers) < 2:
        raise ValueError("Model DCC membutuhkan minimal 2 ticker untuk menghitung korelasi.")

    df_prices = data.dropna()
    
    if len(df_prices) < 20:
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
            resid = res.resid / res.conditional_volatility
            std_residuals.append(resid)
            std_resid_df[asset] = resid
            valid_tickers.append(asset)
        except Exception:
            pass

    if len(valid_tickers) < 2:
         raise ValueError("Tidak cukup asset valid untuk tahap DCC.")

    Z = np.column_stack(std_residuals)
    T, N = Z.shape
    Q_bar = np.cov(Z.T)

    def dcc_log_likelihood(params):
        a, b = params
        if a + b >= 0.999: return 1e10

        Q_t = Q_bar
        ll = 0
        for t in range(T):
            z_t = Z[t].reshape(N, 1)
            Q_t = (1 - a - b) * Q_bar + a * (z_t @ z_t.T) + b * Q_t
            
            Q_t_diag = np.diag(Q_t).copy()
            Q_t_diag[Q_t_diag <= 0] = 1e-8
            
            D_inv = np.diag(1.0 / np.sqrt(Q_t_diag))
            R_t = D_inv @ Q_t @ D_inv

            det_R = np.linalg.det(R_t)
            if det_R <= 0: return 1e10
            
            try:
                inv_R_t = np.linalg.inv(R_t)
            except np.linalg.LinAlgError:
                return 1e10
                
            ll += np.log(det_R) + (z_t.T @ inv_R_t @ z_t)[0,0]
        return ll

    opt = minimize(dcc_log_likelihood, [0.02, 0.95], bounds=[(0.001, 0.99)]*2, method='SLSQP')
    a_opt, b_opt = opt.x

    avg_corrs = []
    asset_corrs_list = []
    Q_t = Q_bar
    for t in range(T):
        z_t = Z[t].reshape(N, 1)
        Q_t = (1 - a_opt - b_opt) * Q_bar + a_opt * (z_t @ z_t.T) + b_opt * Q_t
        
        Q_t_diag = np.diag(Q_t).copy()
        Q_t_diag[Q_t_diag <= 0] = 1e-8
        
        D_inv = np.diag(1.0 / np.sqrt(Q_t_diag))
        R_t = D_inv @ Q_t @ D_inv
        
        avg_corrs.append(np.mean(R_t[np.triu_indices(N, k=1)]))
        
        asset_corrs = {}
        for i in range(N):
            other_indices = [j for j in range(N) if i != j]
            if other_indices:
                asset_corrs[valid_tickers[i]] = np.mean(R_t[i, other_indices])
            else:
                asset_corrs[valid_tickers[i]] = 1.0
        asset_corrs_list.append(asset_corrs)

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
    
    best_fit = "Gaussian"
    if lambda_L > 0.1 and lambda_U > 0.1 and abs(lambda_L - lambda_U) < 0.1:
        best_fit = "Student-t"
    elif lambda_L > lambda_U + 0.05:
        best_fit = "Clayton"
    elif lambda_U > lambda_L + 0.05:
        best_fit = "Gumbel"
        
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
        {'timestamp': str(idx.date()), 'tail_dep': float(v)}
        for idx, v in tail_recent.items()
    ]
    
    copula_details = {
        'pair': [t1, t2],
        'lambda_L': float(lambda_L),
        'lambda_U': float(lambda_U),
        'best_fit': best_fit,
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

    df_bt = pd.DataFrame({'Avg_Corr': avg_corrs, 'Tail_Dep': tail_dep_series}, index=returns.index)
    df_bt['Asset_Corrs'] = asset_corrs_list
    df_bt['Market_Ret'] = (returns / 100).mean(axis=1)

    # Adaptive Weight Logic: Copula + DCC
    df_bt['Weight'] = df_bt.apply(lambda x: 0.1 if (x['Avg_Corr'] > 0.65 or x['Tail_Dep'] > 0.5) else 1.0, axis=1)
    
    df_bt['Adaptive_Ret'] = df_bt['Weight'] * df_bt['Market_Ret']
    df_bt['Passive_Ret'] = df_bt['Market_Ret']

    INITIAL_CASH = 10000
    df_bt['Passive_Equity'] = INITIAL_CASH * (1 + df_bt['Passive_Ret']).cumprod()
    df_bt['Adaptive_Equity'] = INITIAL_CASH * (1 + df_bt['Adaptive_Ret']).cumprod()

    df_bt['Passive_Peak'] = df_bt['Passive_Equity'].cummax()
    df_bt['Passive_DD'] = (df_bt['Passive_Equity'] - df_bt['Passive_Peak']) / df_bt['Passive_Peak'] * 100

    df_bt['Adaptive_Peak'] = df_bt['Adaptive_Equity'].cummax()
    df_bt['Adaptive_DD'] = (df_bt['Adaptive_Equity'] - df_bt['Adaptive_Peak']) / df_bt['Adaptive_Peak'] * 100

    summary_metrics = {
        'final_passive_equity': float(df_bt['Passive_Equity'].iloc[-1]),
        'final_adaptive_equity': float(df_bt['Adaptive_Equity'].iloc[-1]),
        'max_passive_dd': float(df_bt['Passive_DD'].min()),
        'max_adaptive_dd': float(df_bt['Adaptive_DD'].min())
    }

    return valid_tickers, timeframe, history_str, summary_metrics, copula_details, df_bt
