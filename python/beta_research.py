"""Single-benchmark return sensitivity research; no excess-return CAPM claims."""
import numpy as np
import pandas as pd
import statsmodels.api as sm


def fit_sensitivity(asset, market, annualization=252, covariance='HAC', minimum=30):
    y, x = np.asarray(asset, dtype=float), np.asarray(market, dtype=float)
    valid = np.isfinite(y) & np.isfinite(x)
    y, x = y[valid], x[valid]
    if len(x) < minimum or np.var(x) < 1e-14:
        return None
    design = sm.add_constant(x, has_constant='add')
    lag = min(5, len(x)-2)
    fit = sm.OLS(y, design).fit(cov_type=covariance,
        cov_kwds={'maxlags':lag, 'use_correction':True} if covariance=='HAC' else {}, use_t=False)
    alpha, beta = map(float, fit.params)
    residual = y - fit.predict(design)
    total_var = float(np.var(y, ddof=1))
    residual_var = float(np.var(residual, ddof=1))
    r2 = float(np.clip(1-residual_var/total_var, 0, 1)) if total_var > 1e-18 else None
    ci = fit.conf_int(alpha=.05)
    se = float(fit.bse[1])
    # Approximate Normal-Normal update using the estimated robust slope SE as a fixed likelihood SD.
    prior_mean, prior_sd = 1., 1.
    posterior_var = se**2/(1+se**2)
    posterior_mean = (beta + se**2*prior_mean)/(1+se**2)
    return {
        'beta':beta, 'beta_ci':ci[1].tolist(), 'beta_se':se,
        'alpha_daily':alpha, 'alpha_annual':alpha*annualization,
        'alpha_ci_daily':ci[0].tolist(), 'r_squared':r2,
        'correlation':float(np.corrcoef(y,x)[0,1]) if total_var > 1e-18 else None,
        'idiosyncratic_vol_daily':float(np.sqrt(residual_var)),
        'idiosyncratic_vol_annual':float(np.sqrt(residual_var*annualization)),
        'total_vol_annual':float(np.sqrt(total_var*annualization)),
        'n_observations':len(x), 'covariance_method':covariance, 'hac_lags':lag if covariance=='HAC' else None,
        'residual_quantiles':np.quantile(residual,[.1,.5,.9]).tolist(),
        'market_range':[float(x.min()),float(x.max())],
        'bayesian':{'prior_mean':prior_mean,'prior_sd':prior_sd,'mean':posterior_mean,
                    'interval':[posterior_mean-1.96*np.sqrt(posterior_var),posterior_mean+1.96*np.sqrt(posterior_var)]},
    }


def rolling_sensitivity(asset, market, dates, window, annualization=252):
    rows=[]
    for end in range(window-1,len(asset)):
        start=end-window+1
        fit=fit_sensitivity(asset[start:end+1],market[start:end+1],annualization,minimum=window)
        rows.append({'date':dates[end], 'start':dates[start], 'beta':fit['beta'] if fit else None,
                     'low':fit['beta_ci'][0] if fit else None, 'high':fit['beta_ci'][1] if fit else None,
                     'r_squared':fit['r_squared'] if fit else None})
    return rows


def prepare_prices(close, symbols):
    """No fill. Common-date prices imply equal return spans across the comparison basket."""
    if isinstance(close,pd.Series):
        close=close.to_frame(name=symbols[0])
    close=close.reindex(columns=symbols).sort_index()
    close=close.loc[~close.index.duplicated(keep='last')].replace([np.inf,-np.inf],np.nan)
    close=close.where(close>0)
    missing=[s for s in symbols if close[s].dropna().empty]
    if missing:raise ValueError('No valid adjusted prices for: '+', '.join(missing))
    aligned=close.dropna()
    if len(aligned)<31:raise ValueError(f'Need at least 31 common prices (30 returns); found {len(aligned)}.')
    return aligned, {'downloaded_rows':len(close),'aligned_prices':len(aligned),'excluded_rows':len(close)-len(aligned)}


