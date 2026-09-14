"""The Greeks Complete — editable current levels + causal aggregate history.
Current horizontal levels are reference levels, NOT historical signals.
Source: enable The Greeks input in Chart Studio. Full editable SDK guide is in AI guide .md.
"""
import numpy as np
import pandas as pd


def calculate(ctx):
    bars = ctx.data.ohlcv()
    meta = ctx.greeks.meta
    min_dte = ctx.input.int("min_dte", 0, 0, 365)
    max_dte = ctx.input.int("max_dte", 30, 0, 730)
    min_oi = ctx.input.int("min_oi", 10, 0, 10000000)
    strike_band = ctx.input.float("strike_band_pct", 20, 1, 100, 1)
    min_volume = ctx.input.int("min_activity_volume", 100, 0, 10000000)
    min_ratio = ctx.input.float("min_volume_oi", 1.5, 0, 100, .1)
    em_days = ctx.input.float("expected_move_days", 1, .1, 365, .5)
    stale_hours = ctx.input.float("history_max_age_hours", 24, .1, 168, 1)
    z_window = ctx.input.int("zscore_snapshots", 20, 3, 200)
    show_history = ctx.input.int("show_history", 1, 0, 1)
    show_levels = ctx.input.int("show_current_levels", 1, 0, 1)
    allow_synthetic = bool(ctx.input.int("allow_synthetic_experiment", 0, 0, 1))
    if min_dte > max_dte:
        raise ValueError("min_dte must not exceed max_dte")
    output_count = 0

    # Each observation becomes available at its recorded UTC timestamp.
    # Never broadcast today's exposure backwards across historical candles.
    if show_history:
        try:
            history = ctx.greeks.history(allow_synthetic)
        except ValueError as exc:
            print(str(exc))
        else:
            age = pd.Timedelta(hours=stale_hours)
            fields = [
                ("total_net_gex", "gex", "GEX USD per 1%", "#eab86b", 1e7),
                ("total_net_vanna", "vanna", "Vanna exposure", "#45c9b0", 1),
                ("total_net_charm", "charm", "Charm exposure", "#df7884", 1),
            ]
            for field, ident, pane, color, factor in fields:
                values = pd.to_numeric(history[field], errors="coerce") * factor
                aligned = values.reindex(bars.index, method="ffill", tolerance=age)
                if not aligned.notna().any():
                    continue
                ctx.plot.line(ident, aligned, pane=pane, color=color, title=f"{meta['ticker']} {ident}")
                output_count += 1
            # Comparable dimensionless scores; window counts snapshots, not candles.
            for field, ident, color in [("total_net_dai", "delta_z", "#879cfa"), ("total_net_vex", "vega_z", "#eab86b")]:
                values = pd.to_numeric(history[field], errors="coerce")
                sd = values.rolling(z_window, min_periods=z_window).std(ddof=0)
                score = (values - values.rolling(z_window, min_periods=z_window).mean()) / sd.where(sd > 0)
                aligned = score.reindex(bars.index, method="ffill", tolerance=age)
                if not aligned.notna().any():
                    continue
                ctx.plot.line(ident, aligned, pane="Delta & Vega Z", color=color)
                output_count += 1
            print(f"History: {len(history)} stored snapshots; no fill before first observation or beyond {stale_hours:g}h. Full-engine totals, unaffected by chain filters.")
            if not output_count:
                print("History panes hidden: no observations align with these candles within the age limit. Change chart range/timeframe or collect overlapping snapshots.")

    if meta.get("replay"):
        print("Replay: current chain, OI changes and static levels withheld. Only eligible historical aggregates are used.")
        if not output_count:
            raise ValueError("Enable show_history and select a replay date with stored Greeks snapshots")
        return

    snap = ctx.greeks.snapshot(allow_synthetic)
    chain = ctx.greeks.chain(allow_synthetic)
    spot = float(snap["spot"])
    contract_size = float(meta["contract_size"])
    data = chain[(chain.dte >= min_dte) & (chain.dte <= max_dte) & (chain.oi >= min_oi)
                 & ((chain.strike / spot - 1).abs() <= strike_band / 100)].copy()
    if data.empty:
        raise ValueError("No contracts pass DTE, OI and strike-band filters. Widen them and Run again.")
    calls = data[data.option_type == "call"]
    puts = data[data.option_type == "put"]
    call_oi, put_oi = calls.oi.sum(), puts.oi.sum()
    call_vol, put_vol = calls.volume.sum(), puts.volume.sum()
    data["premium_proxy"] = data.volume * data.mid_price * contract_size
    data["vol_oi"] = data.volume / data.oi.where(data.oi > 0)
    activity = data[(data.volume >= min_volume) & (data.vol_oi >= min_ratio)].sort_values("premium_proxy", ascending=False)
    print(f"THE GREEKS / {meta['ticker']} / {meta['source']} / snapshot {snap['timestamp']}")
    print(f"Coverage: {len(data)} filtered contracts, {data.expiry.nunique()} expiries. Engine filters apply before these filters.")
    print(f"Call OI {call_oi:,.0f} | Put OI {put_oi:,.0f} | OI PCR {put_oi / call_oi if call_oi else float('nan'):.3f}")
    print(f"Call volume {call_vol:,.0f} | Put volume {put_vol:,.0f} | Volume PCR {put_vol / call_vol if call_vol else float('nan'):.3f}")
    print(f"Filtered GEX USD/1% {data.gex_spotgamma.sum() * 1e7:,.0f} | Gross GEX {data.gex_spotgamma.abs().sum() * 1e7:,.0f}")
    for field in ["vanna_exp", "charm_exp", "delta_exp", "vega_exp"]:
        print(f"{field}: {data[field].sum():,.3f} (engine sign/unit convention)")
    print(f"Mid-price premium activity proxy: {data.premium_proxy.sum():,.0f}. Not actual premium paid; no aggressor/open-close identification.")
    print(f"Unusual activity: {len(activity)} contracts. Calls/puts do not establish bullish/bearish trade direction.")
    for _, row in activity.head(8).iterrows():
        print(f"  {row.expiry} {row.strike:g} {row.option_type} | vol {row.volume:g} OI {row.oi:g} ratio {row.vol_oi:.2f} | proxy {row.premium_proxy:,.0f}")
    expiry_summary = data.groupby("expiry").agg(oi=("oi", "sum"), volume=("volume", "sum"), gex=("gex_spotgamma", "sum"))
    print("By expiry (GEX uses native engine units):\n" + expiry_summary.head(20).to_string())
    changes = ctx.greeks.oi_changes(allow_synthetic)
    if not changes.empty and "delta_oi" in changes:
        print(f"Archived OI comparison: {len(changes)} rows; delta OI {changes.delta_oi.sum():,.0f}. Partial top-GEX archive; not intraday executions.")
    print("Exposure signs are model assumptions; dealer inventory is not observed. No calibrated directional probability is inferred.")

    # Price overlays require matching underlying symbols; no SPY/SPX or BTC/IBIT conversion.
    if show_levels:
        underlying = ctx.symbol.split(":")[-1].upper()
        if underlying != meta["ticker"].upper():
            print(f"Price levels skipped: chart {ctx.symbol} differs from Greeks {meta['ticker']}. Use the source Yahoo chart or edit an explicit mapping.")
        else:
            def level(ident, value, title, color):
                nonlocal output_count
                if value is not None and np.isfinite(float(value)):
                    ctx.plot.hline(ident, float(value), title="NOW · " + title, color=color)
                    output_count += 1
            level("gamma_flip", snap.get("gamma_flip"), "full-engine gamma flip", "#eab86b")
            for side, subset, color in [("call", calls, "#45c9b0"), ("put", puts, "#df7884")]:
                if not subset.empty:
                    by_strike = subset.groupby("strike").gex_spotgamma.sum().abs()
                    if by_strike.max() > 0:
                        level(side + "_wall", by_strike.idxmax(), side + " GEX wall", color)
            # Aggregate selected expiry payout reference; not a single-expiry settlement claim.
            oi = data.pivot_table(index="strike", columns="option_type", values="oi", aggfunc="sum", fill_value=0).sort_index()
            ks = oi.index.to_numpy(dtype=float)
            c = oi.get("call", pd.Series(0, index=oi.index)).to_numpy(dtype=float)
            p = oi.get("put", pd.Series(0, index=oi.index)).to_numpy(dtype=float)
            payout = ks * np.cumsum(c) - np.cumsum(ks * c) + (ks * p).sum() - np.cumsum(ks * p) - ks * (p.sum() - np.cumsum(p))
            level("max_pain", ks[int(np.argmin(payout))], "selected-expiry aggregate max pain", "#879cfa")
            near = data[data.iv > 0].copy()
            if not near.empty:
                # Nearest expiry then nearest strike, both sides. Annualized IV; calendar-day approximation.
                near = near[near.dte == near.dte.min()]
                nearest = (near.strike - spot).abs().min()
                atm_iv = near[(near.strike - spot).abs() == nearest].iv.mean()
                move = spot * atm_iv * np.sqrt(em_days / 365.0)
                level("em_upper", spot + move, f"IV expected move + ({em_days:g}d)", "#74849b")
                level("em_lower", max(0.0, spot - move), f"IV expected move - ({em_days:g}d)", "#74849b")
                print(f"Nearest-expiry ATM IV {atm_iv:.2%}; {em_days:g}-calendar-day approximate move ±{move:.3f}. Not a calibrated probability interval.")
            print("NOW lines are current snapshot reference levels across the chart, not historical signals. HIP-3 perpetual prices may differ from equity spot.")
    if not output_count:
        raise ValueError("No plots: enable history with stored data, or use a matching chart ticker and enable current levels.")
