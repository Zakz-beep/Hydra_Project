import yfinance as yf
import pandas as pd
import numpy as np
from arch import arch_model
from scipy.optimize import minimize
from datetime import datetime, timedelta
import warnings

warnings.filterwarnings('ignore')

def run_dcc_model_api(tickers: list, mode: str = '4'):
    """
    Run DCC-GARCH model for API consumption.
    Returns summary metrics and timeseries DataFrame.
    
    Modes:
    '1': Scalper (TF: 5m, History: 7d)
    '2': Day Trade (TF: 15m, History: 14d)
    '3': Swing (TF: 1h, History: 30d)
    '4': Core (TF: 1d, History: 3y)
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
    for asset in tickers:
        if asset not in returns.columns:
            continue
        try:
            res = arch_model(returns[asset], vol='Garch', p=1, q=1, dist='normal').fit(disp='off')
            std_residuals.append(res.resid / res.conditional_volatility)
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

    df_bt = pd.DataFrame({'Avg_Corr': avg_corrs}, index=returns.index)
    df_bt['Asset_Corrs'] = asset_corrs_list
    df_bt['Market_Ret'] = (returns / 100).mean(axis=1)

    df_bt['Weight'] = df_bt['Avg_Corr'].apply(lambda x: 0.2 if x > 0.60 else (1.0 if x < 0.35 else 0.6))
    df_bt['Adaptive_Ret'] = df_bt['Weight'] * df_bt['Market_Ret']

    initial_equity = 10000
    df_bt['Passive_Equity'] = initial_equity * (1 + df_bt['Market_Ret']).cumprod()
    df_bt['Adaptive_Equity'] = initial_equity * (1 + df_bt['Adaptive_Ret']).cumprod()

    df_bt['Passive_DD'] = (df_bt['Passive_Equity'] / df_bt['Passive_Equity'].cummax() - 1) * 100
    df_bt['Adaptive_DD'] = (df_bt['Adaptive_Equity'] / df_bt['Adaptive_Equity'].cummax() - 1) * 100

    summary = {
        'final_passive_equity': float(df_bt['Passive_Equity'].iloc[-1]),
        'final_adaptive_equity': float(df_bt['Adaptive_Equity'].iloc[-1]),
        'max_passive_dd': float(df_bt['Passive_DD'].min()),
        'max_adaptive_dd': float(df_bt['Adaptive_DD'].min())
    }

    return valid_tickers, timeframe, history_str, summary, df_bt