def analyze_prices(close, ticker, benchmarks, window=60, annualization=252):
    symbols=list(dict.fromkeys([ticker]+benchmarks))
    prices,coverage=prepare_prices(close,symbols)
    returns=prices.pct_change(fill_method=None).iloc[1:]
    dates=[t.strftime('%Y-%m-%d') for t in returns.index]
    y=returns[ticker].to_numpy()
    analyses=[]
    for benchmark in benchmarks:
        x=returns[benchmark].to_numpy()
        stats=fit_sensitivity(y,x,annualization)
        if stats is None:raise ValueError(f'Cannot estimate beta: {benchmark} has insufficient return variation.')
        up,down=x>0,x<0
        # Conditional samples are not consecutive time series: HC3, not HAC, for these subsets.
        up_fit=fit_sensitivity(y[up],x[up],annualization,'HC3',20)
        down_fit=fit_sensitivity(y[down],x[down],annualization,'HC3',20)
        fitted=stats['alpha_daily']+stats['beta']*x
        residual=y-fitted
        scatter=[{'date':date,'asset_return':float(y[i]*100),'market_return':float(x[i]*100),
                  'fitted':float(fitted[i]*100),'residual':float(residual[i]*100)} for i,date in enumerate(dates)]
        rolling=rolling_sensitivity(y,x,dates,window,annualization)
        valid_rolling=[p['beta'] for p in rolling if p['beta'] is not None]
        analyses.append({'benchmark':benchmark, 'stats':stats,
            'asymmetric_beta':{'beta_upside':up_fit['beta'] if up_fit else None,
                'beta_downside':down_fit['beta'] if down_fit else None,
                'up_ci':up_fit['beta_ci'] if up_fit else None,'down_ci':down_fit['beta_ci'] if down_fit else None,
                'n_up':int(up.sum()),'n_down':int(down.sum()),'n_flat':int((x==0).sum()),
                'mean_asset_up':float(y[up].mean()) if up.any() else None,
                'mean_asset_down':float(y[down].mean()) if down.any() else None},
            'scatter_data':scatter,'rolling_beta':rolling,
            'stability':{'latest':rolling[-1]['beta'] if rolling else None,
                'min':min(valid_rolling) if valid_rolling else None,'max':max(valid_rolling) if valid_rolling else None,
                'change':rolling[-1]['beta']-rolling[-1-window]['beta'] if len(rolling)>window and rolling[-1]['beta'] is not None and rolling[-1-window]['beta'] is not None else None},
            'events':sorted(scatter,key=lambda p:abs(p['residual']),reverse=True)[:12],
            'regression_line':{'x_min':float(x.min()*100),'x_max':float(x.max()*100),
                'y_min':float((stats['alpha_daily']+stats['beta']*x.min())*100),
                'y_max':float((stats['alpha_daily']+stats['beta']*x.max())*100)},
            'price_info':{'asset_last_price':float(prices[ticker].iloc[-1]),'bench_last_price':float(prices[benchmark].iloc[-1]),
                          'data_start':prices.index[0].strftime('%Y-%m-%d'),'data_end':dates[-1]}})
    return analyses, {**coverage,'observations':len(y),'first_return':dates[0],'last_return':dates[-1],
        'warnings':[
            'OLS uses simple adjusted-close returns, not risk-free-adjusted excess returns. The intercept is not Jensen alpha and R² is not causal attribution or forecast accuracy.',
            'All benchmark comparisons use the same common-price dates. No forward fill; missing sessions may produce multi-session returns. Daily cross-market closes are not simultaneous and returns remain in local currencies.',
            'Main and rolling 95% confidence intervals use Newey-West HAC, 5 matched-bar lags, a finite-sample correction and an asymptotic Normal reference. Irregular calendar gaps, model misspecification and future regime changes are not resolved by HAC.',
            'Up/down estimates split on benchmark return sign, use separate intercepts and HC3 intervals, and need 20 observations per subset. Missing or degenerate estimates stay null; lower beta is not guaranteed downside protection.',
            'Annualization is an explicit convention, not inferred from the exchange: volatility × sqrt(sessions/year), intercept × sessions/year. Neither is a forecast or compounded alpha.',
            'Scenario response is a one-observation linear illustration. The residual 10th–90th percentile band is unconditional historical dispersion, not a calibrated prediction interval or VaR.',
            'Bayesian shrinkage assumes beta ~ Normal(1,1²) and beta_hat | beta ~ Normal(beta, estimated HAC SE²). It is an approximate update treating estimated SE as fixed, not a full Bayesian time-series model.',
            'Historical fits, rolling overlap and benchmark selection are descriptive research, not walk-forward validation. Prices are latest-adjusted observations and no vintage-correct evaluation is claimed.'
        ]}
